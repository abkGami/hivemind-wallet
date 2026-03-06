/**
 * @file rpc.ts
 * Singleton wrapper around `@solana/web3.js` `Connection` that provides
 * convenience helpers used throughout the Hivemind agent runtime.
 */

import { Connection, PublicKey, LAMPORTS_PER_SOL } from '@solana/web3.js';
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// SolanaRPC
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Singleton Solana RPC client.
 *
 * Lazily instantiated the first time `SolanaRPC.getInstance()` is called.
 * All public methods log with a `[RPC]` prefix so they are easy to identify
 * in the colony log stream.
 */
export class SolanaRPC {
  private static instance: SolanaRPC;

  /** Underlying `@solana/web3.js` connection. */
  public readonly connection: Connection;

  // Private constructor — use `getInstance()`.
  private constructor() {
    const rpcUrl = process.env.SOLANA_RPC_URL;
    if (!rpcUrl) {
      throw new Error('[SolanaRPC] SOLANA_RPC_URL environment variable is not set.');
    }
    this.connection = new Connection(rpcUrl, 'confirmed');
    console.log(chalk.gray(`[RPC][${timestamp()}] Connected to ${rpcUrl}`));
  }

  /**
   * Returns the singleton `SolanaRPC` instance, creating it if necessary.
   *
   * @returns The shared `SolanaRPC` instance.
   */
  public static getInstance(): SolanaRPC {
    if (!SolanaRPC.instance) {
      SolanaRPC.instance = new SolanaRPC();
    }
    return SolanaRPC.instance;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Public methods
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Returns the SOL balance (not lamports) for the given public key.
   *
   * @param pubkey - The account to query.
   * @returns Balance in SOL (floating-point).
   * @throws If the RPC call fails.
   */
  async getBalance(pubkey: PublicKey): Promise<number> {
    const lamports = await this.connection.getBalance(pubkey, 'confirmed');
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log(chalk.gray(`[RPC][${timestamp()}] Balance for ${pubkey.toBase58()}: ${sol} SOL`));
    return sol;
  }

  /**
   * Returns the raw `AccountInfo` for the given public key, or `null` if the
   * account does not exist.
   *
   * @param pubkey - The account to query.
   * @returns `AccountInfo<Buffer> | null`
   */
  async getAccountInfo(pubkey: PublicKey) {
    const info = await this.connection.getAccountInfo(pubkey, 'confirmed');
    console.log(
      chalk.gray(
        `[RPC][${timestamp()}] AccountInfo for ${pubkey.toBase58()}: ${info ? `${info.lamports} lamports` : 'null'}`
      )
    );
    return info;
  }

  /**
   * Polls the cluster until the given transaction signature reaches
   * "confirmed" finality, throwing if the transaction is not confirmed
   * within the maximum retry window.
   *
   * @param signature - Transaction signature string returned by `sendTransaction`.
   * @param maxRetries - Maximum polling attempts (default: 30).
   * @param intervalMs - Milliseconds between polls (default: 1000).
   * @throws `Error` if the transaction is not confirmed within `maxRetries * intervalMs` ms.
   */
  async waitForConfirmation(
    signature: string,
    maxRetries = 30,
    intervalMs = 1_000
  ): Promise<void> {
    console.log(chalk.gray(`[RPC][${timestamp()}] Waiting for confirmation: ${signature}`));

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      const status = await this.connection.getSignatureStatus(signature, {
        searchTransactionHistory: false,
      });

      const value = status.value;
      if (value !== null && value.confirmationStatus === 'confirmed') {
        if (value.err) {
          throw new Error(
            `[SolanaRPC.waitForConfirmation] Transaction ${signature} failed on-chain: ${JSON.stringify(value.err)}`
          );
        }
        console.log(chalk.gray(`[RPC][${timestamp()}] Confirmed: ${signature} (attempt ${attempt})`));
        return;
      }

      await new Promise((r) => setTimeout(r, intervalMs));
    }

    throw new Error(
      `[SolanaRPC.waitForConfirmation] Transaction ${signature} was not confirmed after ${maxRetries} retries.`
    );
  }

  /**
   * Requests an airdrop if the account balance is below `minSolBalance`.
   * Safe to call only on devnet — performs a no-op on mainnet-beta by
   * checking the cluster URL for "devnet" or "localhost".
   *
   * @param pubkey        - The account to top up.
   * @param minSolBalance - Minimum required SOL balance before airdrop is triggered.
   */
  async airdropIfNeeded(pubkey: PublicKey, minSolBalance: number): Promise<void> {
    const rpcUrl = process.env.SOLANA_RPC_URL ?? '';
    const isDevnet = rpcUrl.includes('devnet') || rpcUrl.includes('localhost');

    if (!isDevnet) {
      console.log(chalk.gray(`[RPC][${timestamp()}] Skipping airdrop — not devnet.`));
      return;
    }

    const balance = await this.getBalance(pubkey);
    if (balance >= minSolBalance) {
      console.log(
        chalk.gray(
          `[RPC][${timestamp()}] Airdrop not needed. Balance ${balance} SOL >= ${minSolBalance} SOL.`
        )
      );
      return;
    }

    console.log(
      chalk.gray(
        `[RPC][${timestamp()}] Airdropping 2 SOL to ${pubkey.toBase58()} (current: ${balance} SOL)`
      )
    );
    const sig = await this.connection.requestAirdrop(pubkey, 2 * LAMPORTS_PER_SOL);
    await this.waitForConfirmation(sig);
    console.log(chalk.gray(`[RPC][${timestamp()}] Airdrop complete: ${sig}`));
  }
}
