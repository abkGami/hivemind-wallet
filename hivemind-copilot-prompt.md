# HIVEMIND WALLET — GitHub Copilot Master Build Prompt

You are a senior full-stack Solana blockchain developer and Rust/Anchor smart contract engineer. You are helping me build a project called **HIVEMIND WALLET** — a multi-agent autonomous AI wallet system on Solana devnet where a swarm of AI agents each own their own PDA (Program Derived Address) wallet, transact with each other in real time, and are governed by a shared on-chain colony program.

This is a hackathon submission. Every piece of code must be production-quality, well-commented, secure, and follow best practices for Solana/Anchor development. Do not use deprecated APIs. Use the latest stable versions of all libraries.

---

## PROJECT OVERVIEW

Build a colony of 4 autonomous AI agents on Solana devnet:
- **Scout** — fetches token price signals, pays Analyst for processing
- **Analyst** — processes signals, decides action, pays Executor
- **Executor** — signs and broadcasts simulated swap transactions, reports outcome
- **Ledger** — on-chain reputation tracker and colony treasury

Each agent has its own PDA vault wallet controlled exclusively by the on-chain Anchor program. Agents pay each other for task completion via on-chain `agent_pay` instructions. Reputation scores update on-chain based on success/failure. A live dashboard shows all activity in real time.

---

## TECH STACK

- **Smart Contract**: Rust + Anchor Framework (latest stable)
- **Agent Runtime**: TypeScript + Node.js (ESM)
- **LLM**: Groq API (model: `llama3-70b-8192`) — for agent decision-making
- **Solana SDK**: `@solana/web3.js` v1.x, `@coral-xyz/anchor` latest
- **Price Data**: Jupiter Price API v2 (devnet-compatible)
- **Dashboard**: `ink` v4 + `react` (terminal UI)
- **RPC**: Helius devnet free tier (`https://devnet.helius-rpc.com/?api-key=YOUR_KEY`)
- **Key Management**: dotenv + encrypted in-memory only, never written to disk after load
- **Testing**: Anchor's built-in Mocha/Chai test suite

---

## REPOSITORY STRUCTURE

Generate the full file tree exactly as follows:

```
hivemind-wallet/
├── programs/
│   └── hivemind/
│       └── src/
│           ├── lib.rs               ← Anchor program entry point
│           ├── state.rs             ← All account structs
│           ├── instructions/
│           │   ├── mod.rs
│           │   ├── initialize_colony.rs
│           │   ├── register_agent.rs
│           │   ├── agent_pay.rs
│           │   ├── report_outcome.rs
│           │   └── emergency_freeze.rs
│           └── errors.rs            ← Custom Anchor errors
├── agents/
│   ├── src/
│   │   ├── index.ts                 ← Colony bootstrap & agent spawner
│   │   ├── colony.ts                ← Colony program client (Anchor IDL wrapper)
│   │   ├── wallet.ts                ← Wallet/PDA utilities
│   │   ├── agents/
│   │   │   ├── scout.ts
│   │   │   ├── analyst.ts
│   │   │   ├── executor.ts
│   │   │   └── ledger.ts
│   │   ├── services/
│   │   │   ├── llm.ts               ← Groq API client
│   │   │   ├── jupiter.ts           ← Jupiter price feed
│   │   │   └── rpc.ts               ← Solana RPC helpers
│   │   └── dashboard/
│   │       └── index.tsx            ← Ink terminal dashboard
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── tests/
│   └── hivemind.ts                  ← Full Anchor integration tests
├── Anchor.toml
├── Cargo.toml
├── README.md
├── SKILLS.md
└── DEEPDIVE.md
```

---

## STEP 1 — ANCHOR PROGRAM (Rust)

### `programs/hivemind/src/state.rs`

Write the following account structs with full Anchor `#[account]` macros, proper space calculations using `8 + ...` discriminator sizing, and inline comments explaining each field:

