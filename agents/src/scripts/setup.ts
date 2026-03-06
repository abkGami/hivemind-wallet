/**
 * @file setup.ts
 * Devnet setup script for the Hivemind Colony.
 *
 * Run with:
 *   npm run setup:devnet
 *
 * What it does:
 *  1. Loads COLONY_PROGRAM_ID from env (or .env).
 *  2. Derives & prints every PDA (colony, treasury, 4 agent state + vault PDAs).
 *  3. If AUTHORITY_KEYPAIR is set, checks whether the colony is already
 *     initialised and, if not, calls `initialize_colony` on-chain.
 *  4. Writes the discovered PDA addresses back into a local `.env` file so
 *     the agent runtime can pick them up without manual copy-paste.
 *
 * Requirements:
 *  - SOLANA_RPC_URL must point to devnet.
 *  - COLONY_PROGRAM_ID must be the deployed program address.
 *  - AUTHORITY_KEYPAIR (optional for PDA derivation; required for init).
 */

import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  Connection,
  Keypair,
  PublicKey,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import * as anchor from '@coral-xyz/anchor';
import { AnchorProvider, Program } from '@coral-xyz/anchor';
import type { Idl } from '@coral-xyz/anchor';
import chalk from 'chalk';

// ─────────────────────────────────────────────────────────────────────────────
// Bootstrap helpers
// ─────────────────────────────────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Resolve a path relative to the *workspace* root (two dirs above agents/src/scripts). */
function workspaceRoot(...parts: string[]) {
  return path.resolve(__dirname, '..', '..', '..', ...parts);
}

/** Agents directory root */
function agentsRoot(...parts: string[]) {
  return path.resolve(__dirname, '..', '..', ...parts);
}

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

function log(msg: string) {
  console.log(`[SETUP][${ts()}] ${msg}`);
}

function ok(msg: string) {
  console.log(chalk.green(`[SETUP][${ts()}] ✔  ${msg}`));
}

function warn(msg: string) {
  console.log(chalk.yellow(`[SETUP][${ts()}] ⚠  ${msg}`));
}

function err(msg: string) {
  console.error(chalk.red(`[SETUP][${ts()}] ✖  ${msg}`));
}

// ─────────────────────────────────────────────────────────────────────────────
// PDA derivation (mirrors wallet.ts — kept standalone for simplicity)
// ─────────────────────────────────────────────────────────────────────────────

const ROLE_NAMES = ['Scout', 'Analyst', 'Executor', 'Ledger'] as const;

function deriveColonyPDA(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([Buffer.from('colony')], programId);
}

function deriveTreasuryPDA(colony: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('treasury'), colony.toBytes()],
    programId
  );
}

function deriveAgentPDA(colony: PublicKey, index: number, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('agent'), colony.toBytes(), Buffer.from([index])],
    programId
  );
}

function deriveVaultPDA(agentState: PublicKey, programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('vault'), agentState.toBytes()],
    programId
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// .env writer
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Patches or creates an `.env` file in the agents directory, inserting /
 * replacing specific KEY=VALUE pairs while preserving all other lines.
 */
