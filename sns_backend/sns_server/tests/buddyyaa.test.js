import test from "node:test";
import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import { io as connectSocket } from "socket.io-client";

process.env.ACCESS_TOKEN_SECRET = "test-access-secret-that-is-at-least-32-characters";
process.env.REFRESH_TOKEN_SECRET = "test-refresh-secret-that-is-at-least-32-characters";
process.env.ADMIN_SESSION_SECRET = "test-admin-session-secret-that-is-at-least-32-characters";
process.env.CUSTOMER_DEV_LOGIN = "true";

const { buildApp } = await import("../app.js");
const { Admin, Buddy, Customer } = await import("../src/models/user.js");
const Category = (await import("../src/models/category.js")).default;
const Counter = (await import("../src/models/counter.js")).default;
const Inventory = (await import("../src/models/inventory.js")).default;
const Order = (await import("../src/models/order.js")).default;
const Product = (await import("../src/models/products.js")).default;
const AdminSession = (await import("../src/models/admin-session.js")).default;

const accessSecret = process.env.ACCESS_TOKEN_SECRET;
const tokenFor = (account) =>
  jwt.sign(
    { sub: String(account._id), role: account.role },
    accessSecret,
    {
      expiresIn: "1h",
      issuer: "buddyyaa-api",
      audience: "buddyyaa-client",
    }
  );
const auth = (account) => ({ authorization: `Bearer ${tokenFor(account)}` });
const point = { latitude: 12.972, longitude: 77.5955 };
const deliveryLocation = { ...point, address: "Test address" };

let mongoServer;
let app;
let fixture;

const createOrder = (customer, payload = {}) =>
  app.inject({
    method: "POST",
    url: "/orders/create",
    headers: auth(customer),
    payload: {
      deliveryType: "NORMAL",
      items: [{ productId: fixture.milk._id, quantity: 1 }],
      deliveryLocation,
      ...payload,
    },
  });

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  app = await buildApp({ mongoUri: mongoServer.getUri() });
});

test.beforeEach(async () => {
  await Promise.all([
    Admin.deleteMany({}),
    Buddy.deleteMany({}),
    Customer.deleteMany({}),
    Category.deleteMany({}),
    Counter.deleteMany({}),
    Inventory.deleteMany({}),
    Order.deleteMany({}),
    Product.deleteMany({}),
    AdminSession.deleteMany({}),
  ]);

  const category = await Category.create({
    name: "Groceries",
    image: "https://example.com/category.png",
  });
  const [milk, bread, eggs, inactiveProduct] = await Product.create([
    {
      name: "Milk",
      image: "https://example.com/milk.png",
      category: category._id,
      quantity: "1 L",
      price: 50,
      discountPrice: 45,
      isActive: true,
    },
    {
      name: "Bread",
      image: "https://example.com/bread.png",
      category: category._id,
      quantity: "1 pack",
      price: 45,
      isActive: true,
    },
    {
      name: "Eggs",
      image: "https://example.com/eggs.png",
      category: category._id,
      quantity: "12",
      price: 90,
      isActive: true,
    },
    {
      name: "Inactive",
      image: "https://example.com/inactive.png",
      category: category._id,
      quantity: "1",
      price: 10,
      isActive: false,
    },
  ]);
  const passwordHash = await bcrypt.hash("buddy-password-123", 4);
  const [nearBuddy, farBuddy, disabledBuddy] = await Buddy.create([
    {
      name: "Near Buddy",
      phone: "9000000001",
      email: "near@example.com",
      passwordHash,
      isApproved: true,
      isActive: true,
      location: { latitude: 12.9716, longitude: 77.5946 },
    },
    {
      name: "Far Buddy",
      phone: "9000000002",
      email: "far@example.com",
      passwordHash,
      isApproved: true,
      isActive: true,
      location: { latitude: 12.9735, longitude: 77.5975 },
    },
    {
      name: "Disabled Buddy",
      phone: "9000000003",
      email: "disabled@example.com",
      passwordHash,
      isApproved: false,
      isActive: false,
      location: { latitude: 12.9717, longitude: 77.5947 },
    },
  ]);
  await Inventory.create([
    { buddy: nearBuddy._id, product: milk._id, availableQuantity: 5 },
    { buddy: nearBuddy._id, product: bread._id, availableQuantity: 2 },
    { buddy: nearBuddy._id, product: inactiveProduct._id, availableQuantity: 10 },
    { buddy: farBuddy._id, product: milk._id, availableQuantity: 4 },
    { buddy: farBuddy._id, product: bread._id, availableQuantity: 8 },
    { buddy: farBuddy._id, product: eggs._id, availableQuantity: 10 },
    { buddy: disabledBuddy._id, product: milk._id, availableQuantity: 20 },
  ]);
  const customer = await Customer.create({
    name: "Jane Customer",
    phone: "9999911111",
    role: "Customer",
  });
  const otherCustomer = await Customer.create({
    name: "Other Customer",
    phone: "9999922222",
    role: "Customer",
  });
  const admin = await Admin.create({
    name: "Platform Admin",
    email: "admin@example.com",
    passwordHash: await bcrypt.hash("admin-password-123", 4),
  });

  fixture = {
    category,
    milk,
    bread,
    eggs,
    inactiveProduct,
    nearBuddy,
    farBuddy,
    disabledBuddy,
    customer,
    otherCustomer,
    admin,
  };
});

