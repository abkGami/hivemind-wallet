/**
 * @file analyst.ts
 * Analyst agent — receives signals from the Scout, judges whether to act using
 * the LLM, and either pays the Executor or penalises Scout's reputation.
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';
import * as crypto from 'crypto';
import type { ColonyClient } from '../colony.js';
import type { LLMService } from '../services/llm.js';
import type { SignalPayload } from './scout.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Payload emitted on the `'execute'` event. */
export interface ExecutePayload {
  signal: string;
  price: number;
  confidence: number;
  timestamp: number;
  fromAgentIndex: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/**
 * Computes the sample standard deviation of an array of numbers.
 *
 * @param values - Non-empty array of numbers.
 * @returns Standard deviation, or 0 if fewer than 2 values provided.
 */
function stdDev(values: number[]): number {
  if (values.length < 2) return 0;
  const mean = values.reduce((a, b) => a + b, 0) / values.length;
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/**
 * Derives a normalised confidence score [0, 1] from price volatility.
 * High volatility → low confidence (more uncertainty).
 *
 * @param priceHistory - Array of recent prices.
 * @param price        - Current price (used for normalisation).
 * @returns Normalised confidence in [0, 1].
 */
function deriveConfidence(priceHistory: number[], price: number): number {
  const last5 = priceHistory.slice(-5);
  if (last5.length < 2 || price === 0) return 0.5;

  const sd = stdDev(last5);
  // Coefficient of variation as a proxy for volatility.
  const cv = sd / price;
  // Clamp and invert so high volatility → low confidence.
  return Math.max(0, Math.min(1, 1 - cv * 10));
}

// ─────────────────────────────────────────────────────────────────────────────
// AnalystAgent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autonomous Analyst agent that evaluates Scout signals and either triggers
 * execution or penalises the Scout for weak signals.
 */
export class AnalystAgent {
  private readonly colony: ColonyClient;
  private readonly llm: LLMService;
  private readonly emitter: EventEmitter;
  private readonly agentIndex: number;

  /** Amount (in lamports) paid to the Executor per actionable signal. */
  private static readonly EXECUTOR_FEE_LAMPORTS = 8_000;
  /** Executor agent index. */
  private static readonly EXECUTOR_INDEX = 2;
  /** Scout agent index — used when penalising weak signals. */
  private static readonly SCOUT_INDEX = 0;

  /**
   * @param colony     - Initialised `ColonyClient`.
   * @param llm        - `LLMService` instance.
   * @param emitter    - Shared `EventEmitter` for inter-agent communication.
   * @param agentIndex - On-chain index for the Analyst agent (typically 1).
   */
  constructor(
    colony: ColonyClient,
    llm: LLMService,
    emitter: EventEmitter,
    agentIndex: number
  ) {
    this.colony = colony;
    this.llm = llm;
    this.emitter = emitter;
    this.agentIndex = agentIndex;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Starts listening for `'signal'` events from the Scout.
   * Each event triggers an asynchronous analysis routine.
   */
  start(): void {
    console.log(chalk.blue(`[ANALYST][${ts()}] Agent started — listening for signals.`));
    this.emitter.on('signal', (payload: SignalPayload) => {
      void this.handleSignal(payload);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Signal handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Processes a Scout signal:
   * 1. Computes a confidence score from price history.
   * 2. Asks the LLM whether execution is warranted.
   * 3. If yes: pays the Executor and emits an `'execute'` event.
   * 4. If no: reports a failed outcome for the Scout.
   *
   * @param payload - Signal payload received from the Scout.
   */
  private async handleSignal(payload: SignalPayload): Promise<void> {
    try {
      console.log(
        chalk.blue(
          `[ANALYST][${ts()}] Received signal: ${payload.signal} @ $${payload.price.toFixed(4)}`
        )
      );

      // Compute confidence from the price history available in payload context.
      const confidence = deriveConfidence([payload.price], payload.price);

      // Ask the LLM whether to execute.
      const shouldExecute = await this.llm.shouldExecute(payload.signal, confidence);

      if (shouldExecute) {
        const executionPayload: ExecutePayload = {
          signal: payload.signal,
          price: payload.price,
          confidence,
          timestamp: Date.now(),
          fromAgentIndex: this.agentIndex,
        };

        const taskId = crypto
          .createHash('sha256')
          .update(JSON.stringify(executionPayload))
          .digest('hex');

        // Pay the Executor.
        const sig = await this.colony.agentPay(
          this.agentIndex,
          AnalystAgent.EXECUTOR_INDEX,
          AnalystAgent.EXECUTOR_FEE_LAMPORTS,
          taskId
        );
        console.log(
          chalk.blue(
            `[ANALYST][${ts()}] Dispatching trade to Executor. tx: ${sig} | confidence: ${(confidence * 100).toFixed(1)}%`
          )
        );

        // Emit execute event for the Executor agent.
        this.emitter.emit('execute', executionPayload);
      } else {
        console.log(
          chalk.blue(
            `[ANALYST][${ts()}] Signal rejected (confidence too low). Penalising Scout.`
          )
        );
        // Penalise Scout for a weak signal.
        await this.colony.reportOutcome(AnalystAgent.SCOUT_INDEX, false);
      }
    } catch (err) {
      console.error(
        chalk.red(
          `[ANALYST][${ts()}] Error handling signal: ${err instanceof Error ? err.message : String(err)}`
        )
      );
    }
  }
}
