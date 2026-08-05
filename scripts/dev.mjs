import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const root = path.resolve(__dirname, "..");

const backendPort = process.env.BACKEND_PORT ?? "8081";
const frontendPort = process.env.FRONTEND_PORT ?? "5173";
const backendWatch = process.env.BACKEND_WATCH === "1";
const apiTarget =
  process.env.VITE_API_PROXY_TARGET ?? `http://localhost:${backendPort}`;
const mediaDir = process.env.MEDIA_DIR ?? path.join(root, "media");
const exportDir = process.env.EXPORT_DIR ?? path.join(root, "export");
const configDir = process.env.CONFIG_DIR ?? path.join(root, "config");

const children = [];
let shuttingDown = false;

function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.unref();

    server.once("error", (err) => {
      if (err && err.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      resolve(false);
    });

    server.listen({ host: "0.0.0.0", port }, () => {
      server.close(() => resolve(true));
    });
  });
}

function run(name, cwd, args, env = {}) {
  const child = spawn("yarn", args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: "inherit",
  });

  child.on("exit", (code, signal) => {
    if (shuttingDown) return;
    shuttingDown = true;
    const reason = signal ? `signal ${signal}` : `code ${code}`;
    console.error(
      `[dev] ${name} exited with ${reason}; stopping the other process.`,
    );
    for (const c of children) {
      if (c !== child && !c.killed) c.kill("SIGTERM");
    }
    process.exit(code ?? 1);
  });

  children.push(child);
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  for (const child of children) {
    if (!child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(0), 100).unref();
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

mkdirSync(mediaDir, { recursive: true });
mkdirSync(exportDir, { recursive: true });
mkdirSync(configDir, { recursive: true });

console.log(`[dev] starting backend on :${backendPort}`);
console.log(
  `[dev] backend mode: ${backendWatch ? "watch (restarts on backend edits)" : "stable (no backend auto-restart)"}`,
);
console.log(
  `[dev] starting frontend on :${frontendPort} (proxy /api -> ${apiTarget})`,
);
console.log("[dev] press Ctrl+C to stop both processes");

const backendPortNum = Number.parseInt(backendPort, 10);
if (
  !Number.isFinite(backendPortNum) ||
  backendPortNum < 1 ||
  backendPortNum > 65535
) {
  console.error(`[dev] invalid BACKEND_PORT: ${backendPort}`);
  process.exit(1);
}

const backendPortAvailable = await isPortAvailable(backendPortNum);
if (!backendPortAvailable) {
  console.log(
    `[dev] backend port ${backendPort} is already in use; reusing existing backend process`,
  );
} else {
  run(
    "backend",
    path.join(root, "backend"),
    [backendWatch ? "dev:watch" : "dev"],
    {
      ADMIN_PORT: backendPort,
      MEDIA_DIR: mediaDir,
      EXPORT_DIR: exportDir,
      CONFIG_DIR: configDir,
    },
  );
}

run(
  "frontend",
  path.join(root, "frontend"),
  ["dev", "--port", frontendPort, "--host", "0.0.0.0"],
  {
    VITE_API_PROXY_TARGET: apiTarget,
  },
);
