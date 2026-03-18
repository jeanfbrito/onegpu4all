import { VRAMManager } from "./vram-manager.mjs";
import { createProxyServer } from "./proxy.mjs";
import { createStatusServer } from "./status.mjs";
import * as log from "./logger.mjs";

/**
 * Boot the broker: register backends, start proxies, start status server.
 */
export async function startBroker(config) {
  const manager = new VRAMManager();

  // Load backend strategies
  for (const backend of config.backends) {
    const strategyName = backend.unloadStrategy || "generic";
    let strategy;
    try {
      strategy = await import(`../backends/${strategyName}.mjs`);
    } catch {
      log.warn(
        `Unknown strategy '${strategyName}', falling back to generic`,
        backend.name
      );
      strategy = await import("../backends/generic.mjs");
    }
    manager.registerBackend(backend, strategy);
  }

  // Start proxy servers
  const servers = [];
  for (const backend of config.backends) {
    const server = createProxyServer(backend, manager);
    server.listen(backend.proxyPort, () => {
      log.info(
        `Proxy :${backend.proxyPort} → ${backend.upstream}`,
        backend.name
      );
    });
    servers.push(server);
  }

  // Start status server
  const statusServer = createStatusServer(config.statusPort, manager);
  statusServer.listen(config.statusPort, () => {
    log.info(`Status API on :${config.statusPort}`);
  });
  servers.push(statusServer);

  // Graceful shutdown
  const shutdown = () => {
    log.info("Shutting down...");
    for (const s of servers) {
      s.close();
    }
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  return { manager, servers };
}