```rust
// AgentRole enum — serializable, cloneable
pub enum AgentRole { Scout, Analyst, Executor, Ledger }

// ColonyState — global state PDA, seeds: [b"colony"]
pub struct ColonyState {
    pub authority: Pubkey,       // colony owner's pubkey
    pub agent_count: u8,         // how many agents registered
    pub treasury: Pubkey,        // treasury PDA pubkey
    pub total_transactions: u64, // colony-wide tx counter
    pub bump: u8,
}

// AgentState — per-agent PDA, seeds: [b"agent", colony.key(), agent_index as u8]
pub struct AgentState {
    pub colony: Pubkey,
    pub agent_index: u8,
    pub role: AgentRole,
    pub vault: Pubkey,           // the agent's PDA vault that holds SOL
    pub reputation: u64,         // starts at 100, max 1000, min 0
    pub daily_limit: u64,        // lamports per day this agent can spend
    pub per_tx_limit: u64,       // lamports per single transaction
    pub daily_spent: u64,        // resets every 86400 seconds
    pub last_reset: i64,         // unix timestamp of last daily reset
    pub is_frozen: bool,
    pub total_tasks: u64,
    pub successful_tasks: u64,
    pub bump: u8,
}

// TransactionLog — append-only record, seeds: [b"log", colony.key(), log_index as u64 bytes]
pub struct TransactionLog {
    pub colony: Pubkey,
    pub from_agent: u8,
    pub to_agent: u8,
    pub amount: u64,
    pub task_id: [u8; 32],       // SHA256 hash of task description
    pub timestamp: i64,
    pub success: bool,
    pub bump: u8,
}
```

Calculate `space` for each account precisely. Add a `impl AgentState` block with a `reset_daily_if_needed(&mut self, current_time: i64)` method that resets `daily_spent` to 0 if 86400 seconds have passed.

---

### `programs/hivemind/src/errors.rs`

Define a full `HivemindError` enum using `#[error_code]` with these variants and human-readable messages:
- `AgentFrozen` — "This agent has been frozen by the colony authority"
- `DailyLimitExceeded` — "Transaction would exceed agent's daily spending limit"
- `PerTxLimitExceeded` — "Transaction amount exceeds per-transaction limit"
- `InsufficientVaultBalance` — "Agent vault does not have enough SOL"
- `UnauthorizedRole` — "This agent role cannot perform this action"
- `ColonyFull` — "Colony has reached maximum agent capacity (255)"
- `InvalidReputation` — "Reputation value is out of valid range"
- `SelfPaymentNotAllowed` — "An agent cannot pay itself"

---

### `programs/hivemind/src/instructions/initialize_colony.rs`

Write the `initialize_colony` instruction:
- Creates `ColonyState` PDA with seeds `[b"colony"]`
- Creates a `treasury` PDA with seeds `[b"treasury", colony.key()]` that holds SOL (a system-owned PDA)
- Sets `authority` to the signer
- `agent_count` starts at 0
- Use `init` constraint with `payer = authority`, `space = ColonyState::SPACE`
- Transfer 1 SOL from authority to treasury PDA using `system_program::transfer` with CPI

---

### `programs/hivemind/src/instructions/register_agent.rs`

Write `register_agent(role: AgentRole, daily_limit: u64, per_tx_limit: u64)`:
- Only callable by `colony.authority`
- Creates `AgentState` PDA with seeds `[b"agent", colony.key().as_ref(), &[colony.agent_count]]`
- Creates a vault PDA with seeds `[b"vault", agent_state.key().as_ref()]` — this is a system-owned PDA that holds the agent's SOL
- Increments `colony.agent_count`
- Sets `reputation = 100`, `daily_spent = 0`, `is_frozen = false`
- Transfer 0.5 SOL from treasury to the new agent vault using CPI `system_program::transfer` with treasury PDA signer seeds
- Enforce: `per_tx_limit <= daily_limit`, else return `HivemindError::PerTxLimitExceeded`

---

### `programs/hivemind/src/instructions/agent_pay.rs`

Write `agent_pay(amount: u64, task_id: [u8; 32])`:
- Validates: `from_agent` not frozen, `amount <= per_tx_limit`, `daily_spent + amount <= daily_limit`, vault has enough lamports
- Calls `reset_daily_if_needed` on `from_agent`
- Transfers `amount` lamports from `from_agent.vault` to `to_agent.vault` using CPI with vault PDA signer seeds `[b"vault", agent_state.key().as_ref(), &[bump]]`
- Creates a new `TransactionLog` account
- Updates `from_agent.daily_spent += amount`
- Enforces `from_agent != to_agent` (no self-payment)
- Emits an Anchor event `AgentPayEvent { from, to, amount, task_id, timestamp }`

---

### `programs/hivemind/src/instructions/report_outcome.rs`

