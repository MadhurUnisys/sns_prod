# Buddyyaa backend

Fastify (v4), MongoDB/Mongoose, JWT authentication, Socket.IO tracking, and an authenticated AdminJS panel. The shared catalogue is separate from per-Buddy inventory. A Buddy account is the single fulfillment, stock-owner, and delivery identity; the legacy `Branch` schema is not used by checkout.

## Local setup

Requirements: Node.js 20 or newer and a MongoDB deployment. A standalone MongoDB instance is supported through atomic inventory updates and idempotent reservation records; replica-set transactions are not required.

1. Copy `.env.example` to `.env` and set `MONGO_URI`.
2. Generate separate secrets (at least 32 characters) for access tokens, refresh tokens, and AdminJS sessions. Do not use the example placeholders in production.
3. Seed the shared catalogue and create the first administrator:

   ```powershell
   npm install
   npm run seed
   $env:ADMIN_BOOTSTRAP_NAME = "Platform Admin"
   $env:ADMIN_BOOTSTRAP_EMAIL = "admin@example.test"
   $env:ADMIN_BOOTSTRAP_PASSWORD = "replace-with-a-unique-12-plus-character-password"
   npm run admin:create
   Remove-Item Env:ADMIN_BOOTSTRAP_PASSWORD
   ```

   Admin creation refuses to overwrite an existing account. No default administrator is created.
4. Start MongoDB, then run `npm run dev` or `npm start`. AdminJS is at `/admin`; the API root is `/`.

Phone-only customer login is deliberately disabled unless `NODE_ENV` is not `production` and `CUSTOMER_DEV_LOGIN=true`. That local convenience is not OTP authentication and must not be enabled for a production customer-facing deployment. No OTP provider is configured.

## Creating Buddies and setting stock

Sign in through `/auth/admin/login` to obtain an Admin bearer token, or use the AdminJS session at `/admin`.

1. Create a Buddy with `POST /api/admin/buddies` (name, phone, email, password of at least 12 characters, address, and location). New accounts are disabled pending approval.
2. Approve and activate through `PATCH /api/admin/buddies/:id/status` with `{ "isApproved": true, "isActive": true }`, or edit the Buddy in AdminJS.
3. Add inventory using `PUT /api/admin/inventory` with `{ "buddyId": "...", "productId": "...", "availableQuantity": 12 }`, or the AdminJS “Set Buddy stock” action. Stock is per Buddy/product.
4. Buddy login is `POST /auth/buddy/login`. Approved Buddies can update their availability and stall location with `PATCH /buddies/me` (delivery location pings record a separate live position and never move the stall), and set available stock for their own existing active products with `PATCH /buddies/me/inventory`. They cannot edit reserved quantities or reservation records.

The catalogue seed does not create Buddies or assign inventory. Use the Admin panel/API to provision real fulfillment data.

## Logging, rate limits and pagination

All settings below are optional environment variables. `.env.example` does not list them yet.

| Variable | Default | Effect |
|---|---|---|
| `LOG_LEVEL` | `info` in production, `debug` otherwise | Fastify/pino log level |
| `RATE_LIMIT_MAX` / `RATE_LIMIT_WINDOW_MS` | `100` / `60000` | Requests per client IP per window, across the API routes |
| `AUTH_RATE_LIMIT_MAX` | `5` | Sign-in/refresh attempts per client IP + identifier per auth window |
| `AUTH_IDENTIFIER_RATE_LIMIT_MAX` | `20` | Sign-in/refresh attempts per identifier across all IPs per auth window |
| `AUTH_RATE_LIMIT_WINDOW_MS` | `900000` (15 min) | Auth attempt window |
| `DELIVERY_LOCATION_MIN_INTERVAL_MS` | `5000` | Minimum gap between accepted `delivery:location` socket pings per socket |
| `PLATFORM_TAKE_RATE_PERCENT` | `12` | Platform take rate (0–100) snapshotted onto each new order as `takeRatePercent` and `commissionAmount`. Changing it never alters existing orders. |
| `DELIVERY_SLOT_DAYS_AHEAD` | `2` | How many days after today customers may book a scheduled delivery slot (0–30). The windows themselves are defined in `src/services/delivery-slots.js`. |
| `TRUST_PROXY` | unset (off) | Proxies whose `X-Forwarded-For` is trusted for the client IP: a comma-separated IP/CIDR list (preferred), a hop count such as `1`, or `true` (trusts any sender and is spoofable) |

Logging is on in every environment and logs one line per request (method, URL, status, timing). The logger redacts `authorization` and `cookie` request headers and `password` and `refreshToken` body fields. Fastify's default request serializer does not log headers or bodies at all, so this redaction only protects against a future serializer change. It does not protect values logged under other keys. There is still no error tracking service.

Rate-limit counters live in memory in each process. They are not shared across instances and reset on restart. Without `TRUST_PROXY` the client IP is the TCP peer address, so behind a reverse proxy every client shares one budget. Set `TRUST_PROXY` to the proxy's address (or its hop count) before deploying behind one. The AdminJS form login `POST /admin/login` shares the API sign-in attempt budget. A blocked attempt returns a JSON 429, not the login page.

`GET /orders` returns at most 25 orders per page (`?limit=` up to 100). Pass the returned `pageInfo.nextCursor` as `?cursor=` for the next page. See [API.md](./API.md) for details.

## Validation

Run `npm test`. Tests use a temporary MongoDB server; no application database or production records are modified.

Order creation uses atomic per-inventory-document conditional updates plus an order-linked reservation ledger. Partial basket reservations are compensated and recoverable `reserving` orders are reconciled at startup. A deployment crash during a multi-document operation can temporarily leave an incomplete reservation until the next startup recovery; use a MongoDB replica set and transactions if strict cross-document atomicity is required at higher scale.

See [API.md](./API.md) for the complete route inventory and Socket.IO contract.
