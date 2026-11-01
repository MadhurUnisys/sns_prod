import jwt from "jsonwebtoken";
import Order from "../models/order.js";
import { Admin, Buddy, Customer } from "../models/user.js";
import { ACCESS_TOKEN_SECRET } from "../config/config.js";
import { isValidCoordinates, parseCoordinates } from "../services/fulfillment.js";

const roleModels = { Customer, Buddy, Admin };

const mayJoinOrderRoom = (user, order) =>
  user.role === "Admin" ||
  (user.role === "Customer" && String(order.customer) === user.id) ||
  (user.role === "Buddy" && String(order.buddy) === user.id);

export const attachRealtimeHandlers = (io) => {
  io.use(async (socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return next(new Error("Authentication required."));

    let claims;
    try {
      claims = jwt.verify(token, ACCESS_TOKEN_SECRET, {
        issuer: "buddyyaa-api",
        audience: "buddyyaa-client",
      });
    } catch {
      return next(new Error("Invalid or expired access token."));
    }
    const model = roleModels[claims.role];
    if (!model || claims.tokenUse === "refresh") {
      return next(new Error("Invalid access token."));
    }
    try {
      const account = await model.findById(claims.sub);
      if (!account || account.isActive === false || account.isApproved === false) {
        return next(new Error("Account is unavailable."));
      }
      socket.data.user = { id: String(account._id), role: account.role };
      return next();
    } catch (error) {
      return next(error);
    }
  });

  io.on("connection", (socket) => {
    const user = socket.data.user;
    if (user.role === "Buddy") socket.join(`buddy:${user.id}`);

    socket.on("order:join", async (payload = {}, acknowledge = () => {}) => {
      if (!payload.orderId) return acknowledge({ error: "orderId is required." });
      try {
        const order = await Order.findById(payload.orderId).select("customer buddy");
        if (!order) return acknowledge({ error: "Order not found." });
        if (!mayJoinOrderRoom(user, order)) {
          return acknowledge({ error: "You are not authorized for this order." });
        }
        await socket.join(`order:${order._id}`);
        return acknowledge({ joined: true, orderId: String(order._id) });
      } catch (error) {
        return acknowledge({ error: "Unable to join order room." });
      }
    });

    socket.on("delivery:location", async (payload = {}, acknowledge = () => {}) => {
      if (user.role !== "Buddy") {
        return acknowledge({ error: "Only an assigned Buddy can update delivery location." });
      }
      const { latitude, longitude } = parseCoordinates(payload.latitude, payload.longitude);
      if (!isValidCoordinates(latitude, longitude) || !payload.orderId) {
        return acknowledge({ error: "Valid orderId and coordinates are required." });
      }
      try {
        const order = await Order.findOneAndUpdate(
          {
            _id: payload.orderId,
            buddy: user.id,
            status: { $in: ["confirmed", "preparing", "arriving", "out_for_delivery"] },
          },
          { $set: { deliveryPersonLocation: { latitude, longitude } } },
          { new: true }
        );
        if (!order) return acknowledge({ error: "Order is not assigned to this Buddy or is not trackable." });
        await Buddy.updateOne(
          { _id: user.id },
          { $set: { liveLocation: { latitude, longitude }, liveLocationUpdatedAt: new Date() } }
        );
        const tracking = {
          orderId: String(order._id),
          status: order.status,
          deliveryPersonLocation: order.deliveryPersonLocation,
          updatedAt: order.updatedAt,
        };
        io.to(`order:${order._id}`).emit("delivery:location", tracking);
        return acknowledge({ persisted: true });
      } catch (error) {
        return acknowledge({ error: "Unable to persist location update." });
      }
    });

    socket.on("disconnect", () => {
      socket.removeAllListeners("order:join");
      socket.removeAllListeners("delivery:location");
    });
  });
};