test.after(async () => {
  if (app) await app.close();
  if (mongoServer) await mongoServer.stop();
});

test("root, health, readiness and API routes are registered", async () => {
  const root = await app.inject({ method: "GET", url: "/" });
  assert.equal(root.statusCode, 200);
  assert.equal(root.json().name, "Buddyyaa API");

  const health = await app.inject({ method: "GET", url: "/health" });
  assert.equal(health.statusCode, 200);
  assert.equal(health.json().database.connected, true);
  assert.equal((await app.inject({ method: "GET", url: "/ready" })).statusCode, 200);

  const routeTree = app.printRoutes({ commonPrefix: false });
  for (const route of [
    "categories",
    "products",
    "ufd",
    "auth",
    "orders",
    "buddies",
    "admin",
  ]) {
    assert.match(routeTree, new RegExp(route));
  }
});

test("server startup rejects a missing MongoDB URI", async () => {
  await assert.rejects(
    buildApp({ mongoUri: "" }),
    /MONGO_URI is required/
  );
});

test("catalogue returns active products and UFD returns only the nearest Buddy's stock", async () => {
  const catalogue = await app.inject({ method: "GET", url: "/products" });
  assert.equal(catalogue.statusCode, 200);
  assert.deepEqual(
    catalogue.json().products.map((product) => product.name).sort(),
    ["Bread", "Eggs", "Milk"]
  );

  const ufd = await app.inject({
    method: "GET",
    url: `/products/ufd?latitude=${point.latitude}&longitude=${point.longitude}`,
  });
  assert.equal(ufd.statusCode, 200);
  assert.equal(String(ufd.json().buddy.id), String(fixture.nearBuddy._id));
  assert.deepEqual(
    ufd.json().products.map((product) => product.name).sort(),
    ["Bread", "Milk"]
  );
});

test("customer login, refresh, profile, and own-order authorization work", async () => {
  const login = await app.inject({
    method: "POST",
    url: "/auth/customer/login",
    payload: { phone: "9999933333" },
  });
  assert.equal(login.statusCode, 200);
  assert.ok(login.json().accessToken);
  const refresh = await app.inject({
    method: "POST",
    url: "/auth/refresh",
    payload: { refreshToken: login.json().refreshToken },
  });
  assert.equal(refresh.statusCode, 200);

  const profile = await app.inject({
    method: "GET",
    url: "/auth/me",
    headers: { authorization: `Bearer ${refresh.json().accessToken}` },
  });
  assert.equal(profile.statusCode, 200);
  assert.equal(profile.json().user.phone, "9999933333");

  const order = await createOrder(fixture.customer);
  assert.equal(order.statusCode, 201);
  const privateRead = await app.inject({
    method: "GET",
    url: `/orders/${order.json().order._id}`,
    headers: auth(fixture.otherCustomer),
  });
  assert.equal(privateRead.statusCode, 403);
});

