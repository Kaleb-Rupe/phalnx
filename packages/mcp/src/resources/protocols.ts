import { KNOWN_PROTOCOLS } from "@phalnx/sdk";

export async function getProtocolsResource(): Promise<string> {
  const protocols: Array<{
    programId: string;
    displayName: string;
  }> = [];

  for (const [programId, displayName] of KNOWN_PROTOCOLS) {
    protocols.push({ programId, displayName });
  }

  return JSON.stringify(
    {
      protocolCount: protocols.length,
      protocols,
    },
    null,
    2,
  );
}
