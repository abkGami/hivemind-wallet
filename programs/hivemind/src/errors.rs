use anchor_lang::prelude::*;

// ─────────────────────────────────────────────────────────────
// HivemindError — all custom on-chain error codes for the
// Hivemind colony program.  Anchor maps each variant to a
// u32 error code (starting at 6000 by default) and includes
// the message string in the transaction error response so that
// clients and tests can display human-readable failure reasons.
// ─────────────────────────────────────────────────────────────
#[error_code]
pub enum HivemindError {
    /// Returned when a frozen agent attempts to send a payment.
    #[msg("This agent has been frozen by the colony authority")]
    AgentFrozen,

    /// Returned when accumulating `amount` would push `daily_spent`
    /// above the agent's configured `daily_limit`.
    #[msg("Transaction would exceed agent's daily spending limit")]
    DailyLimitExceeded,

    /// Returned when a single payment `amount` exceeds `per_tx_limit`.
    #[msg("Transaction amount exceeds per-transaction limit")]
    PerTxLimitExceeded,

    /// Returned when the sending vault PDA holds fewer lamports than
    /// the requested transfer amount (plus rent-exempt minimum).
    #[msg("Agent vault does not have enough SOL")]
    InsufficientVaultBalance,

    /// Returned when an agent attempts an action reserved for a
    /// different role (e.g. a Scout calling Ledger-only functions).
    #[msg("This agent role cannot perform this action")]
    UnauthorizedRole,

    /// Returned when `agent_count` is already at 255 — the maximum
    /// supported by the u8 counter in ColonyState.
    #[msg("Colony has reached maximum agent capacity (255)")]
    ColonyFull,

    /// Returned when a reputation value is computed to be outside 0–1000
    /// (should normally be unreachable given saturating arithmetic).
    #[msg("Reputation value is out of valid range")]
    InvalidReputation,

    /// Returned when the `from_agent` and `to_agent` indices are the same
    /// in an `agent_pay` call — an agent cannot pay itself.
    #[msg("An agent cannot pay itself")]
    SelfPaymentNotAllowed,
}