test("Buddy login verifies passwords and blocks inactive or unapproved Buddies", async () => {
  const active = await app.inject({
    method: "POST",
    url: "/auth/buddy/login",
    payload: { email: "near@example.com", password: "buddy-password-123" },
  });
  assert.equal(active.statusCode, 200);
  assert.ok(active.json().accessToken);

  const invalidPassword = await app.inject({
    method: "POST",
    url: "/auth/buddy/login",
    payload: { email: "near@example.com", password: "incorrect-password" },
  });
  assert.equal(invalidPassword.statusCode, 401);

  const disabled = await app.inject({
    method: "POST",
    url: "/auth/buddy/login",
    payload: { email: "disabled@example.com", password: "buddy-password-123" },
  });
  assert.equal(disabled.statusCode, 403);
});

test("UFD checkout stays with selected Buddy and rejects stale stock without switching", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/orders/create",
    headers: auth(fixture.customer),
    payload: {
      deliveryType: "UFD",
      selectedBuddyId: fixture.nearBuddy._id,
      items: [{ productId: fixture.milk._id, quantity: 2 }],
      deliveryLocation,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(String(created.json().order.buddy._id), String(fixture.nearBuddy._id));
  assert.equal(created.json().order.totalPrice, 90);

  await Inventory.updateOne(
    { buddy: fixture.nearBuddy._id, product: fixture.milk._id },
    { $set: { availableQuantity: 0 } }
  );
  const stale = await app.inject({
    method: "POST",
    url: "/orders/create",
    headers: auth(fixture.customer),
    payload: {
      deliveryType: "UFD",
      selectedBuddyId: fixture.nearBuddy._id,
      items: [{ productId: fixture.milk._id, quantity: 1 }],
      deliveryLocation,
    },
  });
  assert.equal(stale.statusCode, 409);
  const substitutedBuddy = await app.inject({
    method: "POST",
    url: "/orders/create",
    headers: auth(fixture.customer),
    payload: {
      deliveryType: "UFD",
      selectedBuddyId: fixture.farBuddy._id,
      items: [{ productId: fixture.milk._id, quantity: 1 }],
      deliveryLocation,
    },
  });
  assert.equal(substitutedBuddy.statusCode, 409);
  assert.equal(await Order.countDocuments(), 1);
  assert.equal(
    (await Inventory.findOne({ buddy: fixture.farBuddy._id, product: fixture.milk._id }))
      .availableQuantity,
    4
  );
});

test("NORMAL chooses the nearest Buddy able to fulfill the entire basket", async () => {
  const response = await createOrder(fixture.customer, {
    items: [
      { productId: fixture.milk._id, quantity: 1 },
      { productId: fixture.bread._id, quantity: 1 },
      { productId: fixture.eggs._id, quantity: 1 },
    ],
    deliveryLocation,
    totalPrice: 0,
  });
  assert.equal(response.statusCode, 201);
  assert.equal(String(response.json().order.buddy._id), String(fixture.farBuddy._id));
  assert.equal(response.json().order.totalPrice, 180);

  const ordersBeforeFailure = await Order.countDocuments();
  const impossible = await createOrder(fixture.customer, {
    items: [
      { productId: fixture.milk._id, quantity: 100 },
      { productId: fixture.bread._id, quantity: 100 },
      { productId: fixture.eggs._id, quantity: 100 },
    ],
  });
  assert.equal(impossible.statusCode, 409);
  assert.equal(await Order.countDocuments(), ordersBeforeFailure);
});

test("concurrent checkouts do not oversell the same Buddy's inventory", async () => {
  await Inventory.updateOne(
    { buddy: fixture.farBuddy._id, product: fixture.milk._id },
    { $set: { availableQuantity: 0 } }
  );
  const requests = await Promise.all([
    createOrder(fixture.customer, {
      items: [{ productId: fixture.milk._id, quantity: 4 }],
    }),
    createOrder(fixture.otherCustomer, {
      items: [{ productId: fixture.milk._id, quantity: 4 }],
    }),
  ]);
  assert.deepEqual(
    requests.map((response) => response.statusCode).sort(),
    [201, 409]
  );
  const stock = await Inventory.findOne({
    buddy: fixture.nearBuddy._id,
    product: fixture.milk._id,
  });
  assert.equal(stock.availableQuantity, 1);
  assert.equal(stock.reservedQuantity, 4);
  assert.equal(await Order.countDocuments({ status: "pending" }), 1);
});

