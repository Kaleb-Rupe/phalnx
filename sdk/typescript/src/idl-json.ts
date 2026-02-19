// Auto-generated — do not edit. Regenerate with:
//   RUSTUP_TOOLCHAIN=nightly anchor idl build -o target/idl/agent_shield.json
//   Then copy JSON into this file.
export const IDL = {
  "address": "4ZeVCqnjUgUtFrHHPG7jELUxvJeoVGHhGNgPrhBPwrHL",
  "metadata": {
    "name": "agent_shield",
    "version": "0.1.0",
    "spec": "0.1.0",
    "description": "AI Agent Financial Middleware for Solana - Permission controls, spending limits, and audit infrastructure for autonomous agents"
  },
  "instructions": [
    {
      "name": "agent_transfer",
      "docs": [
        "Transfer tokens from the vault to an allowed destination.",
        "Only the agent can call this. Respects destination allowlist,",
        "spending caps, and per-token limits."
      ],
      "discriminator": [
        199,
        111,
        151,
        49,
        124,
        13,
        150,
        44
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
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
                "path": "vault.owner",
                "account": "AgentVault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "vault_token_account",
          "docs": [
            "Vault's PDA-owned token account (source)"
          ],
          "writable": true
        },
        {
          "name": "destination_token_account",
          "docs": [
            "Destination token account (must be in allowed destinations if configured)"
          ],
          "writable": true
        },
        {
          "name": "fee_destination_token_account",
          "docs": [
            "Developer fee destination token account \u2014 must match vault.fee_destination"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_treasury_token_account",
          "docs": [
            "Protocol treasury token account"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "apply_pending_policy",
      "docs": [
        "Apply a queued policy update after the timelock period has expired.",
        "Closes the PendingPolicyUpdate PDA and returns rent to the owner."
      ],
      "discriminator": [
        114,
        212,
        19,
        227,
        89,
        199,
        74,
        62
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker",
            "pending_policy"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "pending_policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "cancel_pending_policy",
      "docs": [
        "Cancel a queued policy update. Closes the PendingPolicyUpdate PDA",
        "and returns rent to the owner."
      ],
      "discriminator": [
        153,
        36,
        104,
        200,
        50,
        94,
        207,
        33
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "pending_policy"
          ]
        },
        {
          "name": "pending_policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "close_vault",
      "docs": [
        "Close the vault entirely. Withdraws all remaining funds and closes all PDAs.",
        "Reclaims rent. Vault must have no open positions. Only the owner can call this."
      ],
      "discriminator": [
        141,
        103,
        17,
        126,
        72,
        75,
        29,
        29
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": []
    },
    {
      "name": "deposit_funds",
      "docs": [
        "Deposit SPL tokens into the vault's PDA-controlled token account.",
        "Only the owner can call this."
      ],
      "discriminator": [
        202,
        39,
        52,
        211,
        53,
        20,
        250,
        88
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "owner_token_account",
          "docs": [
            "Owner's token account to transfer from"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "vault_token_account",
          "docs": [
            "Vault's PDA-controlled token account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "associated_token_program",
          "address": "ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    },
    {
      "name": "finalize_session",
      "docs": [
        "Finalize a session after the DeFi action completes.",
        "Revokes token delegation, collects fees, closes the SessionAuthority PDA,",
        "and records the transaction in the audit log.",
        "Can be called by the agent or permissionlessly (for cleanup of expired sessions)."
      ],
      "discriminator": [
        34,
        148,
        144,
        47,
        37,
        130,
        206,
        161
      ],
      "accounts": [
        {
          "name": "payer",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
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
                "path": "vault.owner",
                "account": "AgentVault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker",
            "session"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "session",
          "docs": [
            "Session rent is returned to the session's agent (who paid for it),",
            "not the arbitrary payer, to prevent rent theft.",
            "Seeds include token_mint for per-token concurrent sessions."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "session.agent",
                "account": "SessionAuthority"
              },
              {
                "kind": "account",
                "path": "session.authorized_token",
                "account": "SessionAuthority"
              }
            ]
          }
        },
        {
          "name": "session_rent_recipient",
          "docs": [
            "Validated in handler to equal session.agent."
          ],
          "writable": true
        },
        {
          "name": "vault_token_account",
          "docs": [
            "Vault's PDA token account for the session's token (fee source + delegation revocation)"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "fee_destination_token_account",
          "docs": [
            "Developer fee destination token account \u2014 must match vault.fee_destination"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "protocol_treasury_token_account",
          "docs": [
            "Protocol treasury token account \u2014 must be owned by PROTOCOL_TREASURY"
          ],
          "writable": true,
          "optional": true
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "success",
          "type": "bool"
        }
      ]
    },
    {
      "name": "initialize_vault",
      "docs": [
        "Initialize a new agent vault with policy configuration.",
        "Only the owner can call this. Creates vault PDA, policy PDA, and spend tracker PDA.",
        "`tracker_tier`: 0 = Standard (200 entries), 1 = Pro (500), 2 = Max (1000)."
      ],
      "discriminator": [
        48,
        191,
        163,
        44,
        71,
        129,
        63,
        164
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "arg",
                "path": "vault_id"
              }
            ]
          }
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "fee_destination",
          "docs": [
            "The protocol treasury that receives fees"
          ]
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "vault_id",
          "type": "u64"
        },
        {
          "name": "daily_spending_cap_usd",
          "type": "u64"
        },
        {
          "name": "max_transaction_size_usd",
          "type": "u64"
        },
        {
          "name": "allowed_tokens",
          "type": {
            "vec": {
              "defined": {
                "name": "AllowedToken"
              }
            }
          }
        },
        {
          "name": "allowed_protocols",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "max_leverage_bps",
          "type": "u16"
        },
        {
          "name": "max_concurrent_positions",
          "type": "u8"
        },
        {
          "name": "developer_fee_rate",
          "type": "u16"
        },
        {
          "name": "timelock_duration",
          "type": "u64"
        },
        {
          "name": "allowed_destinations",
          "type": {
            "vec": "pubkey"
          }
        },
        {
          "name": "tracker_tier",
          "type": "u8"
        }
      ]
    },
    {
      "name": "queue_policy_update",
      "docs": [
        "Queue a policy update when timelock is active.",
        "Creates a PendingPolicyUpdate PDA that becomes executable after",
        "the timelock period expires."
      ],
      "discriminator": [
        149,
        18,
        76,
        197,
        179,
        193,
        91,
        77
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "pending_policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  101,
                  110,
                  100,
                  105,
                  110,
                  103,
                  95,
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "daily_spending_cap_usd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "max_transaction_amount_usd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "allowed_tokens",
          "type": {
            "option": {
              "vec": {
                "defined": {
                  "name": "AllowedToken"
                }
              }
            }
          }
        },
        {
          "name": "allowed_protocols",
          "type": {
            "option": {
              "vec": "pubkey"
            }
          }
        },
        {
          "name": "max_leverage_bps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "can_open_positions",
          "type": {
            "option": "bool"
          }
        },
        {
          "name": "max_concurrent_positions",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "developer_fee_rate",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "timelock_duration",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "allowed_destinations",
          "type": {
            "option": {
              "vec": "pubkey"
            }
          }
        }
      ]
    },
    {
      "name": "reactivate_vault",
      "docs": [
        "Reactivate a frozen vault. Optionally rotate the agent key.",
        "Only the owner can call this."
      ],
      "discriminator": [
        245,
        50,
        143,
        70,
        114,
        220,
        25,
        251
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "new_agent",
          "type": {
            "option": "pubkey"
          }
        }
      ]
    },
    {
      "name": "register_agent",
      "docs": [
        "Register an agent's signing key to this vault.",
        "Only the owner can call this. One agent per vault."
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
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "agent",
          "type": "pubkey"
        }
      ]
    },
    {
      "name": "revoke_agent",
      "docs": [
        "Kill switch. Immediately freezes the vault, preventing all agent actions.",
        "Only the owner can call this. Funds can still be withdrawn by the owner."
      ],
      "discriminator": [
        227,
        60,
        209,
        125,
        240,
        117,
        163,
        73
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          }
        }
      ],
      "args": []
    },
    {
      "name": "update_policy",
      "docs": [
        "Update the policy configuration for a vault.",
        "Only the owner can call this. Cannot be called by the agent.",
        "Blocked when timelock_duration > 0 \u2014 use queue_policy_update instead."
      ],
      "discriminator": [
        212,
        245,
        246,
        7,
        163,
        151,
        18,
        57
      ],
      "accounts": [
        {
          "name": "owner",
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker"
          ]
        },
        {
          "name": "policy",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        }
      ],
      "args": [
        {
          "name": "daily_spending_cap_usd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "max_transaction_size_usd",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "allowed_tokens",
          "type": {
            "option": {
              "vec": {
                "defined": {
                  "name": "AllowedToken"
                }
              }
            }
          }
        },
        {
          "name": "allowed_protocols",
          "type": {
            "option": {
              "vec": "pubkey"
            }
          }
        },
        {
          "name": "max_leverage_bps",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "can_open_positions",
          "type": {
            "option": "bool"
          }
        },
        {
          "name": "max_concurrent_positions",
          "type": {
            "option": "u8"
          }
        },
        {
          "name": "developer_fee_rate",
          "type": {
            "option": "u16"
          }
        },
        {
          "name": "timelock_duration",
          "type": {
            "option": "u64"
          }
        },
        {
          "name": "allowed_destinations",
          "type": {
            "option": {
              "vec": "pubkey"
            }
          }
        }
      ]
    },
    {
      "name": "validate_and_authorize",
      "docs": [
        "Core permission check. Called by the agent before a DeFi action.",
        "Validates the action against all policy constraints (USD caps, per-token caps).",
        "If approved, creates a SessionAuthority PDA, delegates tokens to agent,",
        "and updates spend tracking.",
        "If denied, reverts the entire transaction (including subsequent DeFi instructions)."
      ],
      "discriminator": [
        22,
        183,
        48,
        222,
        218,
        11,
        197,
        152
      ],
      "accounts": [
        {
          "name": "agent",
          "writable": true,
          "signer": true
        },
        {
          "name": "vault",
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
                "path": "vault.owner",
                "account": "AgentVault"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          },
          "relations": [
            "policy",
            "tracker"
          ]
        },
        {
          "name": "policy",
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  112,
                  111,
                  108,
                  105,
                  99,
                  121
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "tracker",
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  116,
                  114,
                  97,
                  99,
                  107,
                  101,
                  114
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              }
            ]
          }
        },
        {
          "name": "session",
          "docs": [
            "Ephemeral session PDA \u2014 `init` ensures no double-authorization.",
            "Seeds include token_mint for per-token concurrent sessions."
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "const",
                "value": [
                  115,
                  101,
                  115,
                  115,
                  105,
                  111,
                  110
                ]
              },
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "account",
                "path": "agent"
              },
              {
                "kind": "arg",
                "path": "token_mint"
              }
            ]
          }
        },
        {
          "name": "vault_token_account",
          "docs": [
            "Vault's PDA-owned token account for the spend token (delegation source)"
          ],
          "writable": true
        },
        {
          "name": "token_mint_account",
          "docs": [
            "The token mint being spent"
          ]
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        },
        {
          "name": "system_program",
          "address": "11111111111111111111111111111111"
        }
      ],
      "args": [
        {
          "name": "action_type",
          "type": {
            "defined": {
              "name": "ActionType"
            }
          }
        },
        {
          "name": "token_mint",
          "type": "pubkey"
        },
        {
          "name": "amount",
          "type": "u64"
        },
        {
          "name": "target_protocol",
          "type": "pubkey"
        },
        {
          "name": "leverage_bps",
          "type": {
            "option": "u16"
          }
        }
      ]
    },
    {
      "name": "withdraw_funds",
      "docs": [
        "Withdraw tokens from the vault back to the owner.",
        "Works in any vault status (Active or Frozen). Only the owner can call this."
      ],
      "discriminator": [
        241,
        36,
        29,
        111,
        208,
        31,
        104,
        217
      ],
      "accounts": [
        {
          "name": "owner",
          "writable": true,
          "signer": true,
          "relations": [
            "vault"
          ]
        },
        {
          "name": "vault",
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
                "path": "owner"
              },
              {
                "kind": "account",
                "path": "vault.vault_id",
                "account": "AgentVault"
              }
            ]
          }
        },
        {
          "name": "mint"
        },
        {
          "name": "vault_token_account",
          "docs": [
            "Vault's PDA-controlled token account"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "vault"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "owner_token_account",
          "docs": [
            "Owner's token account to receive funds"
          ],
          "writable": true,
          "pda": {
            "seeds": [
              {
                "kind": "account",
                "path": "owner"
              },
              {
                "kind": "const",
                "value": [
                  6,
                  221,
                  246,
                  225,
                  215,
                  101,
                  161,
                  147,
                  217,
                  203,
                  225,
                  70,
                  206,
                  235,
                  121,
                  172,
                  28,
                  180,
                  133,
                  237,
                  95,
                  91,
                  55,
                  145,
                  58,
                  140,
                  245,
                  133,
                  126,
                  255,
                  0,
                  169
                ]
              },
              {
                "kind": "account",
                "path": "mint"
              }
            ],
            "program": {
              "kind": "const",
              "value": [
                140,
                151,
                37,
                143,
                78,
                36,
                137,
                241,
                187,
                61,
                16,
                41,
                20,
                142,
                13,
                131,
                11,
                90,
                19,
                153,
                218,
                255,
                16,
                132,
                4,
                142,
                123,
                216,
                219,
                233,
                248,
                89
              ]
            }
          }
        },
        {
          "name": "token_program",
          "address": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      ],
      "args": [
        {
          "name": "amount",
          "type": "u64"
        }
      ]
    }
  ],
  "accounts": [
    {
      "name": "AgentVault",
      "discriminator": [
        232,
        220,
        237,
        164,
        157,
        9,
        215,
        194
      ]
    },
    {
      "name": "PendingPolicyUpdate",
      "discriminator": [
        77,
        255,
        2,
        51,
        79,
        237,
        183,
        239
      ]
    },
    {
      "name": "PolicyConfig",
      "discriminator": [
        219,
        7,
        79,
        84,
        175,
        51,
        148,
        146
      ]
    },
    {
      "name": "SessionAuthority",
      "discriminator": [
        48,
        9,
        30,
        120,
        134,
        35,
        172,
        170
      ]
    },
    {
      "name": "SpendTracker",
      "discriminator": [
        180,
        17,
        195,
        180,
        162,
        207,
        239,
        205
      ]
    }
  ],
  "events": [
    {
      "name": "ActionAuthorized",
      "discriminator": [
        85,
        90,
        59,
        218,
        126,
        8,
        179,
        63
      ]
    },
    {
      "name": "ActionDenied",
      "discriminator": [
        243,
        239,
        240,
        51,
        151,
        100,
        10,
        100
      ]
    },
    {
      "name": "AgentRegistered",
      "discriminator": [
        191,
        78,
        217,
        54,
        232,
        100,
        189,
        85
      ]
    },
    {
      "name": "AgentRevoked",
      "discriminator": [
        12,
        251,
        249,
        166,
        122,
        83,
        162,
        116
      ]
    },
    {
      "name": "AgentTransferExecuted",
      "discriminator": [
        88,
        52,
        117,
        69,
        112,
        152,
        167,
        40
      ]
    },
    {
      "name": "DelegationRevoked",
      "discriminator": [
        59,
        158,
        142,
        49,
        164,
        116,
        220,
        8
      ]
    },
    {
      "name": "FeesCollected",
      "discriminator": [
        233,
        23,
        117,
        225,
        107,
        178,
        254,
        8
      ]
    },
    {
      "name": "FundsDeposited",
      "discriminator": [
        157,
        209,
        100,
        95,
        59,
        100,
        3,
        68
      ]
    },
    {
      "name": "FundsWithdrawn",
      "discriminator": [
        56,
        130,
        230,
        154,
        35,
        92,
        11,
        118
      ]
    },
    {
      "name": "PolicyChangeApplied",
      "discriminator": [
        104,
        89,
        5,
        100,
        180,
        202,
        52,
        73
      ]
    },
    {
      "name": "PolicyChangeCancelled",
      "discriminator": [
        200,
        158,
        226,
        255,
        25,
        211,
        30,
        151
      ]
    },
    {
      "name": "PolicyChangeQueued",
      "discriminator": [
        73,
        231,
        182,
        136,
        141,
        120,
        32,
        79
      ]
    },
    {
      "name": "PolicyUpdated",
      "discriminator": [
        225,
        112,
        112,
        67,
        95,
        236,
        245,
        161
      ]
    },
    {
      "name": "SessionFinalized",
      "discriminator": [
        33,
        12,
        242,
        91,
        206,
        42,
        163,
        235
      ]
    },
    {
      "name": "VaultClosed",
      "discriminator": [
        238,
        129,
        38,
        228,
        227,
        118,
        249,
        215
      ]
    },
    {
      "name": "VaultCreated",
      "discriminator": [
        117,
        25,
        120,
        254,
        75,
        236,
        78,
        115
      ]
    },
    {
      "name": "VaultReactivated",
      "discriminator": [
        197,
        52,
        160,
        147,
        159,
        89,
        90,
        28
      ]
    }
  ],
  "errors": [
    {
      "code": 6000,
      "name": "VaultNotActive",
      "msg": "Vault is not active"
    },
    {
      "code": 6001,
      "name": "UnauthorizedAgent",
      "msg": "Unauthorized: signer is not the registered agent"
    },
    {
      "code": 6002,
      "name": "UnauthorizedOwner",
      "msg": "Unauthorized: signer is not the vault owner"
    },
    {
      "code": 6003,
      "name": "TokenNotAllowed",
      "msg": "Token not in allowed list"
    },
    {
      "code": 6004,
      "name": "ProtocolNotAllowed",
      "msg": "Protocol not in allowed list"
    },
    {
      "code": 6005,
      "name": "TransactionTooLarge",
      "msg": "Transaction exceeds maximum single transaction size"
    },
    {
      "code": 6006,
      "name": "DailyCapExceeded",
      "msg": "Daily spending cap would be exceeded"
    },
    {
      "code": 6007,
      "name": "LeverageTooHigh",
      "msg": "Leverage exceeds maximum allowed"
    },
    {
      "code": 6008,
      "name": "TooManyPositions",
      "msg": "Maximum concurrent open positions reached"
    },
    {
      "code": 6009,
      "name": "PositionOpeningDisallowed",
      "msg": "Cannot open new positions (policy disallows)"
    },
    {
      "code": 6010,
      "name": "SessionExpired",
      "msg": "Session has expired"
    },
    {
      "code": 6011,
      "name": "SessionNotAuthorized",
      "msg": "Session not authorized"
    },
    {
      "code": 6012,
      "name": "InvalidSession",
      "msg": "Invalid session: does not belong to this vault"
    },
    {
      "code": 6013,
      "name": "OpenPositionsExist",
      "msg": "Vault has open positions, cannot close"
    },
    {
      "code": 6014,
      "name": "TooManyAllowedTokens",
      "msg": "Policy configuration invalid: too many allowed tokens"
    },
    {
      "code": 6015,
      "name": "TooManyAllowedProtocols",
      "msg": "Policy configuration invalid: too many allowed protocols"
    },
    {
      "code": 6016,
      "name": "AgentAlreadyRegistered",
      "msg": "Agent already registered for this vault"
    },
    {
      "code": 6017,
      "name": "NoAgentRegistered",
      "msg": "No agent registered for this vault"
    },
    {
      "code": 6018,
      "name": "VaultNotFrozen",
      "msg": "Vault is not frozen (expected frozen for reactivation)"
    },
    {
      "code": 6019,
      "name": "VaultAlreadyClosed",
      "msg": "Vault is already closed"
    },
    {
      "code": 6020,
      "name": "InsufficientBalance",
      "msg": "Insufficient vault balance for withdrawal"
    },
    {
      "code": 6021,
      "name": "DeveloperFeeTooHigh",
      "msg": "Developer fee rate exceeds maximum (50 / 1,000,000 = 0.5 BPS)"
    },
    {
      "code": 6022,
      "name": "InvalidFeeDestination",
      "msg": "Fee destination account invalid"
    },
    {
      "code": 6023,
      "name": "InvalidProtocolTreasury",
      "msg": "Protocol treasury account does not match expected address"
    },
    {
      "code": 6024,
      "name": "TooManySpendEntries",
      "msg": "Spend entry limit reached (too many active entries in rolling window)"
    },
    {
      "code": 6025,
      "name": "InvalidAgentKey",
      "msg": "Invalid agent: cannot be the zero address"
    },
    {
      "code": 6026,
      "name": "AgentIsOwner",
      "msg": "Invalid agent: agent cannot be the vault owner"
    },
    {
      "code": 6027,
      "name": "Overflow",
      "msg": "Arithmetic overflow"
    },
    {
      "code": 6028,
      "name": "DelegationFailed",
      "msg": "Token delegation approval failed"
    },
    {
      "code": 6029,
      "name": "RevocationFailed",
      "msg": "Token delegation revocation failed"
    },
    {
      "code": 6030,
      "name": "OracleFeedStale",
      "msg": "Oracle feed value is too stale"
    },
    {
      "code": 6031,
      "name": "OracleFeedInvalid",
      "msg": "Cannot parse oracle feed data"
    },
    {
      "code": 6032,
      "name": "TokenSpendBlocked",
      "msg": "Unpriced token cannot be spent (receive-only)"
    },
    {
      "code": 6033,
      "name": "InvalidTokenAccount",
      "msg": "Token account does not belong to vault or has wrong mint"
    },
    {
      "code": 6034,
      "name": "OracleAccountMissing",
      "msg": "Oracle-priced token requires feed account in remaining_accounts"
    },
    {
      "code": 6035,
      "name": "PerTokenCapExceeded",
      "msg": "Per-token daily spending cap would be exceeded"
    },
    {
      "code": 6036,
      "name": "PerTokenTxLimitExceeded",
      "msg": "Per-token single transaction limit exceeded"
    },
    {
      "code": 6037,
      "name": "OracleConfidenceTooWide",
      "msg": "Oracle price confidence interval too wide"
    },
    {
      "code": 6038,
      "name": "OracleUnsupportedType",
      "msg": "Oracle account owner is not a recognized oracle program"
    },
    {
      "code": 6039,
      "name": "OracleNotVerified",
      "msg": "Pyth price update not fully verified by Wormhole"
    },
    {
      "code": 6040,
      "name": "TimelockNotExpired",
      "msg": "Timelock period has not expired yet"
    },
    {
      "code": 6041,
      "name": "TimelockActive",
      "msg": "Vault has timelock active \u2014 use queue_policy_update instead"
    },
    {
      "code": 6042,
      "name": "NoTimelockConfigured",
      "msg": "No timelock configured on this vault"
    },
    {
      "code": 6043,
      "name": "DestinationNotAllowed",
      "msg": "Destination not in allowed list"
    },
    {
      "code": 6044,
      "name": "TooManyDestinations",
      "msg": "Too many destinations (max 10)"
    },
    {
      "code": 6045,
      "name": "InvalidTrackerTier",
      "msg": "Invalid tracker tier (must be 0, 1, or 2)"
    }
  ],
  "types": [
    {
      "name": "ActionAuthorized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "action_type",
            "type": {
              "defined": {
                "name": "ActionType"
              }
            }
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "usd_amount",
            "type": "u64"
          },
          {
            "name": "protocol",
            "type": "pubkey"
          },
          {
            "name": "rolling_spend_usd_after",
            "type": "u64"
          },
          {
            "name": "daily_cap_usd",
            "type": "u64"
          },
          {
            "name": "delegated",
            "type": "bool"
          },
          {
            "name": "oracle_price",
            "type": {
              "option": "i128"
            }
          },
          {
            "name": "oracle_source",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ActionDenied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "reason",
            "type": "string"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "ActionType",
      "docs": [
        "Action types that agents can request"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Swap"
          },
          {
            "name": "OpenPosition"
          },
          {
            "name": "ClosePosition"
          },
          {
            "name": "IncreasePosition"
          },
          {
            "name": "DecreasePosition"
          },
          {
            "name": "Deposit"
          },
          {
            "name": "Withdraw"
          },
          {
            "name": "Transfer"
          }
        ]
      }
    },
    {
      "name": "AgentRegistered",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "AgentRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "AgentTransferExecuted",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "mint",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "AgentVault",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "owner",
            "docs": [
              "The owner who created this vault (has full authority)"
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "The registered agent's signing key (Pubkey::default() if not yet registered)"
            ],
            "type": "pubkey"
          },
          {
            "name": "fee_destination",
            "docs": [
              "Developer fee destination \u2014 the wallet that receives developer fees",
              "on every finalized transaction. IMMUTABLE after initialization \u2014 only",
              "`initialize_vault` writes this field. This prevents a compromised owner",
              "key from redirecting fees. Protocol fees go to PROTOCOL_TREASURY separately."
            ],
            "type": "pubkey"
          },
          {
            "name": "vault_id",
            "docs": [
              "Unique vault identifier (allows one owner to have multiple vaults)"
            ],
            "type": "u64"
          },
          {
            "name": "status",
            "docs": [
              "Vault status: Active, Frozen, or Closed"
            ],
            "type": {
              "defined": {
                "name": "VaultStatus"
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA derivation"
            ],
            "type": "u8"
          },
          {
            "name": "created_at",
            "docs": [
              "Unix timestamp of vault creation"
            ],
            "type": "i64"
          },
          {
            "name": "total_transactions",
            "docs": [
              "Total number of agent transactions executed through this vault"
            ],
            "type": "u64"
          },
          {
            "name": "total_volume",
            "docs": [
              "Total volume processed in token base units"
            ],
            "type": "u64"
          },
          {
            "name": "open_positions",
            "docs": [
              "Number of currently open positions (for perps tracking)"
            ],
            "type": "u8"
          },
          {
            "name": "total_fees_collected",
            "docs": [
              "Cumulative developer fees collected from this vault (token base units).",
              "Protocol fees are tracked separately via events."
            ],
            "type": "u64"
          },
          {
            "name": "tracker_tier",
            "docs": [
              "Tracker capacity tier chosen at vault creation"
            ],
            "type": {
              "defined": {
                "name": "TrackerTier"
              }
            }
          }
        ]
      }
    },
    {
      "name": "AllowedToken",
      "docs": [
        "Per-token configuration including oracle feed and per-token caps.",
        "Replaces the old `Vec<Pubkey>` allowed_tokens with richer metadata.",
        "",
        "Oracle feed classification:",
        "- `Pubkey::default()` = stablecoin (1:1 USD, no oracle needed)",
        "- `UNPRICED_SENTINEL` ([0xFF; 32]) = unpriced token (receive-only)",
        "- Any other pubkey = Oracle feed account (Pyth PriceUpdateV2 or Switchboard PullFeed)"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "mint",
            "docs": [
              "Token mint address"
            ],
            "type": "pubkey"
          },
          {
            "name": "oracle_feed",
            "docs": [
              "Oracle feed account (Pyth PriceUpdateV2 or Switchboard PullFeed) for USD pricing.",
              "`Pubkey::default()` = stablecoin (1:1 USD).",
              "`UNPRICED_SENTINEL` = unpriced (receive-only, cannot be spent)."
            ],
            "type": "pubkey"
          },
          {
            "name": "decimals",
            "docs": [
              "Token decimals (e.g., 6 for USDC, 9 for SOL)"
            ],
            "type": "u8"
          },
          {
            "name": "daily_cap_base",
            "docs": [
              "Per-token daily cap in base units (0 = no per-token limit,",
              "only the aggregate USD cap applies)"
            ],
            "type": "u64"
          },
          {
            "name": "max_tx_base",
            "docs": [
              "Per-token max single transaction in base units",
              "(0 = no per-token tx limit, only USD tx limit applies)"
            ],
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "DelegationRevoked",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "token_account",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "FeesCollected",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "protocol_fee_amount",
            "type": "u64"
          },
          {
            "name": "developer_fee_amount",
            "type": "u64"
          },
          {
            "name": "protocol_fee_rate",
            "type": "u16"
          },
          {
            "name": "developer_fee_rate",
            "type": "u16"
          },
          {
            "name": "transaction_amount",
            "type": "u64"
          },
          {
            "name": "protocol_treasury",
            "type": "pubkey"
          },
          {
            "name": "developer_fee_destination",
            "type": "pubkey"
          },
          {
            "name": "cumulative_developer_fees",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "FundsDeposited",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "FundsWithdrawn",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "destination",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "PendingPolicyUpdate",
      "docs": [
        "Queued policy update that becomes executable after a timelock period.",
        "Created by `queue_policy_update`, applied by `apply_pending_policy`,",
        "or cancelled by `cancel_pending_policy`.",
        "",
        "PDA seeds: `[b\"pending_policy\", vault.key().as_ref()]`"
      ],
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "Associated vault pubkey"
            ],
            "type": "pubkey"
          },
          {
            "name": "queued_at",
            "docs": [
              "Unix timestamp when this update was queued"
            ],
            "type": "i64"
          },
          {
            "name": "executes_at",
            "docs": [
              "Unix timestamp when this update becomes executable"
            ],
            "type": "i64"
          },
          {
            "name": "daily_spending_cap_usd",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "max_transaction_amount_usd",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "allowed_tokens",
            "type": {
              "option": {
                "vec": {
                  "defined": {
                    "name": "AllowedToken"
                  }
                }
              }
            }
          },
          {
            "name": "allowed_protocols",
            "type": {
              "option": {
                "vec": "pubkey"
              }
            }
          },
          {
            "name": "max_leverage_bps",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "can_open_positions",
            "type": {
              "option": "bool"
            }
          },
          {
            "name": "max_concurrent_positions",
            "type": {
              "option": "u8"
            }
          },
          {
            "name": "developer_fee_rate",
            "type": {
              "option": "u16"
            }
          },
          {
            "name": "timelock_duration",
            "type": {
              "option": "u64"
            }
          },
          {
            "name": "allowed_destinations",
            "type": {
              "option": {
                "vec": "pubkey"
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PolicyChangeApplied",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "applied_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "PolicyChangeCancelled",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          }
        ]
      }
    },
    {
      "name": "PolicyChangeQueued",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "executes_at",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "PolicyConfig",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "Associated vault pubkey"
            ],
            "type": "pubkey"
          },
          {
            "name": "daily_spending_cap_usd",
            "docs": [
              "Maximum aggregate spend per rolling 24h period in USD (6 decimals).",
              "$500 = 500_000_000. This is the primary spending cap."
            ],
            "type": "u64"
          },
          {
            "name": "max_transaction_size_usd",
            "docs": [
              "Maximum single transaction size in USD (6 decimals)."
            ],
            "type": "u64"
          },
          {
            "name": "allowed_tokens",
            "docs": [
              "Allowed token mints with oracle feeds and per-token caps.",
              "Bounded to MAX_ALLOWED_TOKENS entries."
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "AllowedToken"
                }
              }
            }
          },
          {
            "name": "allowed_protocols",
            "docs": [
              "Allowed program IDs the agent can call (Jupiter, Flash Trade, etc.)",
              "Bounded to MAX_ALLOWED_PROTOCOLS entries"
            ],
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "max_leverage_bps",
            "docs": [
              "Maximum leverage multiplier in basis points (e.g., 10000 = 100x, 1000 = 10x)",
              "Set to 0 to disallow leveraged positions entirely"
            ],
            "type": "u16"
          },
          {
            "name": "can_open_positions",
            "docs": [
              "Whether the agent can open new positions (vs only close existing)"
            ],
            "type": "bool"
          },
          {
            "name": "max_concurrent_positions",
            "docs": [
              "Maximum number of concurrent open positions"
            ],
            "type": "u8"
          },
          {
            "name": "developer_fee_rate",
            "docs": [
              "Developer fee rate (rate / 1,000,000). Applied to every finalized",
              "transaction. Fee deducted from vault, transferred to vault's",
              "fee_destination. Max MAX_DEVELOPER_FEE_RATE (50 = 0.5 BPS).",
              "Set to 0 for no developer fee. Protocol fee is always applied",
              "separately at PROTOCOL_FEE_RATE."
            ],
            "type": "u16"
          },
          {
            "name": "timelock_duration",
            "docs": [
              "Timelock duration in seconds for policy changes. 0 = no timelock",
              "(immediate updates allowed). When > 0, policy changes must go",
              "through queue_policy_update \u2192 apply_pending_policy."
            ],
            "type": "u64"
          },
          {
            "name": "allowed_destinations",
            "docs": [
              "Allowed destination addresses for agent transfers.",
              "Empty = any destination allowed. Bounded to MAX_ALLOWED_DESTINATIONS."
            ],
            "type": {
              "vec": "pubkey"
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "PolicyUpdated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "daily_cap_usd",
            "type": "u64"
          },
          {
            "name": "max_transaction_size_usd",
            "type": "u64"
          },
          {
            "name": "allowed_tokens_count",
            "type": "u8"
          },
          {
            "name": "allowed_protocols_count",
            "type": "u8"
          },
          {
            "name": "max_leverage_bps",
            "type": "u16"
          },
          {
            "name": "developer_fee_rate",
            "type": "u16"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "SessionAuthority",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "Associated vault"
            ],
            "type": "pubkey"
          },
          {
            "name": "agent",
            "docs": [
              "The agent who initiated this session"
            ],
            "type": "pubkey"
          },
          {
            "name": "authorized",
            "docs": [
              "Whether this session has been authorized by the permission check"
            ],
            "type": "bool"
          },
          {
            "name": "authorized_amount",
            "docs": [
              "Authorized action details (for verification in finalize)"
            ],
            "type": "u64"
          },
          {
            "name": "authorized_token",
            "type": "pubkey"
          },
          {
            "name": "authorized_protocol",
            "type": "pubkey"
          },
          {
            "name": "action_type",
            "docs": [
              "The action type that was authorized (stored so finalize can record it)"
            ],
            "type": {
              "defined": {
                "name": "ActionType"
              }
            }
          },
          {
            "name": "expires_at_slot",
            "docs": [
              "Slot-based expiry: session is valid until this slot"
            ],
            "type": "u64"
          },
          {
            "name": "delegated",
            "docs": [
              "Whether token delegation was set up (approve CPI)"
            ],
            "type": "bool"
          },
          {
            "name": "delegation_token_account",
            "docs": [
              "The vault's token account that was delegated to the agent",
              "(only meaningful when delegated == true)"
            ],
            "type": "pubkey"
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "SessionFinalized",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "agent",
            "type": "pubkey"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "is_expired",
            "type": "bool"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "SpendEntry",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "token_index",
            "docs": [
              "Index into PolicyConfig.allowed_tokens[] (0-9).",
              "Compact representation \u2014 avoids storing full 32-byte Pubkey per entry.",
              "Invalidated when token list changes (rolling_spends is cleared)."
            ],
            "type": "u8"
          },
          {
            "name": "usd_amount",
            "docs": [
              "USD value of this spend (6 decimals, e.g., $500 = 500_000_000)"
            ],
            "type": "u64"
          },
          {
            "name": "base_amount",
            "docs": [
              "Original amount in token base units (for per-token cap checks)"
            ],
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "SpendTracker",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "docs": [
              "Associated vault pubkey"
            ],
            "type": "pubkey"
          },
          {
            "name": "tracker_tier",
            "docs": [
              "Tracker capacity tier (Standard/Pro/Max)"
            ],
            "type": {
              "defined": {
                "name": "TrackerTier"
              }
            }
          },
          {
            "name": "max_spend_entries",
            "docs": [
              "Maximum spend entries for this tracker (derived from tier at init)"
            ],
            "type": "u32"
          },
          {
            "name": "rolling_spends",
            "docs": [
              "Rolling spend entries: (token_mint, usd_amount, base_amount, timestamp)",
              "Entries older than ROLLING_WINDOW_SECONDS are pruned on each access"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "SpendEntry"
                }
              }
            }
          },
          {
            "name": "recent_transactions",
            "docs": [
              "Recent transaction log for on-chain audit trail",
              "Bounded to MAX_RECENT_TRANSACTIONS, oldest entries evicted (ring buffer)"
            ],
            "type": {
              "vec": {
                "defined": {
                  "name": "TransactionRecord"
                }
              }
            }
          },
          {
            "name": "bump",
            "docs": [
              "Bump seed for PDA"
            ],
            "type": "u8"
          }
        ]
      }
    },
    {
      "name": "TrackerTier",
      "docs": [
        "Tracker capacity tiers \u2014 chosen at vault creation, determines",
        "max rolling spend entries and SpendTracker account size."
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Standard"
          },
          {
            "name": "Pro"
          },
          {
            "name": "Max"
          }
        ]
      }
    },
    {
      "name": "TransactionRecord",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "timestamp",
            "type": "i64"
          },
          {
            "name": "action_type",
            "type": {
              "defined": {
                "name": "ActionType"
              }
            }
          },
          {
            "name": "token_mint",
            "type": "pubkey"
          },
          {
            "name": "amount",
            "type": "u64"
          },
          {
            "name": "protocol",
            "type": "pubkey"
          },
          {
            "name": "success",
            "type": "bool"
          },
          {
            "name": "slot",
            "type": "u64"
          }
        ]
      }
    },
    {
      "name": "VaultClosed",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "VaultCreated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "owner",
            "type": "pubkey"
          },
          {
            "name": "vault_id",
            "type": "u64"
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "VaultReactivated",
      "type": {
        "kind": "struct",
        "fields": [
          {
            "name": "vault",
            "type": "pubkey"
          },
          {
            "name": "new_agent",
            "type": {
              "option": "pubkey"
            }
          },
          {
            "name": "timestamp",
            "type": "i64"
          }
        ]
      }
    },
    {
      "name": "VaultStatus",
      "docs": [
        "Vault status enum"
      ],
      "type": {
        "kind": "enum",
        "variants": [
          {
            "name": "Active"
          },
          {
            "name": "Frozen"
          },
          {
            "name": "Closed"
          }
        ]
      }
    }
  ]
} as const;
