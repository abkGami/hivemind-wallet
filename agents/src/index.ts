/**
 * @file index.ts
 * Colony bootstrap — initialises all services, optionally initialises the
 * on-chain colony, and starts all four agents concurrently.
 */

import 'dotenv/config';
import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import chalk from 'chalk';

import { SolanaRPC } from './services/rpc.js';
import { LLMService } from './services/llm.js';
import { JupiterService } from './services/jupiter.js';
import { WalletManager } from './wallet.js';
import { ColonyClient, AgentRole } from './colony.js';
import { ScoutAgent } from './agents/scout.js';
import { AnalystAgent } from './agents/analyst.js';
import { ExecutorAgent } from './agents/executor.js';
import { LedgerAgent } from './agents/ledger.js';

// We import the IDL dynamically to avoid a hard compile-time dependency before
// `anchor build` has been run.  Adjust the path if your workspace layout differs.
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// Environment validation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Validates that all required environment variables are present.
 * Throws a descriptive `Error` listing every missing variable if any are absent.
 */
function validateEnv(): void {
  const required = [
    'SOLANA_RPC_URL',
    'COLONY_PROGRAM_ID',
    'AUTHORITY_KEYPAIR',
    'GROQ_API_KEY',
  ] as const;

  const missing = required.filter((key) => !process.env[key] || process.env[key]!.trim() === '');

  if (missing.length > 0) {
    throw new Error(
      `[Bootstrap] Missing required environment variables:\n${missing.map((k) => `  • ${k}`).join('\n')}\n` +
        'Copy agents/.env.example to agents/.env and fill in all values.'
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Colony initialisation
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checks if the colony has already been initialised on-chain.
 *
 * @param colony - `ColonyClient` instance.
 * @returns `true` if the colony account exists; `false` otherwise.
 */
async function isColonyInitialised(colony: ColonyClient): Promise<boolean> {
  try {
    await colony.fetchColonyState();
    return true;
  } catch {
    return false;
  }
}

/**
 * Initialises the colony and registers all four agents.
 *
 * @param colony - `ColonyClient` instance.
 */
async function bootstrapColony(colony: ColonyClient): Promise<void> {
  console.log(chalk.yellow(`[Bootstrap][${ts()}] Colony not found — initialising…`));

  await colony.initializeColony();
  console.log(chalk.green(`[Bootstrap][${ts()}] Colony created.`));

  // Agent registration config.
  const agents: Array<{ role: Record<string, object>; daily: number; perTx: number; name: string }> = [
    { role: AgentRole.Scout,    daily: 500_000,   perTx: 10_000,  name: 'Scout'    },
    { role: AgentRole.Analyst,  daily: 1_000_000, perTx: 20_000,  name: 'Analyst'  },
    { role: AgentRole.Executor, daily: 2_000_000, perTx: 50_000,  name: 'Executor' },
    { role: AgentRole.Ledger,   daily: 100_000,   perTx: 5_000,   name: 'Ledger'   },
  ];

  for (const agent of agents) {
    await colony.registerAgent(agent.role, agent.daily, agent.perTx);
    console.log(
      chalk.green(
        `[Bootstrap][${ts()}] Registered ${agent.name} | daily=${agent.daily} perTx=${agent.perTx}`
      )
    );
  }
}

/**
 * Registers agents that are missing from an already-initialised colony.
 * Useful when the colony was created in a previous session but `registerAgent`
 * failed or was interrupted, leaving `agentCount < 4`.
 *
 * @param colony       - `ColonyClient` instance.
 * @param currentCount - Number of agents already registered on-chain.
 */
async function registerMissingAgents(colony: ColonyClient, currentCount: number): Promise<void> {
  const ALL_AGENTS: Array<{ role: Record<string, object>; daily: number; perTx: number; name: string }> = [
    { role: AgentRole.Scout,    daily: 500_000,   perTx: 10_000,  name: 'Scout'    },
    { role: AgentRole.Analyst,  daily: 1_000_000, perTx: 20_000,  name: 'Analyst'  },
    { role: AgentRole.Executor, daily: 2_000_000, perTx: 50_000,  name: 'Executor' },
    { role: AgentRole.Ledger,   daily: 100_000,   perTx: 5_000,   name: 'Ledger'   },
  ];

  console.log(chalk.yellow(`[Bootstrap][${ts()}] Registering ${4 - currentCount} missing agent(s)…`));

  for (let i = currentCount; i < ALL_AGENTS.length; i++) {
    const agent = ALL_AGENTS[i]!;
    await colony.registerAgent(agent.role, agent.daily, agent.perTx);
    console.log(
      chalk.green(
        `[Bootstrap][${ts()}] Registered ${agent.name} (index ${i}) | daily=${agent.daily} perTx=${agent.perTx}`
      )
    );
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Entry point — validates config, initialises colony if needed, and starts
 * all agents concurrently.
 */
async function main(): Promise<void> {
  console.log(chalk.bold.cyan(`\n🧠 HIVEMIND WALLET — Colony Runtime\n`));

  // 1. Validate environment.
  validateEnv();

  // 2. Load IDL (requires `anchor build` to have been run first).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let idl: any;
  try {
    idl = require('../../target/idl/hivemind.json');
  } catch {
    throw new Error(
      '[Bootstrap] IDL not found at target/idl/hivemind.json. Run `anchor build` first.'
    );
  }

  // 3. Initialise shared services.
  SolanaRPC.getInstance(); // warm up connection
  const llm = new LLMService();
  const jupiter = new JupiterService();
  const walletManager = new WalletManager();
  const authority = walletManager.loadAuthorityKeypair();
  const programId = new PublicKey(process.env.COLONY_PROGRAM_ID!);

  const colony = new ColonyClient(authority, programId, idl);
  const emitter = new EventEmitter();

  // 4. Initialise colony on-chain if it hasn't been set up yet.
  const initialised = await isColonyInitialised(colony);
  if (!initialised) {
    await bootstrapColony(colony);
  } else {
    const state = await colony.fetchColonyState();
    console.log(
      chalk.gray(
        `[Bootstrap][${ts()}] Colony already initialised. Agents: ${state.agentCount}, total txns: ${state.totalTransactions.toString()}`
      )
    );
    // Register any agents that were not registered during a previous run.
    if (state.agentCount < 4) {
      await registerMissingAgents(colony, state.agentCount);
    }
  }

  // 5. Instantiate agents.
  const scout    = new ScoutAgent   (colony, llm, jupiter, 0, emitter);
  const analyst  = new AnalystAgent (colony, llm, emitter, 1);
  const executor = new ExecutorAgent(colony, jupiter, emitter, 2);
  const ledger   = new LedgerAgent  (emitter, 3);

  // 6. Start event-driven agents.
  analyst.start();
  executor.start();
  ledger.start();

  // 7. Handle colony:warning.
  emitter.on('colony:warning', ({ successRate }: { successRate: number }) => {
    console.error(
      chalk.bgRed.white(
        `[Bootstrap][${ts()}] ⚠️  Colony-wide warning — success rate: ${(successRate * 100).toFixed(1)}%`
      )
    );
  });

  // 8. Graceful shutdown handler.
  async function shutdown(signal: string): Promise<void> {
    console.log(chalk.yellow(`\n[Bootstrap][${ts()}] Received ${signal} — shutting down…`));
    try {
      const state = await colony.fetchColonyState();
      for (let i = 0; i < state.agentCount; i++) {
        await colony.emergencyFreeze(i, true);
        console.log(chalk.yellow(`[Bootstrap][${ts()}] Froze agent ${i}.`));
      }
    } catch (err) {
      console.error(
        chalk.red(
          `[Bootstrap][${ts()}] Error during shutdown freeze: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
    process.exit(0);
  }

  process.on('SIGINT',  () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  // 9. Start the Scout (infinite loop — must be last to avoid blocking).
  console.log(chalk.bold.green(`[Bootstrap][${ts()}] All agents active. Colony running.\n`));
  await Promise.all([scout.run()]);
}

main().catch((err) => {
  console.error(chalk.red(`[Bootstrap] Fatal error: ${err instanceof Error ? err.message : String(err)}`));
  process.exit(1);
});
