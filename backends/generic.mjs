import * as log from "../src/logger.mjs";

const TIMEOUT_MS = 10_000;

/**
 * Generic unload strategy.
 * Sends a POST to the backend's unloadEndpoint if configured, otherwise no-op.
 * Throws on failure so the swap can be aborted.
 */
export async function unload(backend) {
  const endpoint = backend.unloadEndpoint;
  if (!endpoint) {
    log.info("No unloadEndpoint configured, skipping", backend.name);
    return;
  }

  log.info(`Calling ${endpoint}`, backend.name);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await fetch(`${backend.upstream}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
