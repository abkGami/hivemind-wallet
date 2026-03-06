use anchor_lang::prelude::*;

// ─────────────────────────────────────────────────────────────
// AgentRole — identifies which function an agent performs in the
// colony. Serialisable via Borsh, clonable and copyable so it
// can be stored inside account structs without heap allocation.
// ─────────────────────────────────────────────────────────────
#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
pub enum AgentRole {
    /// Fetches external price signals and forwards them for analysis.
    Scout,
    /// Analyses incoming signals and decides whether to act.
    Analyst,
    /// Signs and broadcasts (simulated) swap transactions.
    Executor,
    /// Records outcomes on-chain and maintains colony treasury accounting.
    Ledger,
}

// ─────────────────────────────────────────────────────────────
// ColonyState
// Global singleton PDA — seeds: [b"colony"]
// Holds high-level metadata about the whole agent colony.
// ─────────────────────────────────────────────────────────────
#[account]
#[derive(Debug)]
pub struct ColonyState {
    /// The wallet that deployed and governs this colony.
    pub authority: Pubkey,           // 32 bytes
    /// Running count of registered agents (max 255 — u8 ceiling).
    pub agent_count: u8,             // 1 byte
    /// Pubkey of the colony treasury PDA that holds reserve SOL.
    pub treasury: Pubkey,            // 32 bytes
    /// Cumulative number of agent-to-agent transactions ever executed.
    pub total_transactions: u64,     // 8 bytes
    /// Canonical bump stored to avoid recomputation in CPIs.
    pub bump: u8,                    // 1 byte
}

impl ColonyState {
    /// Total on-chain space: 8 (discriminator) + fields.
    pub const SPACE: usize = 8 + 32 + 1 + 32 + 8 + 1;
}

// ─────────────────────────────────────────────────────────────
// AgentState
// Per-agent PDA — seeds: [b"agent", colony.key(), agent_index]
// Tracks identity, spending limits, reputation, and daily accounting.
// ─────────────────────────────────────────────────────────────
#[account]
#[derive(Debug)]
pub struct AgentState {
    /// The colony this agent belongs to.
    pub colony: Pubkey,              // 32 bytes
    /// Zero-based index assigned at registration time.
    pub agent_index: u8,             // 1 byte
    /// Functional role of this agent in the colony.
    pub role: AgentRole,             // 1 byte (Borsh enum)
    /// The PDA vault that holds this agent's SOL balance.
    pub vault: Pubkey,               // 32 bytes
    /// Reputation score — starts at 100, range 0–1000.
    /// Drops to 0 triggers automatic freeze.
    pub reputation: u64,             // 8 bytes
    /// Maximum lamports this agent can spend within a 24-hour window.
    pub daily_limit: u64,            // 8 bytes
    /// Maximum lamports allowed in a single `agent_pay` call.
    pub per_tx_limit: u64,           // 8 bytes
    /// Accumulated lamports spent in the current 24-hour window.
    pub daily_spent: u64,            // 8 bytes
    /// Unix timestamp (seconds) when `daily_spent` was last reset to 0.
    pub last_reset: i64,             // 8 bytes
    /// If true this agent cannot send payments until unfrozen.
    pub is_frozen: bool,             // 1 byte
    /// Total tasks assigned to this agent (success + failure combined).
    pub total_tasks: u64,            // 8 bytes
    /// Tasks that completed with a `success == true` outcome report.
    pub successful_tasks: u64,       // 8 bytes
    /// Canonical bump stored to avoid recomputation in CPIs.
    pub bump: u8,                    // 1 byte
}

impl AgentState {
    /// Total on-chain space: 8 (discriminator) + fields.
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 32 + 8 + 8 + 8 + 8 + 8 + 1 + 8 + 8 + 1;

    /// Resets `daily_spent` to 0 if 86 400 seconds (24 hours) have elapsed
    /// since `last_reset`.  Updates `last_reset` to `current_time` on reset.
    ///
    /// # Parameters
    /// * `current_time` — current Unix timestamp from `Clock::get()`.
    pub fn reset_daily_if_needed(&mut self, current_time: i64) {
        if current_time - self.last_reset >= 86_400 {
            self.daily_spent = 0;
            self.last_reset = current_time;
        }
    }
}

// ─────────────────────────────────────────────────────────────
// TransactionLog
// Append-only record PDA — seeds: [b"log", colony.key(), log_index (le bytes)]
// One account per payment; never mutated after creation.
// ─────────────────────────────────────────────────────────────
#[account]
#[derive(Debug)]
pub struct TransactionLog {
    /// The colony this log entry belongs to.
    pub colony: Pubkey,              // 32 bytes
    /// `agent_index` of the paying agent.
    pub from_agent: u8,              // 1 byte
    /// `agent_index` of the receiving agent.
    pub to_agent: u8,                // 1 byte
    /// Transfer amount in lamports.
    pub amount: u64,                 // 8 bytes
    /// SHA-256 hash of the task description string (32 bytes).
    pub task_id: [u8; 32],           // 32 bytes
    /// Unix timestamp when this transaction was recorded.
    pub timestamp: i64,              // 8 bytes
    /// Whether the downstream task was reported as successful.
    pub success: bool,               // 1 byte
    /// Canonical bump stored to avoid recomputation.
    pub bump: u8,                    // 1 byte
}

impl TransactionLog {
    /// Total on-chain space: 8 (discriminator) + fields.
    pub const SPACE: usize = 8 + 32 + 1 + 1 + 8 + 32 + 8 + 1 + 1;
}