test("idempotent order creation reserves inventory once", async () => {
  const payload = {
    deliveryType: "NORMAL",
    items: [{ productId: fixture.milk._id, quantity: 1 }],
    deliveryLocation,
    idempotencyKey: "checkout-once",
  };
  const first = await createOrder(fixture.customer, payload);
  const second = await createOrder(fixture.customer, payload);
  assert.equal(first.statusCode, 201);
  assert.equal(second.statusCode, 200);
  assert.equal(
    String(first.json().order._id),
    String(second.json().order._id)
  );
  const conflictingReuse = await createOrder(fixture.customer, {
    ...payload,
    items: [{ productId: fixture.milk._id, quantity: 2 }],
  });
  assert.equal(conflictingReuse.statusCode, 409);
  assert.equal(await Order.countDocuments({ customer: fixture.customer._id }), 1);
  const otherCustomerOrder = await createOrder(fixture.otherCustomer, payload);
  assert.equal(otherCustomerOrder.statusCode, 201);
  assert.notEqual(
    String(otherCustomerOrder.json().order._id),
    String(first.json().order._id)
  );
  const stock = await Inventory.findOne({
    buddy: fixture.nearBuddy._id,
    product: fixture.milk._id,
  });
  assert.equal(stock.availableQuantity, 3);
  assert.equal(stock.reservedQuantity, 2);
});

test("order acceptance, assignment authorization, transitions, and cancellation are safe", async () => {
  const response = await createOrder(fixture.customer);
  const orderId = response.json().order._id;
  const accept = (buddy) =>
    app.inject({
      method: "POST",
      url: "/orders/confirm",
      headers: auth(buddy),
      payload: { orderId },
    });

  const unrelated = await accept(fixture.farBuddy);
  assert.equal(unrelated.statusCode, 403);
  assert.equal((await accept(fixture.nearBuddy)).statusCode, 200);
  assert.equal((await accept(fixture.nearBuddy)).statusCode, 409);
  const preparing = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/status`,
    headers: auth(fixture.nearBuddy),
    payload: { status: "preparing" },
  });
  assert.equal(preparing.statusCode, 200);

  const customerCancel = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/status`,
    headers: auth(fixture.customer),
    payload: { status: "cancelled" },
  });
  assert.equal(customerCancel.statusCode, 409);

  const customerOrder = await createOrder(fixture.otherCustomer);
  const beforeCancellation = await Inventory.findOne({
    buddy: fixture.nearBuddy._id,
    product: fixture.milk._id,
  });
  const cancelled = await app.inject({
    method: "PATCH",
    url: `/orders/${customerOrder.json().order._id}/status`,
    headers: auth(fixture.otherCustomer),
    payload: { status: "cancelled" },
  });
  assert.equal(cancelled.statusCode, 200);
  await app.inject({
    method: "PATCH",
    url: `/orders/${customerOrder.json().order._id}/status`,
    headers: auth(fixture.otherCustomer),
    payload: { status: "cancelled" },
  });
  const restored = await Inventory.findOne({
    buddy: fixture.nearBuddy._id,
    product: fixture.milk._id,
  });
  assert.equal(restored.availableQuantity, beforeCancellation.availableQuantity + 1);
  assert.equal(restored.reservedQuantity, beforeCancellation.reservedQuantity - 1);
});

