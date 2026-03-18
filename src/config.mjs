import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

const DEFAULT_CONFIG_NAME = "onegpu4all.yaml";

const EXAMPLE_CONFIG = `# OneGPU4All configuration
# Docs: https://github.com/onegpu4all/onegpu4all

statusPort: 5102

backends:
  - name: ollama
    proxyPort: 5001
    upstream: http://localhost:11434
    unloadStrategy: ollama

  - name: comfyui
    proxyPort: 5101
    upstream: http://localhost:8188
    unloadStrategy: comfyui
`;

/**
 * Minimal YAML parser — handles the flat + array-of-objects structure we need.
 * No external dependency required.
 */
function parseYaml(text) {
  const result = {};
  let currentArray = null;
  let currentObj = null;

  for (const raw of text.split("\n")) {
    const line = raw.replace(/#.*$/, "").trimEnd();
    if (!line.trim()) continue;

    // "backends:" — top-level key with no value → start an array
    const arrayStartMatch = line.match(/^(\w+):\s*$/);
    if (arrayStartMatch) {
      const [, key] = arrayStartMatch;
      result[key] = [];
      currentArray = key;
      currentObj = null;
      continue;
    }

    // "  - name: ollama" — array item (starts a new object)
    const arrayItemMatch = line.match(/^\s+-\s+(\w+):\s*(.+)?$/);
    if (arrayItemMatch) {
      const [, key, val] = arrayItemMatch;
      if (currentArray) {
        currentObj = { [key]: castValue(val) };
        result[currentArray].push(currentObj);
      }
      continue;
    }

    // "    proxyPort: 5001" — nested key inside an array object
    const nestedKvMatch = line.match(/^\s{2,}(\w+):\s*(.+)$/);
    if (nestedKvMatch && currentObj) {
      const [, key, val] = nestedKvMatch;
      currentObj[key] = castValue(val);
      continue;
    }

    // "statusPort: 5102" — top-level key: value
    const topKvMatch = line.match(/^(\w+):\s+(.+)$/);
    if (topKvMatch) {
      const [, key, val] = topKvMatch;
      currentArray = null;
      currentObj = null;
      result[key] = castValue(val);
      continue;
    }
  }

  return result;
}

function castValue(val) {
  if (val === undefined || val === null || val === "") return null;
  val = val.trim();
  // Strip surrounding quotes
  if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
    val = val.slice(1, -1);
  }
  if (val === "true") return true;
  if (val === "false") return false;
  const num = Number(val);
  if (!isNaN(num) && val !== "") return num;
  return val;
}

/**
 * Load configuration from YAML file.
 * Falls back to environment variables for simple setups.
 */
export function loadConfig(configPath) {
  if (configPath && existsSync(configPath)) {
    const raw = readFileSync(configPath, "utf-8");
    const parsed = parseYaml(raw);
    return validateConfig(parsed, configPath);
  }

  // Fallback: check default location
  const defaultPath = resolve(DEFAULT_CONFIG_NAME);
  if (existsSync(defaultPath)) {
    const raw = readFileSync(defaultPath, "utf-8");
    const parsed = parseYaml(raw);
    return validateConfig(parsed, defaultPath);
  }

  // Fallback: env vars (backward compatible with vram-broker)
  return buildConfigFromEnv();
}

function buildConfigFromEnv() {
  const backends = [];
  const env = process.env;

  if (env.OLLAMA_UPSTREAM) {
    backends.push({
      name: "ollama",
      proxyPort: parseInt(env.BROKER_OLLAMA_PORT || "5001", 10),
      upstream: env.OLLAMA_UPSTREAM,
      unloadStrategy: "ollama",
    });
  }

  if (env.COMFYUI_UPSTREAM) {
    backends.push({
      name: "comfyui",
      proxyPort: parseInt(env.BROKER_COMFYUI_PORT || "5101", 10),
      upstream: env.COMFYUI_UPSTREAM,
      unloadStrategy: "comfyui",
    });
  }

  if (backends.length === 0) {
    console.error(
      "No config file found and no environment variables set.\n" +
        "Run `onegpu4all --init` to generate a config file."
    );
    process.exit(1);
  }

  return {
    statusPort: parseInt(env.BROKER_STATUS_PORT || "5102", 10),
    backends,
  };
}

function validateConfig(config, source) {
  if (!config.backends || !Array.isArray(config.backends) || config.backends.length === 0) {
    console.error(`Config error (${source}): 'backends' must be a non-empty array.`);
    process.exit(1);
  }

  const ports = new Set();
  const names = new Set();

  for (const b of config.backends) {
    if (!b.name) {
      console.error(`Config error: each backend must have a 'name'.`);
      process.exit(1);
    }
    if (!b.upstream) {
      console.error(`Config error: backend '${b.name}' must have an 'upstream' URL.`);
      process.exit(1);
    }
    try {
      new URL(b.upstream);
    } catch {
      console.error(`Config error: backend '${b.name}' has invalid upstream URL: '${b.upstream}'`);
      process.exit(1);
    }
    if (!b.proxyPort || b.proxyPort < 1 || b.proxyPort > 65535) {
      console.error(`Config error: backend '${b.name}' must have a valid proxyPort (1-65535).`);
      process.exit(1);
    }
    if (names.has(b.name)) {
      console.error(`Config error: duplicate backend name '${b.name}'.`);
      process.exit(1);
    }
    if (ports.has(b.proxyPort)) {
      console.error(`Config error: duplicate proxyPort ${b.proxyPort}.`);
      process.exit(1);
    }
    names.add(b.name);
    ports.add(b.proxyPort);
    b.unloadStrategy = b.unloadStrategy || "generic";
  }

  config.statusPort = config.statusPort || 5102;
  return config;
}

export function generateConfig(outputPath) {
  const target = outputPath || DEFAULT_CONFIG_NAME;
  if (existsSync(target)) {
    console.error(`File already exists: ${target}`);
    process.exit(1);
  }
  writeFileSync(target, EXAMPLE_CONFIG, "utf-8");
  console.log(`Config written to ${target}`);
}