Write `report_outcome(success: bool)`:
- Only callable by the `colony.authority`
- If `success == true`: `agent.reputation = min(agent.reputation + 5, 1000)`, `agent.successful_tasks += 1`
- If `success == false`: `agent.reputation = agent.reputation.saturating_sub(10)`, and if `reputation == 0` automatically set `is_frozen = true`
- Always increments `agent.total_tasks += 1`
- Emits event `ReputationUpdateEvent { agent_index, old_reputation, new_reputation, success }`

---

### `programs/hivemind/src/instructions/emergency_freeze.rs`

Write `emergency_freeze(freeze: bool)`:
- Only callable by `colony.authority` — validate with `constraint = colony.authority == authority.key()`
- Sets `agent.is_frozen = freeze`
- Emits `AgentFreezeEvent { agent_index, frozen_by, timestamp }`

---

### `programs/hivemind/src/lib.rs`

Wire all instructions together with `declare_id!`, `#[program]` macro, and re-export all events. Include the full IDL-compatible structure. Add a `#[cfg(not(feature = "no-entrypoint"))]` guard.

---

## STEP 2 — TYPESCRIPT AGENT RUNTIME

### `agents/package.json`

Generate a complete `package.json` with:
```json
{
  "type": "module",
  "scripts": {
    "build": "tsc",
    "start": "node dist/index.js",
    "dev": "tsx watch src/index.ts",
    "setup:devnet": "tsx src/scripts/setup.ts",
    "dashboard": "tsx src/dashboard/index.tsx"
  },
  "dependencies": {
    "@solana/web3.js": "^1.98.0",
    "@coral-xyz/anchor": "^0.30.1",
    "groq-sdk": "^0.7.0",
    "axios": "^1.7.0",
    "dotenv": "^16.4.0",
    "ink": "^4.4.1",
    "react": "^18.3.0",
    "chalk": "^5.3.0",
    "ora": "^8.0.1",
    "bs58": "^6.0.0"
  },
  "devDependencies": {
    "typescript": "^5.5.0",
    "tsx": "^4.16.0",
    "@types/node": "^22.0.0",
    "@types/react": "^18.3.0"
  }
}
```

### `agents/tsconfig.json`

Generate a strict TypeScript config with `"module": "ESNext"`, `"moduleResolution": "bundler"`, `"target": "ES2022"`, `"strict": true`, `"outDir": "./dist"`, `"rootDir": "./src"`.

### `agents/.env.example`

```env
# Solana
SOLANA_RPC_URL=https://devnet.helius-rpc.com/?api-key=YOUR_HELIUS_KEY
COLONY_PROGRAM_ID=YOUR_DEPLOYED_PROGRAM_ID
AUTHORITY_KEYPAIR=[]   # JSON array of secret key bytes — NEVER COMMIT REAL VALUES

# LLM
GROQ_API_KEY=YOUR_GROQ_API_KEY

# Colony config
COLONY_PDA=
TREASURY_PDA=
SCOUT_VAULT=
ANALYST_VAULT=
EXECUTOR_VAULT=
LEDGER_VAULT=
```

---

### `agents/src/services/rpc.ts`

Write a singleton `SolanaRPC` class that:
- Initializes `Connection` from `SOLANA_RPC_URL` env var with `"confirmed"` commitment
- Exposes `getBalance(pubkey: PublicKey): Promise<number>` (returns SOL, not lamports)
- Exposes `getAccountInfo(pubkey: PublicKey)`
- Exposes `waitForConfirmation(signature: string): Promise<void>` with retry logic (max 30 retries, 1s apart), throws `Error` if not confirmed
- Exposes `airdropIfNeeded(pubkey: PublicKey, minSolBalance: number): Promise<void>` — airdrops 2 SOL if balance < minSolBalance, only on devnet
- All methods log with a `[RPC]` prefix using `chalk.gray`

---

### `agents/src/services/llm.ts`

Write a `LLMService` class using `groq-sdk`:
- Constructor accepts `model = "llama3-70b-8192"`
- Method `ask(systemPrompt: string, userPrompt: string, maxTokens = 150): Promise<string>` — calls Groq API, returns trimmed text response
- Method `getSignal(price: number, history: number[]): Promise<"BUY" | "SELL" | "HOLD">` — sends price + last 5 prices as context, instructs the LLM to respond ONLY with one of the three words, parses and validates response, defaults to "HOLD" if response is invalid
- Method `shouldExecute(signal: string, confidence: number): Promise<boolean>` — returns true if LLM thinks execution is warranted given the signal and confidence score
- Wrap all calls in try/catch, log errors with `[LLM]` prefix, return safe defaults on failure

