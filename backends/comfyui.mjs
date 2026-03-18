import * as log from "../src/logger.mjs";

const TIMEOUT_MS = 10_000;

/**
 * Free ComfyUI VRAM by calling its /free endpoint.
 * Unloads all models and releases GPU memory.
 * Throws on failure so the swap can be aborted.
 */
export async function unload(backend) {
  log.info("Freeing VRAM", backend.name);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    await fetch(`${backend.upstream}/free`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unload_models: true, free_memory: true }),
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
