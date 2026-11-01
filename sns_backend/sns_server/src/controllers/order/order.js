import { createHash } from "node:crypto";
import mongoose from "mongoose";
import { Buddy } from "../../models/user.js";
import FulfillmentIssue from "../../models/fulfillment-issue.js";
import Order, { ORDER_STATUSES } from "../../models/order.js";
import Product from "../../models/products.js";
import {
  findEligibleBuddiesForBasket,
  findNearestBuddy,
  isValidCoordinates,
  reserveInventoryForOrder,
  releaseInventoryReservation,
} from "../../services/fulfillment.js";
import { assignOrderToBuddy } from "../../services/order-assignment.js";
import { OrderLifecycleError, transitionOrder } from "../../services/order-lifecycle.js";

const TRACKABLE_STATUSES = ["confirmed", "preparing", "arriving", "out_for_delivery"];
const DEFAULT_ORDER_PAGE_SIZE = 25;
const MAX_ORDER_PAGE_SIZE = 100;
const STATUS_TRANSITIONS = {
  pending: ["confirmed", "cancelled"],
  confirmed: ["preparing", "cancelled"],
  preparing: ["arriving", "out_for_delivery", "cancelled"],
  arriving: ["out_for_delivery", "cancelled"],
  out_for_delivery: ["delivered"],
  delivered: [],
  cancelled: [],
};
const populatedOrder = (query) => query
  .populate("customer", "name phone address")
  .populate("buddy", "name phone email address location")
  .populate("items.product", "name image quantity price discountPrice");
const toPlainOrder = async (order) => {
  const found = await populatedOrder(Order.findById(order._id)).lean();
  return found ? { ...found, allowedStatuses: STATUS_TRANSITIONS[found.status] ?? [] } : null;
};
const reportLifecycleError = (reply, error) => {
  if (error instanceof OrderLifecycleError) return reply.code(error.statusCode).send({ message: error.message });
  return reply.code(500).send({ message: "Unable to update this order." });
};

function normalizeCheckout(body = {}, headerIdempotencyKey) {
  const deliveryType = body.deliveryType;
  const point = body.deliveryLocation;
  const latitude = point?.latitude;
  const longitude = point?.longitude;
  if (!["UFD", "NORMAL"].includes(deliveryType)) {
    return { error: "deliveryType must be UFD or NORMAL." };
  }
  if (
    typeof latitude !== "number" || typeof longitude !== "number" ||
    !isValidCoordinates(latitude, longitude) ||
    typeof point.address !== "string" || !point.address.trim()
  ) {
    return { error: "A delivery address and valid numeric coordinates are required." };
  }
  if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > 100) {
    return { error: "At least one valid product and quantity is required." };
  }
  const quantities = new Map();
  for (const item of body.items) {
    if (!mongoose.isValidObjectId(item?.productId) || !Number.isSafeInteger(item.quantity) || item.quantity < 1) {
      return { error: "Each item needs a valid productId and a positive integer quantity." };
    }
    const id = String(item.productId);
    const total = (quantities.get(id) ?? 0) + item.quantity;
    if (!Number.isSafeInteger(total)) return { error: "Requested product quantity is too large." };
    quantities.set(id, total);
  }
  const selectedBuddyId = body.selectedBuddyId;
  if (deliveryType === "UFD" && !mongoose.isValidObjectId(selectedBuddyId)) {
    return { error: "UFD requires the selectedBuddyId returned by the UFD catalogue." };
  }
  if (deliveryType === "NORMAL" && selectedBuddyId !== undefined) {
    return { error: "NORMAL delivery does not accept a selectedBuddyId." };
  }
  const idempotencyKey = typeof body.idempotencyKey === "string"
    ? body.idempotencyKey.trim()
    : typeof headerIdempotencyKey === "string" ? headerIdempotencyKey.trim() : "";
  if (idempotencyKey.length > 200) return { error: "idempotencyKey must be 200 characters or fewer." };
  const items = [...quantities].map(([productId, quantity]) => ({ productId, quantity }));
  const checkout = {
    deliveryType,
    selectedBuddyId: deliveryType === "UFD" ? String(selectedBuddyId) : undefined,
    items,
    deliveryLocation: {
      latitude,
      longitude,
      address: point.address.trim(),
    },
    idempotencyKey: idempotencyKey || undefined,
  };
  checkout.fingerprint = createHash("sha256").update(JSON.stringify({
    deliveryType: checkout.deliveryType,
    selectedBuddyId: checkout.selectedBuddyId ?? null,
    items: [...checkout.items].sort((a, b) => a.productId.localeCompare(b.productId)),
    deliveryLocation: checkout.deliveryLocation,
  })).digest("hex");
  return checkout;
}

