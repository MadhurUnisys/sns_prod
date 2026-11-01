# Buddyyaa API reference

Unless stated otherwise, JSON endpoints return `{ "message": "..." }` errors with an appropriate 4xx/5xx status. Protected routes require `Authorization: Bearer <accessToken>`. Access tokens carry the verified account identity and role; private resource access is checked against the persisted order.

## Diagnostics

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/` | Public | API name, docs path, health/readiness paths |
| GET | `/health` | Public | Liveness and database-connected boolean |
| GET | `/ready` | Public | Readiness; returns 503 until MongoDB is connected |

The root path intentionally returns API metadata rather than a customer homepage.

## Authentication and profile

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| POST | `/auth/login` | Public | Backward-compatible customer login alias |
| POST | `/auth/customer/login` | Public | Development-only phone login; requires `CUSTOMER_DEV_LOGIN=true` and non-production mode |
| POST | `/auth/buddy/login` | Public | Buddy email/password login; requires an approved, active Buddy |
| POST | `/auth/login-delivery-partner` | Public | Legacy login-path alias; authenticates the canonical Buddy account |
| POST | `/auth/admin/login` | Public | Admin email/password login |
| POST | `/auth/refresh` | Public | Exchange a valid refresh token for new tokens |
| GET | `/auth/me` | Any authenticated role | Fetch the authenticated account profile |
| PATCH | `/auth/me` | Customer | Update own name, address, saved locations, or live location |

Customer phone login is not OTP-backed and is not enabled in production. Admin and Buddy passwords use bcrypt hashes.

## Catalogue

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/categories` | Public | List active categories |
| GET | `/categories/:id` | Public | Fetch one active category |
| POST | `/categories` | Admin | Create a category |
| PATCH | `/categories/:id` | Admin | Update category fields/listing status |
| GET | `/products` | Public | List active catalogue products; optional `?categoryId=` |
| GET | `/products/:id` | Public | Fetch one active product |
| GET | `/products/ufd?latitude=&longitude=` | Public | Nearest eligible Buddy plus only that Buddy's active in-stock products |
| POST | `/products` | Admin | Create a catalogue product |
| PATCH | `/products/:id` | Admin | Update product/listing details |

Catalogue endpoints do not imply that every Buddy stocks a product. UFD responses include the selected Buddy ID, name, location, distance, and `availableQuantity` per returned product.

## Buddy and inventory

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| GET | `/buddies/me/inventory` | Buddy | Fetch own inventory |
| PATCH | `/buddies/me/inventory` | Buddy | Set available quantity for a product already in own active inventory |
| PATCH | `/buddies/me` | Buddy | Set own availability, stall location, or address |
| GET | `/api/admin/buddies` | Admin | List Buddies without password hashes |
| POST | `/api/admin/buddies` | Admin | Create a disabled, unapproved Buddy |
| PATCH | `/api/admin/buddies/:id/status` | Admin | Approve/activate or deactivate a Buddy |
| GET | `/api/admin/inventory?buddyId=` | Admin | View a Buddy's inventory |
| PUT | `/api/admin/inventory` | Admin | Create or set Buddy/product stock |

New Buddies cannot log in or receive orders until approved and active. The unique inventory key is `(buddy, product)`.

A Buddy has two separate positions. `location`, set with `PATCH /buddies/me` (or by an Admin at provisioning), is the stall location: it is used to match orders to Buddies and is copied onto new orders as `pickupLocation`. `liveLocation` is the live courier position. `PATCH /orders/:id/location` and the `delivery:location` Socket.IO event write only `liveLocation` and the order's `deliveryPersonLocation`. They never change `location`, so they never affect matching.

Buddies may update only `availableQuantity` for their own existing active inventory rows with `PATCH /buddies/me/inventory` and `{ "productId": "...", "availableQuantity": 12 }`. They cannot create inventory rows, change another Buddy's stock, or alter reserved quantities or reservation records; administrators provision products and manage inventory activation.

## Orders and delivery tracking

