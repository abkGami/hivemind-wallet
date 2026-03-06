/**
 * @file ledger.ts
 * Ledger agent — records every trade outcome in memory, computes colony health
 * metrics, and emits a warning event when the success rate falls critically low.
 */

import { EventEmitter } from 'events';
import chalk from 'chalk';
import type { OutcomePayload } from './executor.js';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** A single recorded outcome entry kept in the Ledger's in-memory history. */
interface OutcomeEntry {
  timestamp: number;
  success: boolean;
  amount: number;
  signal: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

/** Maximum number of outcome entries kept in memory. */
const HISTORY_MAX = 100;
/** Number of outcomes between colony health summary logs. */
const HEALTH_SUMMARY_INTERVAL = 10;
/** Success rate threshold below which a `'colony:warning'` event is emitted. */
const WARNING_THRESHOLD = 0.4;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// LedgerAgent
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Autonomous Ledger agent that maintains an in-memory outcome history and emits
 * colony health warnings when the success rate drops below 40%.
 */
export class LedgerAgent {
  private readonly emitter: EventEmitter;
  private readonly agentIndex: number;

  /** Rolling history of the last 100 outcomes. */
  private outcomeHistory: OutcomeEntry[] = [];

  /**
   * @param emitter    - Shared `EventEmitter` for inter-agent communication.
   * @param agentIndex - On-chain index for the Ledger agent (typically 3).
   */
  constructor(emitter: EventEmitter, agentIndex: number) {
    this.emitter = emitter;
    this.agentIndex = agentIndex;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Lifecycle
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Starts listening for `'outcome'` events from the Executor.
   */
  start(): void {
    console.log(chalk.white(`[LEDGER][${ts()}] Agent started — listening for outcomes.`));
    this.emitter.on('outcome', (payload: OutcomePayload) => {
      this.handleOutcome(payload);
    });
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Outcome handling
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Records an outcome and performs periodic health checks.
   *
   * @param payload - Outcome payload received from the Executor.
   */
  private handleOutcome(payload: OutcomePayload): void {
    const entry: OutcomeEntry = {
      timestamp: payload.timestamp,
      success: payload.success,
      amount: payload.outputAmount,
      signal: payload.signal,
    };

    // Append to rolling history.
    this.outcomeHistory.push(entry);
    if (this.outcomeHistory.length > HISTORY_MAX) {
      this.outcomeHistory.shift();
    }

    const status = payload.success ? chalk.green('✅ SUCCESS') : chalk.red('❌ FAILURE');
    console.log(
      chalk.white(
        `[LEDGER][${ts()}] Outcome recorded: ${status} | signal=${payload.signal} | output=${payload.outputAmount}`
      )
    );

    // Every HEALTH_SUMMARY_INTERVAL outcomes, compute and log colony health.
    if (this.outcomeHistory.length % HEALTH_SUMMARY_INTERVAL === 0) {
      this.logHealthSummary();
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Colony health
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Computes the success rate over the last 10 outcomes and logs a summary.
   * Emits a `'colony:warning'` event if the rate falls below 40%.
   */
  private logHealthSummary(): void {
    const window = this.outcomeHistory.slice(-HEALTH_SUMMARY_INTERVAL);
    const successCount = window.filter((e) => e.success).length;
    const successRate = successCount / window.length;

    const rateLabel = (successRate * 100).toFixed(1);
    const colour = successRate >= 0.7 ? chalk.green : successRate >= 0.4 ? chalk.yellow : chalk.red;

    console.log(
      colour(
        `[LEDGER][${ts()}] ══ Colony Health Summary ══\n` +
          `  Last ${window.length} outcomes | Success rate: ${rateLabel}% (${successCount}/${window.length})\n` +
          `  Total recorded: ${this.outcomeHistory.length}`
      )
    );

    if (successRate < WARNING_THRESHOLD) {
      console.error(
        chalk.bgRed.white(
          `[LEDGER][${ts()}] ⚠️  Colony warning — success rate below ${WARNING_THRESHOLD * 100}%!`
        )
      );
      this.emitter.emit('colony:warning', { successRate, window: window.length });
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public accessors
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Returns a copy of the current outcome history array.
   *
   * @returns Array of `OutcomeEntry` objects (oldest first).
   */
  getHistory(): OutcomeEntry[] {
    return [...this.outcomeHistory];
  }
}
