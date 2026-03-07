/**
 * OS keychain wrapper for TEE provider credentials.
 * Uses `keytar` (macOS Keychain, Windows Credential Manager, Linux Secret Service).
 * Gracefully degrades to null/false if keytar is unavailable (Linux CI, no libsecret).
 */

const SERVICE = "phalnx-mcp";

type KeytarModule = {
  getPassword(service: string, account: string): Promise<string | null>;
  setPassword(service: string, account: string, password: string): Promise<void>;
  deletePassword(service: string, account: string): Promise<boolean>;
};

let _keytar: KeytarModule | null | undefined = undefined;

function loadKeytar(): KeytarModule | null {
  if (_keytar !== undefined) return _keytar;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    _keytar = require("keytar") as KeytarModule;
    return _keytar;
  } catch {
    _keytar = null;
    return null;
  }
}

/** Read a credential. Returns null if keytar unavailable or credential not found. */
export async function getCredential(account: string): Promise<string | null> {
  try {
    const k = loadKeytar();
    if (!k) return null;
    return await k.getPassword(SERVICE, account);
  } catch {
    return null;
  }
}

/** Save a credential. Returns false if keytar unavailable (caller should inform user to set env var). */
export async function saveCredential(account: string, value: string): Promise<boolean> {
  try {
    const k = loadKeytar();
    if (!k) return false;
    await k.setPassword(SERVICE, account, value);
    return true;
  } catch {
    return false;
  }
}

/** Remove a credential. Silently no-ops if keytar unavailable. */
export async function deleteCredential(account: string): Promise<void> {
  try {
    const k = loadKeytar();
    if (!k) return;
    await k.deletePassword(SERVICE, account);
  } catch {}
}

/** Keychain account name constants */
export const KC = {
  CROSSMINT_API_KEY: "crossmint-api-key",
  PRIVY_APP_ID: "privy-app-id",
  PRIVY_APP_SECRET: "privy-app-secret",
  TURNKEY_ORG_ID: "turnkey-org-id",
  TURNKEY_API_KEY_ID: "turnkey-api-key-id",
  TURNKEY_API_PRIVATE_KEY: "turnkey-api-private-key",
} as const;