test("admin reassignment moves reservations and the new Buddy completes delivery once", async () => {
  const created = await createOrder(fixture.customer);
  const orderId = created.json().order._id;
  const reassigned = await app.inject({
    method: "PATCH",
    url: `/api/admin/orders/${orderId}/assign-buddy`,
    headers: auth(fixture.admin),
    payload: { buddyId: fixture.farBuddy._id },
  });
  assert.equal(reassigned.statusCode, 200);
  assert.equal(String(reassigned.json().order.buddy._id), String(fixture.farBuddy._id));

  const nearStock = await Inventory.findOne({
    buddy: fixture.nearBuddy._id,
    product: fixture.milk._id,
  });
  const farStock = await Inventory.findOne({
    buddy: fixture.farBuddy._id,
    product: fixture.milk._id,
  });
  assert.equal(nearStock.availableQuantity, 5);
  assert.equal(nearStock.reservedQuantity, 0);
  assert.equal(farStock.availableQuantity, 3);
  assert.equal(farStock.reservedQuantity, 1);

  const unrelatedAccept = await app.inject({
    method: "POST",
    url: "/orders/confirm",
    headers: auth(fixture.nearBuddy),
    payload: { orderId },
  });
  assert.equal(unrelatedAccept.statusCode, 403);
  const accepted = await app.inject({
    method: "POST",
    url: "/orders/confirm",
    headers: auth(fixture.farBuddy),
    payload: { orderId },
  });
  assert.equal(accepted.statusCode, 200);

  for (const status of ["preparing", "out_for_delivery"]) {
    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/status`,
      headers: auth(fixture.farBuddy),
      payload: { status },
    });
    assert.equal(response.statusCode, 200);
  }
  const locationUpdate = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/location`,
    headers: auth(fixture.farBuddy),
    payload: { latitude: 12.974, longitude: 77.599 },
  });
  assert.equal(locationUpdate.statusCode, 200);
  assert.equal(locationUpdate.json().tracking.deliveryPersonLocation.latitude, 12.974);
  const tracking = await app.inject({
    method: "GET",
    url: `/orders/${orderId}/tracking`,
    headers: auth(fixture.customer),
  });
  assert.equal(tracking.statusCode, 200);
  assert.equal(tracking.json().tracking.deliveryLocation.address, "Test address");
  const unauthorizedDelivery = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/status`,
    headers: auth(fixture.nearBuddy),
    payload: { status: "delivered" },
  });
  assert.equal(unauthorizedDelivery.statusCode, 403);
  const delivered = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/status`,
    headers: auth(fixture.farBuddy),
    payload: { status: "delivered" },
  });
  assert.equal(delivered.statusCode, 200);
  const repeatedDelivery = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/status`,
    headers: auth(fixture.farBuddy),
    payload: { status: "delivered" },
  });
  assert.equal(repeatedDelivery.statusCode, 200);
  const finalStock = await Inventory.findOne({
    buddy: fixture.farBuddy._id,
    product: fixture.milk._id,
  });
  assert.equal(finalStock.availableQuantity, 3);
  assert.equal(finalStock.reservedQuantity, 0);
  assert.equal(
    finalStock.reservations.find((reservation) => String(reservation.order) === String(orderId))
      .state,
    "consumed"
  );
});

test("Socket.IO authenticates clients, authorizes order rooms, and persists location before broadcast", async () => {
  const created = await createOrder(fixture.customer);
  const orderId = created.json().order._id;
  const accepted = await app.inject({
    method: "POST",
    url: "/orders/confirm",
    headers: auth(fixture.nearBuddy),
    payload: { orderId },
  });
  assert.equal(accepted.statusCode, 200);

  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const connect = (account) =>
    new Promise((resolve, reject) => {
      const socket = connectSocket(address, {
        auth: { token: tokenFor(account) },
        transports: ["websocket"],
        reconnection: false,
      });
      socket.once("connect", () => resolve(socket));
      socket.once("connect_error", reject);
    });

  const customerSocket = await connect(fixture.customer);
  const otherSocket = await connect(fixture.otherCustomer);
  const buddySocket = await connect(fixture.nearBuddy);
  try {
    const joined = await new Promise((resolve) =>
      customerSocket.emit("order:join", { orderId }, resolve)
    );
    assert.equal(joined.joined, true);
    const denied = await new Promise((resolve) =>
      otherSocket.emit("order:join", { orderId }, resolve)
    );
    assert.match(denied.error, /not authorized/i);

    const eventReceived = new Promise((resolve) =>
      customerSocket.once("delivery:location", resolve)
    );
    const update = await new Promise((resolve) =>
      buddySocket.emit(
        "delivery:location",
        { orderId, latitude: 12.975, longitude: 77.6 },
        resolve
      )
    );
    assert.equal(update.persisted, true);
    const event = await eventReceived;
    assert.equal(event.deliveryPersonLocation.latitude, 12.975);
    const saved = await Order.findById(orderId);
    assert.equal(saved.deliveryPersonLocation.longitude, 77.6);
  } finally {
    customerSocket.disconnect();
    otherSocket.disconnect();
    buddySocket.disconnect();
  }
});

const stall = { latitude: 12.9716, longitude: 77.5946 };
const fiveKmFromStall = { latitude: 13.0166, longitude: 77.5946 };
const nearestUfdBuddyAtStall = async () => {
  const ufd = await app.inject({
    method: "GET",
    url: `/products/ufd?latitude=${stall.latitude}&longitude=${stall.longitude}`,
  });
  assert.equal(ufd.statusCode, 200);
  return String(ufd.json().buddy.id);
};

test("a Buddy's stall location is unchanged by delivery location pings", async () => {
  const buddy = fixture.nearBuddy;
  assert.deepEqual((await Buddy.findById(buddy._id).lean()).location, stall);
  const created = await createOrder(fixture.customer);
  assert.equal(created.statusCode, 201);
  const orderId = created.json().order._id;
  assert.equal(String(created.json().order.buddy._id), String(buddy._id));
  const accepted = await app.inject({
    method: "POST",
    url: "/orders/confirm",
    headers: auth(buddy),
    payload: { orderId },
  });
  assert.equal(accepted.statusCode, 200);
  for (const status of ["preparing", "out_for_delivery"]) {
    const response = await app.inject({
      method: "PATCH",
      url: `/orders/${orderId}/status`,
      headers: auth(buddy),
      payload: { status },
    });
    assert.equal(response.statusCode, 200);
  }

  const ping = await app.inject({
    method: "PATCH",
    url: `/orders/${orderId}/location`,
    headers: auth(buddy),
    payload: fiveKmFromStall,
  });
  assert.equal(ping.statusCode, 200);

  const saved = await Buddy.findById(buddy._id).lean();
  assert.deepEqual(saved.location, stall);
  assert.deepEqual(saved.liveLocation, fiveKmFromStall);
  assert.ok(saved.liveLocationUpdatedAt instanceof Date);
  const order = await Order.findById(orderId).lean();
  assert.deepEqual(order.deliveryPersonLocation, fiveKmFromStall);
  assert.equal(await nearestUfdBuddyAtStall(), String(buddy._id));
});

test("a Buddy's stall location is unchanged by Socket.IO delivery location pings", async () => {
  const buddy = fixture.nearBuddy;
  const created = await createOrder(fixture.customer);
  const orderId = created.json().order._id;
  const accepted = await app.inject({
    method: "POST",
    url: "/orders/confirm",
    headers: auth(buddy),
    payload: { orderId },
  });
  assert.equal(accepted.statusCode, 200);

  const address = app.server.listening
    ? `http://127.0.0.1:${app.server.address().port}`
    : await app.listen({ host: "127.0.0.1", port: 0 });
  const buddySocket = await new Promise((resolve, reject) => {
    const socket = connectSocket(address, {
      auth: { token: tokenFor(buddy) },
      transports: ["websocket"],
      reconnection: false,
    });
    socket.once("connect", () => resolve(socket));
    socket.once("connect_error", reject);
  });
  try {
    const update = await new Promise((resolve) =>
      buddySocket.emit("delivery:location", { orderId, ...fiveKmFromStall }, resolve)
    );
    assert.equal(update.persisted, true);
  } finally {
    buddySocket.disconnect();
  }

  const saved = await Buddy.findById(buddy._id).lean();
  assert.deepEqual(saved.location, stall);
  assert.deepEqual(saved.liveLocation, fiveKmFromStall);
  assert.ok(saved.liveLocationUpdatedAt instanceof Date);
  const order = await Order.findById(orderId).lean();
  assert.deepEqual(order.deliveryPersonLocation, fiveKmFromStall);
  assert.equal(await nearestUfdBuddyAtStall(), String(buddy._id));
});

