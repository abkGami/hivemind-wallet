use anchor_lang::prelude::*;
use anchor_lang::system_program;
use crate::state::ColonyState;

// ─────────────────────────────────────────────────────────────
// InitializeColony — instruction accounts
// ─────────────────────────────────────────────────────────────

/// Accounts required to initialise the global colony state.
#[derive(Accounts)]
pub struct InitializeColony<'info> {
    /// Colony authority — pays for account creation and seeds the treasury.
    #[account(mut)]
    pub authority: Signer<'info>,

    /// Global colony PDA.  Created here; seeds = [b"colony"].
    #[account(
        init,
        payer = authority,
        space = ColonyState::SPACE,
        seeds = [b"colony"],
        bump,
    )]
    pub colony: Account<'info, ColonyState>,

    /// Treasury PDA — a system-owned account that holds reserve SOL.
    /// Seeds = [b"treasury", colony.key()].
    /// CHECK: This is a raw system account used purely as a SOL vault.
    /// Its address is derived deterministically from the colony PDA, so
    /// no additional data validation is required here.
    #[account(
        mut,
        seeds = [b"treasury", colony.key().as_ref()],
        bump,
    )]
    pub treasury: SystemAccount<'info>,

    pub system_program: Program<'info, System>,
}

// ─────────────────────────────────────────────────────────────
// initialize_colony — handler
// ─────────────────────────────────────────────────────────────

/// Initialises the colony singleton and funds the treasury with 1 SOL.
///
/// # Parameters
/// * `ctx` — Anchor context containing all validated accounts.
///
/// # Actions
/// 1. Populates `ColonyState` fields.
/// 2. Transfers 1 SOL (1_000_000_000 lamports) from `authority` to `treasury`
///    via a CPI to the System Program.
///
/// # Errors
/// Returns a Solana system-program error if the authority lacks sufficient
/// balance to fund the treasury transfer.
pub fn initialize_colony(ctx: Context<InitializeColony>) -> Result<()> {
    let colony = &mut ctx.accounts.colony;
    let bump = ctx.bumps.colony;

    // Populate colony state with initial values.
    colony.authority = ctx.accounts.authority.key();
    colony.agent_count = 0;
    colony.treasury = ctx.accounts.treasury.key();
    colony.total_transactions = 0;
    colony.bump = bump;

    // Transfer 1 SOL from authority to treasury PDA via CPI.
    let cpi_ctx = CpiContext::new(
        ctx.accounts.system_program.to_account_info(),
        system_program::Transfer {
            from: ctx.accounts.authority.to_account_info(),
            to: ctx.accounts.treasury.to_account_info(),
        },
    );
    system_program::transfer(cpi_ctx, 1_000_000_000)?;

    msg!(
        "[COLONY] Colony initialised. Authority: {}, Treasury: {}",
        colony.authority,
        colony.treasury
    );

    Ok(())
}
