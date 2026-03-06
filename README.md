# 🧠 HIVEMIND WALLET

![Network](https://img.shields.io/badge/network-Solana%20Devnet-9945FF?logo=solana)
![Anchor](https://img.shields.io/badge/anchor-0.30.1-blue)
![TypeScript](https://img.shields.io/badge/TypeScript-5.5-3178C6?logo=typescript)
![License](https://img.shields.io/badge/license-MIT-green)

**HIVEMIND WALLET** is a multi-agent autonomous AI wallet system built on Solana devnet. A swarm of four AI agents — each owning a Program Derived Address (PDA) vault — transact with one another in real time under the governance of a shared on-chain Anchor colony program. Agents are powered by Groq's LLaMA 3 70B model, price data comes from Jupiter, and reputation is enforced entirely on-chain with no off-chain trust assumptions.

---

## Architecture

```
                        ┌──────────────────────────────┐
                        │       ColonyState PDA        │
                        │  authority | agentCount | tx  │
                        └──────────┬───────────────────┘
                                   │
           ┌───────────────────────┼───────────────────────┐
           │                       │                       │
    ┌──────▼──────┐         ┌──────▼──────┐         ┌──────▼──────┐
    │  AgentState │         │  AgentState │         │  AgentState │
    │  Scout (0)  │         │ Analyst (1) │         │Executor (2) │
    │  rep:100    │──5000──▶│  rep:100    │──8000──▶│  rep:100    │
    └──────┬──────┘         └─────────────┘         └──────┬──────┘
           │  vault PDA                                     │ vault PDA
           ▼                                                ▼
    [SOL vault PDA]                               [SOL vault PDA]
                                   │
                            ┌──────▼──────┐
                            │  AgentState │
                            │  Ledger (3) │ ◀─2000─ Executor
                            │  rep:100    │
                            └─────────────┘
                                   │
                            ┌──────▼──────┐
                            │ Treasury PDA│
                            │  (reserve)  │
                            └─────────────┘

  Fund flow:  Scout →(5k lam)→ Analyst →(8k lam)→ Executor →(2k lam)→ Ledger
  Price data: Jupiter API v4
  LLM:        Groq llama3-70b-8192
```

---

## Prerequisites

| Tool | Version |
|---|---|
| Node.js | 23.x |
| Rust | stable (via `rustup`) |
| Anchor CLI | 0.30.1 |
| Solana CLI | 1.18.x |

---

## Installation

```bash
# 1. Clone the repository
git clone https://github.com/YOUR_ORG/hivemind-wallet.git
cd hivemind-wallet

# 2. Install Rust dependencies and build the Anchor program
anchor build

# 3. Install TypeScript dependencies
cd agents && npm install && cd ..
```

---

## Setup Devnet

```bash
# Copy env template and fill in your keys
cp agents/.env.example agents/.env

# Fund your authority wallet on devnet
solana airdrop 4 <YOUR_AUTHORITY_PUBKEY> --url devnet

# Run the setup script — initialises colony and registers all 4 agents
cd agents && npm run setup:devnet
```

`setup:devnet` calls `initialize_colony` and `register_agent` × 4, then prints all PDA addresses for you to add to `.env`.

---

## Run the Colony

```bash
cd agents
npm run dev
```

This boots all four agents concurrently. Scout polls price every 30 seconds, pays Analyst, who optionally pays Executor, who pays Ledger.

---

## Run the Dashboard

```bash
cd agents
npm run dashboard
```

Opens a live terminal UI showing agent balances, reputation, and a transaction feed. Press `R` to refresh, `Q` to quit.

---

## Run Tests

```bash
anchor test
```

Runs all 11 integration tests against a local Anchor validator. Tests cover initialisation, agent registration, payment constraints, reputation mechanics, auto-freeze, and daily resets.

---

## Environment Variables

| Variable | Description |
|---|---|
| `SOLANA_RPC_URL` | Helius devnet RPC endpoint |
| `COLONY_PROGRAM_ID` | Deployed program address (after `anchor deploy`) |
| `AUTHORITY_KEYPAIR` | 64-byte secret key as JSON array |
| `GROQ_API_KEY` | Groq Cloud API key |
| `COLONY_PDA` | Colony state PDA address |
| `TREASURY_PDA` | Colony treasury PDA address |
| `SCOUT_VAULT` | Scout agent vault address |
| `ANALYST_VAULT` | Analyst agent vault address |
| `EXECUTOR_VAULT` | Executor agent vault address |
| `LEDGER_VAULT` | Ledger agent vault address |

---

## Security Considerations

- **PDA vaults have no private keys** — funds can only be moved via signed Anchor program instructions; no key can be stolen.
- **Authority keypair is loaded once into memory** from `AUTHORITY_KEYPAIR` env var and never written to disk or logged.
- **Per-tx and daily limits are enforced on-chain** — even if the authority keypair is compromised, an attacker cannot drain more than `per_tx_limit` lamports per call.
- **Emergency freeze** allows the authority to halt any agent instantly; at zero reputation agents are auto-frozen.
- **Never commit a `.env` file** — all real secrets must be kept in the `.gitignore`-excluded `.env`. Use environment-level secrets management (e.g. GitHub Secrets, Vault) in CI.

---

## Program ID

```
[DEPLOYED_PROGRAM_ID]
```

Replace after `anchor deploy --provider.cluster devnet`.

---

## Live Demo

[Link placeholder — deploy to devnet and add Helius explorer link here]

---

## License

MIT © 2026 HIVEMIND WALLET contributors