---

### `agents/src/services/jupiter.ts`

Write a `JupiterService` class:
- Method `getSOLPrice(): Promise<number>` — fetches from `https://price.jup.ag/v4/price?ids=SOL` (Jupiter Price API v4), returns USD price as number
- Method `getPriceHistory(): number[]` — maintains an in-memory rolling array of last 20 prices, updated each time `getSOLPrice()` is called
- Method `simulateSwap(inputMint: string, outputMint: string, amount: number): Promise<{ success: boolean; outputAmount: number; fee: number }>` — for devnet, this is SIMULATED only (does not execute a real swap). It returns a mocked response based on price ± a small random slippage (0–0.5%), logs clearly that it is a simulation
- All methods log with `[JUPITER]` prefix

---

### `agents/src/wallet.ts`

Write a `WalletManager` class:
- Method `loadAuthorityKeypair(): Keypair` — reads `AUTHORITY_KEYPAIR` from env, parses JSON array of bytes, returns `Keypair.fromSecretKey(Uint8Array.from(bytes))`. Throws clearly if env var is missing.
- Method `deriveColonyPDA(programId: PublicKey): Promise<[PublicKey, number]>` — derives PDA with seeds `[Buffer.from("colony")]`
- Method `deriveTreasuryPDA(colonyPubkey: PublicKey, programId: PublicKey): Promise<[PublicKey, number]>`
- Method `deriveAgentPDA(colonyPubkey: PublicKey, agentIndex: number, programId: PublicKey): Promise<[PublicKey, number]>`
- Method `deriveVaultPDA(agentStatePubkey: PublicKey, programId: PublicKey): Promise<[PublicKey, number]>`
- Method `getVaultBalance(vaultPubkey: PublicKey): Promise<number>` — returns SOL balance
- All PDA derivations use `PublicKey.findProgramAddressSync` and are consistent with the Rust program seeds

---

### `agents/src/colony.ts`

Write a `ColonyClient` class that wraps the Anchor `Program` instance:
- Constructor: accepts `wallet: Keypair`, `programId: PublicKey`, loads the IDL (import as JSON from `../../target/idl/hivemind.json`)
- Method `initializeColony(): Promise<string>` — calls `program.methods.initializeColony()` with correct accounts, returns tx signature
- Method `registerAgent(role: number, dailyLimit: number, perTxLimit: number): Promise<string>`
- Method `agentPay(fromAgentIndex: number, toAgentIndex: number, amount: number, taskId: string): Promise<string>` — converts `taskId` string to a 32-byte SHA256 hash
- Method `reportOutcome(agentIndex: number, success: boolean): Promise<string>`
- Method `emergencyFreeze(agentIndex: number, freeze: boolean): Promise<string>`
- Method `fetchColonyState(): Promise<ColonyState>`
- Method `fetchAgentState(agentIndex: number): Promise<AgentState>`
- Method `fetchAllAgentStates(): Promise<AgentState[]>`
- All methods log transaction signatures with `[COLONY]` prefix and include try/catch with descriptive errors

---

### `agents/src/agents/scout.ts`

Write a `ScoutAgent` class:
- Constructor: accepts `colony: ColonyClient`, `llm: LLMService`, `jupiter: JupiterService`, `agentIndex: number`
- Method `run(): Promise<void>` — infinite loop with 30-second sleep between iterations
- Each iteration:
  1. Call `jupiter.getSOLPrice()`, log result with `[SCOUT]` prefix and timestamp
  2. Call `llm.getSignal(price, priceHistory)` to get BUY/SELL/HOLD
  3. Package signal as JSON task payload: `{ signal, price, timestamp, agentIndex: 0 }`
  4. Call `colony.agentPay(0, 1, 5000, taskId)` to pay Analyst 5000 lamports for processing the signal (taskId = hash of payload)
  5. Log payment signature
  6. Emit a `'signal'` event on a shared `EventEmitter` with the signal data
- Wrap the entire loop body in try/catch — log errors but never crash the loop

---

### `agents/src/agents/analyst.ts`

