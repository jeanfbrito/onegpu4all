# OneGPU4All

> One GPU, many services. Zero conflicts.

A lightweight VRAM broker for single-GPU machines. Run LLMs (Ollama), image generation (ComfyUI), and any other GPU service simultaneously — OneGPU4All handles the queue and swaps VRAM automatically so they never crash into each other.

```
                       ┌─────────────┐
  Client A ──────────► │             │ ──────► Ollama (:11434)
                       │  OneGPU4All │
  Client B ──────────► │             │ ──────► ComfyUI (:8188)
                       │  VRAM Broker│
  Client C ──────────► │             │ ──────► Any GPU Service
                       └──────┬──────┘
                              │
                         Status API
                       GET :5102/health
```

## The Problem

You have one GPU. You run Ollama for LLMs and ComfyUI for image generation. When both try to use the GPU at the same time — out of memory, crashes, or one silently fails.

**OneGPU4All sits between your clients and your GPU services.** When a request arrives for one backend while another holds the GPU:

1. Incoming request is **queued** (client waits transparently)
2. The current GPU owner finishes its active work
3. OneGPU4All tells it to **unload from VRAM**
4. The new backend's request is **forwarded** and loads into VRAM
5. Done — no OOM, no manual intervention

## Quick Start

```bash
# Install
npm install -g onegpu4all

# Generate config
onegpu4all --init

# Edit onegpu4all.yaml with your backends, then:
onegpu4all
```

Or without installing globally:

```bash
git clone https://github.com/onegpu4all/onegpu4all
cd onegpu4all
npm install
node bin/onegpu4all.mjs --config examples/config.yaml
```

## Configuration

OneGPU4All uses a YAML config file. Run `onegpu4all --init` to generate one.

```yaml
statusPort: 5102

backends:
  - name: ollama
    proxyPort: 5001          # Clients connect here instead of Ollama directly
    upstream: http://localhost:11434  # Where Ollama actually runs
    unloadStrategy: ollama   # Built-in: knows how to free Ollama VRAM

  - name: comfyui
    proxyPort: 5101
    upstream: http://localhost:8188
    unloadStrategy: comfyui

  - name: my-custom-service
    proxyPort: 5103
    upstream: http://localhost:9000
    unloadStrategy: generic
    unloadEndpoint: /api/release-gpu  # POST to this to free VRAM
```

**Key idea:** clients connect to the `proxyPort` instead of the service directly. OneGPU4All transparently proxies all requests (HTTP + WebSocket), only intervening when a VRAM swap is needed.

### Environment Variables (alternative)

For simple two-backend setups, you can skip the config file:

```bash
OLLAMA_UPSTREAM=http://localhost:11434 \
COMFYUI_UPSTREAM=http://localhost:8188 \
onegpu4all
```

## Built-in Backends

### Ollama

Lists loaded models via `/api/ps` and unloads each with `keep_alive: 0`. Works with any Ollama version.

**Tip:** Set `OLLAMA_MAX_LOADED_MODELS=1` in your Ollama config to prevent it from trying to load multiple models into VRAM on its own.

### ComfyUI

Calls the `/free` endpoint with `unload_models: true` to release VRAM. ComfyUI stays running (UI accessible) but models are cleared from GPU memory.

### Generic

POSTs to a configurable `unloadEndpoint` on the backend. Use this for any service that has an API to release GPU resources. If no endpoint is configured, it's a no-op (useful for services that release VRAM on their own).

## Adding Custom Backends

Create a file in the `backends/` directory that exports an `unload(backend)` async function. This is called when another backend needs the GPU — your job is to free VRAM.

```js
// backends/my-service.mjs
import * as log from "../src/logger.mjs";

export async function unload(backend) {
  log.info("Releasing GPU", backend.name);
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 10_000);
  try {
    await fetch(`${backend.upstream}/api/release`, {
      method: "POST",
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}
```

Then reference it in your config:

```yaml
backends:
  - name: my-service
    proxyPort: 5200
    upstream: http://localhost:7000
    unloadStrategy: my-service
```

Always include a timeout on fetch calls — if your unload hangs, it blocks all VRAM swaps.

### GPU endpoint patterns

Not every request needs VRAM. OneGPU4All only acquires GPU ownership for endpoints that actually run inference. Built-in patterns:

| Backend | GPU endpoints (acquire VRAM) |
|---------|------------------------------|
| Ollama | `/api/generate`, `/api/chat`, `/api/embed`, `/v1/chat/completions`, `/v1/completions`, `/v1/embeddings` |
| ComfyUI | `/prompt`, `/api/prompt`, `/queue` |
| Generic | Any `POST`/`PUT` request |

Everything else (UI assets, status polls, model lists, GET requests) passes through without touching the VRAM manager. This means browser tabs, health checks, and API discovery never block or trigger swaps.

## Status API

```bash
# Full status
curl http://localhost:5102
```

