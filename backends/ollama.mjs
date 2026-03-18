import * as log from "../src/logger.mjs";

const TIMEOUT_MS = 10_000;

function withTimeout() {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  return { signal: ctrl.signal, clear: () => clearTimeout(timer) };
}

/**
 * Unload all loaded Ollama models from VRAM.
 * Calls /api/ps to list running models, then sends keep_alive: 0 to each.
 * Throws on failure so the swap can be aborted.
 */
export async function unload(backend) {
  const t1 = withTimeout();
  let res;
  try {
    res = await fetch(`${backend.upstream}/api/ps`, { signal: t1.signal });
  } finally {
    t1.clear();
  }

  const data = await res.json();
  const models = data.models || [];

  if (models.length === 0) {
    log.info("No models loaded, skipping unload", backend.name);
    return;
  }

  for (const m of models) {
    log.info(`Unloading model: ${m.name}`, backend.name);
    const t2 = withTimeout();
    try {
      await fetch(`${backend.upstream}/api/generate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model: m.name, keep_alive: 0 }),
        signal: t2.signal,
      });
    } finally {
      t2.clear();
    }
  }
}
