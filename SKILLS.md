# HIVEMIND WALLET — Agent Skills Manifest

> Machine-readable. Parse with any JSON/YAML reader after converting headers.

## Colony Info

- Program ID: [PROGRAM_ID]
- Network: Solana Devnet
- RPC: https://devnet.helius-rpc.com
- Framework: Anchor 0.30.1

## Available Agent Roles

- scout    (index: 0): Fetches price data, daily_limit: 500000 lamports,   per_tx_limit: 10000
- analyst  (index: 1): Processes signals, daily_limit: 1000000 lamports,   per_tx_limit: 20000
- executor (index: 2): Executes trades,   daily_limit: 2000000 lamports,   per_tx_limit: 50000
- ledger   (index: 3): Records outcomes,  daily_limit: 100000 lamports,    per_tx_limit: 5000

## API Endpoints (if HTTP server is running)

```
GET  /api/colony                → ColonyState JSON
GET  /api/agents                → All AgentState[] JSON
GET  /api/agents/:index         → Single AgentState JSON
GET  /api/agents/:index/balance → { sol: number }
POST /api/agents/:index/freeze  → { frozen: true } (authority only)
GET  /api/logs?limit=20         → Last N TransactionLogs
```

## How to spawn a new agent

Call `register_agent` instruction on program [PROGRAM_ID]

Required accounts:
- `authority` (signer) — must match `colony.authority`
- `colony` PDA — seeds: `["colony"]`
- `treasury` PDA — seeds: `["treasury", colony_pubkey]`
- `agent_state` PDA — seeds: `["agent", colony_pubkey, agent_index_byte]`
- `vault` PDA — seeds: `["vault", agent_state_pubkey]`
- `system_program`

Parameters:
- `role`: AgentRole enum variant
- `daily_limit`: u64 lamports
- `per_tx_limit`: u64 lamports (must be ≤ daily_limit)

## How to pay between agents

Call `agent_pay` instruction with:

Required accounts:
- `authority` (signer)
- `colony` PDA
- `from_agent` PDA — seeds: `["agent", colony_pubkey, from_index]`
- `vault_from` PDA — seeds: `["vault", from_agent_pubkey]`
- `to_agent` PDA — seeds: `["agent", colony_pubkey, to_index]`
- `vault_to` PDA — seeds: `["vault", to_agent_pubkey]`
- `transaction_log` PDA — seeds: `["log", colony_pubkey, total_transactions_le_bytes]`
- `system_program`

Parameters:
- `amount`: u64 lamports (must satisfy per_tx_limit AND daily budget)
- `task_id`: [u8; 32] SHA-256 hash of task description

Constraints enforced on-chain:
1. from_agent is not frozen
2. amount ≤ per_tx_limit
3. daily_spent + amount ≤ daily_limit
4. vault_from has sufficient lamports
5. from_agent ≠ to_agent

## How to report an outcome

Call `report_outcome` instruction:
- Parameters: `success: bool`
- success=true:  reputation += 5 (max 1000), successful_tasks += 1
- success=false: reputation -= 10 (min 0; auto-freeze at 0)
- Always: total_tasks += 1

## Reputation System

| Parameter         | Value |
|---|---|
| Initial value     | 100   |
| Maximum           | 1000  |
| Minimum           | 0     |
| Auto-freeze at    | 0     |
| Success outcome   | +5    |
| Failed outcome    | −10   |

Expected reputation after N tasks at success rate p:
```
E[rep_N] = rep_0 + N × (5p − 10(1−p)) = rep_0 + N × (15p − 10)
Break-even success rate: p = 10/15 ≈ 66.7%
```

## Events emitted

| Event                   | Fields                                     |
|---|---|
| `AgentPayEvent`         | from, to, amount, task_id, timestamp       |
| `ReputationUpdateEvent` | agent_index, old_reputation, new_reputation, success |
| `AgentFreezeEvent`      | agent_index, frozen_by, timestamp, is_frozen |
