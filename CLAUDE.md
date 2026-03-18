# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm start                              # Start broker (needs config.yaml)
npm test                               # Run all tests (Node.js native test runner)
node --test tests/vram-manager.test.mjs  # Run a single test file
npm run status                         # Live terminal monitor
node bin/onegpu4all.mjs --init         # Generate config.yaml
node bin/onegpu4all.mjs --config <path>  # Start with specific config
```

## Architecture

OneGPU4All is a reverse proxy with an exclusive VRAM mutex. Each backend gets its own proxy port. The broker only intervenes on GPU-intensive endpoints — everything else passes through instantly.

### Request flow

1. Request arrives at a backend's proxy port
2. `proxy.mjs` checks `needsGpu()` against `GPU_PATTERNS` (regex per backend type)
3. **GPU request:** `vramManager.acquire()` → if another backend owns VRAM, queue and wait (120s timeout) → unload current owner (10s timeout) → 1s settle → transfer ownership → proxy to upstream → `release()` on response close
4. **Passthrough** (GET, UI assets, health checks): proxy immediately, no VRAM interaction

### Key modules

- **`src/vram-manager.mjs`** — Core ownership/queue logic. Tracks owner, active request counts, pending queue (promise-based). First GPU request after startup proactively unloads all backends to clear stale VRAM.
- **`src/proxy.mjs`** — HTTP reverse proxy (http-proxy lib) with WebSocket support. Routes GPU vs passthrough requests. 300s request timeout.
- **`src/broker.mjs`** — Startup orchestration: loads config, dynamically imports backend strategies from `backends/`, registers with VramManager, spins up proxy servers + status server.
- **`src/config.mjs`** — Custom YAML parser (no external dep). Fallback chain: CLI `--config` → `./config.yaml` → env vars (`OLLAMA_UPSTREAM`, `COMFYUI_UPSTREAM`).
- **`src/status.mjs`** — JSON status API on `statusPort` (default 5102). `/health` for monitoring, `/` for full state.

### Backend strategy pattern

Each backend in `backends/` exports `async function unload(backend)`. Called when another backend needs VRAM. All unloads have a 10s AbortController timeout — if exceeded, swap continues anyway (best-effort over deadlock).

- **ollama.mjs** — Lists models via `/api/ps`, unloads each with `keep_alive: 0`
- **comfyui.mjs** — `POST /free` with `unload_models: true`
- **generic.mjs** — POSTs to configurable `unloadEndpoint`, or no-op

To add a new backend: create `backends/<name>.mjs` exporting `unload(backend)`, reference it as `unloadStrategy` in config.

### Design decisions worth knowing

- Passthrough routing means browser tabs and status polls never block or trigger swaps
- If unload fails, swap continues — partial VRAM freed beats deadlock
- 1s settle wait after unload lets GPU memory actually free before next backend loads
- `config.yaml` is gitignored; examples are in `examples/`
