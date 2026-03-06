/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/hivemind.json`.
 */
export type Hivemind = {
  "address": "2wRN9Nrd5USVo5oVWjyfYiRgN6nrJMW5vDpscx7iRRZn",
  "metadata": {
    "name": "hivemind",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "Hivemind Colony — multi-agent autonomous AI wallet on Solana"
  },
  "instructions": [
    {
      "name": "agentPay",
      "docs": [
        "Transfers `amount` lamports from one agent vault to another,",
        "enforcing all spending rules and creating an immutable `TransactionLog`.",
        "",
        "# Parameters",
        "* `amount`  — Lamports to transfer.",
        "* `task_id` — 32-byte SHA-256 hash of the task description string,",
        "used to correlate payments with off-chain task records."
      ],
      "discriminator": [
        191,
        210,
        112,
        56,
        82,
        215,
        140,
        233
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Transaction initiator — must be the colony authority."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "docs": [
            "Colony state — used to validate authority and increment tx counter."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "fromAgent",
          "docs": [
            "Paying agent's state account."
          ],
          "writable": true
        },
        {
          "name": "vaultFrom",
          "docs": [
            "Paying agent's vault — lamports deducted from here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "fromAgent"
              }
            ]
          }
        },
        {
          "name": "toAgent",
          "docs": [
            "Receiving agent's state account."
          ],
          "writable": true
        },
        {
          "name": "vaultTo",
          "docs": [
            "Receiving agent's vault — lamports deposited here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "toAgent"
              }
            ]
          }
        },
        {
          "name": "transactionLog",
          "docs": [
            "Append-only log entry created for this payment.",
            "Seeds = [b\"log\", colony.key(), total_transactions as le bytes]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  108,
                  111,
                  103
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              },
              {
                "kind": "account",
                "path": "colony.total_transactions",
                "account": "colonyState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "taskId",
          "type": {
            "array": [
              "u8",
              32
            ]
          }
        }
      ]
    },
    {
      "name": "emergencyFreeze",
      "docs": [
        "Freezes or unfreezes an agent.  A frozen agent cannot initiate payments.",
        "Only callable by the colony authority.",
        "",
        "# Parameters",
        "* `freeze` — `true` to freeze; `false` to unfreeze."
      ],
      "discriminator": [
        179,
        69,
        168,
        100,
        173,
        7,
        136,
        112
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Only the colony authority may freeze/unfreeze agents."
          ],
          "signer": true
        },
        {
          "name": "colony",
          "docs": [
            "Colony state — authority is verified against this account."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "agent",
          "docs": [
            "The agent whose `is_frozen` flag will be toggled."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "freeze",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initializeColony",
      "docs": [
        "Creates the global colony PDA and seeds the treasury with 1 SOL.",
        "",
        "Must be called exactly once by the deploying authority before any",
        "agents are registered."
      ],
      "discriminator": [
        91,
        184,
        105,
        243,
        90,
        175,
        137,
        217
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Colony authority — pays for account creation and seeds the treasury."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "docs": [
            "Global colony PDA.  Created here; seeds = [b\"colony\"]."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury PDA — a system-owned account that holds reserve SOL.",
            "Seeds = [b\"treasury\", colony.key()].",
            "Its address is derived deterministically from the colony PDA, so",
            "no additional data validation is required here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "registerAgent",
      "docs": [
        "Registers a new agent in the colony, creates its vault PDA, and",
        "funds the vault with 0.5 SOL from the colony treasury.",
        "",
        "# Parameters",
        "* `role`         — Functional role (`Scout = 0`, `Analyst = 1`, `Executor = 2`, `Ledger = 3`).",
        "* `daily_limit`  — Maximum lamports spendable in a 24-hour window.",
        "* `per_tx_limit` — Maximum lamports per single `agent_pay` call."
      ],
      "discriminator": [
        135,
        157,
        66,
        195,
        2,
        113,
        175,
        30
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Only the colony authority can register new agents."
          ],
          "writable": true,
          "signer": true
        },
        {
          "name": "colony",
          "docs": [
            "Colony global state — agent_count is incremented here."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "treasury",
          "docs": [
            "Treasury PDA — source of the initial 0.5 SOL vault funding."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  101,
                  97,
                  115,
                  117,
                  114,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "colony"
              }
            ]
          }
        },
        {
          "name": "agentState",
          "docs": [
            "AgentState PDA — created here.",
            "Seeds = [b\"agent\", colony.key(), agent_index]."
          ],
          "writable": true
        },
        {
          "name": "vault",
          "docs": [
            "Vault PDA — a system-owned SOL holder for this agent.",
            "Seeds = [b\"vault\", agent_state.key()].",
            "Access is controlled exclusively by on-chain PDA signing."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  118,
                  97,
                  117,
                  108,
                  116
                ]
              },
              {
                "kind": "account",
                "path": "agentState"
              }
            ]
          }
        },
        {
          "name": "systemProgram",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "role",
          "type": {
            "defined": {
              "name": "agentRole"
            }
          }
        },
        {
          "name": "dailyLimit",
          "type": "u64"
        },
        {
          "name": "perTxLimit",
          "type": "u64"
        }
      ]
    },
    {
      "name": "reportOutcome",
      "docs": [
        "Updates an agent's reputation and task counters after a task",
        "completes.  Only callable by the colony authority.",
        "",
        "# Parameters",
        "* `success` — `true` if the task succeeded (+5 reputation), `false` if it failed (-10 reputation)."
      ],
      "discriminator": [
        12,
        250,
        114,
        172,
        2,
        7,
        2,
        36
      ],
      "accounts": [
        {
          "name": "authority",
          "docs": [
            "Only the colony authority can report outcomes."
          ],
          "signer": true
        },
        {
          "name": "colony",
          "docs": [
            "Colony state — used to verify the reporting authority."
          ],
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  99,
                  111,
                  108,
                  111,
                  110,
                  121
                ]
              }
            ]
          }
        },
        {
          "name": "agent",
          "docs": [
            "The agent whose reputation and task counters are updated."
          ],
          "writable": true
        }
      ],
      "args": [
        {
          "name": "success",
          "type": "bool"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "agentState",
      "discriminator": [
        254,
        187,
        98,
        119,
        228,
        48,
        47,
        49
      ]
    },
    {
      "name": "colonyState",
      "discriminator": [
        219,
        153,
        230,
        213,
        208,
        203,
        61,
        116
      ]
    },
    {
      "name": "transactionLog",
      "discriminator": [
        26,
        131,
        178,
        93,
        195,
        70,
        29,
        67
      ]
    }
  ],
  "events": [
    {
      "name": "agentFreezeEvent",
      "discriminator": [
        82,
        54,
        63,
        16,
        110,
        98,
        46,
        170
      ]
    },
    {
      "name": "agentPayEvent",
      "discriminator": [
        158,
        47,
        22,
        23,
        53,
        28,
        200,
        43
      ]
    },
    {
      "name": "reputationUpdateEvent",
      "discriminator": [
        43,
        135,
        44,
        193,
        26,
        143,
        173,
        182
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "agentFrozen",
      "msg": "This agent has been frozen by the colony authority"
    },
    {
      "code": 6001,
      "name": "dailyLimitExceeded",
      "msg": "Transaction would exceed agent's daily spending limit"
    },
    {
      "code": 6002,
      "name": "perTxLimitExceeded",
      "msg": "Transaction amount exceeds per-transaction limit"
    },
    {
      "code": 6003,
      "name": "insufficientVaultBalance",
      "msg": "Agent vault does not have enough SOL"
    },
    {
      "code": 6004,
      "name": "unauthorizedRole",
      "msg": "This agent role cannot perform this action"
    },
    {
      "code": 6005,
      "name": "colonyFull",
      "msg": "Colony has reached maximum agent capacity (255)"
    },
    {
      "code": 6006,
      "name": "invalidReputation",
      "msg": "Reputation value is out of valid range"
    },
    {
      "code": 6007,
      "name": "selfPaymentNotAllowed",
      "msg": "An agent cannot pay itself"
    }
  ],
  "types": [
    {
      "name": "agentFreezeEvent",
      "docs": [
        "On-chain event emitted by `emergency_freeze` upon state change."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agentIndex",
            "docs": [
              "Zero-based index of the agent that was frozen or unfrozen."
            ],
            "type": "u8"
          },
          {
            "name": "frozenBy",
            "docs": [
              "The authority that triggered this action."
            ],
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when the freeze/unfreeze occurred."
            ],
            "type": "i64"
          },
          {
            "name": "isFrozen",
            "docs": [
              "New frozen state: `true` = frozen, `false` = active."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "agentPayEvent",
      "docs": [
        "On-chain event broadcasted by `agent_pay` upon successful transfer."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "from",
            "docs": [
              "Agent index of the payer."
            ],
            "type": "u8"
          },
          {
            "name": "to",
            "docs": [
              "Agent index of the recipient."
            ],
            "type": "u8"
          },
          {
            "name": "amount",
            "docs": [
              "Transfer amount in lamports."
            ],
            "type": "u64"
          },
          {
            "name": "taskId",
            "docs": [
              "SHA-256 hash of the task description (matches `TransactionLog.task_id`)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when the transfer was executed."
            ],
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "agentRole",
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "scout"
          },
          {
            "name": "analyst"
          },
          {
            "name": "executor"
          },
          {
            "name": "ledger"
          }
        ]
      }
    },
    {
      "name": "agentState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "docs": [
              "The colony this agent belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "agentIndex",
            "docs": [
              "Zero-based index assigned at registration time."
            ],
            "type": "u8"
          },
          {
            "name": "role",
            "docs": [
              "Functional role of this agent in the colony."
            ],
            "type": {
              "defined": {
                "name": "agentRole"
              }
            }
          },
          {
            "name": "vault",
            "docs": [
              "The PDA vault that holds this agent's SOL balance."
            ],
            "type": "pubkey"
          },
          {
            "name": "reputation",
            "docs": [
              "Reputation score — starts at 100, range 0–1000.",
              "Drops to 0 triggers automatic freeze."
            ],
            "type": "u64"
          },
          {
            "name": "dailyLimit",
            "docs": [
              "Maximum lamports this agent can spend within a 24-hour window."
            ],
            "type": "u64"
          },
          {
            "name": "perTxLimit",
            "docs": [
              "Maximum lamports allowed in a single `agent_pay` call."
            ],
            "type": "u64"
          },
          {
            "name": "dailySpent",
            "docs": [
              "Accumulated lamports spent in the current 24-hour window."
            ],
            "type": "u64"
          },
          {
            "name": "lastReset",
            "docs": [
              "Unix timestamp (seconds) when `daily_spent` was last reset to 0."
            ],
            "type": "i64"
          },
          {
            "name": "isFrozen",
            "docs": [
              "If true this agent cannot send payments until unfrozen."
            ],
            "type": "bool"
          },
          {
            "name": "totalTasks",
            "docs": [
              "Total tasks assigned to this agent (success + failure combined)."
            ],
            "type": "u64"
          },
          {
            "name": "successfulTasks",
            "docs": [
              "Tasks that completed with a `success == true` outcome report."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "Canonical bump stored to avoid recomputation in CPIs."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "colonyState",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "authority",
            "docs": [
              "The wallet that deployed and governs this colony."
            ],
            "type": "pubkey"
          },
          {
            "name": "agentCount",
            "docs": [
              "Running count of registered agents (max 255 — u8 ceiling)."
            ],
            "type": "u8"
          },
          {
            "name": "treasury",
            "docs": [
              "Pubkey of the colony treasury PDA that holds reserve SOL."
            ],
            "type": "pubkey"
          },
          {
            "name": "totalTransactions",
            "docs": [
              "Cumulative number of agent-to-agent transactions ever executed."
            ],
            "type": "u64"
          },
          {
            "name": "bump",
            "docs": [
              "Canonical bump stored to avoid recomputation in CPIs."
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "reputationUpdateEvent",
      "docs": [
        "On-chain event emitted by `report_outcome` after updating reputation."
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "agentIndex",
            "docs": [
              "Zero-based index of the agent whose reputation changed."
            ],
            "type": "u8"
          },
          {
            "name": "oldReputation",
            "docs": [
              "Reputation score before this update."
            ],
            "type": "u64"
          },
          {
            "name": "newReputation",
            "docs": [
              "Reputation score after this update."
            ],
            "type": "u64"
          },
          {
            "name": "success",
            "docs": [
              "Whether the task was reported as successful."
            ],
            "type": "bool"
          }
        ]
      }
    },
    {
      "name": "transactionLog",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "colony",
            "docs": [
              "The colony this log entry belongs to."
            ],
            "type": "pubkey"
          },
          {
            "name": "fromAgent",
            "docs": [
              "`agent_index` of the paying agent."
            ],
            "type": "u8"
          },
          {
            "name": "toAgent",
            "docs": [
              "`agent_index` of the receiving agent."
            ],
            "type": "u8"
          },
          {
            "name": "amount",
            "docs": [
              "Transfer amount in lamports."
            ],
            "type": "u64"
          },
          {
            "name": "taskId",
            "docs": [
              "SHA-256 hash of the task description string (32 bytes)."
            ],
            "type": {
              "array": [
                "u8",
                32
              ]
            }
          },
          {
            "name": "timestamp",
            "docs": [
              "Unix timestamp when this transaction was recorded."
            ],
            "type": "i64"
          },
          {
            "name": "success",
            "docs": [
              "Whether the downstream task was reported as successful."
            ],
            "type": "bool"
          },
          {
            "name": "bump",
            "docs": [
              "Canonical bump stored to avoid recomputation."
            ],
            "type": "u8"
          }
        ]
      }
    }
  ]
};