async function findExistingIdempotentOrder(customerId, key, fingerprint) {
  if (!key) return null;
  const existing = await Order.findOne({ customer: customerId, idempotencyKey: key })
    .select("+idempotencyFingerprint");
  if (!existing) return null;
  if (existing.idempotencyFingerprint !== fingerprint) {
    const error = new OrderLifecycleError("This idempotency key was already used for a different checkout.", 409);
    throw error;
  }
  if (existing.status === "reserving") {
    const error = new OrderLifecycleError("This checkout is still being processed. Retry with the same idempotency key.", 409);
    throw error;
  }
  return existing;
}

async function createFulfillmentIssue(customerId, checkout, reason) {
  await FulfillmentIssue.create({
    customer: customerId,
    deliveryType: checkout.deliveryType,
    selectedBuddy: checkout.selectedBuddyId,
    items: checkout.items.map(({ productId, quantity }) => ({ product: productId, quantity })),
    location: {
      latitude: checkout.deliveryLocation.latitude,
      longitude: checkout.deliveryLocation.longitude,
    },
    reason: reason.slice(0, 500),
  });
}

async function emitToAssignedBuddy(request, buddyId, event, order) {
  request.server.io?.to(`buddy:${buddyId}`).emit(event, { order });
}

export const createOrder = async (request, reply) => {
  const checkout = normalizeCheckout(request.body, request.headers["idempotency-key"]);
  if (checkout.error) return reply.code(400).send({ message: checkout.error });

  try {
    const existing = await findExistingIdempotentOrder(
      request.user.id,
      checkout.idempotencyKey,
      checkout.fingerprint
    );
    if (existing) {
      return reply.code(200).send({ order: await toPlainOrder(existing) });
    }

    const products = await Product.find({
      _id: { $in: checkout.items.map((item) => item.productId) },
      isActive: true,
    }).lean();
    const productById = new Map(products.map((product) => [String(product._id), product]));
    if (productById.size !== checkout.items.length) {
      return reply.code(409).send({ message: "One or more requested products are no longer available." });
    }
    const snapshotItems = checkout.items.map(({ productId, quantity }) => {
      const product = productById.get(productId);
      return {
        product: product._id,
        quantity,
        price: product.discountPrice ?? product.price,
        name: product.name,
      };
    });
    const totalPrice = snapshotItems.reduce((sum, item) => sum + item.price * item.quantity, 0);
    if (!Number.isFinite(totalPrice)) return reply.code(400).send({ message: "The order total is invalid." });

    let candidates;
    if (checkout.deliveryType === "UFD") {
      const nearest = await findNearestBuddy(checkout.deliveryLocation);
      if (!nearest || String(nearest.buddy._id) !== checkout.selectedBuddyId) {
        return reply.code(409).send({ message: "The selected UFD Buddy is no longer the nearest Buddy for this location. Refresh UFD before checkout." });
      }
      const selectedBuddy = await Buddy.findOne({
        _id: checkout.selectedBuddyId,
        isApproved: true,
        isActive: true,
        isAvailable: true,
      }).lean();
      if (!selectedBuddy) return reply.code(409).send({ message: "The selected UFD Buddy is no longer available. Refresh UFD before checkout." });
      candidates = [{ buddy: selectedBuddy }];
    } else {
      candidates = await findEligibleBuddiesForBasket(checkout.deliveryLocation, snapshotItems);
      if (!candidates?.length) {
        await createFulfillmentIssue(request.user.id, checkout, "No active Buddy can fulfill the complete basket.");
        return reply.code(409).send({ message: "No nearby Buddy can fulfill every item in this basket. Edit your basket and try again." });
      }
    }

    let order;
    try {
      order = await Order.create({
        customer: request.user.id,
        buddy: candidates[0].buddy._id,
        deliveryType: checkout.deliveryType,
        items: snapshotItems,
        deliveryLocation: checkout.deliveryLocation,
        pickupLocation: {
          latitude: candidates[0].buddy.location?.latitude,
          longitude: candidates[0].buddy.location?.longitude,
          address: candidates[0].buddy.address,
        },
        status: "reserving",
        inventoryState: "pending",
        idempotencyKey: checkout.idempotencyKey,
        idempotencyFingerprint: checkout.fingerprint,
        totalPrice,
      });
    } catch (error) {
      if (error.code === 11000 && checkout.idempotencyKey) {
        const duplicate = await findExistingIdempotentOrder(
          request.user.id,
          checkout.idempotencyKey,
          checkout.fingerprint
        );
        if (duplicate) return reply.code(200).send({ order: await toPlainOrder(duplicate) });
      }
      throw error;
    }

    let reservedBuddy;
    let lastReservationError;
    for (const candidate of candidates) {
      try {
        await reserveInventoryForOrder(candidate.buddy._id, order._id, snapshotItems.map(({ product, quantity }) => ({ product, quantity })));
        reservedBuddy = candidate.buddy;
        break;
      } catch (error) {
        lastReservationError = error;
        if (checkout.deliveryType === "UFD") break;
      }
    }
    if (!reservedBuddy) {
      await Order.deleteOne({ _id: order._id, status: "reserving" });
      if (checkout.deliveryType === "NORMAL") {
        await createFulfillmentIssue(request.user.id, checkout, lastReservationError?.message ?? "No eligible Buddy had sufficient stock.");
        return reply.code(409).send({ message: "Stock changed while checking this basket. No Buddy can fulfill every item now; please review your basket." });
      }
      return reply.code(409).send({ message: "The selected UFD Buddy no longer has enough stock. Refresh UFD and review your basket." });
    }

    const confirmedReservation = await Order.findOneAndUpdate(
      { _id: order._id, status: "reserving" },
      {
        $set: {
          buddy: reservedBuddy._id,
          pickupLocation: {
            latitude: reservedBuddy.location?.latitude,
            longitude: reservedBuddy.location?.longitude,
            address: reservedBuddy.address,
          },
          status: "pending",
          inventoryState: "reserved",
        },
      },
      { new: true, runValidators: true }
    );
    if (!confirmedReservation) {
      await releaseInventoryReservation(
        reservedBuddy._id,
        order._id,
        snapshotItems.map(({ product, quantity }) => ({ product, quantity }))
      );
      throw new Error("Order reservation could not be finalized.");
    }
    const result = await toPlainOrder(confirmedReservation);
    await emitToAssignedBuddy(request, reservedBuddy._id, "order:available", result);
    return reply.code(201).send({ order: result });
  } catch (error) {
    if (error instanceof OrderLifecycleError) return reply.code(error.statusCode).send({ message: error.message });
    if (error.name === "ValidationError") return reply.code(400).send({ message: "Invalid order data." });
    request.log.error(error);
    return reply.code(500).send({ message: "Unable to create this order right now." });
  }
};

