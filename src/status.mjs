import http from "node:http";

/**
 * Status API server — lightweight JSON endpoint for monitoring.
 */
export function createStatusServer(port, vramManager) {
  const server = http.createServer((req, res) => {
    if (req.method !== "GET") {
      res.writeHead(405, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    if (req.url === "/health") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(
      JSON.stringify(
        {
          ...vramManager.status(),
          uptime: Math.floor(process.uptime()),
        },
        null,
        2
      )
    );
  });

  return server;
}
