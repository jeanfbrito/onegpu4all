#!/usr/bin/env node

import { loadConfig, generateConfig } from "../src/config.mjs";
import { startBroker } from "../src/broker.mjs";
import * as log from "../src/logger.mjs";

const args = process.argv.slice(2);

// --help
if (args.includes("--help") || args.includes("-h")) {
  console.log(`
OneGPU4All — One GPU, many services. Zero conflicts.

Usage:
  onegpu4all                        Start with ./onegpu4all.yaml or env vars
  onegpu4all --config <path>        Start with a specific config file
  onegpu4all --init                 Generate an example config file
  onegpu4all --help                 Show this help

Environment variables (fallback when no config file):
  OLLAMA_UPSTREAM          Ollama URL (e.g. http://localhost:11434)
  COMFYUI_UPSTREAM         ComfyUI URL (e.g. http://localhost:8188)
  BROKER_OLLAMA_PORT       Proxy port for Ollama (default: 5001)
  BROKER_COMFYUI_PORT      Proxy port for ComfyUI (default: 5101)
  BROKER_STATUS_PORT       Status API port (default: 5102)
`);
  process.exit(0);
}

// --init
if (args.includes("--init")) {
  generateConfig();
  process.exit(0);
}

// --config <path>
let configPath = null;
const configIdx = args.indexOf("--config");
if (configIdx !== -1) {
  configPath = args[configIdx + 1];
  if (!configPath) {
    console.error("Missing path after --config");
    process.exit(1);
  }
}

const config = loadConfig(configPath);

log.info("OneGPU4All starting...");
log.info(`Backends: ${config.backends.map((b) => b.name).join(", ")}`);

startBroker(config);