test("admin API and AdminJS require real admin credentials", async () => {
  const forbidden = await app.inject({ method: "GET", url: "/api/admin/buddies" });
  assert.equal(forbidden.statusCode, 401);
  const list = await app.inject({
    method: "GET",
    url: "/api/admin/buddies",
    headers: auth(fixture.admin),
  });
  assert.equal(list.statusCode, 200);
  assert.equal(list.json().buddies.length, 3);

  const badLogin = await app.inject({
    method: "POST",
    url: "/auth/admin/login",
    payload: { email: "admin@example.com", password: "incorrect-password" },
  });
  assert.equal(badLogin.statusCode, 401);
  const goodLogin = await app.inject({
    method: "POST",
    url: "/auth/admin/login",
    payload: { email: "admin@example.com", password: "admin-password-123" },
  });
  assert.equal(goodLogin.statusCode, 200);
  assert.ok(goodLogin.json().accessToken);

  const loginPage = await app.inject({ method: "GET", url: "/admin/login" });
  assert.equal(loginPage.statusCode, 200);
  const panelLogin = await app.inject({
    method: "POST",
    url: "/admin/login",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    payload: new URLSearchParams({
      email: "admin@example.com",
      password: "admin-password-123",
    }).toString(),
  });
  assert.ok([302, 303].includes(panelLogin.statusCode));
  assert.match(panelLogin.headers["set-cookie"] || "", /buddyyaa-admin/);
  const cookie = panelLogin.headers["set-cookie"].split(";")[0];
  const authenticatedDashboard = await app.inject({
    method: "GET",
    url: "/admin",
    headers: { cookie },
  });
  assert.equal(authenticatedDashboard.statusCode, 200);
  const logout = await app.inject({
    method: "GET",
    url: "/admin/logout",
    headers: { cookie },
  });
  assert.equal(logout.statusCode, 302);
  const dashboard = await app.inject({ method: "GET", url: "/admin" });
  assert.ok([302, 303].includes(dashboard.statusCode));
});

