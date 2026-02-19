import { Connection, Keypair, clusterApiUrl } from "@solana/web3.js";
import { Wallet } from "@coral-xyz/anchor";
import { AgentShieldClient } from "@agent-shield/sdk";
import * as fs from "fs";

/** Supported custody providers for MCP server. */
export type McpCustodyProvider = "crossmint" | "turnkey" | "privy";

export interface McpConfig {
  /** Path to owner wallet keypair JSON. Not needed when using custody. */
  walletPath?: string;
  rpcUrl: string;
  agentKeypairPath?: string;
  /** TEE custody provider — when set, walletPath is not required. */
  custodyProvider?: McpCustodyProvider;
  /** Crossmint API key (when custodyProvider = "crossmint"). */
  crossmintApiKey?: string;
  /** Crossmint wallet locator (optional — creates new wallet if omitted). */
  crossmintLocator?: string;
}

export function loadConfig(): McpConfig {
  const rpcUrl = process.env.AGENTSHIELD_RPC_URL || clusterApiUrl("devnet");

  const agentKeypairPath =
    process.env.AGENTSHIELD_AGENT_KEYPAIR_PATH || undefined;

  const custodyProvider = process.env.AGENTSHIELD_CUSTODY as
    | McpCustodyProvider
    | undefined;

  if (custodyProvider) {
    // TEE custody path — no wallet file needed
    return {
      rpcUrl,
      agentKeypairPath,
      custodyProvider,
      crossmintApiKey: process.env.CROSSMINT_API_KEY || undefined,
      crossmintLocator: process.env.CROSSMINT_WALLET_LOCATOR || undefined,
    };
  }

  // Legacy path — keypair file required
  const walletPath = process.env.AGENTSHIELD_WALLET_PATH;
  if (!walletPath) {
    throw new Error(
      "AGENTSHIELD_WALLET_PATH is required (or set AGENTSHIELD_CUSTODY " +
        "to a custody provider: crossmint, turnkey, privy). " +
        "Set AGENTSHIELD_WALLET_PATH to the path of your Solana keypair JSON file.",
    );
  }

  return { walletPath, rpcUrl, agentKeypairPath };
}

export function loadKeypair(path: string): Keypair {
  const resolved = path.startsWith("~")
    ? path.replace("~", process.env.HOME || "")
    : path;
  const raw = fs.readFileSync(resolved, "utf-8");
  const secretKey = Uint8Array.from(JSON.parse(raw));
  return Keypair.fromSecretKey(secretKey);
}

export function createClient(config: McpConfig): AgentShieldClient {
  if (!config.walletPath) {
    throw new Error(
      "createClient requires walletPath. " +
        "For custody-based wallets, use createCustodyClient() instead.",
    );
  }
  const keypair = loadKeypair(config.walletPath);
  const wallet = new Wallet(keypair);
  const connection = new Connection(config.rpcUrl, "confirmed");
  return new AgentShieldClient(connection, wallet);
}

/**
 * Create a WalletLike from a TEE custody provider.
 * Dynamically imports the provider adapter to avoid hard dependencies.
 */
export async function createCustodyWallet(config: McpConfig): Promise<{
  publicKey: import("@solana/web3.js").PublicKey;
  signTransaction: Function;
}> {
  switch (config.custodyProvider) {
    case "crossmint": {
      if (!config.crossmintApiKey) {
        throw new Error(
          "CROSSMINT_API_KEY is required when AGENTSHIELD_CUSTODY=crossmint.",
        );
      }
      // Dynamic require to avoid hard dependency on custody adapter.
      let mod: any;
      try {
        mod = require("@agent-shield/custody-crossmint");
      } catch {
        throw new Error(
          "@agent-shield/custody-crossmint is not installed. " +
            "Run: npm install @agent-shield/custody-crossmint",
        );
      }
      return mod.crossmint({
        apiKey: config.crossmintApiKey,
        locator: config.crossmintLocator,
      });
    }
    case "turnkey":
      throw new Error(
        "Turnkey custody adapter is not yet available. " +
          "Install @agent-shield/custody-turnkey when released.",
      );
    case "privy":
      throw new Error(
        "Privy custody adapter is not yet available. " +
          "Install @agent-shield/custody-privy when released.",
      );
    default:
      throw new Error(
        `Unknown custody provider '${config.custodyProvider}'. ` +
          "Supported: crossmint, turnkey, privy.",
      );
  }
}

export function loadAgentKeypair(config: McpConfig): Keypair {
  if (!config.agentKeypairPath) {
    throw new Error(
      "AGENTSHIELD_AGENT_KEYPAIR_PATH is required for agent-signed operations. " +
        "Set it to the path of the agent's Solana keypair JSON file.",
    );
  }
  return loadKeypair(config.agentKeypairPath);
}