| Method | Path | Authentication | Purpose |
|---|---|---|---|
| POST | `/orders/create` | Customer | Create one UFD or NORMAL order; customer ID comes from token |
| GET | `/orders` | Customer, Buddy, Admin | List own customer orders, assigned Buddy orders, or all orders for Admin; optional valid `?status=` |
| GET | `/orders/:id` | Customer, assigned Buddy, Admin | Fetch an authorized order |
| GET | `/orders/:id/tracking` | Customer, assigned Buddy, Admin | Fetch destination, pickup, status, and delivery coordinates |
| POST | `/orders/confirm` | Assigned Buddy or Admin | Accept a pending assigned order |
| PATCH | `/orders/:id/status` | Customer, assigned Buddy, Admin | Customer may cancel own pending order; Buddy/Admin use valid lifecycle transitions |
| POST | `/orders/update-status` | Customer, assigned Buddy, Admin | Compatibility status endpoint; same authorization and lifecycle checks |
| PATCH | `/orders/:id/location` | Assigned Buddy | Persist live courier position (not the stall location), then emit realtime tracking |
| PATCH | `/orders/track/location` | Assigned Buddy | Compatibility location endpoint |
| PATCH | `/api/admin/orders/:id/assign-buddy` | Admin | Reassign a pending order only after reserving the new Buddy's full basket |

Create-order body shape:

```json
{
  "deliveryType": "UFD",
  "selectedBuddyId": "Buddy ID from the UFD catalogue",
  "items": [{ "productId": "Product ID", "quantity": 2 }],
  "deliveryLocation": {
    "latitude": 12.97,
    "longitude": 77.59,
    "address": "Delivery address"
  },
  "idempotencyKey": "optional-client-generated-unique-key"
}
```

For NORMAL delivery omit `selectedBuddyId`; the server chooses the nearest active Buddy able to fulfill every requested quantity. The server ignores client prices and snapshots catalogue prices. UFD requires the selected Buddy ID and never switches to another Buddy at checkout. Coordinates must be numeric values within latitude/longitude ranges.

Statuses: `pending → confirmed → preparing → arriving → out_for_delivery → delivered`; cancellation is available before dispatch according to server transition rules. Customers can cancel only a pending order. Stock is reserved at order creation, restored once for cancellation, and consumed once on delivery. Order IDs are sequential `ORDR00001` style IDs.

## AdminJS

AdminJS is mounted at `/admin`, with session-authenticated dashboard and Mongo-backed session persistence. It includes Admin, Customer, Buddy, Category, Product, Buddy inventory, Fulfillment issue, Order, and Counter resources. Password hashes and inventory reservation ledgers are hidden from normal list views; inventory edits, order status changes, and order reassignment use validated actions rather than raw AdminJS edits.

Create the first administrator with `npm run admin:create` after setting `ADMIN_BOOTSTRAP_NAME`, `ADMIN_BOOTSTRAP_EMAIL`, `ADMIN_BOOTSTRAP_PASSWORD`, and `MONGO_URI` in the environment.

## Socket.IO

Connect to the same origin with a valid access token in `auth.token` or a Bearer authorization header. Invalid/expired tokens and inactive accounts are rejected.

| Direction | Event | Payload / behavior |
|---|---|---|
| Client → server | `order:join` | `{ "orderId": "..." }`; joins only if caller is the customer, assigned Buddy, or Admin |
| Client → server | `delivery:location` | `{ "orderId": "...", "latitude": 12.9, "longitude": 77.5 }`; assigned Buddy only, persisted before acknowledgement/broadcast; records live courier position only and never changes the stall location used for matching |
| Server → room `order:<id>` | `order:status` | Persisted order state after API/admin status transition |
| Server → room `order:<id>` | `order:assignment` | Updated Buddy assignment after Admin reassignment |
| Server → room `order:<id>` | `delivery:location` | Persisted delivery-location update |
| Server → room `buddy:<id>` | `order:available` | Order assigned to that Buddy |

Order rooms are private and authorized when joined. Buddy rooms are joined only by the authenticated Buddy account. Do not broadcast order events globally.

## Stock consistency notes

Stock reservation uses atomic conditional MongoDB updates and per-order reservation records. Failed multi-item reservations are compensated; order creation is idempotent when the customer supplies an idempotency key. Interrupted provisional reservations and terminal order movements are reconciled at startup. This strategy is compatible with standalone MongoDB; it is not a cross-document database transaction, so a crash can leave temporary state until startup recovery.
