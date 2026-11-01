// Starts the API and the storefront together for the local demo. One Ctrl-C stops both.
// Demo settings are fixed here so the run does not depend on hand-made .env files.
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { createInterface } from "node:readline";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const apiPort = process.env.DEMO_API_PORT || "3000";
const webPort = process.env.DEMO_WEB_PORT || "5173";
const apiUrl = `http://localhost:${apiPort}`;
const colour = process.stdout.isTTY ? { api: "\x1b[36m", web: "\x1b[35m", reset: "\x1b[0m" } : { api: "", web: "", reset: "" };

const services = [
  {
    name: "api",
    cwd: join(root, "sns_backend", "sns_server"),
    args: ["run", "dev"],
    env: {
      NODE_ENV: "development",
      PORT: apiPort,
      MONGO_URI: process.env.DEMO_MONGO_URI || "mongodb://127.0.0.1:27017/buddyyaa",
      CUSTOMER_DEV_LOGIN: "true",
      CLIENT_ORIGIN: `http://localhost:${webPort},http://127.0.0.1:${webPort}`,
    },
  },
  {
    name: "web",
    cwd: join(root, "sns_frontend", "frontend"),
    args: ["run", "dev", "--", "--port", webPort, "--strictPort"],
    env: { VITE_API_BASE_URL: apiUrl, VITE_ADMIN_PANEL_URL: `${apiUrl}/admin` },
  },
];

const children = [];
let stopping = false;
const isWindows = process.platform === "win32";

// npm, nodemon and vite each spawn their own children, so signal the whole process tree.
const stopTree = (child) => {
  if (isWindows) {
    spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], { stdio: "ignore" });
    return;
  }
  try {
    process.kill(-child.pid, "SIGTERM");
  } catch {
    // The process group has already exited.
  }
};

const stopAll = (exitCode = 0) => {
  if (stopping) return;
  stopping = true;
  for (const child of children) stopTree(child);
  process.exitCode = exitCode;
};

for (const service of services) {
  const child = spawn("npm", service.args, {
    cwd: service.cwd,
    env: { ...process.env, ...service.env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    detached: !isWindows,
  });
  const prefix = `${colour[service.name]}[${service.name}]${colour.reset} `;
  for (const stream of [child.stdout, child.stderr]) {
    createInterface({ input: stream }).on("line", (line) => process.stdout.write(`${prefix}${line}\n`));
  }
  child.on("exit", (code, signal) => {
    if (!stopping) {
      process.stdout.write(`${prefix}exited (${signal ?? code}); stopping the other service.\n`);
      stopAll(code || 1);
    }
  });
  children.push(child);
}

process.stdout.write(`Buddyyaa demo: storefront http://localhost:${webPort}  ·  API ${apiUrl}  ·  admin ${apiUrl}/admin\n`);
process.on("SIGINT", () => stopAll(0));
process.on("SIGTERM", () => stopAll(0));
