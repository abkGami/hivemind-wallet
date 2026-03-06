/**
 * @file wallet.ts
 * PDA derivation utilities and authority keypair loading for the Hivemind
 * colony.  All PDA seeds are kept in one place and must match the Anchor
 * program's seed definitions exactly.
 */

import {
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import { SolanaRPC } from './services/rpc.js';
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Returns the current wall-clock time formatted as `HH:MM:SS`. */
function timestamp(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

// ─────────────────────────────────────────────────────────────────────────────
// WalletManager
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Provides PDA derivation helpers and keypair loading utilities used by the
 * colony client and the dashboard.
 *
 * All PDA seeds mirror the Anchor program's `seeds` constraints so that
 * derived addresses are always consistent with on-chain data.
 */
export class WalletManager {
  // ───────────────────────────────────────────────────────────────────────────
  // Keypair loading
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Loads the colony authority `Keypair` from the `AUTHORITY_KEYPAIR`
   * environment variable.
   *
   * The env var must be a JSON array of 64 secret-key bytes (the format
   * produced by `solana-keygen new --outfile /tmp/auth.json`).
   *
   * @returns Authority `Keypair` ready for signing transactions.
   * @throws `Error` if the env var is missing, empty, or not valid JSON.
   */
  loadAuthorityKeypair(): Keypair {
    const raw = process.env.AUTHORITY_KEYPAIR;
    if (!raw || raw.trim() === '' || raw.trim() === '[]') {
      throw new Error(
        '[WalletManager.loadAuthorityKeypair] AUTHORITY_KEYPAIR env var is missing or empty. ' +
          'Set it to a JSON byte array of 64 secret-key bytes.'
      );
    }

    let bytes: number[];
    try {
      bytes = JSON.parse(raw) as number[];
    } catch {
      throw new Error(
        '[WalletManager.loadAuthorityKeypair] AUTHORITY_KEYPAIR is not valid JSON. ' +
          'Expected a byte array: [1,2,3,...,64]'
      );
    }

    if (!Array.isArray(bytes) || bytes.length !== 64) {
      throw new Error(
        `[WalletManager.loadAuthorityKeypair] AUTHORITY_KEYPAIR must be a 64-byte array; got ${bytes.length} bytes.`
      );
    }

    // NOTE: Secret key bytes are never logged.
    const keypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
    console.log(
      chalk.gray(
        `[WALLET][${timestamp()}] Authority keypair loaded. Pubkey: ${keypair.publicKey.toBase58()}`
      )
    );
    return keypair;
  }

  // ───────────────────────────────────────────────────────────────────────────
  // PDA derivation
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Derives the global colony PDA.
   * Seeds: `[Buffer.from("colony")]`
   *
   * @param programId - The deployed Hivemind program's `PublicKey`.
   * @returns Tuple of `[colonyPDA, bump]`.
   */
  deriveColonyPDA(programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('colony')],
      programId
    );
  }

  /**
   * Derives the colony treasury PDA.
   * Seeds: `[Buffer.from("treasury"), colonyPubkey.toBytes()]`
   *
   * @param colonyPubkey - The colony PDA public key.
   * @param programId    - The deployed Hivemind program's `PublicKey`.
   * @returns Tuple of `[treasuryPDA, bump]`.
   */
  deriveTreasuryPDA(colonyPubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('treasury'), colonyPubkey.toBytes()],
      programId
    );
  }

  /**
   * Derives an agent's state PDA.
   * Seeds: `[Buffer.from("agent"), colonyPubkey.toBytes(), Buffer.from([agentIndex])]`
   *
   * @param colonyPubkey - The colony PDA public key.
   * @param agentIndex   - Zero-based agent index (0–255).
   * @param programId    - The deployed Hivemind program's `PublicKey`.
   * @returns Tuple of `[agentStatePDA, bump]`.
   */
  deriveAgentPDA(
    colonyPubkey: PublicKey,
    agentIndex: number,
    programId: PublicKey
  ): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('agent'), colonyPubkey.toBytes(), Buffer.from([agentIndex])],
      programId
    );
  }

  /**
   * Derives an agent's vault PDA (the SOL-holding system account).
   * Seeds: `[Buffer.from("vault"), agentStatePubkey.toBytes()]`
   *
   * @param agentStatePubkey - The agent's state PDA public key.
   * @param programId        - The deployed Hivemind program's `PublicKey`.
   * @returns Tuple of `[vaultPDA, bump]`.
   */
  deriveVaultPDA(agentStatePubkey: PublicKey, programId: PublicKey): [PublicKey, number] {
    return PublicKey.findProgramAddressSync(
      [Buffer.from('vault'), agentStatePubkey.toBytes()],
      programId
    );
  }

  // ───────────────────────────────────────────────────────────────────────────
  // Balance helpers
  // ───────────────────────────────────────────────────────────────────────────

  /**
   * Fetches the SOL balance of a vault PDA.
   *
   * @param vaultPubkey - The vault's public key.
   * @returns Balance in SOL (floating-point).
   */
  async getVaultBalance(vaultPubkey: PublicKey): Promise<number> {
    const rpc = SolanaRPC.getInstance();
    const lamports = await rpc.connection.getBalance(vaultPubkey, 'confirmed');
    const sol = lamports / LAMPORTS_PER_SOL;
    console.log(
      chalk.gray(
        `[WALLET][${timestamp()}] Vault ${vaultPubkey.toBase58()} balance: ${sol} SOL`
      )
    );
    return sol;
  }
}