```json
{
  "vramOwner": "ollama",
  "activeRequests": { "ollama": 1, "comfyui": 0 },
  "queueLength": 0,
  "queuedBackends": [],
  "gpuRequests": { "ollama": 42, "comfyui": 7 },
  "passthroughRequests": { "ollama": 10, "comfyui": 318 },
  "swapCount": 5,
  "lastSwapAt": "2025-01-15T10:30:00.000Z",
  "liveRequests": [
    { "method": "POST", "url": "/api/generate", "backend": "ollama", "startedAt": "..." }
  ],
  "uptime": 3600
}
```

```bash
# Health check (for monitoring/load balancers)
curl http://localhost:5102/health
# → {"ok":true}
```

## Live Monitor

OneGPU4All ships with a real-time terminal dashboard that shows GPU stats, VRAM ownership, active requests, and swap history at a glance.

```bash
# If installed globally
onegpu4all-status

# Or run directly
node bin/onegpu4all-status.mjs
```

<!-- screenshot placeholder -->

The monitor displays:
- **GPU hardware stats** — VRAM usage, utilization, power draw, temperature, fan speed, clock speeds
- **GPU processes** — which processes are on the GPU and how much VRAM each uses
- **Broker state** — current VRAM owner, per-backend request counts (GPU vs passthrough), swap history
- **Active GPU requests** — live list of in-flight requests that are holding VRAM, with elapsed time
- **Queue** — any requests waiting for a VRAM swap

Options:

```bash
# Custom status URL and refresh interval (ms)
onegpu4all-status http://localhost:5102 1000
```

### Quick access

Add an alias to your shell profile (`~/.bashrc` or `~/.zshrc`):

```bash
# Add to ~/.bashrc or ~/.zshrc
alias gpu='node /path/to/onegpu4all/bin/onegpu4all-status.mjs'
```

Then just run `gpu` from anywhere to monitor your broker.

If installed globally via npm:

```bash
alias gpu='onegpu4all-status'
```

Reload your shell (`source ~/.bashrc`) and you're set.

## Running as a Service

### systemd

```bash
sudo cp examples/onegpu4all.service /etc/systemd/system/
sudo systemctl edit onegpu4all  # set User, WorkingDirectory, config path
sudo systemctl enable --now onegpu4all
```

### Docker Compose

See `examples/docker-compose.yml` for a complete Ollama + ComfyUI + OneGPU4All stack.

## How It Works

OneGPU4All is a reverse proxy with a mutex. Each backend gets its own proxy port. All traffic passes through transparently with near-zero overhead.

### Smart routing

Not every request needs the GPU. OneGPU4All distinguishes between:

- **GPU requests** — endpoints that actually run inference (e.g., `/api/generate`, `/v1/chat/completions`, `/prompt`). These acquire VRAM ownership and trigger swaps.
- **Passthrough requests** — everything else (UI assets, status polls, model lists). These are proxied instantly without touching the VRAM manager.

This means ComfyUI's browser tab can stay open and poll for job status without blocking Ollama, and vice versa.

### VRAM swap sequence

1. **Acquire** — A GPU request arrives. If this backend already owns VRAM, pass through immediately. If another backend owns it, join the queue.
2. **Drain** — Wait for the current owner to finish all active GPU requests.
3. **Unload** — Call the owner's unload strategy (e.g., tell Ollama to drop models). All unload calls have a 10-second timeout to prevent hangs.
4. **Transfer** — Mark the new backend as VRAM owner and forward the queued request.
5. **Release** — When the response completes, decrement the active count.

### Startup probe

When the broker starts (or restarts), it doesn't know which backends are holding VRAM from before. On the first GPU request, it proactively frees all other backends before forwarding — so you never get OOM from stale VRAM.

### Timeouts

- **Unload calls**: 10-second timeout per backend. If a backend is unresponsive, the swap continues anyway (better than deadlocking).
- **Queue wait**: 2-minute timeout. If a request waits longer than that for VRAM, it receives a 503 error instead of hanging forever.

The swap adds a few seconds of latency (time to unload + load models), but only on the first request after a backend switch. Subsequent requests to the same backend pass through instantly.

## FAQ

**Q: Does this add latency to every request?**
No. The proxy overhead is ~1ms. Latency only occurs during a VRAM swap (typically 5-15 seconds depending on model size).

**Q: Can I use more than two backends?**
Yes. Add as many as you need — VRAM ownership is exclusive to one at a time, but you can have N backends configured.

**Q: What if a backend doesn't have an unload API?**
Use the `generic` strategy with no `unloadEndpoint`. OneGPU4All will still queue requests, but the backend will need to handle VRAM pressure on its own (or you may get OOM on swap).

**Q: Does this work with multiple GPUs?**
Not yet — it's designed for single-GPU machines. Multi-GPU support (pinning backends to specific GPUs) is a potential future feature.

## Requirements

- Node.js >= 18
- Your GPU backends running independently (Ollama, ComfyUI, etc.)

## License

MIT
