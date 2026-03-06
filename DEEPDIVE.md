# HIVEMIND WALLET — Deep Dive

## 1. Why PDA Wallets?

Program Derived Addresses (PDAs) are the cornerstone of trustless agent autonomy on Solana.

**Traditional keypair wallets** require a secret key to sign transactions. Storing a secret key in an agent process introduces a single point of failure: if the host is compromised, all funds are at risk, and there is no on-chain mechanism to set spending limits, freeze the wallet, or audit every transfer in an immutable log.

**PDA vaults** have no private keys. The vault account is a system-owned account whose address is derived deterministically from a seed and the program ID. Only the on-chain program itself can sign CPIs that move funds out of the vault — using the canonical `invoke_signed` pattern with the PDA's bump seed. This means:

- **No private key exposure** — there is no key to steal. An attacker who compromises the agent process gets nothing, because the signing authority is the on-chain program, not a key in memory.
- **On-chain access control** — every transfer is validated against spending limits, freeze flags, and self-payment prevention, checked atomically within the same transaction.
- **Composability** — other on-chain programs can verify the PDA address for any agent permissionlessly, enabling cross-colony interactions in the future.
- **Immutable audit trail** — every `agent_pay` call creates a `TransactionLog` account that persists on-chain forever.

---

## 2. Colony Program Architecture

```
                   ┌─────────────────────────────────────────┐
                   │          hivemind program                │
                   │  (program ID: HivE111…)                  │
                   └──────┬──────────────────────────────────┘
                          │ CPI  (invoke_signed)
          ┌───────────────┼────────────────────────┐
          │               │                        │
  ┌───────▼──────┐ ┌──────▼──────┐ ┌──────────────▼──────┐
  │ ColonyState  │ │  AgentState │ │  TransactionLog      │
  │ PDA          │ │  PDA × N    │ │  PDA × M (immutable) │
  │  seeds:      │ │  seeds:     │ │  seeds:              │
  │  ["colony"]  │ │  ["agent",  │ │  ["log",             │
  │              │ │   colony,   │ │   colony,            │
  │  authority   │ │   index]    │ │   tx_counter_le8]    │
  │  agent_count │ │             │ │                      │
  │  treasury    │ │  role       │ │  from, to, amount    │
  │  total_txns  │ │  vault      │ │  task_id, timestamp  │
  └──────────────┘ │  reputation │ └──────────────────────┘
                   │  limits     │
                   │  is_frozen  │
                   └──────┬──────┘
                          │ seeds: ["vault", agent_state]
                   ┌──────▼──────┐
                   │  Vault PDA  │ ← system-owned, holds SOL
                   │  (no owner  │
                   │  code, just │
                   │  lamports)  │
                   └─────────────┘
```

Account hierarchy:
1. **ColonyState** — singleton. All agents reference it for authority checks.
2. **AgentState × N** — one per registered agent. Contains role, limits, reputation.
3. **Vault PDA** — derived from `AgentState`. SOL vault controlled by program CPI.
4. **TreasuryPDA** — colony reserve; seeds `["treasury", colony]`. Funds initial vault distribution.
5. **TransactionLog × M** — one per successful `agent_pay`. Immutable once created.

---

## 3. Agent-to-Agent Payment Protocol

Step-by-step walkthrough of a Scout → Analyst payment (5 000 lamports, task_id = SHA256("scout-signal-xyz")):

```
[Off-chain: Scout agent]
1. Jupiter: SOL price = $182.43
2. Groq LLM: signal = "BUY"
3. taskId = SHA256(JSON.stringify({ signal, price, timestamp }))

[On-chain: agent_pay instruction]
4. Anchor validates all account seeds (PDA bumps checked against stored values)
5. from_agent.reset_daily_if_needed(Clock::get()?.unix_timestamp)
6. Guards: !is_frozen, amount≤per_tx_limit, daily_spent+amount≤daily_limit, vault_lamports≥amount
7. invoke_signed(
     system_program::Transfer { from: vault_from, to: vault_to },
     signer_seeds: [b"vault", from_agent.key(), &[vault_bump]]
   )
8. from_agent.daily_spent += 5_000
9. colony.total_transactions += 1
10. TransactionLog account created with all fields including task_id
11. Event emitted: AgentPayEvent { from: 0, to: 1, amount: 5000, task_id, timestamp }

[Off-chain: EventEmitter]
12. "signal" event fires → AnalystAgent.handleSignal() starts
```

The vault PDA's signer seeds are `[b"vault", agent_state.key().as_ref(), &[bump]]`. The program passes these to `CpiContext::new_with_signer` which causes the Solana runtime to validate that the derived address matches `vault_from` and authorises the system program transfer.

---

## 4. Key Management Strategy

| Component | Key strategy |
|---|---|
| Colony Authority | Single `Keypair` loaded from `AUTHORITY_KEYPAIR` env var at startup. Never logged. Never written to disk post-load. |
| Agent Vaults | **No private key.** Vault is a system-owned PDA. Only the on-chain program can move its lamports. |
| Instruction signing | Program signs vault CPI using `invoke_signed` with PDA bump seeds. |

