/**
 * Jupiter API Foundation Layer — Kit-native
 *
 * Pure HTTP client with retry, API key injection, and timeout.
 * Zero dependency on @solana/web3.js or @solana/kit — pure fetch.
 */

// ─── Configuration ──────────────────────────────────────────────────────────

export interface JupiterApiConfig {
  apiKey?: string;
  baseUrl?: string;
  maxRetries?: number;
  retryDelayMs?: number;
  timeoutMs?: number;
  maxDelayMs?: number;
}

export class JupiterApiError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Jupiter API error (${statusCode}): ${body}`);
    this.name = "JupiterApiError";
  }
}

const DEFAULT_CONFIG: Required<JupiterApiConfig> = {
  apiKey: "",
  baseUrl: "https://api.jup.ag",
  maxRetries: 3,
  retryDelayMs: 1000,
  timeoutMs: 30_000,
  maxDelayMs: 30_000,
};

let currentConfig: Readonly<Required<JupiterApiConfig>> = Object.freeze({ ...DEFAULT_CONFIG });

export function configureJupiterApi(config: JupiterApiConfig): void {
  const normalizedUrl = (config.baseUrl ?? DEFAULT_CONFIG.baseUrl).replace(/\/$/, "");
  // H-3: Enforce HTTPS for Jupiter API (security audit fix)
  if (normalizedUrl && !normalizedUrl.startsWith("https://") && !normalizedUrl.startsWith("http://localhost")) {
    throw new Error(
      `Jupiter API base URL must use HTTPS (got: ${normalizedUrl}). ` +
      "Use http://localhost only for local development/testing."
    );
  }
  currentConfig = Object.freeze({
    apiKey: config.apiKey ?? DEFAULT_CONFIG.apiKey,
    baseUrl: normalizedUrl,
    maxRetries: config.maxRetries ?? DEFAULT_CONFIG.maxRetries,
    retryDelayMs: config.retryDelayMs ?? DEFAULT_CONFIG.retryDelayMs,
    timeoutMs: config.timeoutMs ?? DEFAULT_CONFIG.timeoutMs,
    maxDelayMs: config.maxDelayMs ?? DEFAULT_CONFIG.maxDelayMs,
  });
}

export function getJupiterApiConfig(): Readonly<Required<JupiterApiConfig>> {
  return currentConfig;
}

export function resetJupiterApiConfig(): void {
  currentConfig = Object.freeze({ ...DEFAULT_CONFIG });
}

// ─── Fetch with Retry ───────────────────────────────────────────────────────

export interface JupiterFetchOptions {
  method?: "GET" | "POST" | "PUT" | "DELETE";
  headers?: Record<string, string>;
  body?: string | Record<string, unknown>;
  timeoutMs?: number;
}

export async function jupiterFetch<T>(
  path: string,
  options?: JupiterFetchOptions,
): Promise<T> {
  const config = currentConfig;
  const url = `${config.baseUrl}${path}`;
  const method = options?.method ?? "GET";
  const timeout = options?.timeoutMs ?? config.timeoutMs;

  const headers: Record<string, string> = { ...options?.headers };

  if (config.apiKey) {
    headers["x-api-key"] = config.apiKey;
  }

  if (options?.body && !headers["Content-Type"] && !headers["content-type"]) {
    headers["Content-Type"] = "application/json";
  }

  const body: string | undefined =
    options?.body && typeof options.body !== "string"
      ? JSON.stringify(options.body)
      : (options?.body as string | undefined);

  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= config.maxRetries; attempt++) {
    try {
      const response = await fetch(url, {
        method,
        headers,
        body,
        signal: AbortSignal.timeout(timeout),
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      const responseBody = await response.text();

      if (
        (response.status === 429 || response.status >= 500) &&
        attempt < config.maxRetries
      ) {
        const retryAfter = response.headers.get("Retry-After");
        const parsedRetry = retryAfter ? parseInt(retryAfter, 10) : NaN;
        const delay =
          !isNaN(parsedRetry) && parsedRetry > 0
            ? Math.min(parsedRetry * 1000, config.maxDelayMs)
            : Math.min(
                config.retryDelayMs * Math.pow(2, attempt) +
                  Math.random() * config.retryDelayMs,
                config.maxDelayMs,
              );

        await sleep(delay);
        lastError = new JupiterApiError(response.status, responseBody);
        continue;
      }

      throw new JupiterApiError(response.status, responseBody);
    } catch (error) {
      if (error instanceof JupiterApiError) {
        throw error;
      }

      if (attempt < config.maxRetries) {
        const delay = Math.min(
          config.retryDelayMs * Math.pow(2, attempt) +
            Math.random() * config.retryDelayMs,
          config.maxDelayMs,
        );
        await sleep(delay);
        lastError = error instanceof Error ? error : new Error(String(error));
        continue;
      }

      throw error;
    }
  }

  throw lastError ?? new Error("Jupiter API request failed after retries");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
