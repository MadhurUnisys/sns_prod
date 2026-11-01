# CLAUDE.md — Buddyyaa (`sns_prod`)

Context for Claude Code sessions in this repo. Read before changing anything.

---

## 1. What this is

A three-sided hyperlocal fresh-produce marketplace for Chhatrapati Sambhajinagar, Maharashtra.

- **Customer** orders fruit/veg/dairy from a web storefront.
- **Buddy** = an existing mandi vendor who owns his own stock *and* his own vehicle. He picks, packs and delivers.
- **Admin** provisions vendors, catalogue and stock via AdminJS.

Buddyyaa is **asset-light by design**: no inventory, no warehouses, no fleet, no delivery staff. The `Branch` model is vestigial — deliberately disconnected from checkout. Do not reintroduce warehouse concepts.

Two delivery modes, and the distinction is load-bearing:
- **UFD** — customer picks one nearby Buddy and orders from his real stock. The server **never silently switches vendors**; stale stock fails checkout with "refresh UFD".
- **NORMAL** — server picks the nearest Buddy who can fulfil the **entire basket**. No split-vendor orders, ever.

## 2. Repo layout

```
sns_backend/sns_server/     Fastify 4 + Mongoose 8 + Socket.IO 4 + AdminJS 7   (~2,900 LOC)
  app.js                    entry: CORS, sockets, startup recovery
  src/routes/               thin route registration
  src/controllers/          HTTP handling, validation
  src/services/             DOMAIN LOGIC — fulfillment, inventory, order-lifecycle, order-assignment
  src/models/               Mongoose schemas
  src/realtime/socket.js    JWT-authed Socket.IO, room-scoped
  tests/                    node --test + mongodb-memory-server

sns_frontend/frontend/      Vite 8 + React 19 + TS 7                            (~2,900 LOC)
  src/services/api.ts       ALL HTTP + response normalisation (anti-corruption layer)
  src/state/AppState.tsx    3 React contexts (auth / cart / delivery)
  src/pages/                Storefront, Checkout, Orders, BuddyPortal, AuthPage
  src/styles.css            hand-written CSS — NO Tailwind, do not add it
```

`API.md` in the backend is the authoritative route + Socket.IO contract. Keep it in sync with any route change.

## 3. Invariants — do not break these

1. **The server is authoritative for price, stock, vendor assignment and authorisation.** The client sends only product IDs, quantities, coordinates and an idempotency key. Never trust a client-supplied price.
2. **Inventory safety is the hard-won part of this codebase.** Reservation uses atomic conditional `findOneAndUpdate` (filtered on `availableQuantity >= quantity`), a per-order reservation ledger, compensating rollback on partial baskets, a transient `reserving` order status, and startup recovery. This works on **standalone MongoDB without transactions**. If you touch `services/fulfillment.js` or `services/order-lifecycle.js`, you must not weaken any of it.
3. **Stock moves exactly once per transition** — reserved on create, released once on cancel, consumed once on delivery, guarded by `Order.inventoryState` (`pending|reserved|released|consumed`).
4. **Authorisation is checked against the persisted order**, not token claims.
5. **Socket events are cache-invalidation signals, not truth.** Persist first, then broadcast; the client refetches. Never broadcast order events globally — rooms are authorised on join.
6. **Order IDs are sequential** (`ORDR00001`) via the `Counter` collection.

## 4. House style — match it exactly

**Backend:** ESM, 2-space indent, **double quotes, semicolons**, `const` arrow functions, named exports (default export only for Mongoose models). Typed error classes carrying HTTP status (`OrderLifecycleError`, `InventoryServiceError`).

**Frontend:** 2-space indent, **single quotes, NO semicolons**, extremely dense single-line JSX. `App.tsx` is 48 lines for the whole router — that is intentional. Every route is `React.lazy` + `Suspense`.

Run `npm run lint` (oxlint, frontend only) before proposing frontend changes.

## 5. Commands

```bash
# backend — needs MongoDB running
cd sns_backend/sns_server
npm install
npm run seed          # catalogue only; creates NO buddies, NO inventory
npm run admin:create  # needs ADMIN_BOOTSTRAP_{NAME,EMAIL,PASSWORD} env vars
npm run dev
npm test              # see trap #2 below

# frontend
cd sns_frontend/frontend
npm install
npm run dev           # :5173
npm test              # vitest, 14 tests
npm run build         # tsc -b && vite build
npm run lint
```

## 6. Traps — these will bite you