export const getOrders = async (request, reply) => {
  const filter = {};
  if (request.user.role === "Customer") filter.customer = request.user.id;
  if (request.user.role === "Buddy") filter.buddy = request.user.id;
  if (request.query.status) {
    if (!ORDER_STATUSES.includes(request.query.status)) {
      return reply.code(400).send({ message: "A valid order status is required." });
    }
    filter.status = request.query.status;
  }
  let limit = DEFAULT_ORDER_PAGE_SIZE;
  if (request.query.limit !== undefined) {
    limit = /^\d+$/.test(String(request.query.limit)) ? Number(request.query.limit) : Number.NaN;
    if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_ORDER_PAGE_SIZE) {
      return reply.code(400).send({ message: `limit must be an integer from 1 to ${MAX_ORDER_PAGE_SIZE}.` });
    }
  }
  const cursor = typeof request.query.cursor === "string" ? new Date(request.query.cursor) : null;
  if (cursor && Number.isFinite(cursor.getTime())) filter.createdAt = { $lt: cursor };
  const page = await Order.find(filter)
    .sort({ createdAt: -1 })
    .limit(limit + 1)
    .populate("buddy", "name")
    .lean();
  const hasMore = page.length > limit;
  const orders = hasMore ? page.slice(0, limit) : page;
  return reply.send({
    orders: orders.map((order) => ({
      ...order,
      allowedStatuses: STATUS_TRANSITIONS[order.status] ?? [],
    })),
    pageInfo: {
      hasMore,
      nextCursor: hasMore ? orders.at(-1).createdAt.toISOString() : null,
    },
  });
};

async function findAuthorizedOrder(request, orderId) {
  const order = mongoose.isValidObjectId(orderId)
    ? await Order.findById(orderId)
    : await Order.findOne({ orderId });
  if (!order) return { error: { status: 404, message: "Order not found." } };
  if (request.user.role === "Customer" && String(order.customer) !== request.user.id) {
    return { error: { status: 403, message: "You are not authorized to access this order." } };
  }
  if (request.user.role === "Buddy" && String(order.buddy) !== request.user.id) {
    return { error: { status: 403, message: "This order is assigned to another Buddy." } };
  }
  return { order };
}

