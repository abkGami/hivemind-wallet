/**
 * @file jupiter.ts
 * Jupiter Price API v4 client used by the Scout agent.
 * All swap execution on devnet is SIMULATED — no real tokens are moved.
 */

import axios from 'axios';
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

/** Response shape from Jupiter Lite Price API v2 for a single token. */
interface JupiterV2PriceEntry {
  id: string;
  type: string;
  price: string; // decimal string, e.g. "133.50"
}

interface JupiterV2PriceResponse {
  data: Record<string, JupiterV2PriceEntry>;
  timeTaken: number;
}

/** CoinGecko simple price response. */
interface CoinGeckoResponse {
  solana: { usd: number };
}

/** Simulated swap result. */
export interface SimulatedSwapResult {
  /** Whether the simulated swap succeeded. */
  success: boolean;
  /** Amount of output token received (in token units). */
  outputAmount: number;
  /** Simulated fee in basis points (scaled to token units here). */
  fee: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────

// Jupiter Lite API v2 endpoint (may vary by region/version — used as secondary).
const JUPITER_PRICE_URL = 'https://api.jup.ag/price/v2';
// SOL native mint address used as the query ID in the v2 API.
const SOL_MINT = 'So11111111111111111111111111111111111111112';
// CoinGecko is primary — free tier, no key, reliable.
const COINGECKO_URL = 'https://api.coingecko.com/api/v3/simple/price';
const PRICE_HISTORY_MAX = 20;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// JupiterService
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provides SOL/USD price feeds and simulated swap execution via the Jupiter
 * Price API v4.  Price history is kept in memory (rolling window of 20 prices).
 */
export class JupiterService {
  /** Rolling array of the last `PRICE_HISTORY_MAX` SOL/USD prices. */
  private priceHistory: number[] = [];

  // ───────────────────────────────────────────────────────────────────────────
  // Price feed
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Fetches the current SOL/USD price from the Jupiter Price API v4.
   *
   * Appends the result to the internal price history ring buffer and logs
   * the result with a `[JUPITER]` prefix.
   *
   * @returns Current SOL/USD price as a floating-point number.
   * @throws `Error` if the HTTP request fails or the API returns an unexpected shape.
   */
  async getSOLPrice(): Promise<number> {
    // Primary: CoinGecko public API (reliable, no key required).
    try {
      const response = await axios.get<CoinGeckoResponse>(COINGECKO_URL, {
        params: { ids: 'solana', vs_currencies: 'usd' },
        timeout: 10_000,
      });

      const price = response.data?.solana?.usd;
      if (typeof price !== 'number' || price <= 0) {
        throw new Error(`Unexpected CoinGecko price: ${JSON.stringify(response.data)}`);
      }

      this.recordPrice(price);
      console.log(chalk.gray(`[JUPITER][${timestamp()}] SOL/USD: $${price.toFixed(4)} (CoinGecko)`));
      return price;
    } catch (cgErr) {
      const cgMsg = cgErr instanceof Error ? cgErr.message : String(cgErr);
      console.warn(chalk.yellow(`[JUPITER][${timestamp()}] CoinGecko failed (${cgMsg}), trying Jupiter v2…`));
    }

    // Secondary: Jupiter Lite API v2.
    try {
      const response = await axios.get<JupiterV2PriceResponse>(JUPITER_PRICE_URL, {
        params: { ids: SOL_MINT },
        timeout: 10_000,
      });

      const entry = response.data.data[SOL_MINT];
      if (!entry) {
        throw new Error('SOL mint not found in Jupiter v2 response.');
      }

      const price = parseFloat(entry.price);
      if (isNaN(price) || price <= 0) {
        throw new Error(`Unexpected Jupiter price value: ${entry.price}`);
      }

      this.recordPrice(price);
      console.log(chalk.gray(`[JUPITER][${timestamp()}] SOL/USD: $${price.toFixed(4)} (Jupiter v2)`));
      return price;
    } catch (jupErr) {
      const jupMsg = jupErr instanceof Error ? jupErr.message : String(jupErr);
      console.error(chalk.red(`[JUPITER][${timestamp()}] getSOLPrice — both sources failed. Last error: ${jupMsg}`));
      throw new Error(`[JupiterService.getSOLPrice] Failed to fetch price: ${jupMsg}`);
    }
  }

  /** Appends a price to the rolling history buffer. */
  private recordPrice(price: number): void {
    this.priceHistory.push(price);
    if (this.priceHistory.length > PRICE_HISTORY_MAX) {
      this.priceHistory.shift();
    }
  }

  /**
   * Returns a copy of the internal rolling price history (up to last 20 entries).
   *
   * @returns Array of historical SOL/USD prices, oldest first.
   */
  getPriceHistory(): number[] {
    return [...this.priceHistory];
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Simulated swap
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * ⚠️ SIMULATION ONLY — does NOT execute a real on-chain swap.
   *
   * Calculates a mock output amount based on the latest known SOL price ± a
   * random slippage of 0–0.5 %.  Returns a `SimulatedSwapResult` so the
   * Executor agent can record a realistic outcome without touching real tokens.
   *
   * @param inputMint   - Mint address of the input token (e.g. native SOL mint).
   * @param outputMint  - Mint address of the output token (e.g. USDC).
   * @param amount      - Amount of input token in base units (lamports for SOL).
   * @returns `SimulatedSwapResult` with `success`, `outputAmount`, and `fee`.
   */
  async simulateSwap(
    inputMint: string,
    outputMint: string,
    amount: number
  ): Promise<SimulatedSwapResult> {
    console.log(
      chalk.yellow(
        `[JUPITER][${timestamp()}] ⚠️  SIMULATED SWAP — ${inputMint} → ${outputMint} | amount=${amount}`
      )
    );

    try {
      // Use the last known price or fetch a fresh one.
      let solPrice = this.priceHistory[this.priceHistory.length - 1];
      if (solPrice === undefined) {
        solPrice = await this.getSOLPrice();
      }

      // Random slippage in the range [0, 0.005].
      const slippage = Math.random() * 0.005;
      const price = solPrice * (1 - slippage);

      // Convert lamport amount to SOL, then to USD equivalent.
      const solAmount = amount / 1_000_000_000;
      const outputAmount = parseFloat((solAmount * price).toFixed(6));

      // Simulate a 0.25 % protocol fee.
      const fee = parseFloat((outputAmount * 0.0025).toFixed(6));

      const result: SimulatedSwapResult = {
        success: true,
        outputAmount,
        fee,
      };

      console.log(
        chalk.yellow(
          `[JUPITER][${timestamp()}] Simulated result: outputAmount=${outputAmount} fee=${fee} (slippage=${(slippage * 100).toFixed(3)}%)`
        )
      );

      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      console.error(chalk.red(`[JUPITER][${timestamp()}] simulateSwap error: ${msg}`));
      return { success: false, outputAmount: 0, fee: 0 };
    }
  }
}