1. **Never commit `package-lock.json` churn.** Running `npm install` on a different npm/platform strips `libc` metadata from optional native deps (~96 deletions, zero version changes). Committing it can break musl/Alpine installs. Always `git checkout -- '**/package-lock.json'` unless you deliberately changed a dependency.
2. **`npm test` in the backend downloads a MongoDB binary** from `fastdl.mongodb.org` at test time. It fails in any network-restricted environment. The suite is non-hermetic — this is gap `D2` and it blocks CI.
3. **Logging is on in production, but redaction is thin.** (`A5` fixed.) `createLoggerOptions` in `app.js` sets `LOG_LEVEL` (default `info` in prod, `debug` otherwise) and redacts `req.headers.{authorization,cookie}` and `req.body.{password,refreshToken}`. Fastify's default req serializer never emits headers or body, so those paths are only a backstop. Never log `request.body` or headers under another key, because nothing redacts it. There is still no error tracking.
4. **There is no production customer login.** Phone login returns 403 unless `NODE_ENV≠production` **and** `CUSTOMER_DEV_LOGIN=true`. No OTP provider is wired (gap `P1`).
5. **No payment, commission, subscription or settlement exists anywhere** in the schema. `totalPrice` is computed and never charged (gaps `P2`–`P4`).
6. **`Buddy.location` is the stall only.** (`A1` fixed.) Matching (`fulfillment.js`) and `pickupLocation` read `location`, which only `PATCH /buddies/me` and provisioning write. Courier pings (`PATCH /orders/:id/location` and the `delivery:location` socket event) write `Buddy.liveLocation` / `liveLocationUpdatedAt` and `Order.deliveryPersonLocation`. Never write `location` from a ping. Buddies whose stall was overwritten before the fix still hold a wrong `location` until it is reset.
7. Commit to a **feature branch**, never `main`. This repo is a fork of `smitsabnis213/sns_prod`.
8. **Rate limits are per-process, in memory, and keyed on the TCP peer IP.** (`S1`.) The global `@fastify/rate-limit` allows 100 requests/min per IP. Sign-in and refresh share the attempt limiter in `src/routes/auth.js`: 5 per 15 min per IP + identifier, and 20 per identifier. Fastify `trustProxy` comes from `TRUST_PROXY` (unset = TCP peer). Behind a reverse proxy it must be set, or all users share one budget. AdminJS `POST /admin/login` uses the same attempt limiter instance. Test files raise `RATE_LIMIT_MAX`, and the limiter state persists across tests within a file, so use a fresh identifier in any test that counts attempts. `GET /orders` is cursor-paginated (`A2`/`A3` fixed), and the cursor is `createdAt` only.

## 7. Known gaps

The full prioritised matrix (38 gaps, IDs `P*` product / `A*` architecture / `D*` DX / `S*` security) lives in the Buddyyaa project docs alongside the Phase 1 architecture report. Reference gaps by ID in commits and PRs.

**Highest-value, lowest-effort:**
- `A1` split `Buddy.location` into stall vs. live position
- `A2` add indexes on `Order.customer`, `Order.buddy`, `Order.status` — none exist today; the only customer index is *partial* and misses orders without an idempotency key
- `A3` add pagination — there is none anywhere; `GET /orders` as Admin returns every order ever placed, fully populated
- `A5` turn production logging on
- `S1` rate-limit the auth endpoints — they are freely brute-forceable
- `P3` record commission per order — one schema field; until it exists no business metric can be measured

**Blocking chains:** `D2` blocks CI (`D1`). `P1` blocks everything customer-facing. Google Play additionally requires a privacy policy, a Data Safety declaration and in-app account deletion (`S9`) — none exist, and there is no mobile app to submit yet (`P6`).

## 8. Working agreement

- Match existing style; do not reformat untouched code.
- Every behavioural change needs a test in the existing framework (`node --test` backend, vitest frontend).
- Update `API.md` when routes change; update READMEs when setup changes.
- The READMEs are unusually honest about limitations ("this is not OTP authentication"). Preserve that tone — do not oversell in docs.

## 9. Git safety — non-negotiable

- `origin` = https://github.com/MadhurUnisys/sns_prod — the ONLY valid push target.
- `upstream` = smitsabnis213/sns_prod is **fetch-only**. Never push to it. Never open a PR against it without being told to.
- A `.git/hooks/pre-push` guard enforces this. Do not remove or bypass it.
- Never commit directly to `main`. Branch first: `git checkout -b fix/<gap-id>-<slug>`.
- Never commit `package-lock.json` churn (see trap #1).
