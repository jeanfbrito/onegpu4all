import http from "node:http";
import httpProxy from "http-proxy";
import * as log from "./logger.mjs";

/**
 * Built-in patterns for requests that use GPU (need VRAM acquisition).
 * Everything else is passthrough (UI polling, static files, status checks).
 */
const GPU_PATTERNS = {
  ollama: [
    /^\/api\/generate/,
    /^\/api\/chat/,
    /^\/api\/embed/,
    /^\/v1\/chat\/completions/,
    /^\/v1\/completions/,
    /^\/v1\/embeddings/,
  ],
  comfyui: [
    /^\/prompt/,
    /^\/api\/prompt/,
    /^\/queue/,
  ],
};

/**
 * Check if a request URL needs GPU / VRAM access.
 */
function needsGpu(backendName, method, url) {
  // POST/PUT to known GPU endpoints
  const patterns = GPU_PATTERNS[backendName];
  if (patterns) {
    const path = url.split("?")[0];
    return patterns.some((p) => p.test(path));
  }
  // Unknown backend: all POST/PUT requests acquire, GET passes through
  return method !== "GET" && method !== "HEAD" && method !== "OPTIONS";
}

/**
 * Create a reverse proxy server for a backend.
 * Only GPU-intensive requests acquire VRAM; UI/polling passes through.
 */
export function createProxyServer(backend, vramManager) {
  const proxy = httpProxy.createProxyServer({
    target: backend.upstream,
    ws: true,
    timeout: 300_000,
    proxyTimeout: 300_000,
  });

  proxy.on("error", (err, req, res) => {
    log.error(`Proxy error: ${err.message}`, backend.name);
    if (res && res.writeHead) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end(
        JSON.stringify({
          error: "Backend unavailable",
          backend: backend.name,
        })
      );
    }
  });

  const server = http.createServer(async (req, res) => {
    const start = Date.now();
    const gpu = needsGpu(backend.name, req.method, req.url);

    if (gpu) {
      try {
        await vramManager.acquire(backend.name);
      } catch (err) {
        res.writeHead(503, {
          "Content-Type": "application/json",
          "Retry-After": "5",
        });
        res.end(
          JSON.stringify({
            error: "VRAM swap failed",
            message: err.message,
          })
        );
        return;
      }

      // Track this request for the status monitor
      const reqInfo = {
        method: req.method,
        url: req.url.split("?")[0],
        startedAt: new Date().toISOString(),
        backend: backend.name,
      };
      vramManager.addActiveRequest(reqInfo);

      log.info(
        `→ ${req.method} ${req.url} [GPU] (active: ${vramManager.active[backend.name]}, queued: ${vramManager.queue.length})`,
        backend.name
      );

      let released = false;
      const cleanup = () => {
        if (released) return;
        released = true;
        vramManager.release(backend.name);
        vramManager.removeActiveRequest(reqInfo);
        log.info(`← ${req.method} ${req.url} [GPU] (${Date.now() - start}ms)`, backend.name);
      };
      res.on("close", cleanup);
      res.on("error", cleanup);
    } else {
      // Passthrough — no VRAM acquisition
      res.on("close", () => {
        vramManager.trackPassthrough(backend.name);
      });
    }

    proxy.web(req, res);
  });

  // WebSocket passthrough (e.g., ComfyUI UI).
  server.on("upgrade", (req, socket, head) => {
    proxy.ws(req, socket, head);
  });

  return server;
}
