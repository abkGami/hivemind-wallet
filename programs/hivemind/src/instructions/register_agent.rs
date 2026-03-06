use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::{AgentRole, AgentState, ColonyState};
use crate::errors::HivemindError;

// ─────────────────────────────────────────────────────────────
// RegisterAgent — instruction accounts
// ─────────────────────────────────────────────────────────────

/// Accounts required to register a new agent in the colony.
#[derive(Accounts)]
#[instruction(role: AgentRole, daily_limit: u64, per_tx_limit: u64)]
pub struct RegisterAgent<'info> {
    /// Only the colony authority can register new agents.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Colony global state — agent_count is incremented here.
    #[account(
        mut,
        seeds = [b"colony"],
        bump = colony.bump,
        constraint = colony.authority == authority.key(),
    )]
    pub colony: Account<'info, ColonyState>,

    /// Treasury PDA — source of the initial 0.5 SOL vault funding.
    /// CHECK: Raw system account validated by seeds; holds colony reserve SOL.
    #[account(
        mut,
        seeds = [b"treasury", colony.key().as_ref()],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    /// AgentState PDA — created here.
    /// Seeds = [b"agent", colony.key(), agent_index].
    #[account(
        init,
        payer = authority,
        space = AgentState::SPACE,
        seeds = [b"agent", colony.key().as_ref(), &[colony.agent_count]],
        bump,
    )]
    pub agent_state: Account<'info, AgentState>,

    /// Vault PDA — a system-owned SOL holder for this agent.
    /// Seeds = [b"vault", agent_state.key()].
    /// CHECK: Raw system account acting as the agent's SOL vault.
    /// Access is controlled exclusively by on-chain PDA signing.
    #[account(
        mut,
        seeds = [b"vault", agent_state.key().as_ref()],
        bump,
    )]
    pub vault: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────
// register_agent — handler
// ─────────────────────────────────────────────────────────────

/// Registers a new autonomous agent in the colony.
///
/// # Parameters
/// * `ctx`         — Anchor context with all validated accounts.
/// * `role`        — Functional role (`Scout`, `Analyst`, `Executor`, `Ledger`).
/// * `daily_limit` — Maximum lamports the agent may spend in a 24-hour window.
/// * `per_tx_limit`— Maximum lamports allowed in a single `agent_pay` call.
///
/// # Errors
/// * `HivemindError::ColonyFull`         — `agent_count` is already 255.
/// * `HivemindError::PerTxLimitExceeded` — `per_tx_limit > daily_limit`.
pub fn register_agent(
    ctx: Context<RegisterAgent>,
    role: AgentRole,
    daily_limit: u64,
    per_tx_limit: u64,
) -> Result<()> {
    // Guard: colony cannot exceed 255 agents (u8 limit).
    require!(ctx.accounts.colony.agent_count < 255, HivemindError::ColonyFull);

    // Guard: per-transaction limit must not exceed the daily budget.
    require!(per_tx_limit <= daily_limit, HivemindError::PerTxLimitExceeded);

    let colony = &mut ctx.accounts.colony;
    let agent_state = &mut ctx.accounts.agent_state;
    let clock = Clock::get()?;

    // Populate the new AgentState.
    agent_state.colony = colony.key();
    agent_state.agent_index = colony.agent_count;
    agent_state.role = role;
    agent_state.vault = ctx.accounts.vault.key();
    agent_state.reputation = 100;
    agent_state.daily_limit = daily_limit;
    agent_state.per_tx_limit = per_tx_limit;
    agent_state.daily_spent = 0;
    agent_state.last_reset = clock.unix_timestamp;
    agent_state.is_frozen = false;
    agent_state.total_tasks = 0;
    agent_state.successful_tasks = 0;
    agent_state.bump = ctx.bumps.agent_state;

    // Transfer 0.5 SOL from treasury to the new agent vault using treasury
    // PDA signer seeds so the system program accepts the CPI.
    let treasury_seeds: &[&[u8]] = &[
        b"treasury",
        colony.to_account_info().key.as_ref(),
        &[ctx.bumps.treasury],
    ];
    let signer_seeds = &[treasury_seeds];

    let cpi_ctx = CpiContext::new_with_signer(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.treasury.to_account_info(),
            to: ctx.accounts.vault.to_account_info(),
        },
        signer_seeds,
    );
    system_program::transfer(cpi_ctx, 500_000_000)?; // 0.5 SOL

    // Increment colony agent count.
    colony.agent_count += 1;

    msg!(
        "[COLONY] Agent {} registered. Role: {:?}, Vault: {}, DailyLimit: {}, PerTxLimit: {}",
        agent_state.agent_index,
        agent_state.role,
        agent_state.vault,
        daily_limit,
        per_tx_limit,
    );

    Ok(())
}