function patchEnvFile(updates: Record<string, string>): void {
  const envPath = agentsRoot('.env');

  let existing = '';
  if (fs.existsSync(envPath)) {
    existing = fs.readFileSync(envPath, 'utf8');
  } else {
    // Bootstrap from .env.example if .env doesn't exist yet
    const examplePath = agentsRoot('.env.example');
    if (fs.existsSync(examplePath)) {
      existing = fs.readFileSync(examplePath, 'utf8');
    }
  }

  const lines = existing.split('\n');
  const updated = new Set<string>();

  const patchedLines = lines.map((line) => {
    const match = line.match(/^([A-Z_]+)=/);
    if (match) {
      const key = match[1];
      if (key in updates) {
        updated.add(key);
        return `${key}=${updates[key]}`;
      }
    }
    return line;
  });

  // Append any keys that weren't already present
  for (const [key, value] of Object.entries(updates)) {
    if (!updated.has(key)) {
      patchedLines.push(`${key}=${value}`);
    }
  }

  fs.writeFileSync(envPath, patchedLines.join('\n'), 'utf8');
  ok(`.env updated at ${envPath}`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────

async function main() {
  console.log(chalk.cyan('\n══════════════════════════════════════════════'));
  console.log(chalk.cyan('  HIVEMIND WALLET — Devnet Setup Script'));
  console.log(chalk.cyan('══════════════════════════════════════════════\n'));

  // ── 1. Validate env vars ──────────────────────────────────────────────────
  const rpcUrl = process.env.SOLANA_RPC_URL;
  if (!rpcUrl) {
    err('SOLANA_RPC_URL is not set. Add it to agents/.env');
    process.exit(1);
  }

  const programIdStr = process.env.COLONY_PROGRAM_ID;
  if (!programIdStr) {
    err('COLONY_PROGRAM_ID is not set. Deploy the program first with `anchor deploy --provider.cluster devnet` then set this variable.');
    process.exit(1);
  }

  let programId: PublicKey;
  try {
    programId = new PublicKey(programIdStr);
  } catch {
    err(`COLONY_PROGRAM_ID "${programIdStr}" is not a valid public key.`);
    process.exit(1);
  }

  log(`RPC: ${rpcUrl}`);
  log(`Program ID: ${programId.toBase58()}`);

  // ── 2. Derive all PDAs ────────────────────────────────────────────────────
  const [colonyPDA, colonyBump] = deriveColonyPDA(programId);
  const [treasuryPDA] = deriveTreasuryPDA(colonyPDA, programId);

  const agents = ROLE_NAMES.map((name, i) => {
    const [statePDA] = deriveAgentPDA(colonyPDA, i, programId);
    const [vaultPDA] = deriveVaultPDA(statePDA, programId);
    return { name, index: i, statePDA, vaultPDA };
  });

  console.log(chalk.bold('\n── Derived PDAs ──────────────────────────────'));
  log(`Colony PDA  : ${colonyPDA.toBase58()}  (bump=${colonyBump})`);
  log(`Treasury PDA: ${treasuryPDA.toBase58()}`);
  for (const a of agents) {
    log(`${a.name.padEnd(8)} state: ${a.statePDA.toBase58()}`);
    log(`${a.name.padEnd(8)} vault: ${a.vaultPDA.toBase58()}`);
  }

  // ── 3. Connect and inspect chain state ───────────────────────────────────
  const connection = new Connection(rpcUrl, 'confirmed');
  log('\nConnecting to Solana devnet…');

  let authorityWallet: anchor.Wallet | null = null;
  let authorityKeypair: Keypair | null = null;
  const keypairRaw = process.env.AUTHORITY_KEYPAIR;
  if (keypairRaw && keypairRaw.trim() !== '' && keypairRaw.trim() !== '[]') {
    try {
      const bytes = JSON.parse(keypairRaw) as number[];
      authorityKeypair = Keypair.fromSecretKey(Uint8Array.from(bytes));
      authorityWallet = new anchor.Wallet(authorityKeypair);
      ok(`Authority: ${authorityKeypair.publicKey.toBase58()}`);

      const lamports = await connection.getBalance(authorityKeypair.publicKey, 'confirmed');
      log(`Authority balance: ${(lamports / LAMPORTS_PER_SOL).toFixed(4)} SOL`);

      if (lamports < 2 * LAMPORTS_PER_SOL) {
        warn('Balance < 2 SOL. Requesting airdrop (devnet only)…');
        try {
          const sig = await connection.requestAirdrop(
            authorityKeypair.publicKey,
            2 * LAMPORTS_PER_SOL
          );
          await connection.confirmTransaction(sig, 'confirmed');
          const newBalance = await connection.getBalance(authorityKeypair.publicKey, 'confirmed');
          ok(`Airdrop confirmed. New balance: ${(newBalance / LAMPORTS_PER_SOL).toFixed(4)} SOL`);
        } catch (e) {
          warn(`Airdrop failed (you may have hit the rate limit): ${e}`);
        }
      }
    } catch (e) {
      warn(`Could not parse AUTHORITY_KEYPAIR: ${e}. Skipping on-chain init.`);
    }
  } else {
    warn('AUTHORITY_KEYPAIR not set — PDA derivation only (no on-chain calls).');
  }

  // ── 4. Check if colony is already initialised ─────────────────────────────
  let colonyAlreadyInit = false;
  const colonyAccount = await connection.getAccountInfo(colonyPDA, 'confirmed');
  if (colonyAccount && colonyAccount.data.length > 0) {
    colonyAlreadyInit = true;
    ok('Colony account already exists on-chain. Skipping initialize_colony.');
  } else {
    log('Colony account does not exist yet.');
  }

  // ── 5. Initialize colony (if authority provided and not yet initialised) ──
  if (!colonyAlreadyInit && authorityKeypair && authorityWallet) {
    log('\nInitialising colony on-chain…');

    // Load IDL from target/idl/hivemind.json (built by `anchor build`)
    const idlPath = workspaceRoot('target', 'idl', 'hivemind.json');
    if (!fs.existsSync(idlPath)) {
      err(`IDL not found at ${idlPath}. Run \`anchor build\` first.`);
      process.exit(1);
    }
    const idl = JSON.parse(fs.readFileSync(idlPath, 'utf8')) as Idl;

    const provider = new AnchorProvider(connection, authorityWallet, {
      skipPreflight: false,
      commitment: 'confirmed',
    });
    anchor.setProvider(provider);
    const program = new Program(idl, provider);

    try {
      const sig = await (program.methods as any)
        .initializeColony()
        .accounts({
          authority: authorityKeypair.publicKey,
          colony: colonyPDA,
          treasury: treasuryPDA,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([authorityKeypair])
        .rpc();

      ok(`Colony initialised!  tx: ${sig}`);
      ok(`Explorer: https://solscan.io/tx/${sig}?cluster=devnet`);
    } catch (e) {
      err(`initialize_colony failed: ${e}`);
      warn('The program may not be deployed yet. Run `anchor deploy --provider.cluster devnet` first.');
    }
  }

  // ── 6. Write PDAs to .env ─────────────────────────────────────────────────
  console.log(chalk.bold('\n── Writing PDAs to agents/.env ───────────────'));

  const envUpdates: Record<string, string> = {
    COLONY_PDA: colonyPDA.toBase58(),
    TREASURY_PDA: treasuryPDA.toBase58(),
    SCOUT_VAULT: agents[0].vaultPDA.toBase58(),
    ANALYST_VAULT: agents[1].vaultPDA.toBase58(),
    EXECUTOR_VAULT: agents[2].vaultPDA.toBase58(),
    LEDGER_VAULT: agents[3].vaultPDA.toBase58(),
  };

  patchEnvFile(envUpdates);

  // ── 7. Summary ────────────────────────────────────────────────────────────
  console.log(chalk.cyan('\n══════════════════════════════════════════════'));
  console.log(chalk.bold.green('  Setup complete!'));
  console.log(chalk.cyan('══════════════════════════════════════════════'));
  console.log(`
Next steps:
  1. Ensure agents/.env has AUTHORITY_KEYPAIR set (64-byte JSON array).
  2. Deploy the program if you haven't already:
       anchor deploy --provider.cluster devnet
  3. Run the colony:
       npm run dev
  4. (Optional) Open the terminal dashboard:
       npm run dashboard
`);
}

main().catch((e) => {
  err(`Unhandled error: ${e}`);
  process.exit(1);
});
