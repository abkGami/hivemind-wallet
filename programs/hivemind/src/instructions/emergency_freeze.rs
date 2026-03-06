use anchor_lang::prelude::*;
use crate::state::{AgentState, ColonyState};

// ─────────────────────────────────────────────────────────────
// AgentFreezeEvent — emitted after every freeze/unfreeze action.
// ─────────────────────────────────────────────────────────────

/// On-chain event emitted by `emergency_freeze` upon state change.
#[event]
pub struct AgentFreezeEvent {
    /// Zero-based index of the agent that was frozen or unfrozen.
    pub agent_index: u8,
    /// The authority that triggered this action.
    pub frozen_by: Pubkey,
    /// Unix timestamp when the freeze/unfreeze occurred.
    pub timestamp: i64,
    /// New frozen state: `true` = frozen, `false` = active.
    pub is_frozen: bool,
}

// ─────────────────────────────────────────────────────────────
// EmergencyFreeze — instruction accounts
// ─────────────────────────────────────────────────────────────

/// Accounts required to freeze or unfreeze an agent.
#[derive(Accounts)]
pub struct EmergencyFreeze<'info> {
    /// Only the colony authority may freeze/unfreeze agents.
    pub authority: Signer<'info>,

    /// Colony state — authority is verified against this account.
    #[account(
        seeds = [b"colony"],
        bump = colony.bump,
        // Explicit constraint matches the prompt requirement.
        constraint = colony.authority == authority.key(),
    )]
    pub colony: Account<'info, ColonyState>,

    /// The agent whose `is_frozen` flag will be toggled.
    #[account(
        mut,
        seeds = [b"agent", colony.key().as_ref(), &[agent.agent_index]],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentState>,
}

// ─────────────────────────────────────────────────────────────
// emergency_freeze — handler
// ─────────────────────────────────────────────────────────────

/// Freezes or unfreezes an agent by toggling its `is_frozen` flag.
///
/// A frozen agent cannot initiate `agent_pay` transactions until unfrozen.
/// This instruction is callable exclusively by the colony authority.
///
/// # Parameters
/// * `ctx`    — Anchor context with all validated accounts.
/// * `freeze` — `true` to freeze the agent; `false` to unfreeze.
pub fn emergency_freeze(ctx: Context<EmergencyFreeze>, freeze: bool) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let clock = Clock::get()?;

    agent.is_frozen = freeze;

    // Emit event so the dashboard and off-chain monitors can react immediately.
    emit!(AgentFreezeEvent {
        agent_index: agent.agent_index,
        frozen_by: ctx.accounts.authority.key(),
        timestamp: clock.unix_timestamp,
        is_frozen: freeze,
    });

    msg!(
        "[COLONY] emergency_freeze: Agent {} | frozen={} | by {}",
        agent.agent_index,
        freeze,
        ctx.accounts.authority.key(),
    );

    Ok(())
}
