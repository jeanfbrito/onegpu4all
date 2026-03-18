#!/usr/bin/env node

import { execSync } from "node:child_process";

const STATUS_URL = process.argv[2] || "http://localhost:5102";
const INTERVAL = parseInt(process.argv[3] || "2000", 10);

const c = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  red: "\x1b[31m",
  magenta: "\x1b[35m",
  white: "\x1b[37m",
};

function col(color, text) {
  return `${color}${text}${c.reset}`;
}

function bar(used, total, width = 30) {
  const pct = total > 0 ? used / total : 0;
  const filled = Math.round(pct * width);
  const empty = width - filled;
  const color = pct > 0.9 ? c.red : pct > 0.7 ? c.yellow : c.green;
  return `${color}${"█".repeat(filled)}${c.dim}${"░".repeat(empty)}${c.reset} ${(pct * 100).toFixed(1)}%`;
}

function formatUptime(seconds) {
  const d = Math.floor(seconds / 86400);
  const h = Math.floor((seconds % 86400) / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = seconds % 60;
  if (d > 0) return `${d}d ${h}h ${m}m`;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function timeAgo(iso) {
  if (!iso) return "never";
  const diff = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ${diff % 60}s ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

function getGpu() {
  try {
    const out = execSync(
      "nvidia-smi --query-gpu=memory.used,memory.total,utilization.gpu,temperature.gpu,power.draw,power.limit,fan.speed,name,clocks.current.graphics,clocks.current.memory --format=csv,noheader,nounits",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    const parts = out.split(", ").map((s) => s.trim());
    return {
      memUsed: parseInt(parts[0]),
      memTotal: parseInt(parts[1]),
      gpuUtil: parseInt(parts[2]),
      temp: parseInt(parts[3]),
      powerDraw: parseFloat(parts[4]),
      powerLimit: parseFloat(parts[5]),
      fanSpeed: parseInt(parts[6]),
      name: parts[7],
      clockGpu: parseInt(parts[8]),
      clockMem: parseInt(parts[9]),
    };
  } catch {
    return null;
  }
}

function getGpuProcesses() {
  try {
    const out = execSync(
      "nvidia-smi --query-compute-apps=pid,used_memory,process_name --format=csv,noheader,nounits",
      { encoding: "utf-8", timeout: 3000 }
    ).trim();
    if (!out) return [];
    return out.split("\n").map((line) => {
      const parts = line.split(", ").map((s) => s.trim());
      return {
        pid: parts[0],
        mem: parseInt(parts[1]),
        name: parts[2].split("/").pop(),
      };
    });
  } catch {
    return [];
  }
}

async function tick() {
  let status;
  try {
    const res = await fetch(STATUS_URL);
    status = await res.json();
  } catch {
    console.clear();
    console.log(col(c.red, `\n  Cannot connect to OneGPU4All at ${STATUS_URL}\n`));
    return;
  }

  const gpu = getGpu();
  const procs = getGpuProcesses();

  console.clear();
  console.log(col(c.bold, "\n  OneGPU4All") + col(c.dim, " — Live Monitor\n"));

  // ─── GPU ────────────────────────────────────────
  if (gpu) {
    console.log(col(c.dim, "  ─── GPU ───────────────────────────────────────────────────"));
    console.log(`  ${col(c.bold + c.white, gpu.name)}`);
    console.log();
    console.log(`  VRAM   ${bar(gpu.memUsed, gpu.memTotal)}   ${col(c.white, `${gpu.memUsed}`)}${col(c.dim, ` / ${gpu.memTotal} MiB`)}`);
    console.log(`  Load   ${bar(gpu.gpuUtil, 100, 15)}`);
    console.log(`  Power  ${bar(gpu.powerDraw, gpu.powerLimit, 15)}   ${gpu.powerDraw.toFixed(0)}W / ${gpu.powerLimit.toFixed(0)}W`);
    console.log();
    console.log(
      `  Temp ${col(gpu.temp > 80 ? c.red : gpu.temp > 65 ? c.yellow : c.green, `${gpu.temp}°C`)}` +
      `   Fan ${col(c.white, `${gpu.fanSpeed}%`)}` +
      `   Clock ${col(c.white, `${gpu.clockGpu}`)}${col(c.dim, "MHz gpu")}` +
      ` ${col(c.white, `${gpu.clockMem}`)}${col(c.dim, "MHz mem")}`
    );

    if (procs.length > 0) {
      console.log();
      console.log(col(c.dim, "  Processes on GPU:"));
      for (const p of procs) {
        const memBar = bar(p.mem, gpu.memTotal, 10);
        console.log(
          `    ${col(c.dim, `PID ${p.pid.padStart(7)}`)}  ${p.name.padEnd(20)}  ${memBar}  ${col(c.yellow, `${p.mem} MiB`)}`
        );
      }
    }
  } else {
    console.log(col(c.dim, "  ─── GPU ───────────────────────────────────────────────────"));
    console.log(col(c.yellow, "  nvidia-smi not available"));
  }

  // ─── Broker ─────────────────────────────────────
  console.log();
  console.log(col(c.dim, "  ─── Broker ────────────────────────────────────────────────"));

  const ownerText = status.vramOwner
    ? col(c.bold + c.green, ` ${status.vramOwner.toUpperCase()} `)
    : col(c.dim, "none");

  console.log(
    `  VRAM Owner  ${ownerText}` +
    `    Uptime ${col(c.dim, formatUptime(status.uptime))}` +
    `    Swaps ${col(c.cyan, String(status.swapCount))}` +
    ` ${col(c.dim, `(last: ${timeAgo(status.lastSwapAt)})`)}`
  );
  console.log();

  // Backend table
  const backendNames = Object.keys(status.activeRequests);
  console.log(
    col(c.dim, "  Backend".padEnd(17)) +
    col(c.dim, "Status".padEnd(14)) +
    col(c.dim, "GPU Reqs".padEnd(12)) +
    col(c.dim, "Passthrough")
  );
  console.log(col(c.dim, "  " + "─".repeat(55)));

  for (const name of backendNames) {
    const active = status.activeRequests[name];
    const gpuReqs = status.gpuRequests?.[name] || 0;
    const passReqs = status.passthroughRequests?.[name] || 0;
    const isOwner = status.vramOwner === name;
    const icon = isOwner ? col(c.green, "●") : col(c.dim, "○");
    const statusText = active > 0
      ? col(c.yellow, `${active} active`)
      : col(c.dim, "idle");

    console.log(
      `  ${icon} ${col(c.bold, name.padEnd(13))} ${statusText.padEnd(23)} ${String(gpuReqs).padEnd(12)} ${passReqs}`
    );
  }

  // Queue
  if (status.queueLength > 0) {
    console.log();
    console.log(
      `  ${col(c.yellow, "⏳ Queue:")} ${col(c.bold + c.yellow, String(status.queueLength))} waiting → ${status.queuedBackends.join(", ")}`
    );
  }

  // Live GPU requests
  const liveReqs = status.liveRequests || [];
  if (liveReqs.length > 0) {
    console.log();
    console.log(col(c.dim, "  ─── Active GPU Requests ───────────────────────────────────"));
    for (const req of liveReqs) {
      const elapsed = Math.floor((Date.now() - new Date(req.startedAt).getTime()) / 1000);
      console.log(
        `  ${col(c.cyan, req.backend.padEnd(10))} ${col(c.white, req.method.padEnd(5))} ${req.url.padEnd(35)} ${col(c.dim, `${elapsed}s`)}`
      );
    }
  }

  console.log(col(c.dim, `\n  Refreshing every ${INTERVAL / 1000}s — Ctrl+C to exit`));
}

tick();
setInterval(tick, INTERVAL);
