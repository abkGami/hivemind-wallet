/**
 * @file scout.ts
 * Scout agent — fetches SOL/USD price signals, derives a trading signal using
 * the LLM, and pays the Analyst agent for further processing.
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';
import * as crypto from 'crypto';
import type { ColonyClient } from '../colony.js';
import type { LLMService, TradingSignal } from '../services/llm.js';
import type { JupiterService } from '../services/jupiter.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Payload emitted on the `'signal'` event. */
export interface SignalPayload {
  signal: TradingSignal;
  price: number;
  timestamp: number;
  agentIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/** Pauses execution for `ms` milliseconds. */
const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

// ─────────────────────────────────────────────────────────────────────────────
// ScoutAgent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autonomous Scout agent that periodically fetches the SOL price, derives a
 * trading signal with the LLM, and pays the Analyst via the colony program.
 */
export class ScoutAgent {
  private readonly colony: ColonyClient;
  private readonly llm: LLMService;
  private readonly jupiter: JupiterService;
  private readonly agentIndex: number;
  private readonly emitter: EventEmitter;

  /** Amount (in lamports) paid to the Analyst for each signal. */
  private static readonly ANALYST_FEE_LAMPORTS = 5_000;
  /** Analyst agent index. */
  private static readonly ANALYST_INDEX = 1;
  /** Polling interval in milliseconds. */
  private static readonly POLL_INTERVAL_MS = 30_000;

  /**
   * @param colony     - Initialised `ColonyClient`.
   * @param llm        - `LLMService` instance.
   * @param jupiter    - `JupiterService` instance.
   * @param agentIndex - On-chain index for the Scout agent (typically 0).
   * @param emitter    - Shared `EventEmitter` for inter-agent communication.
   */
  constructor(
    colony: ColonyClient,
    llm: LLMService,
    jupiter: JupiterService,
    agentIndex: number,
    emitter: EventEmitter
  ) {
    this.colony = colony;
    this.llm = llm;
    this.jupiter = jupiter;
    this.agentIndex = agentIndex;
    this.emitter = emitter;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Main loop
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Starts the Scout agent's infinite polling loop.
   *
   * Each iteration:
   * 1. Fetches the current SOL/USD price.
   * 2. Calls the LLM for a BUY/SELL/HOLD signal.
   * 3. Pays the Analyst 5 000 lamports via `colony.agentPay`.
   * 4. Emits a `'signal'` event with the payload.
   *
   * Errors are caught and logged without crashing the loop.
   *
   * @returns A promise that never resolves (infinite loop).
   */
  async run(): Promise<void> {
    console.log(chalk.cyan(`[SCOUT][${ts()}] Agent started.`));

    while (true) {
      try {
        await this.tick();
      } catch (err) {
        console.error(
          chalk.red(
            `[SCOUT][${ts()}] Error in tick: ${err instanceof Error ? err.message : String(err)}`
          )
        );
      }
      await sleep(ScoutAgent.POLL_INTERVAL_MS);
    }
  }

  /**
   * Executes one Scout iteration: fetch price → get signal → pay Analyst → emit.
   */
  private async tick(): Promise<void> {
    // 1. Fetch current SOL price.
    const price = await this.jupiter.getSOLPrice();
    const priceHistory = this.jupiter.getPriceHistory();
    console.log(chalk.cyan(`[SCOUT][${ts()}] SOL/USD: $${price.toFixed(4)}`));

    // 2. Get LLM trading signal.
    const signal = await this.llm.getSignal(price, priceHistory);
    console.log(chalk.cyan(`[SCOUT][${ts()}] Signal: ${signal}`));

    // 3. Build task payload and derive task ID.
    const payload: SignalPayload = {
      signal,
      price,
      timestamp: Date.now(),
      agentIndex: this.agentIndex,
    };
    const taskId = crypto
      .createHash('sha256')
      .update(JSON.stringify(payload))
      .digest('hex');

    // 4. Pay the Analyst via on-chain agent_pay.
    const sig = await this.colony.agentPay(
      this.agentIndex,
      ScoutAgent.ANALYST_INDEX,
      ScoutAgent.ANALYST_FEE_LAMPORTS,
      taskId
    );
    console.log(chalk.cyan(`[SCOUT][${ts()}] Paid Analyst ${ScoutAgent.ANALYST_FEE_LAMPORTS} lamports | tx: ${sig}`));

    // 5. Emit signal event for the Analyst to consume.
    this.emitter.emit('signal', payload);
  }
}
