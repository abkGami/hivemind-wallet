//! # Hivemind Colony Program
//!
//! An on-chain Anchor program that governs a colony of autonomous AI agents on
//! Solana devnet.  Each agent owns a PDA vault; the program is the sole entity
//! that can sign transfers out of those vaults, enforcing spending limits,
//! reputation tracking, and emergency freeze capabilities.
//!
//! ## Program Architecture
//! ```
//! ColonyState (singleton PDA)
//!   └─► AgentState × N  (per-agent PDAs)
//!         └─► VaultPDA  (system-owned SOL holder)
//!   └─► TreasuryPDA     (colony reserve SOL)
//!   └─► TransactionLog × M (append-only payment records)
//! ```

use anchor_lang::prelude::*;

pub mod errors;
pub mod instructions;
pub mod state;

use instructions::*;
use state::AgentRole;

// Re-export events so external crates and the IDL generator can reference them.
pub use instructions::agent_pay::AgentPayEvent;
pub use instructions::emergency_freeze::AgentFreezeEvent;
pub use instructions::report_outcome::ReputationUpdateEvent;

// ---------------------------------------------------------------------------
// Program ID
// Replace with the actual program ID after `anchor build && anchor deploy`.
// ---------------------------------------------------------------------------
declare_id!("2wRN9Nrd5USVo5oVWjyfYiRgN6nrJMW5vDpscx7iRRZn");

// ---------------------------------------------------------------------------
// Program entry-point
// ---------------------------------------------------------------------------

#[program]
pub mod hivemind {
    use super::*;

    // ───────────────────────────────────────────────────────
    // Colony lifecycle
    // ───────────────────────────────────────────────────────

    /// Creates the global colony PDA and seeds the treasury with 1 SOL.
    ///
    /// Must be called exactly once by the deploying authority before any
    /// agents are registered.
    pub fn initialize_colony(ctx: Context<InitializeColony>) -> Result<()> {
        instructions::initialize_colony::initialize_colony(ctx)
    }

    /// Registers a new agent in the colony, creates its vault PDA, and
    /// funds the vault with 0.5 SOL from the colony treasury.
    ///
    /// # Parameters
    /// * `role`         — Functional role (`Scout = 0`, `Analyst = 1`, `Executor = 2`, `Ledger = 3`).
    /// * `daily_limit`  — Maximum lamports spendable in a 24-hour window.
    /// * `per_tx_limit` — Maximum lamports per single `agent_pay` call.
    pub fn register_agent(
        ctx: Context<RegisterAgent>,
        role: AgentRole,
        daily_limit: u64,
        per_tx_limit: u64,
    ) -> Result<()> {
        instructions::register_agent::register_agent(ctx, role, daily_limit, per_tx_limit)
    }

    // ───────────────────────────────────────────────────────
    // Agent interactions
    // ───────────────────────────────────────────────────────

    /// Transfers `amount` lamports from one agent vault to another,
    /// enforcing all spending rules and creating an immutable `TransactionLog`.
    ///
    /// # Parameters
    /// * `amount`  — Lamports to transfer.
    /// * `task_id` — 32-byte SHA-256 hash of the task description string,
    ///               used to correlate payments with off-chain task records.
    pub fn agent_pay(ctx: Context<AgentPay>, amount: u64, task_id: [u8; 32]) -> Result<()> {
        instructions::agent_pay::agent_pay(ctx, amount, task_id)
    }

    /// Updates an agent's reputation and task counters after a task
    /// completes.  Only callable by the colony authority.
    ///
    /// # Parameters
    /// * `success` — `true` if the task succeeded (+5 reputation), `false` if it failed (-10 reputation).
    pub fn report_outcome(ctx: Context<ReportOutcome>, success: bool) -> Result<()> {
        instructions::report_outcome::report_outcome(ctx, success)
    }

    /// Freezes or unfreezes an agent.  A frozen agent cannot initiate payments.
    /// Only callable by the colony authority.
    ///
    /// # Parameters
    /// * `freeze` — `true` to freeze; `false` to unfreeze.
    pub fn emergency_freeze(ctx: Context<EmergencyFreeze>, freeze: bool) -> Result<()> {
        instructions::emergency_freeze::emergency_freeze(ctx, freeze)
    }
}
