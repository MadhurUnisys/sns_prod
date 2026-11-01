import "dotenv/config";
import Fastify from "fastify";
import rateLimit from "@fastify/rate-limit";
import { Server as SocketIOServer } from "socket.io";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { connectDB, disconnectDB, getMongoStatus } from "./src/config/connect.js";
import {
  HOST,
  PORT,
  validateRuntimeConfig,
  isProductionEnvironment,
} from "./src/config/config.js";
import { registerAdminPanel, setAdminRealtimeServer } from "./src/config/admin.js";
import authRoutes, { createAttemptLimiter } from "./src/routes/auth.js";
import productRoutes from "./src/routes/products.js";
import orderRoutes from "./src/routes/order.js";
import buddyRoutes from "./src/routes/buddy.js";
import adminRoutes from "./src/routes/admin.js";
import { attachRealtimeHandlers } from "./src/realtime/socket.js";
import { recoverIncompleteOrderReservations } from "./src/services/order-lifecycle.js";
import { recoverPendingOrderAssignments } from "./src/services/order-assignment.js";

const currentFile = fileURLToPath(import.meta.url);

const positiveIntegerFromEnv = (name, fallback) => {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
};

// TRUST_PROXY: unset/"false" = use the TCP peer; "true" = trust any X-Forwarded-For (spoofable);
// a hop count such as "1"; or a comma-separated list of proxy IPs/CIDRs.
export const parseTrustProxy = (value = "") => {
  const setting = value.trim();
  if (!setting || setting === "false") return false;
  if (setting === "true") return true;
  if (/^\d+$/.test(setting)) return Number(setting);
  return setting;
};

export const createLoggerOptions = ({ production = isProductionEnvironment, stream } = {}) => ({
  level: process.env.LOG_LEVEL || (production ? "info" : "debug"),
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "req.body.password",
    "req.body.refreshToken",
  ],
  ...(stream ? { stream } : {}),
});

export const buildApp = async ({ mongoUri, connectDatabase = true, logStream } = {}) => {
  validateRuntimeConfig();
  if (connectDatabase) await connectDB(mongoUri);
  if (getMongoStatus().connected) {
    await recoverIncompleteOrderReservations();
    await recoverPendingOrderAssignments();
  }

  const app = Fastify({
    logger: createLoggerOptions({ stream: logStream }),
    trustProxy: parseTrustProxy(process.env.TRUST_PROXY),
  });
  app.decorateRequest("user", null);

  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);
    if (error.validation) {
      return reply.code(400).send({
        message: "Request validation failed.",
        details: error.validation,
      });
    }
    return reply.code(error.statusCode && error.statusCode < 500 ? error.statusCode : 500).send({
      message: error.statusCode && error.statusCode < 500
        ? error.message
        : "Internal server error.",
    });
  });

  app.get("/", async () => ({
    name: "Buddyyaa API",
    version: "1.0.0",
    documentation: "See README.md and API.md for routes and setup.",
    health: "/health",
    readiness: "/ready",
  }));
  app.get("/health", async () => ({
    status: "ok",
    service: "buddyyaa-api",
    database: { connected: getMongoStatus().connected },
  }));
  app.get("/ready", async (_request, reply) => {
    const database = getMongoStatus();
    if (!database.connected) {
      return reply.code(503).send({ status: "not_ready", database: { connected: false } });
    }
    return { status: "ready", database: { connected: true } };
  });

  const allowedOrigins = process.env.CLIENT_ORIGIN
    ?.split(",")
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.addHook("onRequest", async (request, reply) => {
    const origin = request.headers.origin;
    if (!origin || !allowedOrigins?.includes(origin)) return;
    reply
      .header("Access-Control-Allow-Origin", origin)
      .header("Access-Control-Allow-Credentials", "true")
      .header("Access-Control-Allow-Methods", "GET,POST,PATCH,PUT,DELETE,OPTIONS")
      .header("Access-Control-Allow-Headers", "Accept,Authorization,Content-Type,Idempotency-Key")
      .header("Vary", "Origin");
    if (request.method === "OPTIONS") return reply.code(204).send();
  });
  app.options("/*", async (request, reply) => {
    if (!allowedOrigins?.includes(request.headers.origin)) {
      return reply.code(403).send({ message: "Origin is not allowed." });
    }
    return reply.code(204).send();
  });
  const realtimeServer = new SocketIOServer(app.server, {
    cors: {
      origin: allowedOrigins?.length ? allowedOrigins : false,
      credentials: true,
    },
  });
  app.decorate("io", realtimeServer);
  app.addHook("onClose", async () => {
    await new Promise((resolve, reject) => {
      realtimeServer.close((error) => {
        if (error && error.code !== "ERR_SERVER_NOT_RUNNING") return reject(error);
        return resolve();
      });
    });
  });

  const attemptLimiter = createAttemptLimiter({
    max: positiveIntegerFromEnv("AUTH_RATE_LIMIT_MAX", 5),
    identifierMax: positiveIntegerFromEnv("AUTH_IDENTIFIER_RATE_LIMIT_MAX", 20),
    timeWindow: positiveIntegerFromEnv("AUTH_RATE_LIMIT_WINDOW_MS", 15 * 60_000),
  });
  await registerAdminPanel(app, { attemptLimiter });
  await app.register(rateLimit, {
    global: true,
    max: positiveIntegerFromEnv("RATE_LIMIT_MAX", 100),
    timeWindow: positiveIntegerFromEnv("RATE_LIMIT_WINDOW_MS", 60_000),
  });
  app.register(authRoutes, { attemptLimiter });
  app.register(productRoutes);
  app.register(orderRoutes);
  app.register(buddyRoutes);
  app.register(adminRoutes);
  app.addHook("onClose", async () => {
    await disconnectDB();
  });

  await app.ready();
  attachRealtimeHandlers(app.io, {
    locationMinIntervalMs: positiveIntegerFromEnv("DELIVERY_LOCATION_MIN_INTERVAL_MS", 5_000),
  });
  setAdminRealtimeServer(app.io);

  if (!isProductionEnvironment) {
    app.log.info({ routes: app.printRoutes({ commonPrefix: false }) }, "Registered API routes");
  }
  return app;
};

export const start = async () => {
  const app = await buildApp();
  await app.listen({ port: PORT, host: HOST });
  app.log.info(`Buddyyaa API listening at http://${HOST}:${PORT}`);

  const shutdown = async (signal) => {
    app.log.info({ signal }, "Closing Buddyyaa API");
    await app.close();
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  return app;
};

const isDirectRun =
  process.argv[1] && resolve(process.argv[1]) === resolve(dirname(currentFile), "app.js");
if (isDirectRun) {
  start().catch((error) => {
    console.error("Buddyyaa API startup failed:", error.message);
    process.exitCode = 1;
  });
}
