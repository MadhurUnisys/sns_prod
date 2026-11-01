import bcrypt from "bcryptjs";
import AdminJS, { Router } from "adminjs";
import AdminJSMongoose from "@adminjs/mongoose";
import AdminJSFastify from "@adminjs/fastify";
import fastifyCookie from "@fastify/cookie";
import fastifyFormbody from "@fastify/formbody";
import fastifySession from "@fastify/session";
import AdminSession from "../models/admin-session.js";
import Category from "../models/category.js";
import Counter from "../models/counter.js";
import Inventory from "../models/inventory.js";
import FulfillmentIssue from "../models/fulfillment-issue.js";
import Order, { ORDER_STATUSES } from "../models/order.js";
import Product from "../models/products.js";
import { Admin, Buddy, Customer } from "../models/user.js";
import { authenticateAdmin } from "../controllers/auth/auth.js";
import { transitionOrder } from "../services/order-lifecycle.js";
import { assignOrderToBuddy } from "../services/order-assignment.js";
import { setBuddyStock, InventoryServiceError } from "../services/inventory.js";
import { ADMIN_SESSION_SECRET, isProductionEnvironment } from "./config.js";

const { buildRouter } = AdminJSFastify;

AdminJS.registerAdapter({
  Database: AdminJSMongoose.Database,
  Resource: AdminJSMongoose.Resource,
});

const adminSessionStore = {
  get(sid, callback) {
    AdminSession.findOne({ sid })
      .lean()
      .then(
        (row) => callback(null, row?.session || null),
        (error) => callback(error)
      );
  },
  set(sid, session, callback) {
    const expiresAt = session?.cookie?.expires
      ? new Date(session.cookie.expires)
      : new Date(Date.now() + (session?.cookie?.maxAge || 86_400_000));
    AdminSession.updateOne(
      { sid },
      { $set: { session, expiresAt } },
      { upsert: true }
    )
      .then(
        () => callback?.(null),
        (error) => callback?.(error)
      );
  },
  destroy(sid, callback) {
    AdminSession.deleteOne({ sid })
      .then(
        () => callback?.(null),
        (error) => callback?.(error)
      );
  },
  touch(sid, session, callback) {
    this.set(sid, session, callback);
  },
};

const readOnly = { new: false, edit: false, delete: false };
// Commission fields are select:false on Order, so load them explicitly for the records shown.
const withCommission = async (records = []) => {
  const rows = await Order.find({ _id: { $in: records.map((record) => record.id) } })
    .select("takeRatePercent commissionAmount")
    .lean();
  const byId = new Map(rows.map((row) => [String(row._id), row]));
  for (const record of records) {
    const row = byId.get(String(record.id));
    record.params.takeRatePercent = row?.takeRatePercent;
    record.params.commissionAmount = row?.commissionAmount;
  }
};
let realtimeServer;

