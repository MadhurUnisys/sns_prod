import bcrypt from "bcryptjs";
import mongoose from "mongoose";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { buildApp } from "../app.js";
import { Admin } from "../src/models/user.js";

// Demo-only data and credentials for a local showcase database. Never point this at production.
export const DEMO_MONGO_URI = process.env.DEMO_MONGO_URI || "mongodb://127.0.0.1:27017/buddyyaa";
const LOCAL_MONGO_URI = /^mongodb:\/\/(localhost|127\.0\.0\.1)(:\d+)?\/[\w-]+(\?.*)?$/;

const escapeXml = (value) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
// Inline SVG tiles: they cannot 404 and work without internet access at a demo venue.
const tile = (background, emoji, label) => {
  const art = emoji
    ? `<text x="300" y="215" font-size="190" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI Emoji, Apple Color Emoji, Noto Color Emoji, sans-serif">${emoji}</text>`
    : `<circle cx="300" cy="185" r="115" fill="#ffffff" opacity="0.7"/><text x="300" y="190" font-size="54" font-weight="700" fill="#2f3b2f" text-anchor="middle" dominant-baseline="middle" font-family="Segoe UI, Helvetica, Arial, sans-serif">${escapeXml(label)}</text>`;
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400" viewBox="0 0 600 400"><rect width="600" height="400" fill="${background}"/>${art}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

// Indicative Nov-2026 Chhatrapati Sambhajinagar retail prices in rupees.
export const DEMO_CATALOGUE = [
  {
    name: "Vegetables",
    image: tile("#e8f3df", "🥕"),
    products: [
      { name: "Tomato", quantity: "1 kg", price: 38, discountPrice: 34, image: tile("#fde3df", "🍅") },
      { name: "Onion", quantity: "1 kg", price: 42, image: tile("#f4e6f1", "🧅") },
      { name: "Potato", quantity: "1 kg", price: 34, image: tile("#f5ecd9", "🥔") },
      { name: "Brinjal", quantity: "500 g", price: 28, image: tile("#ece3f6", "🍆") },
      { name: "Lady Finger / Bhindi", quantity: "500 g", price: 36, discountPrice: 32, image: tile("#e3f1d8", null, "Bhindi") },
      { name: "Cauliflower", quantity: "1 pc", price: 38, image: tile("#eef4e4", "🥦") },
      { name: "Cabbage", quantity: "1 pc", price: 27, image: tile("#e6f4e1", "🥬") },
      { name: "Green Chilli", quantity: "100 g", price: 12, image: tile("#e1f2dc", "🌶️") },
      { name: "Ginger", quantity: "200 g", price: 26, image: tile("#f6ead6", null, "Ginger") },
      { name: "Garlic", quantity: "250 g", price: 58, image: tile("#f4f0e8", "🧄") },
    ],
  },
  {
    name: "Leafy Greens",
    image: tile("#e0f2e3", "🥬"),
    products: [
      { name: "Coriander", quantity: "1 bunch", price: 14, discountPrice: 12, image: tile("#dff1dc", "🌿") },
      { name: "Spinach / Palak", quantity: "1 bunch", price: 18, image: tile("#d9eedb", "🥬") },
      { name: "Methi", quantity: "1 bunch", price: 17, image: tile("#e4f3dc", "🌱") },
      { name: "Curry Leaves", quantity: "100 g", price: 9, image: tile("#dcefd9", "🍃") },
    ],
  },
  {
    name: "Fruits",
    image: tile("#fdecdc", "🍌"),
    products: [
      { name: "Banana", quantity: "1 dozen", price: 56, discountPrice: 49, image: tile("#fdf3cf", "🍌") },
      { name: "Pomegranate", quantity: "1 kg", price: 148, image: tile("#fbdfe0", null, "Anar") },
      { name: "Grapes", quantity: "500 g", price: 67, image: tile("#ece4f5", "🍇") },
      { name: "Papaya", quantity: "1 pc", price: 46, image: tile("#fde7d3", null, "Papaya") },
      { name: "Sweet Lime / Mosambi", quantity: "1 kg", price: 78, discountPrice: 69, image: tile("#f1f6d6", "🍋") },
    ],
  },
  {
    name: "Daily Essentials",
    image: tile("#e6eef8", "🥛"),
    products: [
      { name: "Milk", quantity: "1 L", price: 56, image: tile("#eaf1fa", "🥛") },
      { name: "Curd", quantity: "500 g", price: 42, image: tile("#f0f3f7", "🥣") },
      { name: "Paneer", quantity: "200 g", price: 94, image: tile("#fbf3dc", "🧀") },
      { name: "Eggs", quantity: "6 pc", price: 44, image: tile("#f8efe2", "🥚") },
    ],
  },
];

// Staples everywhere; three exclusive items per Buddy; Pomegranate at 2 for the out-of-stock moment.
export const DEMO_BUDDIES = [
  {
    name: "Ramesh Fresh Vegetables",
    email: "ramesh@buddyyaa.test",
    phone: "+91 98220 41001",
    password: "Ramesh@Demo2026",
    address: "Jadhavwadi APMC Market, Chhatrapati Sambhajinagar",
    location: { latitude: 19.9012, longitude: 75.3310 },
    stock: { Tomato: 60, Onion: 80, Potato: 70, Brinjal: 18, "Lady Finger / Bhindi": 15, "Green Chilli": 25, Garlic: 20, Ginger: 16, Cabbage: 12 },
  },
  {
    name: "Sunita Bhaji Bhandar",
    email: "sunita@buddyyaa.test",
    phone: "+91 98220 41002",
    password: "Sunita@Demo2026",
    address: "CIDCO N-5, Chhatrapati Sambhajinagar",
    location: { latitude: 19.8930, longitude: 75.3550 },
    stock: { Tomato: 35, Onion: 40, Potato: 45, Coriander: 30, "Green Chilli": 20, Brinjal: 14, "Spinach / Palak": 22, Methi: 18, "Curry Leaves": 25 },
  },
  {
    name: "Pawar Vegetables",
    email: "pawar@buddyyaa.test",
    phone: "+91 98220 41003",
    password: "Pawar@Demo2026!",
    address: "Garkheda, Chhatrapati Sambhajinagar",
    location: { latitude: 19.8640, longitude: 75.3290 },
    stock: { Tomato: 40, Onion: 50, Potato: 55, "Lady Finger / Bhindi": 12, Coriander: 20, Cauliflower: 10, Milk: 24, Curd: 15 },
  },
  {
    name: "Khan Fruit & Veg",
    email: "khan@buddyyaa.test",
    phone: "+91 98220 41004",
    password: "Khan@Demo2026!!",
    address: "Osmanpura, Chhatrapati Sambhajinagar",
    location: { latitude: 19.8800, longitude: 75.3380 },
    stock: { Tomato: 30, Onion: 35, Potato: 40, Banana: 18, Coriander: 15, Pomegranate: 2, Grapes: 14, Papaya: 8 },
  },
  {
    name: "Jadhav Taaza Market",
    email: "jadhav@buddyyaa.test",
    phone: "+91 98220 41005",
    password: "Jadhav@Demo2026",
    address: "Beed Bypass, Chhatrapati Sambhajinagar",
    location: { latitude: 19.8490, longitude: 75.3600 },
    stock: { Tomato: 45, Onion: 60, Potato: 50, Banana: 20, "Lady Finger / Bhindi": 10, "Sweet Lime / Mosambi": 16, Paneer: 12, Eggs: 30 },
  },
];

export const DEMO_ADMIN = {
  name: "Buddyyaa Demo Admin",
  email: "admin@buddyyaa.test",
  password: "Buddyyaa@Demo2026",
};

const discardLogs = { write: () => {} };

const call = async (app, method, url, { token, payload, expect = [200] } = {}) => {
  const response = await app.inject({
    method,
    url,
    payload,
    headers: token ? { authorization: `Bearer ${token}` } : {},
  });
  if (!expect.includes(response.statusCode)) {
    throw new Error(`${method} ${url} returned ${response.statusCode}: ${response.json().message ?? response.body}`);
  }
  return { status: response.statusCode, body: response.json() };
};

const resetDatabase = async (mongoUri) => {
  if (!LOCAL_MONGO_URI.test(mongoUri)) {
    throw new Error(`Refusing to drop a non-local database (${mongoUri}). Reset works only on mongodb://localhost or 127.0.0.1.`);
  }
  await mongoose.connect(mongoUri);
  await mongoose.connection.dropDatabase();
  await mongoose.disconnect();
};

export const seedDemo = async ({ mongoUri = DEMO_MONGO_URI, reset = false, log = console.log } = {}) => {
  if (reset) {
    await resetDatabase(mongoUri);
    log(`Dropped ${mongoUri}.`);
  }
  process.env.RATE_LIMIT_MAX = process.env.RATE_LIMIT_MAX || "10000";
  const app = await buildApp({ mongoUri, logStream: discardLogs });
  try {
    await Admin.updateOne(
      { email: DEMO_ADMIN.email },
      {
        $set: { name: DEMO_ADMIN.name, passwordHash: await bcrypt.hash(DEMO_ADMIN.password, 12), isActive: true },
        $setOnInsert: { role: "Admin" },
      },
      { upsert: true }
    );
    const login = await call(app, "POST", "/auth/admin/login", {
      payload: { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password },
    });
    const token = login.body.accessToken;

    const existingCategories = (await call(app, "GET", "/categories")).body.categories;
    const existingProducts = (await call(app, "GET", "/products")).body.products;
    const productIds = new Map();
    let createdProducts = 0;
    for (const { products, ...categoryData } of DEMO_CATALOGUE) {
      let category = existingCategories.find((entry) => entry.name === categoryData.name);
      if (!category) {
        category = (await call(app, "POST", "/categories", { token, payload: categoryData, expect: [201] })).body.category;
      }
      for (const productData of products) {
        let product = existingProducts.find((entry) =>
          entry.name === productData.name && String(entry.category?._id) === String(category._id)
        );
        if (!product) {
          product = (await call(app, "POST", "/products", {
            token,
            payload: { ...productData, category: category._id, isActive: true },
            expect: [201],
          })).body.product;
          createdProducts += 1;
        }
        productIds.set(productData.name, product._id);
      }
    }
    const demoNames = new Set(DEMO_CATALOGUE.flatMap((category) => category.products.map((product) => product.name)));
    const extraProducts = existingProducts.filter((product) => !demoNames.has(product.name));
    if (extraProducts.length) {
      log(`Note: ${extraProducts.length} non-demo product(s) are also active (e.g. ${extraProducts[0].name}). Run npm run demo:reset for a clean store.`);
    }

    const buddies = [];
    for (const { stock, ...buddyData } of DEMO_BUDDIES) {
      const created = await call(app, "POST", "/api/admin/buddies", { token, payload: buddyData, expect: [201, 409] });
      let buddyId = created.body.buddy?.id;
      if (!buddyId) {
        const listed = (await call(app, "GET", "/api/admin/buddies", { token })).body.buddies;
        buddyId = listed.find((buddy) => buddy.email === buddyData.email)?._id;
        if (!buddyId) throw new Error(`Buddy ${buddyData.email} conflicts with an existing account that has another email.`);
      }
      await call(app, "PATCH", `/api/admin/buddies/${buddyId}/status`, {
        token,
        payload: { isApproved: true, isActive: true, isAvailable: true },
      });
      for (const [productName, availableQuantity] of Object.entries(stock)) {
        await call(app, "PUT", "/api/admin/inventory", {
          token,
          payload: { buddyId, productId: productIds.get(productName), availableQuantity },
        });
      }
      buddies.push({ id: String(buddyId), name: buddyData.name, email: buddyData.email, password: buddyData.password, created: created.status === 201 });
    }
    log(`Catalogue ready: ${DEMO_CATALOGUE.length} categories, ${productIds.size} products (${createdProducts} new).`);
    log(`Buddies ready: ${buddies.length} (${buddies.filter((buddy) => buddy.created).length} new), stock set for each.`);
    return { admin: { email: DEMO_ADMIN.email, password: DEMO_ADMIN.password }, buddies };
  } finally {
    await app.close();
  }
};

const isDirectRun = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  seedDemo({ reset: process.argv.includes("--reset") })
    .then(({ admin, buddies }) => {
      console.log("\nDemo logins (local demo only):");
      console.log(`  Admin (http://localhost:3000/admin): ${admin.email} / ${admin.password}`);
      for (const buddy of buddies) console.log(`  Buddy ${buddy.name.padEnd(24)} ${buddy.email} / ${buddy.password}`);
      console.log("  Customers: any 10-digit phone number on the storefront login (development login, no OTP).");
    })
    .catch((error) => {
      console.error("Demo seed failed:", error.message);
      process.exitCode = 1;
    });
}
