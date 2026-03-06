use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{AgentState, ColonyState, TransactionLog};
use crate::errors::HivemindError;

// ─────────────────────────────────────────────────────────────
// AgentPayEvent — emitted after every successful payment.
// ─────────────────────────────────────────────────────────────

/// On-chain event broadcasted by `agent_pay` upon successful transfer.
#[event]
pub struct AgentPayEvent {
    /// Agent index of the payer.
    pub from: u8,
    /// Agent index of the recipient.
    pub to: u8,
    /// Transfer amount in lamports.
    pub amount: u64,
    /// SHA-256 hash of the task description (matches `TransactionLog.task_id`).
    pub task_id: [u8; 32],
    /// Unix timestamp when the transfer was executed.
    pub timestamp: i64,
}

// ─────────────────────────────────────────────────────────────
// AgentPay — instruction accounts
// ─────────────────────────────────────────────────────────────

/// Accounts required to transfer lamports between two agent vaults.
#[derive(Accounts)]
#[instruction(amount: u64, task_id: [u8; 32])]
pub struct AgentPay<'info> {
    /// Transaction initiator — must be the colony authority.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Colony state — used to validate authority and increment tx counter.
    #[account(
        mut,
        seeds = [b"colony"],
        bump = colony.bump,
        constraint = colony.authority == authority.key(),
    )]
    pub colony: Account<'info, ColonyState>,

    /// Paying agent's state account.
    #[account(
        mut,
        seeds = [b"agent", colony.key().as_ref(), &[from_agent.agent_index]],
        bump = from_agent.bump,
    )]
    pub from_agent: Account<'info, AgentState>,

    /// Paying agent's vault — lamports deducted from here.
    /// CHECK: System-owned PDA vault; seeds validated against from_agent.vault.
    #[account(
        mut,
        seeds = [b"vault", from_agent.key().as_ref()],
        bump,
        constraint = from_agent.vault == vault_from.key(),
    )]
    pub vault_from: SystemAccount<'info>,

    /// Receiving agent's state account.
    #[account(
        mut,
        seeds = [b"agent", colony.key().as_ref(), &[to_agent.agent_index]],
        bump = to_agent.bump,
    )]
    pub to_agent: Account<'info, AgentState>,

    /// Receiving agent's vault — lamports deposited here.
    /// CHECK: System-owned PDA vault; seeds validated against to_agent.vault.
    #[account(
        mut,
        seeds = [b"vault", to_agent.key().as_ref()],
        bump,
        constraint = to_agent.vault == vault_to.key(),
    )]
    pub vault_to: SystemAccount<'info>,

    /// Append-only log entry created for this payment.
    /// Seeds = [b"log", colony.key(), total_transactions as le bytes].
    #[account(
        init,
        payer = authority,
        space = TransactionLog::SPACE,
        seeds = [
            b"log",
            colony.key().as_ref(),
            &colony.total_transactions.to_le_bytes(),
        ],
        bump,
    )]
    pub transaction_log: Account<'info, TransactionLog>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────
// agent_pay — handler
// ─────────────────────────────────────────────────────────────

/// Transfers `amount` lamports from `from_agent.vault` to `to_agent.vault`,
/// enforcing spending limits, frozen status, and self-payment prevention.
///
/// # Parameters
/// * `ctx`     — Anchor context containing all validated accounts.
/// * `amount`  — Lamports to transfer.
/// * `task_id` — 32-byte SHA-256 hash of the task description string.
///
/// # Errors
/// * `HivemindError::SelfPaymentNotAllowed`    — `from` and `to` are the same agent.
/// * `HivemindError::AgentFrozen`              — The paying agent is frozen.
/// * `HivemindError::PerTxLimitExceeded`       — `amount > from_agent.per_tx_limit`.
/// * `HivemindError::DailyLimitExceeded`       — Cumulative spend would exceed `daily_limit`.
/// * `HivemindError::InsufficientVaultBalance` — Vault lamports < amount.
#[allow(clippy::result_large_err)]
pub fn agent_pay(ctx: Context<AgentPay>, amount: u64, task_id: [u8; 32]) -> Result<()> {
    let clock = Clock::get()?;

    // Self-payment guard.
    require!(
        ctx.accounts.from_agent.agent_index != ctx.accounts.to_agent.agent_index,
        HivemindError::SelfPaymentNotAllowed
    );

    // Reset daily spending budget if 24 hours have elapsed.
    {
        let from = &mut ctx.accounts.from_agent;
        from.reset_daily_if_needed(clock.unix_timestamp);
    }

    let from = &ctx.accounts.from_agent;

    // Frozen guard.
    require!(!from.is_frozen, HivemindError::AgentFrozen);

    // Per-transaction limit guard.
    require!(amount <= from.per_tx_limit, HivemindError::PerTxLimitExceeded);

    // Daily limit guard.
    require!(
        from.daily_spent.saturating_add(amount) <= from.daily_limit,
        HivemindError::DailyLimitExceeded
    );

    // Vault balance guard — vault must hold amount plus remain rent-exempt.
    let vault_lamports = ctx.accounts.vault_from.lamports();
    require!(vault_lamports >= amount, HivemindError::InsufficientVaultBalance);

    // Derive vault signer seeds for the CPI.
    let from_agent_key = ctx.accounts.from_agent.key();
    let vault_bump = ctx.bumps.vault_from;
    let vault_seeds: &[&[u8]] = &[
        b"vault",
        from_agent_key.as_ref(),
        &[vault_bump],
    ];
    let signer_seeds = &[vault_seeds];

    // CPI: transfer lamports from vault_from → vault_to.
    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.vault_from.to_account_info(),
            to: ctx.accounts.vault_to.to_account_info(),
        },
        signer_seeds,
    );
    system_program::transfer(cpi_ctx, amount)?;

    // Update from_agent accounting.
    {
        let from = &mut ctx.accounts.from_agent;
        from.daily_spent = from.daily_spent.saturating_add(amount);
    }

    // Increment colony-wide transaction counter.
    ctx.accounts.colony.total_transactions =
        ctx.accounts.colony.total_transactions.saturating_add(1);

    // Populate the transaction log.
    {
        let log = &mut ctx.accounts.transaction_log;
        log.colony = ctx.accounts.colony.key();
        log.from_agent = ctx.accounts.from_agent.agent_index;
        log.to_agent = ctx.accounts.to_agent.agent_index;
        log.amount = amount;
        log.task_id = task_id;
        log.timestamp = clock.unix_timestamp;
        log.success = true; // payment itself succeeded; outcome reported separately
        log.bump = ctx.bumps.transaction_log;
    }

    // Emit the payment event for off-chain indexers and the dashboard.
    emit!(AgentPayEvent {
        from: ctx.accounts.from_agent.agent_index,
        to: ctx.accounts.to_agent.agent_index,
        amount,
        task_id,
        timestamp: clock.unix_timestamp,
    });

    msg!(
        "[COLONY] agent_pay: Agent {} → Agent {} | {} lamports | task_id: {:?}",
        ctx.accounts.from_agent.agent_index,
        ctx.accounts.to_agent.agent_index,
        amount,
        task_id,
    );

    Ok(())
}
