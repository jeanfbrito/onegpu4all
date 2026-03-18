import { describe, it, beforeEach } from "node:test";
import assert from "node:assert/strict";
import { VRAMManager } from "../src/vram-manager.mjs";

const noopStrategy = { unload: async () => {} };

function makeBackend(name) {
  return { name, upstream: `http://localhost:0`, proxyPort: 0 };
}

describe("VRAMManager", () => {
  let manager;

  beforeEach(() => {
    manager = new VRAMManager();
    manager.registerBackend(makeBackend("a"), noopStrategy);
    manager.registerBackend(makeBackend("b"), noopStrategy);
  });

  it("assigns ownership to first acquirer", async () => {
    await manager.acquire("a");
    assert.equal(manager.owner, "a");
    assert.equal(manager.active.a, 1);
  });

  it("allows multiple concurrent requests to the same backend", async () => {
    await manager.acquire("a");
    await manager.acquire("a");
    assert.equal(manager.active.a, 2);
  });

  it("swaps ownership when current owner is idle", async () => {
    await manager.acquire("a");
    manager.release("a");
    await manager.acquire("b");
    assert.equal(manager.owner, "b");
    assert.equal(manager.active.b, 1);
    assert.equal(manager.swapCount, 1);
  });

  it("queues requests when owner has active requests", async () => {
    await manager.acquire("a");
    const bPromise = manager.acquire("b");
    assert.equal(manager.queue.length, 1);
    manager.release("a");
    await bPromise;
    assert.equal(manager.owner, "b");
    assert.equal(manager.queue.length, 0);
  });

  it("tracks request counts correctly", async () => {
    await manager.acquire("a");
    await manager.acquire("a");
    manager.release("a");
    manager.release("a");
    assert.equal(manager.requestCounts.a, 2);
    assert.equal(manager.active.a, 0);
  });

  it("release never goes below zero", () => {
    manager.release("a");
    manager.release("a");
    assert.equal(manager.active.a, 0);
  });

  it("calls unload strategy on swap", async () => {
    let unloadCalled = false;
    const trackingStrategy = {
      unload: async () => { unloadCalled = true; },
    };
    manager.strategies.a = trackingStrategy;

    await manager.acquire("a");
    manager.release("a");
    await manager.acquire("b");

    assert.equal(unloadCalled, true);
  });

  it("continues swap even if unload fails", async () => {
    manager.strategies.a = {
      unload: async () => { throw new Error("backend down"); },
    };

    await manager.acquire("a");
    manager.release("a");
    await manager.acquire("b");

    assert.equal(manager.owner, "b");
    assert.equal(manager.swapCount, 1);
  });

  it("status returns correct shape", () => {
    const status = manager.status();
    assert.ok("vramOwner" in status);
    assert.ok("activeRequests" in status);
    assert.ok("queueLength" in status);
    assert.ok("swapCount" in status);
    assert.ok("gpuRequests" in status);
    assert.ok("passthroughRequests" in status);
    assert.ok("liveRequests" in status);
  });

  it("tracks active request list", async () => {
    await manager.acquire("a");
    const info = { method: "POST", url: "/api/generate", backend: "a" };
    manager.addActiveRequest(info);
    assert.equal(manager.status().liveRequests.length, 1);
    manager.removeActiveRequest(info);
    assert.equal(manager.status().liveRequests.length, 0);
  });

  it("tracks passthrough counts", () => {
    manager.trackPassthrough("a");
    manager.trackPassthrough("a");
    manager.trackPassthrough("b");
    assert.equal(manager.passthroughCounts.a, 2);
    assert.equal(manager.passthroughCounts.b, 1);
  });

  it("drains multiple queued requests for the same backend", async () => {
    await manager.acquire("a");

    const p1 = manager.acquire("b");
    const p2 = manager.acquire("b");
    assert.equal(manager.queue.length, 2);

    manager.release("a");
    await Promise.all([p1, p2]);

    assert.equal(manager.owner, "b");
    assert.equal(manager.active.b, 2);
    assert.equal(manager.queue.length, 0);
  });
});