test("admin can provision, approve, and stock a Buddy through protected APIs", async () => {
  const created = await app.inject({
    method: "POST",
    url: "/api/admin/buddies",
    headers: auth(fixture.admin),
    payload: {
      name: "New Buddy",
      email: "new@example.com",
      phone: "9000000004",
      password: "new-buddy-password",
      address: "New address",
      location: point,
    },
  });
  assert.equal(created.statusCode, 201);
  assert.equal(created.json().buddy.isApproved, false);
  assert.equal(created.json().buddy.passwordHash, undefined);
  const buddyId = created.json().buddy.id;

  const approval = await app.inject({
    method: "PATCH",
    url: `/api/admin/buddies/${buddyId}/status`,
    headers: auth(fixture.admin),
    payload: { isApproved: true, isActive: true },
  });
  assert.equal(approval.statusCode, 200);

  const stock = await app.inject({
    method: "PUT",
    url: "/api/admin/inventory",
    headers: auth(fixture.admin),
    payload: {
      buddyId,
      productId: fixture.milk._id,
      availableQuantity: 7,
    },
  });
  assert.equal(stock.statusCode, 200);
  assert.equal(stock.json().inventory.availableQuantity, 7);
});

test("Buddies can update available stock only in their own active inventory", async () => {
  const buddyHeaders = auth(fixture.nearBuddy);
  const invalid = await app.inject({
    method: "PATCH",
    url: "/buddies/me/inventory",
    headers: buddyHeaders,
    payload: { productId: fixture.milk._id, availableQuantity: -1 },
  });
  assert.equal(invalid.statusCode, 400);

  const updated = await app.inject({
    method: "PATCH",
    url: "/buddies/me/inventory",
    headers: buddyHeaders,
    payload: {
      buddyId: fixture.farBuddy._id,
      productId: fixture.milk._id,
      availableQuantity: 3,
    },
  });
  assert.equal(updated.statusCode, 200);
  assert.equal(updated.json().inventory.availableQuantity, 3);

  const [nearStock, farStock] = await Promise.all([
    Inventory.findOne({ buddy: fixture.nearBuddy._id, product: fixture.milk._id }),
    Inventory.findOne({ buddy: fixture.farBuddy._id, product: fixture.milk._id }),
  ]);
  assert.equal(nearStock.availableQuantity, 3);
  assert.equal(farStock.availableQuantity, 4);

  const missing = await app.inject({
    method: "PATCH",
    url: "/buddies/me/inventory",
    headers: buddyHeaders,
    payload: { productId: fixture.eggs._id, availableQuantity: 2 },
  });
  assert.equal(missing.statusCode, 404);

  const unauthenticated = await app.inject({
    method: "PATCH",
    url: "/buddies/me/inventory",
    payload: { productId: fixture.milk._id, availableQuantity: 2 },
  });
  assert.equal(unauthenticated.statusCode, 401);
});

