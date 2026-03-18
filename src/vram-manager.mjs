import * as log from "./logger.mjs";

const ACQUIRE_TIMEOUT_MS = 120_000; // 2 minutes max wait in queue
const SWAP_SETTLE_MS = 1000;        // pause after unload to let VRAM free

/**
 * VRAMManager — exclusive GPU ownership with request queuing.
 *
 * Only one backend may own VRAM at a time. When a competing backend
 * needs access, existing requests are drained, the current owner is
 * unloaded, and ownership transfers to the new backend.
 */
export class VRAMManager {
  constructor() {
    this.owner = null;
    this.active = {};       // { backendName: count }
    this.queue = [];        // { backendName, resolve, reject }
    this.swapping = false;
    this.strategies = {};   // { backendName: { unload(backend) } }
    this.backends = {};     // { backendName: backendConfig }

    // Stats
    this.swapCount = 0;
    this.lastSwapAt = null;
    this.requestCounts = {};    // { backendName: total GPU requests }
    this.passthroughCounts = {}; // { backendName: total passthrough requests }

    // Live request tracking
    this.activeRequestList = []; // [{ method, url, startedAt, backend }]
  }

  registerBackend(backend, strategy) {
    this.active[backend.name] = 0;
    this.requestCounts[backend.name] = 0;
    this.passthroughCounts[backend.name] = 0;
    this.strategies[backend.name] = strategy;
    this.backends[backend.name] = backend;
  }

  async acquire(backendName) {
    this.requestCounts[backendName]++;

    // First GPU request after startup — free all other backends just in case
    // they hold VRAM from before the broker started.
    if (this.owner === null && !this.swapping) {
      this.swapping = true;
      for (const [name, strategy] of Object.entries(this.strategies)) {
        if (name !== backendName) {
          try {
            await strategy.unload(this.backends[name]);
          } catch { /* best effort */ }
        }
      }
      await new Promise((r) => setTimeout(r, SWAP_SETTLE_MS));
      this.owner = backendName;
      this.active[backendName]++;
      this.swapping = false;
      return;
    }

    // Same owner — pass through
    if (!this.swapping && this.owner === backendName) {
      this.active[backendName]++;
      return;
    }

    // Different owner or currently swapping — queue with timeout
    if (this.active[this.owner] > 0 || this.swapping) {
      await this._queueWithTimeout(backendName);
      return;
    }

    // Owner is idle — swap now
    await this._performSwap(backendName);
  }

  async _queueWithTimeout(backendName) {
    return new Promise((resolve, reject) => {
      const entry = { backendName, resolve, reject };
      const timer = setTimeout(() => {
        const idx = this.queue.indexOf(entry);
        if (idx !== -1) this.queue.splice(idx, 1);
        reject(new Error(`Acquire timeout after ${ACQUIRE_TIMEOUT_MS / 1000}s waiting for VRAM`));
      }, ACQUIRE_TIMEOUT_MS);

      entry.timer = timer;
      this.queue.push(entry);
    });
  }

  release(backendName) {
    this.active[backendName] = Math.max(0, this.active[backendName] - 1);

    // Process queue when current owner finishes all requests
    if (this.active[backendName] === 0 && this.queue.length > 0) {
      const next = this.queue[0].backendName;
      this._drainQueue(next);
    }
  }

  addActiveRequest(info) {
    this.activeRequestList.push(info);
  }

  removeActiveRequest(info) {
    const idx = this.activeRequestList.indexOf(info);
    if (idx !== -1) {
      this.activeRequestList.splice(idx, 1);
    } else {
      log.warn("Tried to remove unknown active request", info.backend);
    }
  }

  trackPassthrough(backendName) {
    this.passthroughCounts[backendName]++;
  }

  async _performSwap(toBackend) {
    this.swapping = true;
    const from = this.owner;

    log.swap(from, toBackend);

    if (from && this.strategies[from]) {
      try {
        await this.strategies[from].unload(this.backends[from]);
      } catch (err) {
        log.error(`Unload failed: ${err.message}`, from);
        // Continue with swap — backend may have partially freed VRAM.
        // Better to attempt the new load than to deadlock.
      }
    }

    // Brief pause to let VRAM actually free
    await new Promise((r) => setTimeout(r, SWAP_SETTLE_MS));

    this.owner = toBackend;
    this.active[toBackend]++;
    this.swapping = false;
    this.swapCount++;
    this.lastSwapAt = new Date().toISOString();
  }

  async _drainQueue(forBackend) {
    await this._performSwap(forBackend);

    const toRelease = [];
    let i = 0;
    while (i < this.queue.length) {
      if (this.queue[i].backendName === forBackend) {
        const entry = this.queue.splice(i, 1)[0];
        clearTimeout(entry.timer);
        toRelease.push(entry);
      } else {
        i++;
      }
    }

    // First was counted in _performSwap, add the rest
    for (let j = 1; j < toRelease.length; j++) {
      this.active[forBackend]++;
    }

    for (const item of toRelease) {
      item.resolve();
    }
  }

  status() {
    return {
      vramOwner: this.owner,
      activeRequests: { ...this.active },
      queueLength: this.queue.length,
      queuedBackends: this.queue.map((q) => q.backendName),
      gpuRequests: { ...this.requestCounts },
      passthroughRequests: { ...this.passthroughCounts },
      swapCount: this.swapCount,
      lastSwapAt: this.lastSwapAt,
      liveRequests: this.activeRequestList.map((r) => ({ ...r })),
    };
  }
}