Write an `AnalystAgent` class:
- Listens for `'signal'` events from Scout via shared `EventEmitter`
- On each signal:
  1. Log received signal with `[ANALYST]` prefix
  2. Call `llm.shouldExecute(signal, confidence)` — confidence derived from price volatility (std deviation of last 5 prices, normalized 0–1)
  3. If `shouldExecute == true`: emit `'execute'` event with trade instruction, call `colony.agentPay(1, 2, 8000, taskId)` to pay Executor
  4. If `shouldExecute == false`: call `colony.reportOutcome(0, false)` to penalize Scout's reputation for a weak signal
  5. Log decision clearly

---

### `agents/src/agents/executor.ts`

Write an `ExecutorAgent` class:
- Listens for `'execute'` events from Analyst
- On each execute event:
  1. Log with `[EXECUTOR]` prefix
  2. Call `jupiter.simulateSwap(...)` with the trade instruction
  3. If `result.success`: call `colony.reportOutcome(2, true)` (self-report success), log swap details
  4. If `!result.success`: call `colony.reportOutcome(2, false)`, log failure
  5. Call `colony.agentPay(2, 3, 2000, taskId)` to pay Ledger for recording the outcome
  6. Always report the outcome back to Analyst via a `'outcome'` event

---

### `agents/src/agents/ledger.ts`

Write a `LedgerAgent` class:
- Listens for `'outcome'` events
- Maintains an in-memory `outcomeHistory: Array<{ timestamp, success, amount, signal }>` (last 100 entries)
- On each outcome:
  1. Push to history
  2. Log with `[LEDGER]` prefix
  3. Every 10 outcomes, compute success rate and log a colony health summary
  4. If success rate drops below 40% in last 10 outcomes, emit a `'colony:warning'` event

---

### `agents/src/index.ts`

Write the main bootstrap file:
- Loads `.env` with `dotenv/config`
- Validates all required env vars are present, throws descriptive error if any are missing
- Creates shared `EventEmitter` instance
- Initializes all services: `SolanaRPC`, `LLMService`, `JupiterService`, `WalletManager`, `ColonyClient`
- Checks if colony is already initialized (fetch ColonyState, catch error = not initialized)
- If not initialized: calls `colony.initializeColony()`, then `registerAgent` 4 times for Scout/Analyst/Executor/Ledger with these limits:
  - Scout: `dailyLimit = 500_000`, `perTxLimit = 10_000`
  - Analyst: `dailyLimit = 1_000_000`, `perTxLimit = 20_000`
  - Executor: `dailyLimit = 2_000_000`, `perTxLimit = 50_000`
  - Ledger: `dailyLimit = 100_000`, `perTxLimit = 5_000`
- Starts all 4 agents concurrently using `Promise.all`
- Handles `SIGINT` / `SIGTERM` gracefully — logs shutdown, freezes all agents on-chain before exit

---

### `agents/src/dashboard/index.tsx`

Write a full `ink` terminal dashboard React component:
- Use `ink` v4 with `Box`, `Text`, `useInput`, `useApp`
- Poll `colony.fetchAllAgentStates()` every 3 seconds using `useEffect` + `setInterval`
- Poll SOL balances of all 4 vaults every 5 seconds
- Layout:
  ```
  ╔══════════════════════════════════════════════════════╗
  ║           🧠 HIVEMIND WALLET — COLONY STATUS         ║
  ╠══════════════════════════════════════════════════════╣
  ║  Agent     │ Role      │ SOL Balance │ Rep  │ Status ║
  ║  Agent 0   │ Scout     │ 0.4821 SOL  │ 105  │ 🟢     ║
  ║  Agent 1   │ Analyst   │ 0.9103 SOL  │ 95   │ 🟢     ║
  ║  Agent 2   │ Executor  │ 1.2043 SOL  │ 88   │ 🟢     ║
  ║  Agent 3   │ Ledger    │ 0.3012 SOL  │ 100  │ 🟢     ║
  ╠══════════════════════════════════════════════════════╣
  ║  Live Transaction Feed (last 10)                     ║
  ║  [12:34:01] Scout → Analyst  5000 lamports  ✅       ║
  ║  [12:34:32] Analyst → Executor 8000 lamports ✅      ║
  ╠══════════════════════════════════════════════════════╣
  ║  [F] Freeze Agent  [R] Refresh  [Q] Quit             ║
  ╚══════════════════════════════════════════════════════╝
  ```