const seedOrders = async (count) => {
  const base = Date.parse("2026-01-01T00:00:00.000Z");
  const docs = Array.from({ length: count }, (_, index) => ({
    _id: new mongoose.Types.ObjectId(),
    orderId: `ORDR9${String(index).padStart(4, "0")}`,
    customer: fixture.customer._id,
    buddy: fixture.nearBuddy._id,
    deliveryType: "NORMAL",
    items: [{ product: fixture.milk._id, quantity: 1, price: 45, name: "Milk" }],
    deliveryLocation,
    status: "pending",
    inventoryState: "reserved",
    totalPrice: 45,
    createdAt: new Date(base + index * 1000),
    updatedAt: new Date(base + index * 1000),
  }));
  await Order.collection.insertMany(docs);
  return docs;
};
const listOrders = (account, query = "") =>
  app.inject({ method: "GET", url: `/orders${query}`, headers: auth(account) });

test("order list is paginated and cursor-stable", async () => {
  const seeded = await seedOrders(30);
  const first = await listOrders(fixture.customer);
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().orders.length, 25);
  assert.equal(first.json().pageInfo.hasMore, true);
  assert.equal(typeof first.json().pageInfo.nextCursor, "string");

  const second = await listOrders(
    fixture.customer,
    `?cursor=${encodeURIComponent(first.json().pageInfo.nextCursor)}`
  );
  assert.equal(second.statusCode, 200);
  assert.equal(second.json().orders.length, 5);
  assert.equal(second.json().pageInfo.hasMore, false);
  assert.equal(second.json().pageInfo.nextCursor, null);

  const pagedIds = [...first.json().orders, ...second.json().orders].map((order) => order._id);
  assert.equal(new Set(pagedIds).size, 30);
  const newestFirst = [...seeded].reverse().map((order) => String(order._id));
  assert.deepEqual(pagedIds, newestFirst);

  for (const limit of ["101", "abc", "0", "-1", "1.5"]) {
    assert.equal((await listOrders(fixture.customer, `?limit=${limit}`)).statusCode, 400, `limit=${limit}`);
  }
  const small = await listOrders(fixture.customer, "?limit=10");
  assert.equal(small.json().orders.length, 10);
  assert.equal(small.json().pageInfo.hasMore, true);
  const garbage = await listOrders(fixture.customer, "?cursor=garbage");
  assert.equal(garbage.statusCode, 200);
  assert.equal(garbage.json().orders.length, 25);
});

test("order list populates only list fields while order detail stays fully populated", async () => {
  const created = await createOrder(fixture.customer);
  const orderId = created.json().order._id;
  const list = await listOrders(fixture.customer);
  const [row] = list.json().orders;
  assert.equal(row._id, orderId);
  assert.equal(row.customer, String(fixture.customer._id));
  assert.equal(row.items[0].product, String(fixture.milk._id));
  assert.equal(row.items[0].name, "Milk");
  assert.deepEqual(Object.keys(row.buddy).sort(), ["_id", "name"]);
  assert.deepEqual(row.allowedStatuses, ["confirmed", "cancelled"]);

  const detail = await app.inject({ method: "GET", url: `/orders/${orderId}`, headers: auth(fixture.customer) });
  assert.equal(detail.json().order.customer.name, "Jane Customer");
  assert.equal(detail.json().order.items[0].product.name, "Milk");
  assert.ok(detail.json().order.buddy.location);
});

test("order indexes exist", async () => {
  await Order.init();
  const indexes = await Order.collection.indexes();
  const names = indexes.map((index) => index.name);
  for (const name of ["customer_1_createdAt_-1", "buddy_1_createdAt_-1", "status_1_createdAt_-1"]) {
    assert.ok(names.includes(name), `missing index ${name}`);
  }
  const idempotency = indexes.find((index) => index.name === "customer_1_idempotencyKey_1");
  assert.equal(idempotency.unique, true);
  assert.deepEqual(idempotency.partialFilterExpression, { idempotencyKey: { $type: "string" } });
});