const admin = new AdminJS({
  rootPath: "/admin",
  branding: { companyName: "Buddyyaa", withMadeWithLove: false },
  resources: [
    {
      resource: Admin,
      options: {
        properties: { passwordHash: { isVisible: false } },
        actions: readOnly,
      },
    },
    {
      resource: Customer,
      options: {
        properties: { phone: { isTitle: true } },
        actions: readOnly,
      },
    },
    {
      resource: Buddy,
      options: {
        properties: {
          email: { isTitle: true },
          passwordHash: {
            label: "Temporary password",
            type: "password",
            isVisible: { list: false, filter: false, show: false, edit: false, new: true },
          },
        },
        actions: {
          new: {
            before: async (request) => {
              const password = request.payload?.passwordHash;
              if (typeof password !== "string" || password.length < 12) {
                throw new Error("Buddy password must be at least 12 characters.");
              }
              request.payload.passwordHash = await bcrypt.hash(password, 12);
              request.payload.role = "Buddy";
              request.payload.isApproved = false;
              request.payload.isActive = false;
              return request;
            },
            after: async (response) => {
              if (response.record?.params) delete response.record.params.passwordHash;
              return response;
            },
          },
          edit: {
            before: async (request) => {
              if (request.payload) delete request.payload.passwordHash;
              return request;
            },
          },
          delete: false,
        },
      },
    },
    { resource: Category },
    { resource: Product },
    {
      resource: Inventory,
      options: {
        properties: { reservations: { isVisible: { list: false, filter: false, show: true, edit: false, new: false } } },
        actions: {
          new: false,
          edit: false,
          delete: false,
          setBuddyStock: {
            actionType: "resource",
            label: "Set Buddy stock",
            guard: "Set or update stock for one Buddy and product?",
            properties: {
              buddyId: { type: "string" },
              productId: { type: "string" },
              availableQuantity: { type: "number" },
              isActive: { type: "boolean" },
            },
            handler: async (request) => {
              try {
                await setBuddyStock(request.payload);
                return {
                  notice: { message: "Buddy inventory saved.", type: "success" },
                };
              } catch (error) {
                const statusMessage = error instanceof InventoryServiceError
                  ? error.message
                  : "Unable to save inventory.";
                return { notice: { message: statusMessage, type: "error" } };
              }
            },
          },
        },
      },
    },
    { resource: FulfillmentIssue, options: { actions: readOnly } },
    {
      resource: Order,
      options: {
        properties: {
          customer: { isVisible: { list: true, filter: true, show: true, edit: false, new: false } },
          buddy: { isVisible: { list: true, filter: true, show: true, edit: false, new: false } },
        },
        actions: {
          new: false,
          edit: false,
          delete: false,
          list: { after: async (response) => { await withCommission(response.records); return response; } },
          show: { after: async (response) => { if (response.record) await withCommission([response.record]); return response; } },
          updateOperationalStatus: {
            actionType: "record",
            label: "Update order status",
            guard: "Apply a valid Buddyyaa order status transition?",
            properties: {
              status: {
                type: "string",
                availableValues: ORDER_STATUSES.map((status) => ({ value: status, label: status })),
              },
            },
            handler: async (request, _response, context) => {
              try {
                const order = await transitionOrder({
                  orderId: context.record.id(),
                  status: request.payload?.status,
                  actorRole: "Admin",
                  actorId: context.currentAdmin?.id,
                });
                realtimeServer?.to(`order:${order._id}`).emit("order:status", { order });
                const record = await context.resource.findOne(String(order._id));
                return {
                  record: record.toJSON(context.currentAdmin),
                  notice: { message: "Order transition completed.", type: "success" },
                };
              } catch (error) {
                return {
                  record: context.record.toJSON(context.currentAdmin),
                  notice: { message: error.message, type: "error" },
                };
              }
            },
          },
          reassignToBuddy: {
            actionType: "record",
            label: "Reassign to Buddy",
            guard: "Reserve the new Buddy's stock and reassign this pending order?",
            properties: { buddyId: { type: "string" } },
            handler: async (request, _response, context) => {
              try {
                const order = await assignOrderToBuddy({
                  orderId: context.record.id(),
                  buddyId: request.payload?.buddyId,
                });
                realtimeServer?.to(`order:${order._id}`).emit("order:assignment", { order });
                const record = await context.resource.findOne(String(order._id));
                return {
                  record: record.toJSON(context.currentAdmin),
                  notice: { message: "Order reassigned.", type: "success" },
                };
              } catch (error) {
                return {
                  record: context.record.toJSON(context.currentAdmin),
                  notice: { message: error.message, type: "error" },
                };
              }
            },
          },
        },
      },
    },
    { resource: Counter, options: { actions: readOnly } },
  ],
});

export const registerAdminPanel = async (fastify, { attemptLimiter } = {}) => {
  if (!ADMIN_SESSION_SECRET || ADMIN_SESSION_SECRET.length < 32) {
    throw new Error("ADMIN_SESSION_SECRET must be at least 32 characters.");
  }

  await fastify.register(fastifyCookie, { secret: ADMIN_SESSION_SECRET });
  await fastify.register(fastifySession, {
    secret: ADMIN_SESSION_SECRET,
    cookieName: "buddyyaa-admin",
    store: adminSessionStore,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isProductionEnvironment,
      sameSite: "lax",
      path: "/",
    },
  });
  await fastify.register(fastifyFormbody);

  const { rootPath, loginPath, logoutPath } = admin.options;
  const assets = Router.assets;
  fastify.addHook("preHandler", async (request, reply) => {
    if (!request.url.startsWith(rootPath)) return;
    if (
      request.url.startsWith(loginPath) ||
      request.url.startsWith(logoutPath) ||
      assets.some((asset) => request.url.match(asset.path)) ||
      request.session.get("adminUser")
    ) {
      return;
    }
    request.session.redirectTo = request.url.startsWith(`${rootPath}/api`)
      ? rootPath
      : request.url;
    return reply.redirect(loginPath, 302);
  });

  await buildRouter(admin, fastify);
  fastify.get(loginPath, async (_request, reply) => {
    const page = await admin.renderLogin({
      action: loginPath,
      errorMessage: null,
    });
    return reply.type("text/html").send(page);
  });
  fastify.post(loginPath, { preHandler: attemptLimiter ? [attemptLimiter] : [] }, async (request, reply) => {
    const adminUser = await authenticateAdmin(
      request.body?.email,
      request.body?.password
    );
    if (!adminUser) {
      const page = await admin.renderLogin({
        action: loginPath,
        errorMessage: "invalidCredentials",
      });
      return reply.type("text/html").send(page);
    }
    request.session.set("adminUser", adminUser);
    const redirectTo = request.session.redirectTo || rootPath;
    delete request.session.redirectTo;
    return reply.redirect(redirectTo, 302);
  });
  fastify.get(logoutPath, async (request, reply) => {
    await request.session.destroy();
    return reply.redirect(loginPath, 302);
  });
  return admin;
};

export const setAdminRealtimeServer = (io) => {
  realtimeServer = io;
};

export default admin;
