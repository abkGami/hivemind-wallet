use anchor_lang::prelude::*;
use crate::state::{AgentState, ColonyState};

// ─────────────────────────────────────────────────────────────
// ReputationUpdateEvent — emitted after every outcome report.
// ─────────────────────────────────────────────────────────────

/// On-chain event emitted by `report_outcome` after updating reputation.
#[event]
pub struct ReputationUpdateEvent {
    /// Zero-based index of the agent whose reputation changed.
    pub agent_index: u8,
    /// Reputation score before this update.
    pub old_reputation: u64,
    /// Reputation score after this update.
    pub new_reputation: u64,
    /// Whether the task was reported as successful.
    pub success: bool,
}

// ─────────────────────────────────────────────────────────────
// ReportOutcome — instruction accounts
// ─────────────────────────────────────────────────────────────

/// Accounts required to report a task outcome for an agent.
#[derive(Accounts)]
pub struct ReportOutcome<'info> {
    /// Only the colony authority can report outcomes.
    pub authority: Signer<'info>,

    /// Colony state — used to verify the reporting authority.
    #[account(
        seeds = [b"colony"],
        bump = colony.bump,
        constraint = colony.authority == authority.key(),
    )]
    pub colony: Account<'info, ColonyState>,

    /// The agent whose reputation and task counters are updated.
    #[account(
        mut,
        seeds = [b"agent", colony.key().as_ref(), &[agent.agent_index]],
        bump = agent.bump,
    )]
    pub agent: Account<'info, AgentState>,
}

// ─────────────────────────────────────────────────────────────
// report_outcome — handler
// ─────────────────────────────────────────────────────────────

/// Updates an agent's reputation and task counters based on task outcome.
///
/// # Parameters
/// * `ctx`     — Anchor context with all validated accounts.
/// * `success` — `true` if the task completed successfully; `false` otherwise.
///
/// # Reputation rules
/// * Success: `reputation = min(reputation + 5, 1000)`, `successful_tasks += 1`
/// * Failure: `reputation = reputation.saturating_sub(10)`.
///   If reputation reaches 0, the agent is automatically frozen.
/// * Always: `total_tasks += 1`
#[allow(clippy::result_large_err)]
pub fn report_outcome(ctx: Context<ReportOutcome>, success: bool) -> Result<()> {
    let agent = &mut ctx.accounts.agent;
    let old_reputation = agent.reputation;

    if success {
        // Cap reputation at 1000.
        agent.reputation = agent.reputation.saturating_add(5).min(1_000);
        agent.successful_tasks = agent.successful_tasks.saturating_add(1);
    } else {
        // Saturating subtraction prevents underflow below 0.
        agent.reputation = agent.reputation.saturating_sub(10);

        // Auto-freeze the agent when reputation hits zero.
        if agent.reputation == 0 {
            agent.is_frozen = true;
            msg!(
                "[COLONY] Agent {} auto-frozen — reputation reached 0",
                agent.agent_index
            );
        }
    }

    agent.total_tasks = agent.total_tasks.saturating_add(1);

    // Emit reputation change event for off-chain monitoring.
    emit!(ReputationUpdateEvent {
        agent_index: agent.agent_index,
        old_reputation,
        new_reputation: agent.reputation,
        success,
    });

    msg!(
        "[COLONY] report_outcome: Agent {} | success={} | rep {} → {}",
        agent.agent_index,
        success,
        old_reputation,
        agent.reputation,
    );

    Ok(())
}
