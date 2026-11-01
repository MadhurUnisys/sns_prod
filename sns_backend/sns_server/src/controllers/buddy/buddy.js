import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import Inventory from "../../models/inventory.js";
import { Buddy } from "../../models/user.js";
import { isValidCoordinates } from "../../services/fulfillment.js";
import { setBuddyStock, InventoryServiceError } from "../../services/inventory.js";

const publicBuddyFields = "name phone email address location isAvailable isApproved isActive locationUpdatedAt liveLocation liveLocationUpdatedAt createdAt updatedAt";

export const getBuddyInventory = async (request, reply) => {
  const isAdmin = request.user.role === "Admin";
  const buddyId = isAdmin ? request.query.buddyId : request.user.id;
  if (!buddyId || !mongoose.isValidObjectId(buddyId)) {
    return reply.code(400).send({ message: isAdmin ? "A valid buddyId is required." : "Buddy account is required." });
  }
  if (isAdmin && !(await Buddy.exists({ _id: buddyId }))) {
    return reply.code(404).send({ message: "Buddy not found." });
  }
  const inventory = await Inventory.find({ buddy: buddyId })
    .populate({ path: "product", select: "name image price discountPrice quantity category isActive", populate: { path: "category", select: "name" } })
    .sort({ updatedAt: -1 })
    .lean();
  return reply.send({ buddyId: String(buddyId), inventory });
};

export const updateOwnInventory = async (request, reply) => {
  const { productId, availableQuantity } = request.body ?? {};
  if (
    !mongoose.isValidObjectId(productId) ||
    !Number.isSafeInteger(availableQuantity) ||
    availableQuantity < 0
  ) {
    return reply.code(400).send({
      message: "A valid productId and non-negative integer availableQuantity are required.",
    });
  }
  try {
    const inventory = await Inventory.findOneAndUpdate(
      { buddy: request.user.id, product: productId, isActive: true },
      { $set: { availableQuantity } },
      { new: true, runValidators: true }
    ).populate({
      path: "product",
      select: "name image price discountPrice quantity category isActive",
      populate: { path: "category", select: "name" },
    });
    if (!inventory) {
      return reply.code(404).send({
        message: "This product is not in your active Buddy inventory.",
      });
    }
    return reply.send({ inventory });
  } catch (error) {
    if (error.name === "ValidationError") {
      return reply.code(400).send({ message: "Invalid inventory quantity." });
    }
    request.log.error(error);
    return reply.code(500).send({ message: "Unable to update Buddy inventory." });
  }
};

export const updateBuddyAvailability = async (request, reply) => {
  const updates = {};
  const body = request.body ?? {};
  if (Object.hasOwn(body, "isAvailable")) {
    if (typeof body.isAvailable !== "boolean") {
      return reply.code(400).send({ message: "isAvailable must be a boolean." });
    }
    updates.isAvailable = body.isAvailable;
  }
  if (Object.hasOwn(body, "address")) {
    if (typeof body.address !== "string" || !body.address.trim()) {
      return reply.code(400).send({ message: "A non-empty address is required." });
    }
    updates.address = body.address.trim();
  }
  if (Object.hasOwn(body, "location")) {
    const latitude = Number(body.location?.latitude);
    const longitude = Number(body.location?.longitude);
    if (!isValidCoordinates(latitude, longitude)) {
      return reply.code(400).send({ message: "Valid location coordinates are required." });
    }
    updates.location = { latitude, longitude };
    updates.locationUpdatedAt = new Date();
  }
  if (!Object.keys(updates).length) {
    return reply.code(400).send({ message: "Provide availability, address, or location to update." });
  }
  const buddy = await Buddy.findByIdAndUpdate(
    request.user.id,
    { $set: updates },
    { new: true, runValidators: true, projection: publicBuddyFields }
  );
  if (!buddy) return reply.code(404).send({ message: "Buddy not found." });
  return reply.send({ buddy });
};

export const listBuddies = async (_request, reply) => {
  const buddies = await Buddy.find({})
    .select(publicBuddyFields)
    .sort({ createdAt: -1 })
    .lean();
  return reply.send({ buddies });
};

export const createBuddy = async (request, reply) => {
  const { name, email, phone, password, address, location } = request.body ?? {};
  const normalizedEmail = typeof email === "string" ? email.trim().toLowerCase() : "";
  const normalizedPhone = typeof phone === "string" ? phone.trim() : "";
  if (
    typeof name !== "string" || !name.trim() ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(normalizedEmail) ||
    !/^[+()\d -]{8,20}$/.test(normalizedPhone) ||
    typeof password !== "string" || password.length < 12 ||
    typeof address !== "string" || !address.trim() ||
    !isValidCoordinates(Number(location?.latitude), Number(location?.longitude))
  ) {
    return reply.code(400).send({ message: "Name, valid email and phone, a 12-character password, address, and valid coordinates are required." });
  }
  try {
    const buddy = await Buddy.create({
      name: name.trim(),
      email: normalizedEmail,
      phone: normalizedPhone,
      passwordHash: await bcrypt.hash(password, 12),
      address: address.trim(),
      location: { latitude: Number(location.latitude), longitude: Number(location.longitude) },
      isApproved: false,
      isActive: false,
      isAvailable: true,
    });
    return reply.code(201).send({ buddy: {
      id: String(buddy._id),
      name: buddy.name,
      email: buddy.email,
      phone: buddy.phone,
      address: buddy.address,
      location: buddy.location,
      isApproved: buddy.isApproved,
      isActive: buddy.isActive,
      isAvailable: buddy.isAvailable,
    } });
  } catch (error) {
    if (error.code === 11000) return reply.code(409).send({ message: "A Buddy with this email or phone already exists." });
    if (error.name === "ValidationError") return reply.code(400).send({ message: "Invalid Buddy data." });
    request.log.error(error);
    return reply.code(500).send({ message: "Unable to create Buddy." });
  }
};

export const updateBuddyApproval = async (request, reply) => {
  if (!mongoose.isValidObjectId(request.params.id)) {
    return reply.code(400).send({ message: "A valid Buddy ID is required." });
  }
  const allowed = ["isApproved", "isActive", "isAvailable"];
  const updates = {};
  for (const field of allowed) {
    if (Object.hasOwn(request.body ?? {}, field)) {
      if (typeof request.body[field] !== "boolean") {
        return reply.code(400).send({ message: `${field} must be a boolean.` });
      }
      updates[field] = request.body[field];
    }
  }
  if (!Object.keys(updates).length) return reply.code(400).send({ message: "Provide an approval or active status to update." });
  const buddy = await Buddy.findByIdAndUpdate(
    request.params.id,
    { $set: updates },
    { new: true, runValidators: true, projection: publicBuddyFields }
  );
  if (!buddy) return reply.code(404).send({ message: "Buddy not found." });
  return reply.send({ buddy });
};

export const setInventoryStock = async (request, reply) => {
  const { buddyId, productId, availableQuantity, isActive } = request.body ?? {};
  try {
    const inventory = await setBuddyStock({
      buddyId,
      productId,
      availableQuantity,
      ...(isActive === undefined ? {} : { isActive }),
    });
    return reply.send({ inventory });
  } catch (error) {
    if (error instanceof InventoryServiceError) {
      return reply.code(error.statusCode).send({ message: error.message });
    }
    request.log.error(error);
    return reply.code(500).send({ message: "Unable to update Buddy inventory." });
  }
};
