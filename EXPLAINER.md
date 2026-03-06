# 🧠 HIVEMIND WALLET — Beginner's Guide to the Console

This document explains, in plain English, exactly what is happening when you run `npm run dev` inside the `agents/` folder. No prior blockchain or coding experience required.

---

## The Big Picture: What Is This Thing?

HIVEMIND WALLET is a **multi-agent AI system living on the Solana blockchain**.

Think of it like a small company with four employees (called "agents"), each with a specific job:

| Agent | Job |
|---|---|
| **Scout** | Watches the price of SOL (Solana's currency) and decides whether to BUY, SELL, or HOLD |
| **Analyst** | Receives the Scout's signal and digs deeper into the data |
| **Executor** | Carries out actual trade simulations based on the Analyst's report |
| **Ledger** | Records everything that happened, like an accountant |

These four agents talk to each other by **sending tiny payments on the Solana blockchain**. When the Scout finishes its job, it pays the Analyst 5,000 lamports (a very small fraction of SOL — about $0.001) to "hire" it for the next step. This creates a verifiable on-chain trail of work done.

The agents use an **AI model (Groq's LLaMA 3.3 70B)** to make decisions rather than following hard-coded rules.

---

## Key Terms (Plain English Dictionary)

| Term | What It Means |
|---|---|
| **Solana** | A fast, cheap blockchain — like a public spreadsheet everyone can see but no one can fake |
| **Devnet** | A fake version of Solana used for testing. The SOL here is not real money |
| **Lamports** | The smallest unit of SOL. 1 SOL = 1,000,000,000 lamports — like cents to a dollar |
| **Wallet** | An address on the blockchain that holds SOL. Identified by a long string like `5Lmq6...` |
| **Program** | A smart contract — code that lives permanently on the blockchain and runs when called |
| **PDA** | "Program Derived Address" — a special wallet that only the program can control (no private key) |
| **Treasury** | A PDA that holds the colony's shared SOL funds |
| **Vault** | Each agent has its own PDA "piggy bank" — this is where their earned SOL sits |
| **IDL** | "Interface Definition Language" — a JSON file that describes what the on-chain program can do |
| **RPC** | "Remote Procedure Call" — how the code talks to the Solana network over the internet |
| **LLM** | "Large Language Model" — the AI that reads market data and decides BUY/SELL/HOLD |
| **Anchor** | A framework that makes building Solana programs easier, like React for blockchain |
| **Colony** | The on-chain "company" that registers all four agents and tracks their activity |

---

## The Console, Line by Line

Here is the full console output from a successful run, with every line explained:

```
🧠 HIVEMIND WALLET — Colony Runtime
```
The program has started. This is just a banner printed to the screen.

---

```
[RPC][23:49:32] Connected to https://solana-devnet.g.alchemy.com/v2/...
```
**RPC = the phone line to Solana.**

The program just successfully dialled up the Solana devnet using Alchemy (a commercial Solana node provider). From now on, every time the code reads or writes anything on the blockchain, it goes through this connection.

The timestamp `23:49:32` shows the exact wall-clock time this happened.

---

```
[LLM][23:49:32] Initialised with model: llama-3.3-70b-versatile
```
**The AI brain is awake.**

The code connected to the Groq API and confirmed which AI model it will use: `llama-3.3-70b-versatile`. This is a 70-billion-parameter language model made by Meta (the same family as LLaMA). The agents will send it market data and ask it what to do.

> 💡 The old model `llama3-70b-8192` was retired ("decommissioned") by Groq in early 2026. We updated it to the current equivalent.

---

```
[WALLET][23:49:32] Authority keypair loaded. Pubkey: 5Lmq6teGmq6Qx4WM8AENEMXTUc2e3C6NQqr1uDwaVLKq
```
**The "boss" wallet is ready.**

Every blockchain transaction needs to be signed by someone with the right private key (like a password + signature combined). The "authority" is the master account that controls the colony.

- `Pubkey` = the public address, safe to share — like a bank account number
- The private key (the secret) is stored locally in your `.env` file as `AUTHORITY_KEYPAIR` and never goes online

This wallet currently holds ~0.6 SOL on devnet (free test money from Solana's faucet).

---

```
[COLONY][23:49:32] ColonyClient initialised. Program: 2wRN9Nrd5USVo5oVWjyfYiRgN6nrJMW5vDpscx7iRRZn
```
**The TypeScript code found the on-chain program.**

`2wRN9N...` is the address of the Rust smart contract (called the "hivemind program") that was compiled and deployed to Solana devnet earlier. Think of it like the URL of an API — the agents will call this address to do things like register themselves, send payments, and log transactions.

The `ColonyClient` is the TypeScript wrapper that makes calling the program easy.

---

```
[Bootstrap][23:49:33] Colony already initialised. Agents: 2, total txns: 0
```
**The colony has been set up before, but it's incomplete.**

When the colony was first created (in a previous run), it wrote a record to the blockchain — a `ColonyState` account — containing:
- How many agents are registered (`2`)
- How many transactions have happened (`0`)

The code reads this and says "OK, colony exists — but we're missing agents 3 and 4."

---

```
[Bootstrap][23:49:33] Registering 2 missing agent(s)…
```
**Automatically filling in the gap.**

The code noticed `agentCount = 2` but needs 4. It calls the on-chain `register_agent` instruction twice more — once for Executor (index 2) and once for Ledger (index 3).

Each registration:
1. Creates an `AgentState` account on-chain (stores the agent's role, limits, reputation score)
2. Creates a `Vault` PDA for the agent (its personal SOL piggy bank)
3. Transfers **0.5 SOL from the Treasury PDA** into that vault

> 💡 This is why we had to top up the Treasury PDA (`EPTwQe...`) with 1.5 SOL before this worked. It had run out of funds after funding the first two agents.

---

```
[Bootstrap][23:45:34] Registered Scout | daily=500000 perTx=10000
[Bootstrap][23:45:34] Registered Analyst | daily=1000000 perTx=20000
[Bootstrap][23:45:34] Registered Executor | daily=2000000 perTx=50000
[Bootstrap][23:45:34] Registered Ledger | daily=100000 perTx=5000
```
**Each agent now exists on-chain with spending limits.**

- `daily` = max lamports this agent can spend in 24 hours (500,000 lamports = 0.0005 SOL)
- `perTx` = max lamports per single transaction

These limits are **enforced by the Rust program** on-chain — they cannot be cheated at the TypeScript level. The Executor has the highest limits because it handles simulated trades; the Ledger has the lowest because it only records data.

---

```
[ANALYST][23:45:34] Agent started — listening for signals.
[EXECUTOR][23:45:34] Agent started — listening for execute events.
[LEDGER][23:45:34] Agent started — listening for outcomes.
```
**Three agents are now sitting quietly, waiting for work.**

These three agents are **event-driven** — they don't do anything until they receive a message. Internally, they're listening on a shared JavaScript `EventEmitter` (think of it like a walkie-talkie channel). When the Scout emits a signal, the Analyst wakes up. When the Analyst emits a recommendation, the Executor wakes up. And so on.

---

```
[Bootstrap][23:45:34] All agents active. Colony running.
```
**The colony is fully live.** All four agents are ready.

---

```
[SCOUT][23:45:34] Agent started.
```
**The Scout begins its infinite loop.**

Unlike the other agents, the Scout doesn't wait for events — it actively polls (checks repeatedly) every **30 seconds**. Each cycle is called a "tick."

---

```
[JUPITER][23:45:34] SOL/USD: $91.68 (CoinGecko)
```
**The Scout fetched the current SOL price.**

The code tried to get the price from **CoinGecko** (a public crypto data API, no sign-up required). It got back `$91.68 per SOL`.

> 💡 Previously it tried Jupiter's price API first, but that endpoint returned a 404 error, so we swapped the order — CoinGecko is now primary, Jupiter is the fallback.

---

```
[SCOUT][23:45:34] SOL/USD: $91.6800
```
The Scout logged the price it will use for its decision. This is the number that gets passed to the AI.

---

```
[LLM][23:45:35] ... (thinking) ...
[SCOUT][23:45:35] Signal: HOLD
```
**The AI made a decision.**

The Scout sent a message to the LLaMA AI that looked something like:

> "The current SOL price is $91.68. The last few prices were: [91.68]. Based on this data, should I BUY, SELL, or HOLD? Reply with a single word."

The AI replied: **HOLD** — meaning "don't trade, conditions aren't compelling enough."

---

```
[SCOUT][23:45:36] Error in tick: [ColonyClient.agentPay] Failed to send transaction:
AnchorError caused by account: from_agent.
Error Code: AccountNotInitialized.
```
**This was the "agents not registered yet" error — now fixed.**

The Scout tried to pay the Analyst (via `agent_pay` on-chain), but the Analyst's `AgentState` account didn't exist yet because registration wasn't complete. After topping up the treasury and re-running, this resolves — all 4 agents are registered and their vault accounts exist.

---

## The Full Data Flow (What Happens Every 30 Seconds)

```
Every 30 seconds:
                                                        
  1. SCOUT fetches SOL/USD price (CoinGecko → Jupiter fallback)
          │
  2. SCOUT sends price history to AI (Groq LLaMA)
          │
  3. AI replies: "BUY" / "SELL" / "HOLD"
          │
  4. SCOUT calls agent_pay on-chain:
     Scout Vault → 5,000 lamports → Analyst Vault
     (recorded permanently on Solana devnet)
          │
  5. SCOUT emits 'signal' event on the internal event bus
          │
  6. ANALYST wakes up, receives signal + price data
          │
  7. ANALYST asks AI for deeper analysis
          │
  8. ANALYST calls agent_pay on-chain:
     Analyst Vault → lamports → Executor Vault
          │
  9. EXECUTOR wakes up, simulates a swap
          │
 10. EXECUTOR calls agent_pay on-chain:
     Executor Vault → lamports → Ledger Vault
          │
 11. LEDGER wakes up, records the outcome
          │
 12. Loop sleeps 30 seconds, then back to step 1
```

---

## The Money Flow (Where Does SOL Actually Move?)

```
Your Authority Wallet (5Lmq6...)
        │ funded Treasury at setup
        ▼
Treasury PDA (EPTwQe...)  ← holds the colony's shared reserve
        │ 0.5 SOL per agent at registration
        ├──► Scout Vault  (FF1QFJ...)
        ├──► Analyst Vault (99ikVQ...)
        ├──► Executor Vault (DovHMC...)
        └──► Ledger Vault  (EjwUTH...)

During operation, tiny amounts (5,000–50,000 lamports) flow
between these vaults via on-chain agent_pay transactions.
All of this is on DEVNET — none of it is real money.
```

---

## Files and What They Do

```
hivemind-wallet/
│
├── programs/hivemind/src/          ← Rust code (the on-chain smart contract)
│   ├── lib.rs                      ← Entry point, lists all instructions
│   ├── instructions/
│   │   ├── initialize_colony.rs    ← Creates the colony on-chain
│   │   ├── register_agent.rs       ← Registers an agent + funds its vault
│   │   ├── agent_pay.rs            ← Transfers SOL between agent vaults
│   │   └── emergency_freeze.rs     ← Freezes an agent (safety switch)
│   └── state.rs                    ← Data structures stored on-chain
│
├── target/
│   ├── deploy/hivemind.so          ← Compiled Rust program (uploaded to Solana)
│   └── idl/hivemind.json           ← Machine-readable description of the program
│
└── agents/src/                     ← TypeScript code (runs on your computer)
    ├── index.ts                    ← Startup: connects everything, boots agents
    ├── colony.ts                   ← Talks to the on-chain program
    ├── wallet.ts                   ← Loads your keypair & reads balances
    ├── agents/
    │   ├── scout.ts                ← Fetches price, asks AI, pays Analyst
    │   ├── analyst.ts              ← Receives signal, analyses deeper
    │   ├── executor.ts             ← Simulates trade execution
    │   └── ledger.ts               ← Records outcomes
    └── services/
        ├── rpc.ts                  ← Solana network connection
        ├── llm.ts                  ← Groq AI client (LLaMA model)
        └── jupiter.ts              ← Price feed (CoinGecko primary, Jupiter fallback)
```

---

## Why Does Everything Have a Weird Long Address?

Every account on Solana — wallets, programs, PDAs — is identified by a **32-byte public key**, displayed as a Base58 string (letters and numbers, no `0`, `O`, `I`, `l` to avoid confusion).

Examples from this project:
- Program: `2wRN9Nrd5USVo5oVWjyfYiRgN6nrJMW5vDpscx7iRRZn`
- Authority wallet: `5Lmq6teGmq6Qx4WM8AENEMXTUc2e3C6NQqr1uDwaVLKq`
- Treasury PDA: `EPTwQeSWiopVu3QQKivhucZRoQbtwo1kXBZVQqzkL6wT`

Unlike a bank account number, these addresses are **cryptographically derived** — the PDA addresses are computed mathematically from seed words (like `"colony"`, `"treasury"`, `"agent"`) + the program's address. This means anyone can derive the same address independently, and the Rust program can verify the addresses it receives are legitimate.

---

## What Would You See in a Fully Healthy Run?

```
🧠 HIVEMIND WALLET — Colony Runtime

[RPC] Connected to https://...alchemy.com/...
[LLM] Initialised with model: llama-3.3-70b-versatile
[WALLET] Authority keypair loaded. Pubkey: 5Lmq6...
[COLONY] ColonyClient initialised. Program: 2wRN9N...
[Bootstrap] Colony already initialised. Agents: 4, total txns: 12

[ANALYST] Agent started — listening for signals.
[EXECUTOR] Agent started — listening for execute events.
[LEDGER] Agent started — listening for outcomes.
[Bootstrap] All agents active. Colony running.

[SCOUT] Agent started.
[JUPITER] SOL/USD: $91.68 (CoinGecko)
[SCOUT] SOL/USD: $91.6800
[SCOUT] Signal: HOLD
[COLONY] agentPay 0→1 | 5000 lamports | tx: 4xKp9...

[ANALYST] Received HOLD signal @ $91.68
[ANALYST] Recommendation: maintain current position
[COLONY] agentPay 1→2 | 10000 lamports | tx: 7mNq2...

[EXECUTOR] Simulating HOLD at $91.68
[EXECUTOR] No trade executed (HOLD).
[COLONY] agentPay 2→3 | 5000 lamports | tx: 9pRt1...

[LEDGER] Outcome recorded: HOLD — no trade.

--- (30 seconds later) ---

[JUPITER] SOL/USD: $92.15 (CoinGecko)
[SCOUT] Signal: BUY
...
```

When all 4 agents are registered and vaults are funded, you'll see messages flowing from Scout → Analyst → Executor → Ledger every 30 seconds, each with a blockchain transaction signature (`tx: ...`) proving the payment happened on-chain.

---

## Summary

| What runs where | Description |
|---|---|
| **On the Solana blockchain (devnet)** | The Rust program, colony state, agent state accounts, vaults, transaction logs |
| **On your computer** | The TypeScript agents, AI calls to Groq, price fetches from CoinGecko |
| **In `agents/.env`** | Your private key, API keys, program ID, PDA addresses |

The TypeScript code on your machine **orchestrates** the agents and makes AI decisions, but every payment and state change is **recorded permanently and trustlessly on-chain** — no central server, no database, no middleman.
