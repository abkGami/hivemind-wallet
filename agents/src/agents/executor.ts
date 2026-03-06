/**
 * @file executor.ts
 * Executor agent — receives trade instructions from the Analyst, triggers a
 * simulated Jupiter swap, reports the outcome on-chain, and pays the Ledger.
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';
import * as crypto from 'crypto';
import type { ColonyClient } from '../colony.js';
import type { JupiterService } from '../services/jupiter.js';
import type { ExecutePayload } from './analyst.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Payload broadcasted on the `'outcome'` event. */
export interface OutcomePayload {
  success: boolean;
  outputAmount: number;
  fee: number;
  signal: string;
  price: number;
  timestamp: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Simulated SOL native mint address (Wrapped SOL). */
const SOL_MINT = 'So11111111111111111111111111111111111111112';
/** USDC devnet mint address. */
const USDC_MINT = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// ExecutorAgent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autonomous Executor agent that performs simulated swaps and records outcomes.
 */
export class ExecutorAgent {
  private readonly colony: ColonyClient;
  private readonly jupiter: JupiterService;
  private readonly emitter: EventEmitter;
  private readonly agentIndex: number;

  /** Amount (in lamports) paid to the Ledger per outcome recorded. */
  private static readonly LEDGER_FEE_LAMPORTS = 2_000;
  /** Ledger agent index. */
  private static readonly LEDGER_INDEX = 3;

  /**
   * @param colony     - Initialised `ColonyClient`.
   * @param jupiter    - `JupiterService` instance for simulated swaps.
   * @param emitter    - Shared `EventEmitter` for inter-agent communication.
   * @param agentIndex - On-chain index for the Executor agent (typically 2).
   */
  constructor(
    colony: ColonyClient,
    jupiter: JupiterService,
    emitter: EventEmitter,
    agentIndex: number
  ) {
    this.colony = colony;
    this.jupiter = jupiter;
    this.emitter = emitter;
    this.agentIndex = agentIndex;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Starts listening for `'execute'` events from the Analyst.
   */
  start(): void {
    console.log(chalk.magenta(`[EXECUTOR][${ts()}] Agent started — listening for execute events.`));
    this.emitter.on('execute', (payload: ExecutePayload) => {
      void this.handleExecute(payload);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Execute handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Processes an execution instruction:
   * 1. Runs a simulated Jupiter swap.
   * 2. Reports the outcome on-chain (self-report).
   * 3. Pays the Ledger 2 000 lamports for recording the event.
   * 4. Emits an `'outcome'` event.
   *
   * @param payload - Execution payload received from the Analyst.
   */
  private async handleExecute(payload: ExecutePayload): Promise<void> {
    try {
      console.log(
        chalk.magenta(
          `[EXECUTOR][${ts()}] Executing trade: ${payload.signal} @ $${payload.price.toFixed(4)}`
        )
      );

      // Determine swap direction based on signal.
      const [inputMint, outputMint] =
        payload.signal === 'BUY' ? [USDC_MINT, SOL_MINT] : [SOL_MINT, USDC_MINT];

      // 1 000 000 lamports (0.001 SOL) as the simulated input amount.
      const swapAmount = 1_000_000;

      // Execute simulated swap.
      const result = await this.jupiter.simulateSwap(inputMint, outputMint, swapAmount);

      if (result.success) {
        console.log(
          chalk.magenta(
            `[EXECUTOR][${ts()}] Swap success — output: ${result.outputAmount} | fee: ${result.fee}`
          )
        );
      } else {
        console.warn(chalk.yellow(`[EXECUTOR][${ts()}] Swap failed.`));
      }

      // 2. Report outcome on-chain.
      await this.colony.reportOutcome(this.agentIndex, result.success);

      // 3. Pay Ledger for recording the event.
      const taskId = crypto
        .createHash('sha256')
        .update(JSON.stringify({ ...result, timestamp: Date.now() }))
        .digest('hex');

      const sig = await this.colony.agentPay(
        this.agentIndex,
        ExecutorAgent.LEDGER_INDEX,
        ExecutorAgent.LEDGER_FEE_LAMPORTS,
        taskId
      );
      console.log(
        chalk.magenta(`[EXECUTOR][${ts()}] Paid Ledger ${ExecutorAgent.LEDGER_FEE_LAMPORTS} lamports | tx: ${sig}`)
      );

      // 4. Emit outcome event for Ledger and other listeners.
      const outcome: OutcomePayload = {
        success: result.success,
        outputAmount: result.outputAmount,
        fee: result.fee,
        signal: payload.signal,
        price: payload.price,
        timestamp: Date.now(),
      };
      this.emitter.emit('outcome', outcome);
    } catch (err) {
      console.error(
        chalk.red(
          `[EXECUTOR][${ts()}] Error during execute: ${err instanceof Error ? err.message : String(err)}`
        )
      );
      // Still emit a failed outcome so Ledger stays in sync.
      this.emitter.emit('outcome', {
        success: false,
        outputAmount: 0,
        fee: 0,
        signal: payload.signal,
        price: payload.price,
        timestamp: Date.now(),
      } satisfies OutcomePayload);
    }
  }
}
