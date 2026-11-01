import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";

const { seedDemo } = await import("../scripts/seed-demo.js");
const { Admin, Buddy } = await import("../src/models/user.js");
const Category = (await import("../src/models/category.js")).default;
const Inventory = (await import("../src/models/inventory.js")).default;
const Product = (await import("../src/models/products.js")).default;
const { findNearestBuddy } = await import("../src/services/fulfillment.js");

const cityCentre = { latitude: 19.8762, longitude: 75.3433 };
const cidcoN5 = { latitude: 19.8935, longitude: 75.3560 };
const staples = ["Tomato", "Onion", "Potato"];

let mongoServer;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
});

test.after(async () => {
  await mongoose.disconnect();
  if (mongoServer) await mongoServer.stop();
});

test("demo seed builds a browsable store with working UFD and is idempotent", async () => {
  const mongoUri = mongoServer.getUri("buddyyaa");
  const first = await seedDemo({ mongoUri, log: () => {} });
  const second = await seedDemo({ mongoUri, log: () => {} });
  await mongoose.connect(mongoUri);

  assert.equal(await Category.countDocuments(), 4);
  assert.equal(await Product.countDocuments({ isActive: true }), 23);
  assert.equal(await Admin.countDocuments(), 1);
  const buddies = await Buddy.find({}).lean();
  assert.equal(buddies.length, 5);
  assert.ok(buddies.every((buddy) => buddy.isApproved && buddy.isActive && buddy.isAvailable));
  assert.deepEqual(second.buddies.map((buddy) => buddy.email), first.buddies.map((buddy) => buddy.email));
  assert.ok(first.buddies.every((buddy) => buddy.password.length >= 12));
  assert.ok(first.admin.password.length >= 12);

  const products = await Product.find({}).lean();
  assert.ok(products.every((product) => product.image.startsWith("data:image/svg+xml")));
  const discounted = products.filter((product) => product.discountPrice !== undefined);
  assert.ok(discounted.length >= 4 && discounted.length <= 5, `${discounted.length} discounted`);
  assert.ok(discounted.every((product) => product.discountPrice < product.price));

  const inventory = await Inventory.find({ isActive: true }).populate("product", "name").lean();
  assert.equal(await Inventory.countDocuments(), inventory.length);
  const stockedBy = new Map();
  for (const row of inventory) {
    const holders = stockedBy.get(row.product.name) ?? new Set();
    holders.add(String(row.buddy));
    stockedBy.set(row.product.name, holders);
  }
  assert.equal(stockedBy.size, 23, "every product is stocked by at least one Buddy");
  for (const name of staples) assert.equal(stockedBy.get(name).size, 5, `${name} at every Buddy`);
  for (const buddy of buddies) {
    const exclusive = [...stockedBy].filter(([, holders]) => holders.size === 1 && holders.has(String(buddy._id)));
    assert.ok(exclusive.length >= 2 && exclusive.length <= 3, `${buddy.name} has ${exclusive.length} exclusive items`);
  }
  const lowStock = inventory.filter((row) => row.availableQuantity === 2);
  assert.equal(lowStock.length, 1);
  assert.equal(lowStock[0].product.name, "Pomegranate");

  assert.equal((await findNearestBuddy(cityCentre)).buddy.name, "Khan Fruit & Veg");
  assert.equal((await findNearestBuddy(cidcoN5)).buddy.name, "Sunita Bhaji Bhandar");
});