export const getOrderById = async (request, reply) => {
  const result = await findAuthorizedOrder(request, request.params.id);
  if (result.error) return reply.code(result.error.status).send({ message: result.error.message });
  return reply.send({ order: await toPlainOrder(result.order) });
};

export const getTracking = async (request, reply) => {
  const result = await findAuthorizedOrder(request, request.params.id);
  if (result.error) return reply.code(result.error.status).send({ message: result.error.message });
  const order = result.order;
  return reply.send({
    tracking: {
      orderId: order.orderId,
      status: order.status,
      deliveryLocation: order.deliveryLocation,
      pickupLocation: order.pickupLocation,
      deliveryPersonLocation: order.deliveryPersonLocation,
      updatedAt: order.updatedAt,
    },
  });
};

export const confirmOrder = async (request, reply) => {
  const orderId = request.body?.orderId;
  if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId)) {
    return reply.code(400).send({ message: "A valid orderId is required." });
  }
  try {
    const current = await Order.findById(orderId);
    if (!current) return reply.code(404).send({ message: "Order not found." });
    if (request.user.role === "Buddy" && String(current.buddy) !== request.user.id) {
      return reply.code(403).send({ message: "This order is assigned to another Buddy." });
    }
    if (current.status !== "pending") {
      return reply.code(409).send({ message: "Only pending orders can be accepted." });
    }
    const order = await transitionOrder({
      orderId,
      status: "confirmed",
      actorRole: request.user.role,
      actorId: request.user.id,
    });
    const result = await toPlainOrder(order);
    request.server.io?.to(`order:${order._id}`).emit("order:status", { order: result });
    return reply.send({ order: result });
  } catch (error) {
    return reportLifecycleError(reply, error);
  }
};

export const updateOrderStatus = async (request, reply) => {
  const orderId = request.params?.id ?? request.body?.orderId;
  const status = request.body?.status;
  if (typeof orderId !== "string" || !mongoose.isValidObjectId(orderId) || typeof status !== "string") {
    return reply.code(400).send({ message: "A valid orderId and status are required." });
  }
  try {
    const order = await transitionOrder({
      orderId,
      status,
      actorRole: request.user.role,
      actorId: request.user.id,
    });
    const result = await toPlainOrder(order);
    request.server.io?.to(`order:${order._id}`).emit("order:status", { order: result });
    return reply.send({ order: result });
  } catch (error) {
    return reportLifecycleError(reply, error);
  }
};

export const updateBuddyLocation = async (request, reply) => {
  const orderId = request.params?.id ?? request.body?.orderId;
  const { latitude, longitude } = request.body ?? {};
  if (
    typeof orderId !== "string" || !mongoose.isValidObjectId(orderId) ||
    typeof latitude !== "number" || typeof longitude !== "number" ||
    !isValidCoordinates(latitude, longitude)
  ) {
    return reply.code(400).send({ message: "A valid orderId and numeric coordinates are required." });
  }
  try {
    const order = await Order.findOneAndUpdate(
      {
        _id: orderId,
        buddy: request.user.id,
        status: { $in: TRACKABLE_STATUSES },
      },
      { $set: { deliveryPersonLocation: { latitude, longitude } } },
      { new: true, runValidators: true }
    );
    if (!order) {
      return reply.code(404).send({ message: "This order is not assigned to you or is not in an active delivery status." });
    }
    await Buddy.updateOne(
      { _id: request.user.id },
      { $set: { liveLocation: { latitude, longitude }, liveLocationUpdatedAt: new Date() } }
    );
    const tracking = {
      orderId: order.orderId,
      status: order.status,
      deliveryPersonLocation: order.deliveryPersonLocation,
      updatedAt: order.updatedAt,
    };
    request.server.io?.to(`order:${order._id}`).emit("delivery:location", tracking);
    return reply.send({ tracking });
  } catch (error) {
    request.log.error(error);
    return reply.code(500).send({ message: "Unable to save delivery location." });
  }
};

export const reassignOrderToBuddy = async (request, reply) => {
  try {
    const order = await assignOrderToBuddy({
      orderId: request.params.id,
      buddyId: request.body?.buddyId,
    });
    const result = await toPlainOrder(order);
    request.server.io?.to(`order:${order._id}`).emit("order:assignment", { order: result });
    await emitToAssignedBuddy(request, order.buddy, "order:available", result);
    return reply.send({ order: result });
  } catch (error) {
    return reportLifecycleError(reply, error);
  }
};
