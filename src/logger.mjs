const isTTY = process.stdout.isTTY;

const colors = {
  reset: "\x1b[0m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  cyan: "\x1b[36m",
  green: "\x1b[32m",
};

function c(color, text) {
  return isTTY ? `${color}${text}${colors.reset}` : text;
}

function ts() {
  return new Date().toISOString().replace("T", " ").slice(0, 19);
}

export function info(msg, backend) {
  const tag = backend ? `[${backend}]` : "";
  console.log(`${c(colors.dim, ts())} ${c(colors.cyan, "INFO")} ${tag} ${msg}`);
}

export function warn(msg, backend) {
  const tag = backend ? `[${backend}]` : "";
  console.log(`${c(colors.dim, ts())} ${c(colors.yellow, "WARN")} ${tag} ${msg}`);
}

export function error(msg, backend) {
  const tag = backend ? `[${backend}]` : "";
  console.error(`${c(colors.dim, ts())} ${c(colors.red, "ERR ")} ${tag} ${msg}`);
}

export function swap(from, to) {
  console.log(
    `${c(colors.dim, ts())} ${c(colors.green, "SWAP")} ${from || "none"} → ${to}`
  );
}
