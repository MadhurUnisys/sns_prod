import mongoose from "mongoose";
import Counter from "./counter.js";

export const ORDER_STATUSES = [
  "pending",
  "confirmed",
  "preparing",
  "arriving",
  "out_for_delivery",
  "delivered",
  "cancelled",
];
const ORDER_SCHEMA_STATUSES = [...ORDER_STATUSES, "reserving"];

const orderSchema = new mongoose.Schema(
  {
    orderId: {
      type: String,
      unique: true,
    },
    customer: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Customer",
      required: true,
    },
    buddy: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "Buddy",
      required: true,
    },
    deliveryType: {
      type: String,
      enum: ["UFD", "NORMAL"],
      default: "NORMAL",
    },
    items: [
      {
        product: {
          type: mongoose.Schema.Types.ObjectId,
          ref: "Product",
          required: true,
        },
        quantity: { type: Number, required: true, min: 1 },
        price: { type: Number, required: true, min: 0 },
        name: { type: String, required: true },
      },
    ],
    deliveryLocation: {
      latitude: { type: Number, required: true },
      longitude: { type: Number, required: true },
      address: { type: String },
    },
    pickupLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
    },
    deliveryPersonLocation: {
      latitude: { type: Number },
      longitude: { type: Number },
      address: { type: String },
    },
    status: {
      type: String,
      enum: ORDER_SCHEMA_STATUSES,
      default: "pending",
    },
    inventoryState: {
      type: String,
      enum: ["pending", "reserved", "released", "consumed"],
      default: "pending",
    },
    idempotencyKey: { type: String, trim: true },
    idempotencyFingerprint: { type: String, select: false },
    reassignment: {
      fromBuddy: { type: mongoose.Schema.Types.ObjectId, ref: "Buddy" },
      toBuddy: { type: mongoose.Schema.Types.ObjectId, ref: "Buddy" },
      state: { type: String, enum: ["requested", "new_reserved"] },
    },
    totalPrice: { type: Number, required: true, min: 0 },
    // Platform take rate and commission, snapshotted at checkout. Admin-only: never select by default.
    takeRatePercent: { type: Number, min: 0, max: 100, select: false },
    commissionAmount: { type: Number, min: 0, select: false },
  },
  { timestamps: true }
);

orderSchema.index(
  { customer: 1, idempotencyKey: 1 },
  {
    unique: true,
    partialFilterExpression: { idempotencyKey: { $type: "string" } },
  }
);
orderSchema.index({ customer: 1, createdAt: -1 });
orderSchema.index({ buddy: 1, createdAt: -1 });
orderSchema.index({ status: 1, createdAt: -1 });

async function getNextSequenceValue(sequenceName) {
  const sequenceDocument = await Counter.findOneAndUpdate(
    { name: sequenceName },
    { $inc: { sequence_value: 1 } },
    { new: true, upsert: true }
  );

  return sequenceDocument.sequence_value;
}

orderSchema.pre("save", async function nextHook(next) {
  try {
    if (this.isNew && !this.orderId) {
      const sequenceValue = await getNextSequenceValue("OrderId");
      this.orderId = `ORDR${String(sequenceValue).padStart(5, "0")}`;
    }
    next();
  } catch (error) {
    next(error);
  }
});

const Order = mongoose.models.Order || mongoose.model("Order", orderSchema);
export default Order;
