import { createHash } from "node:crypto";
import {
  getCurrentUser,
  loginAdmin,
  loginBuddy,
  loginCustomer,
  refreshToken,
} from "../controllers/auth/auth.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

const TOO_MANY_ATTEMPTS = "Too many sign-in attempts. Please try again later.";
const MAX_TRACKED_KEYS = 10_000;

const attemptIdentifier = (body = {}) => {
  if (typeof body.email === "string") return `email:${body.email.trim().toLowerCase()}`;
  if (typeof body.phone === "string") return `phone:${body.phone.replace(/\s+/g, "")}`;
  if (typeof body.refreshToken === "string") {
    return `refresh:${createHash("sha256").update(body.refreshToken).digest("hex")}`;
  }
  return null;
};

// Fixed-window, in-process counters: per IP + identifier (no shared-NAT lockout) and
// per identifier across all IPs (no distributed hammering of one account).
const createAttemptLimiter = ({ max, identifierMax, timeWindow }) => {
  const windows = new Map();
  const hit = (key, limit, now) => {
    let entry = windows.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + timeWindow };
      windows.set(key, entry);
    }
    entry.count += 1;
    return entry.count > limit ? entry.resetAt - now : 0;
  };
  return async (request, reply) => {
    const now = Date.now();
    if (windows.size > MAX_TRACKED_KEYS) {
      for (const [key, entry] of windows) if (entry.resetAt <= now) windows.delete(key);
    }
    const identifier = attemptIdentifier(request.body ?? {}) ?? "none";
    const waitMs = Math.max(
      hit(`ip:${request.ip}|${identifier}`, max, now),
      identifier === "none" ? 0 : hit(`id:${identifier}`, identifierMax, now)
    );
    if (!waitMs) return;
    return reply
      .code(429)
      .header("retry-after", Math.ceil(waitMs / 1000))
      .send({ message: TOO_MANY_ATTEMPTS });
  };
};

export default async function authRoutes(fastify, { attemptLimit } = {}) {
  const limited = { preHandler: [createAttemptLimiter(attemptLimit)] };
  fastify.post("/auth/login", limited, loginCustomer);
  fastify.post("/auth/customer/login", limited, loginCustomer);
  fastify.post("/auth/buddy/login", limited, loginBuddy);
  fastify.post("/auth/login-delivery-partner", limited, loginBuddy);
  fastify.post("/auth/admin/login", limited, loginAdmin);
  fastify.post("/auth/refresh", limited, refreshToken);
  fastify.get("/auth/me", { preValidation: [requireAuth] }, getCurrentUser);
  fastify.patch(
    "/auth/me",
    { preValidation: [requireRole("Customer")] },
    async (request, reply) => {
      const allowed = {};
      for (const field of ["name", "address", "liveLocation", "savedLocations"]) {
        if (Object.hasOwn(request.body || {}, field)) allowed[field] = request.body[field];
      }
      try {
        const customer = await request.user.account.constructor.findByIdAndUpdate(
          request.user.id,
          { $set: allowed },
          { new: true, runValidators: true }
        );
        if (!customer) return reply.code(404).send({ message: "Customer not found." });
        const user = customer.toObject();
        delete user.__v;
        return reply.send({ user });
      } catch (error) {
        if (error.name === "ValidationError") {
          return reply.code(400).send({ message: "Invalid profile data." });
        }
        request.log.error(error);
        return reply.code(500).send({ message: "Unable to update profile." });
      }
    }
  );
}
