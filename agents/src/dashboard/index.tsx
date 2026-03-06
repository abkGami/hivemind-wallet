/**
 * @file dashboard/index.tsx
 * Ink v4 terminal dashboard for the Hivemind Colony.
 * Displays live agent states, SOL balances, reputation, and recent transactions.
 */

import React, { useState, useEffect, useCallback } from 'react';
import { render, Box, Text, useInput, useApp } from 'ink';
import { PublicKey } from '@solana/web3.js';
import 'dotenv/config';

import { SolanaRPC } from '../services/rpc.js';
import { WalletManager } from '../wallet.js';
import type { AgentState, ColonyClient } from '../colony.js';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────

interface TransactionFeedEntry {
  time: string;
  from: string;
  to: string;
  lamports: number;
  success: boolean;
}

const ROLE_NAMES = ['Scout', 'Analyst', 'Executor', 'Ledger'];

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function ts(): string {
  return new Date().toLocaleTimeString('en-US', { hour12: false });
}

/** Maps a reputation score to a terminal colour name. */
function repColor(rep: number): string {
  if (rep > 80) return 'green';
  if (rep >= 40) return 'yellow';
  return 'red';
}

/** Returns a coloured status indicator. */
function statusIcon(frozen: boolean): string {
  return frozen ? '🔴' : '🟢';
}

// ─────────────────────────────────────────────────────────────────────────────
// Dashboard component
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Main Ink React component that renders the HIVEMIND colony dashboard.
 * Polls on-chain state every 3 seconds and vault balances every 5 seconds.
 */
function Dashboard({ colonyClient }: { colonyClient: ColonyClient }): React.ReactElement {
  const { exit } = useApp();
  const walletManager = new WalletManager();

  const [agents, setAgents] = useState<AgentState[]>([]);
  const [balances, setBalances] = useState<number[]>([]);
  const [feed, setFeed] = useState<TransactionFeedEntry[]>([]);
  const [lastRefresh, setLastRefresh] = useState<string>(ts());
  const [errorMsg, setErrorMsg] = useState<string>('');

  // ──────────────────────────── Data fetching ──────────────────────────────

  const fetchAgents = useCallback(async () => {
    try {
      const states = await colonyClient.fetchAllAgentStates();
      setAgents(states);
      setLastRefresh(ts());
      setErrorMsg('');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    }
  }, [colonyClient]);

  const fetchBalances = useCallback(async () => {
    try {
      const rpc = SolanaRPC.getInstance();
      const programId = colonyClient.programId;
      const [colonyPDA] = walletManager.deriveColonyPDA(programId);

      const bals = await Promise.all(
        [0, 1, 2, 3].map(async (i) => {
          const [agentPDA] = walletManager.deriveAgentPDA(colonyPDA, i, programId);
          const [vaultPDA] = walletManager.deriveVaultPDA(agentPDA, programId);
          const lamports = await rpc.connection.getBalance(vaultPDA, 'confirmed');
          return lamports / 1_000_000_000;
        })
      );
      setBalances(bals);
    } catch {
      // Balance fetch errors are non-fatal — keep showing last known values.
    }
  }, [colonyClient, walletManager]);

  // Initial fetch.
  useEffect(() => {
    void fetchAgents();
    void fetchBalances();
  }, [fetchAgents, fetchBalances]);

  // Poll agent states every 3 s.
  useEffect(() => {
    const id = setInterval(() => void fetchAgents(), 3_000);
    return () => clearInterval(id);
  }, [fetchAgents]);

  // Poll balances every 5 s.
  useEffect(() => {
    const id = setInterval(() => void fetchBalances(), 5_000);
    return () => clearInterval(id);
  }, [fetchBalances]);

  // ──────────────────────────── Keyboard input ──────────────────────────────

  useInput((input, key) => {
    if (input === 'q' || input === 'Q') {
      exit();
    }

    if (input === 'r' || input === 'R') {
      void fetchAgents();
      void fetchBalances();
    }

    if (input === 'f' || input === 'F') {
      // Prompt is handled via stdin; here we just log intent.
      // Full interactive freeze requires a separate prompt layer.
      setFeed((prev) => [
        {
          time: ts(),
          from: 'Dashboard',
          to: 'Colony',
          lamports: 0,
          success: false,
        },
        ...prev.slice(0, 9),
      ]);
    }
  });

  // ──────────────────────────── Render ──────────────────────────────────────

  const width = 58;
  const border = '═'.repeat(width);
  const divider = '═'.repeat(width);

  return (
    <Box flexDirection="column">
      {/* Header */}
      <Text>╔{border}╗</Text>
      <Text>║{'           🧠 HIVEMIND WALLET — COLONY STATUS         '}║</Text>
      <Text>╠{divider}╣</Text>

      {/* Column headers */}
      <Text>
        {'║  '}
        <Text bold>{'Agent     │ Role      │ SOL Balance │ Rep  │ Status'}</Text>
        {'║'}
      </Text>

      {/* Agent rows */}
      {[0, 1, 2, 3].map((i) => {
        const agent = agents[i];
        const balance = balances[i] ?? 0;
        const rep = agent ? Number(agent.reputation) : 0;
        const frozen = agent ? agent.isFrozen : false;
        const roleName = ROLE_NAMES[i] ?? '?';

        const nameCol  = `Agent ${i}`.padEnd(8);
        const roleCol  = roleName.padEnd(9);
        const balCol   = `${balance.toFixed(4)} SOL`.padEnd(11);
        const repStr   = String(rep).padEnd(4);

        return (
          <Text key={i}>
            {'║  '}
            {nameCol}
            {'│ '}
            {roleCol}
            {'│ '}
            <Text color={repColor(rep)}>{balCol}</Text>
            {'│ '}
            <Text color={repColor(rep)}>{repStr}</Text>
            {'│ '}
            {statusIcon(frozen)}
            {'     ║'}
          </Text>
        );
      })}

      <Text>╠{divider}╣</Text>

      {/* Transaction feed */}
      <Text>{'║  Live Transaction Feed (last 10)                     ║'}</Text>
      {feed.length === 0 ? (
        <Text>{'║  No transactions yet…                                ║'}</Text>
      ) : (
        feed.slice(0, 10).map((entry, idx) => {
          const line = `[${entry.time}] ${entry.from} → ${entry.to}  ${entry.lamports} lam  ${entry.success ? '✅' : '❌'}`;
          return <Text key={idx}>{'║  '}{line.padEnd(width - 2)}{'║'}</Text>;
        })
      )}

      <Text>╠{divider}╣</Text>

      {/* Controls */}
      <Text>{'║  [F] Freeze Agent  [R] Refresh  [Q] Quit             ║'}</Text>
      <Text>╚{border}╝</Text>

      {/* Status line */}
      <Text color="gray">Last refresh: {lastRefresh}</Text>
      {errorMsg !== '' && <Text color="red">Error: {errorMsg}</Text>}
    </Box>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// Entry point
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  // Load IDL and initialise the colony client.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let idl: any;
  try {
    idl = require('../../../target/idl/hivemind.json');
  } catch {
    console.error('IDL not found — run `anchor build` first.');
    process.exit(1);
  }

  const walletManager = new WalletManager();
  const authority = walletManager.loadAuthorityKeypair();
  const programId = new PublicKey(process.env.COLONY_PROGRAM_ID!);

  // Import ColonyClient after env is ready.
  const { ColonyClient } = await import('../colony.js');
  const colonyClient = new ColonyClient(authority, programId, idl);

  render(<Dashboard colonyClient={colonyClient} />);
}

main().catch((err) => {
  console.error('Dashboard fatal error:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
