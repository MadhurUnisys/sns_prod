import {
  confirmOrder,
  createOrder,
  getDeliverySlots,
  getOrderById,
  getOrders,
  getTracking,
  reassignOrderToBuddy,
  updateBuddyLocation,
  updateOrderStatus,
} from "../controllers/order/order.js";
import { requireAuth, requireRole } from "../middleware/auth.js";

export default async function orderRoutes(fastify) {
  fastify.get("/delivery-slots", getDeliverySlots);
  fastify.get("/orders", { preValidation: [requireRole("Customer", "Buddy", "Admin")] }, getOrders);
  fastify.post("/orders/create", { preValidation: [requireRole("Customer")] }, createOrder);
  fastify.get("/orders/:id", { preValidation: [requireRole("Customer", "Buddy", "Admin")] }, getOrderById);
  fastify.get("/orders/:id/tracking", { preValidation: [requireRole("Customer", "Buddy", "Admin")] }, getTracking);
  fastify.post("/orders/confirm", { preValidation: [requireRole("Buddy", "Admin")] }, confirmOrder);
  fastify.patch(
    "/orders/:id/status",
    { preValidation: [requireRole("Customer", "Buddy", "Admin")] },
    async (request, reply) => {
      request.body = { ...(request.body || {}), orderId: request.params.id };
      return updateOrderStatus(request, reply);
    }
  );
  fastify.post(
    "/orders/update-status",
    { preValidation: [requireRole("Customer", "Buddy", "Admin")] },
    updateOrderStatus
  );
  fastify.patch(
    "/orders/:id/location",
    { preValidation: [requireRole("Buddy")] },
    async (request, reply) => {
      request.body = { ...(request.body || {}), orderId: request.params.id };
      return updateBuddyLocation(request, reply);
    }
  );
  fastify.patch(
    "/orders/track/location",
    { preValidation: [requireRole("Buddy")] },
    updateBuddyLocation
  );
  fastify.patch(
    "/api/admin/orders/:id/assign-buddy",
    { preValidation: [requireRole("Admin")] },
    reassignOrderToBuddy
  );
}