- Color code reputation: green > 80, yellow 40–80, red < 40
- Status shows 🟢 active, 🔴 frozen
- Use `useInput` to handle keyboard: `f` = prompt for agent index to freeze, `q` = quit, `r` = force refresh
- Transaction feed is driven by the shared `EventEmitter`

---

## STEP 3 — ANCHOR TESTS

### `tests/hivemind.ts`

Write a complete Anchor test file using Mocha/Chai that:

1. **Test: Initialize Colony** — deploys and initializes colony, asserts `colonyState.agentCount == 0`, treasury funded with 1 SOL
2. **Test: Register 4 Agents** — registers Scout, Analyst, Executor, Ledger, asserts `agentCount == 4`, each vault has 0.5 SOL, all reputations == 100
3. **Test: Agent Pay — Success** — Scout pays Analyst 5000 lamports, asserts both vault balances updated, TransactionLog created, daily_spent updated
4. **Test: Agent Pay — Daily Limit Exceeded** — attempt to pay more than daily limit, assert throws `HivemindError::DailyLimitExceeded`
5. **Test: Agent Pay — Per TX Limit Exceeded** — assert throws `HivemindError::PerTxLimitExceeded`
6. **Test: Agent Pay — Self Payment** — assert throws `HivemindError::SelfPaymentNotAllowed`
7. **Test: Report Outcome — Success** — call reportOutcome(true), assert reputation increases by 5
8. **Test: Report Outcome — Failure** — call reportOutcome(false) 10 times, assert reputation decreases by 10 each time
9. **Test: Auto-Freeze on Zero Reputation** — drain reputation to 0 via repeated failures, assert agent is auto-frozen
10. **Test: Emergency Freeze** — freeze agent, assert `is_frozen == true`, attempt agent_pay from frozen agent, assert throws `HivemindError::AgentFrozen`
11. **Test: Daily Reset** — manually set `last_reset` to 25 hours ago via clock manipulation, make a payment, assert `daily_spent` resets

Use `anchor.BN` for all u64 values. Use `assert.ok`, `assert.equal`, `assert.strictEqual` from Chai. Each test must clean up its state or use a fresh program deployment.

---

## STEP 4 — DOCUMENTATION FILES

### `README.md`

Generate a complete README with:
1. Project title with badges (devnet, Anchor version, TypeScript)
2. One-paragraph description of HIVEMIND WALLET
3. Architecture diagram in ASCII art showing all 4 agents, their PDA vaults, the colony program, and arrows showing fund flows
4. Prerequisites (Node 23, Rust, Anchor CLI, Solana CLI)
5. **Installation** — step-by-step from `git clone` to `anchor build`
6. **Setup devnet** — `npm run setup:devnet` what it does
7. **Run the colony** — `npm run dev`
8. **Run dashboard** — `npm run dashboard`
9. **Run tests** — `anchor test`
10. **Environment variables** — table of all vars with descriptions
11. **Security considerations** — 5 bullet points on key management
12. **Program ID** — placeholder `[DEPLOYED_PROGRAM_ID]`
13. **Live demo** — link placeholder
14. **License** — MIT

### `SKILLS.md`

Generate a machine-readable skills manifest that an AI agent can parse:

```markdown
# HIVEMIND WALLET — Agent Skills Manifest
## Colony Info
- Program ID: [PROGRAM_ID]
- Network: Solana Devnet
- RPC: https://devnet.helius-rpc.com

## Available Agent Roles
- scout (index: 0): Fetches price data, daily_limit: 500000 lamports
- analyst (index: 1): Processes signals, daily_limit: 1000000 lamports
- executor (index: 2): Executes trades, daily_limit: 2000000 lamports
- ledger (index: 3): Records outcomes, daily_limit: 100000 lamports

## API Endpoints (if HTTP server is running)
GET  /api/colony              → ColonyState JSON
GET  /api/agents              → All AgentState[]  JSON
GET  /api/agents/:index       → Single AgentState JSON
GET  /api/agents/:index/balance → { sol: number }
POST /api/agents/:index/freeze  → { frozen: true } (authority only)
GET  /api/logs?limit=20       → Last N TransactionLogs

## How to spawn a new agent
Call `register_agent` instruction on program [PROGRAM_ID]
Seeds: ["agent", colony_pubkey, agent_index_byte]

## How to pay between agents
Call `agent_pay` instruction with from_agent, to_agent accounts
Maximum single transaction: see per_tx_limit on AgentState

## Reputation System
- Starts at: 100
- Max: 1000
- Min: 0 (triggers auto-freeze)
- Success outcome: +5
- Failed outcome: -10
```

