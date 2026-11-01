import mongoose from "mongoose";

const savedLocationSchema = new mongoose.Schema(
  {
    label: { type: String, trim: true, default: "Home" },
    address: { type: String, trim: true },
    latitude: { type: Number, min: -90, max: 90, required: true },
    longitude: { type: Number, min: -180, max: 180, required: true },
  },
  { _id: true }
);

const customerSchema = new mongoose.Schema(
  {
    name: { type: String, trim: true, maxlength: 100 },
    phone: { type: String, trim: true, unique: true, sparse: true },
    address: { type: String, trim: true },
    liveLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    savedLocations: { type: [savedLocationSchema], default: [] },
    role: { type: String, enum: ["Customer"], default: "Customer" },
    isActive: { type: Boolean, default: true },
    isActivated: { type: Boolean, default: true },
  },
  { timestamps: true }
);

const buddySchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    phone: { type: String, required: true, trim: true, unique: true },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["Buddy"], default: "Buddy" },
    isApproved: { type: Boolean, default: false },
    isActive: { type: Boolean, default: false },
    isAvailable: { type: Boolean, default: true },
    // Stall/pickup location used for order matching. Never write this from a courier location ping.
    location: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    address: { type: String, trim: true },
    locationUpdatedAt: { type: Date },
    liveLocation: {
      latitude: { type: Number, min: -90, max: 90 },
      longitude: { type: Number, min: -180, max: 180 },
    },
    liveLocationUpdatedAt: { type: Date },
  },
  { timestamps: true }
);

buddySchema.index({ isApproved: 1, isActive: 1, isAvailable: 1 });

const adminSchema = new mongoose.Schema(
  {
    name: { type: String, required: true, trim: true, maxlength: 100 },
    email: { type: String, required: true, trim: true, lowercase: true, unique: true },
    passwordHash: { type: String, required: true, select: false },
    role: { type: String, enum: ["Admin"], default: "Admin" },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Customer =
  mongoose.models.Customer || mongoose.model("Customer", customerSchema);
export const Buddy = mongoose.models.Buddy || mongoose.model("Buddy", buddySchema);
export const Admin = mongoose.models.Admin || mongoose.model("Admin", adminSchema);

// Kept only as an import compatibility alias; new fulfillment uses Buddy.
export const DeliveryPartner = Buddy;