The authority keypair is the only secret in the system. Even if it was compromised:
- Per-transaction limits and daily limits remain enforced on-chain.
- The attacker cannot bypass the on-chain checks to drain vaults in bulk.
- A single `emergency_freeze` call from a secondary authority multisig would halt all activity.

**Recommended production hardening**: migrate the authority to a Squads multisig, requiring M-of-N governance signatures for any sensitive instructions.

---

## 5. Spending Limits & Daily Resets

On-chain enforcement is categorically superior to off-chain checks because:
- **Atomicity** — the limit check and the transfer are in the same transaction. There is no race condition between check and execution.
- **Trustlessness** — no off-chain oracle or middleware can be bribed or compromised to bypass the limit.
- **Immutable audit** — every spend is reflected in `daily_spent` on the AgentState, readable by any other Solana program.

**Daily reset mechanism:**
```rust
pub fn reset_daily_if_needed(&mut self, current_time: i64) {
    if current_time - self.last_reset >= 86_400 {
        self.daily_spent = 0;
        self.last_reset = current_time;
    }
}
```

`current_time` comes from `Clock::get()?.unix_timestamp` — the Solana cluster's consensus time. This is called at the start of every `agent_pay` instruction before any limit checks, ensuring that a new 24-hour window opens automatically without requiring a separate cron instruction.

---

## 6. Reputation System

**Mechanics:**
- Initial reputation: 100
- Success: `+5` (capped at 1 000)
- Failure: `−10` (saturating_sub, auto-freeze at 0)

**Break-even analysis:**

Let $p$ = task success rate, $r_0$ = initial reputation.

Expected reputation after $N$ tasks:

$$E[r_N] = r_0 + N \cdot (5p - 10(1-p)) = r_0 + N(15p - 10)$$

Break-even: $15p - 10 = 0 \Rightarrow p = \frac{10}{15} = \overline{0.6}$

An agent must succeed in at least **66.7%** of tasks to maintain a stable reputation. Below this threshold, reputation decays and eventually triggers auto-freeze, removing the node from the swarm automatically.

This creates **emergent economic pressure**: agents with poor signal quality are self-correcting removed, while high-quality agents accumulate reputation and remain active indefinitely (up to max 1 000).

---

## 7. Attack Vectors & Mitigations

| Attack | Mitigation |
|---|---|
| **Prompt injection into LLM signal** | LLM responses are parsed for exact strings (BUY/SELL/HOLD; YES/NO). Any deviation defaults to the safe option (HOLD/NO). Adversarial price data cannot execute an arbitrary transaction. |
| **Vault drain via rapid agent_pay** | `per_tx_limit` and `daily_limit` enforce hard ceilings on-chain. Guards fire before any fund movement. |
| **Authority key compromise** | Per-tx limits cap damage per call. Emergency freeze can halt colony. Recommend migration to Squads multisig post-MVP. |
| **Replay attacks** | Solana's account-model natively prevents replay: each transaction has a unique recent blockhash. `TransactionLog` PDA is indexed by `total_transactions`, so the same log index cannot be re-created. |
| **Fake reporter** | `report_outcome` is restricted to `colony.authority`. Only the authority can alter reputation. |
| **Self-payment loop** | Checked explicitly: `require!(from.agent_index != to.agent_index)` using the on-chain `HivemindError::SelfPaymentNotAllowed` error. |

---

## 8. Scalability

The colony supports up to **255 agents** (u8 counter). Adding the 100th agent is identical to adding the 1st:

1. Call `register_agent` — Anchor derives the next PDA using `colony.agent_count` as the seed byte.
2. Colony increments `agent_count`.
3. New agent gets 0.5 SOL from treasury and starts with reputation 100.

Each agent's data is isolated in its own PDA account. On-chain reads scale linearly (`O(N)` for fetching all agents) but each agent interacts only with its immediate upstream/downstream payee, keeping hot-path transactions `O(1)`.

Event routing off-chain uses a Node.js `EventEmitter`. For large colonies (> 50 agents), replacing this with a Redis pub/sub or a Kafka topic is recommended to handle concurrent event bursts.

---

## 9. Future Work

| Feature | Description |
|---|---|
| **Cross-colony communication** | Allow agents in one colony to pay agents in another colony program via CPI, creating an inter-colony economy. |
| **SPL token support** | Replace SOL transfers with SPL token CPI calls (using `anchor-spl`), enabling USDC or custom colony tokens as the unit of account. |
| **Agent staking for reputation** | Require agents to stake SOL as collateral proportional to their reputation, creating a financial incentive for high-quality outputs. |
| **zkProof of agent decision** | Attach a zero-knowledge proof (via a Solana ZK framework) that the agent's LLM decision was computed correctly, enabling verifiable AI inference on-chain. |
| **Multisig authority** | Migrate colony authority to a Squads v4 multisig to require governance votes for freeze, parameter changes, and treasury withdrawals. |
| **HTTP API server** | Add a Fastify REST server that exposes the endpoints described in SKILLS.md for third-party integrations. |