### `DEEPDIVE.md`

Generate a comprehensive deep dive document with these sections:

1. **Why PDA Wallets?** — Explain why PDA vaults are superior to raw keypair wallets for agents: no private key exposure, on-chain access control, composable
2. **Colony Program Architecture** — Explain the account hierarchy with a detailed ASCII diagram
3. **Agent-to-Agent Payment Protocol** — Step-by-step flow of a Scout→Analyst payment: instruction construction, PDA signer seeds, CPI, event emission
4. **Key Management Strategy** — How the authority keypair is stored (encrypted env), why agent vaults have no private keys, how the on-chain program is the sole signer for vault PDAs
5. **Spending Limits & Daily Resets** — How on-chain enforcement is superior to off-chain checks. Explain the clock sysvar usage for `last_reset`
6. **Reputation System** — How emergent economic pressure self-corrects the swarm. Math: expected reputation after N tasks at X% success rate
7. **Attack Vectors & Mitigations** — Cover: prompt injection into LLM signal, vault drain via rapid agent_pay calls, authority key compromise, replay attacks (handled by Solana nonces)
8. **Scalability** — How adding a 100th agent is identical to adding the 1st. Colony program supports up to 255 agents (u8 counter)
9. **Future Work** — Cross-colony communication, SPL token support, agent staking for reputation, zkProof of agent decision

---

## CODING STANDARDS — APPLY TO ALL FILES

1. **Rust**: Use `#[allow(clippy::result_large_err)]` where needed. All `Result` types use Anchor's `Result<()>`. Never use `.unwrap()` — use `?` operator or explicit error handling.
2. **TypeScript**: Never use `any`. Use explicit interfaces for all data shapes. Use `async/await` exclusively, no raw `.then()` chains. Use `const` everywhere possible.
3. **Comments**: Every function must have a JSDoc comment (TypeScript) or doc comment `///` (Rust) explaining what it does, its parameters, and what it returns or can throw.
4. **Logging**: Use consistent prefixes: `[SCOUT]`, `[ANALYST]`, `[EXECUTOR]`, `[LEDGER]`, `[COLONY]`, `[RPC]`, `[LLM]`, `[JUPITER]` — always with a timestamp in `HH:MM:SS` format.
5. **Error messages**: All thrown errors must include the function name and context, e.g. `throw new Error('[ColonyClient.agentPay] Failed to send transaction: ' + err.message)`
6. **Environment**: Never hardcode any public key, URL, or secret. All configurable values come from `.env`.
7. **Security**: Never log private keys, secret key bytes, or raw keypair JSON. Mask sensitive env vars in logs.
8. **Solana transactions**: Always use `{ skipPreflight: false, commitment: "confirmed" }` for all `sendAndConfirmTransaction` calls.

---

## FINAL INSTRUCTIONS FOR COPILOT

- Build each file completely — no `// TODO` placeholders, no stub functions
- All imports must resolve correctly relative to the file structure defined above
- The Anchor program must compile with `anchor build` without warnings
- The TypeScript code must pass `tsc --noEmit` without errors
- Tests must pass with `anchor test` on a local validator or devnet
- When generating the Anchor program, always use `ctx.accounts.X` pattern, never raw account access
- PDA bump seeds must be stored in account structs and validated with `bump = X.bump` constraint in account validation
- Use `Clock::get()?.unix_timestamp` for all timestamp access in Rust
- The `agent_pay` CPI must sign with the vault PDA seeds: `[b"vault", agent_state.key().as_ref(), &[vault_bump]]`

Start by generating files in this order:
1. `programs/hivemind/src/state.rs`
2. `programs/hivemind/src/errors.rs`
3. `programs/hivemind/src/instructions/` (all 5 files)
4. `programs/hivemind/src/lib.rs`
5. `Anchor.toml` and `Cargo.toml`
6. `agents/package.json` and `agents/tsconfig.json`
7. `agents/.env.example`
8. All TypeScript service files
9. All agent files
10. `agents/src/index.ts`
11. `agents/src/dashboard/index.tsx`
12. `tests/hivemind.ts`
13. `README.md`, `SKILLS.md`, `DEEPDIVE.md`
