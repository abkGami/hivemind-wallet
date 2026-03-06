/**
 * @file llm.ts
 * Groq API client used by the Hivemind agents for on-the-fly decision-making.
 * Wraps `groq-sdk` with typed helpers for signal analysis and execution judgment.
 */

import Groq from 'groq-sdk';
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Possible trading signals the Scout can emit. */
export type TradingSignal = 'BUY' | 'SELL' | 'HOLD';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// LLMService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Wrapper around the Groq API that provides high-level helpers for agent
 * decision-making.  All failures are caught and safe defaults are returned
 * so that one bad API call never crashes the agent loop.
 */
export class LLMService {
  private readonly client: Groq;
  private readonly model: string;

  /**
   * Creates a new `LLMService` instance.
   *
   * @param model - Groq model identifier to use for all requests.
   *                Reads `GROQ_MODEL` env var; defaults to `"llama-3.3-70b-versatile"`.
   * @throws `Error` if `GROQ_API_KEY` is not set.
   */
  constructor(model = process.env.GROQ_MODEL ?? 'llama-3.3-70b-versatile') {
    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey) {
      throw new Error('[LLMService] GROQ_API_KEY environment variable is not set.');
    }
    this.client = new Groq({ apiKey });
    this.model = model;
    console.log(chalk.gray(`[LLM][${timestamp()}] Initialised with model: ${this.model}`));
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Core API
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Sends a prompt to the Groq API and returns the trimmed text response.
   *
   * @param systemPrompt - System-role instructions for the model.
   * @param userPrompt   - User-role message / question.
   * @param maxTokens    - Upper token limit for the completion (default: 150).
   * @returns Trimmed text response, or an empty string on failure.
   */
  async ask(systemPrompt: string, userPrompt: string, maxTokens = 150): Promise<string> {
    try {
      const response = await this.client.chat.completions.create({
        model: this.model,
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
        max_tokens: maxTokens,
        temperature: 0.2, // low temperature for deterministic agent decisions
      });

      const text = response.choices[0]?.message?.content?.trim() ?? '';
      return text;
    } catch (err) {
      console.error(
        chalk.red(
          `[LLM][${timestamp()}] Error in ask(): ${err instanceof Error ? err.message : String(err)}`
        )
      );
      return '';
    }
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Agent-specific helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Asks the LLM to evaluate the current SOL price versus recent price
   * history and return a trading signal.
   *
   * @param price   - Current SOL/USD price.
   * @param history - Array of up to the last 5 historical prices (oldest first).
   * @returns `"BUY"`, `"SELL"`, or `"HOLD"`.  Falls back to `"HOLD"` if the
   *          model response cannot be parsed.
   */
  async getSignal(price: number, history: number[]): Promise<TradingSignal> {
    const last5 = history.slice(-5);
    const systemPrompt = `You are a crypto trading signal bot.
Analyse the SOL price data and respond with EXACTLY one word: BUY, SELL, or HOLD.
Do NOT include any other text, punctuation, or explanation.`;

    const userPrompt = `Current SOL price: $${price.toFixed(4)}
Recent prices (oldest → newest): ${last5.map((p) => `$${p.toFixed(4)}`).join(', ')}
Signal:`;

    const raw = await this.ask(systemPrompt, userPrompt, 10);
    const normalised = raw.toUpperCase().trim().replace(/[^A-Z]/g, '') as TradingSignal;

    if (['BUY', 'SELL', 'HOLD'].includes(normalised)) {
      console.log(chalk.gray(`[LLM][${timestamp()}] Signal: ${normalised} (price=$${price})`));
      return normalised;
    }

    console.warn(
      chalk.yellow(`[LLM][${timestamp()}] Unexpected signal response "${raw}" — defaulting to HOLD`)
    );
    return 'HOLD';
  }

  /**
   * Asks the LLM whether a trade should be executed given a signal and a
   * confidence score derived from price volatility.
   *
   * @param signal     - The trading signal (`"BUY"`, `"SELL"`, or `"HOLD"`).
   * @param confidence - Normalised confidence score in the range [0, 1].
   *                     0 = maximum uncertainty, 1 = maximum certainty.
   * @returns `true` if the LLM recommends executing the trade; `false` otherwise.
   */
  async shouldExecute(signal: string, confidence: number): Promise<boolean> {
    const systemPrompt = `You are an autonomous trading risk manager.
Based on the provided signal and confidence score, decide whether to execute the trade.
Respond with EXACTLY one word: YES or NO.
Do NOT include any other text, punctuation, or explanation.`;

    const userPrompt = `Signal: ${signal}
Confidence: ${(confidence * 100).toFixed(1)}%
Should we execute? (YES/NO):`;

    const raw = await this.ask(systemPrompt, userPrompt, 5);
    const normalised = raw.toUpperCase().trim().replace(/[^A-Z]/g, '');

    const execute = normalised === 'YES';
    console.log(
      chalk.gray(
        `[LLM][${timestamp()}] shouldExecute: signal=${signal} confidence=${(confidence * 100).toFixed(1)}% → ${execute ? 'YES' : 'NO'}`
      )
    );
    return execute;
  }
}
