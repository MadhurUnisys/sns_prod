# Buddyyaa — local demo

Everything here runs on one laptop against a local MongoDB database called `buddyyaa`. All data and passwords below are demo-only.

## 1. Prerequisites

- Node.js 20+ and npm.
- Dependencies installed once: `npm --prefix sns_backend/sns_server install` and `npm --prefix sns_frontend/frontend install`.
- MongoDB running locally on the default port. Confirm with:

  ```bash
  mongosh --quiet --eval 'db.runCommand({ping:1}).ok'   # prints 1
  ```

## 2. Start

From the repository root:

```bash
npm run demo:reset   # drop the local buddyyaa database and seed the demo (use before every demo)
npm run dev          # API on :3000 and storefront on :5173; one Ctrl-C stops both
```

- `npm run demo:seed` seeds without dropping anything. It is safe to re-run: nothing is duplicated, and it puts stock back to the demo levels.
- `npm run demo:reset` refuses to drop anything that is not a `mongodb://localhost` or `127.0.0.1` database.
- `npm run dev` always uses `mongodb://127.0.0.1:27017/buddyyaa` (override with `DEMO_MONGO_URI`) and turns on development customer login. It ignores the `MONGO_URI` and `NODE_ENV` set in your backend `.env`.
- `npm test` runs both test suites.

Open the storefront at **http://localhost:5173**.

## 3. Logins

| Who | Where | Login |
|---|---|---|
| Admin | http://localhost:3000/admin | `admin@buddyyaa.test` / `Buddyyaa@Demo2026` |
| Ramesh Fresh Vegetables (Jadhavwadi APMC) | http://localhost:5173/buddy/login | `ramesh@buddyyaa.test` / `Ramesh@Demo2026` |
| Sunita Bhaji Bhandar (CIDCO N-5) | same | `sunita@buddyyaa.test` / `Sunita@Demo2026` |
| Pawar Vegetables (Garkheda) | same | `pawar@buddyyaa.test` / `Pawar@Demo2026!` |
| Khan Fruit & Veg (Osmanpura) | same | `khan@buddyyaa.test` / `Khan@Demo2026!!` |
| Jadhav Taaza Market (Beed Bypass) | same | `jadhav@buddyyaa.test` / `Jadhav@Demo2026` |
| Customer | http://localhost:5173/login | Any phone number, e.g. `9876543210`. There is no OTP: this is a development-only login that is switched off in production. |

Use a separate browser window (or a private window) for the Buddy, so the customer and the Buddy stay signed in side by side.

## 4. What the demo data contains

- 23 products in Vegetables, Leafy Greens, Fruits and Daily Essentials, at indicative local prices.
- Tomato, Bhindi, Coriander, Banana and Mosambi show a struck-through discount.
- Every Buddy stocks tomato, onion and potato, and each Buddy also has three items no other Buddy carries:

| Buddy | Only here |
|---|---|
| Ramesh | Garlic, Ginger, Cabbage |
| Sunita | Palak, Methi, Curry Leaves |
| Pawar | Cauliflower, Milk, Curd |
| Khan | Pomegranate, Grapes, Papaya |
| Jadhav | Mosambi, Paneer, Eggs |

- Khan has only **2 Pomegranates**, which sets up the out-of-stock moment.
- Product pictures are simple built-in illustrations, not photographs, so they work without internet.

## 5. Live demo script

1. **The store.** On http://localhost:5173 the customer sees the full catalogue. Point out the categories and the discounted prices.
2. **"Your nearest vendor."** Switch to **UFD · Ultra Fast**. When asked for a location, enter address `Kranti Chowk`, latitude `19.8762`, longitude `75.3433`. Buddyyaa picks **Khan Fruit & Veg**, about 0.7 km away, and shows only Khan's own stock with live quantities ("2 available from this Buddy" on Pomegranate).
3. **Move across town.** Click **Change location** and enter `CIDCO N-5`, latitude `19.8935`, longitude `75.3560`. The vendor switches to **Sunita Bhaji Bhandar** (about 0.1 km away). Her Palak, Methi and Curry Leaves appear and Khan's fruit disappears: each customer buys from the mandi vendor next door.
4. **Sign in as a customer** at http://localhost:5173/login with phone `9876543210`.
5. **Out-of-stock moment.** Change the location back to Kranti Chowk (`19.8762`, `75.3433`) and switch to **Normal delivery**. Add **3 Pomegranates** and go to checkout. The order is refused with "No nearby Buddy can fulfill every item in this basket": only Khan carries pomegranates and he has two. In UFD mode the `+` button already stops at 2. The server checks real stock, and it never splits one order across vendors.
6. **A real order.** Empty the basket. Still at Kranti Chowk on normal delivery, add Tomato × 2, Onion × 1 and Coriander × 1, then place the order. It goes to **Khan Fruit & Veg** for about **₹122**; prices come from the server, discounts included.
7. **The vendor's side.** In the second window, sign in at http://localhost:5173/buddy/login as `khan@buddyyaa.test`. The order is under **Available**. Open it and tap **Accept this order**, then **Preparing**, then **Out For Delivery**.
8. **Tracking.** On the customer window, open **My orders → Track order**; the status follows the Buddy's changes. On the Buddy's order page, **Start location sharing** sends the laptop's real browser location, so away from Sambhajinagar the dot appears wherever the laptop actually is.
9. **Delivered.** The Buddy taps **Delivered**. In Khan's **Inventory** panel, Tomato has gone from 30 to 28: stock moved exactly once.
10. **Admin view.** Open http://localhost:3000/admin with the admin login: Orders, Buddies and Buddy inventory are all there. Opening an order shows Buddyyaa's take rate (12% by default) and its commission, e.g. ₹14.64 on the ₹122 order. Customers and Buddies never see these figures.

Run `npm run demo:reset` again before the next audience.

## 6. What is NOT built — do not promise these

- **No payments.** The order total is calculated but nothing is charged, and there is no cash-on-delivery tracking.
- **No scheduled delivery slots.** Every order is "deliver now".
- **No push, SMS or WhatsApp notifications.** Updates appear only while the page is open.
- **No OTP sign-up or real customer login.** The phone login above is a development shortcut that is disabled in production.
- **No earnings reports, settlement or payouts.** Each order records Buddyyaa's commission, but nothing totals it, invoices it or pays vendors.
- **No mobile app.** This is a web app in a laptop browser.
- **No address search or map picker.** Locations are typed as latitude/longitude, or taken from the browser's GPS.
- **Do not edit a product's discount live.** `PATCH /products/:id` with a `discountPrice` currently fails (known bug). Editing it through AdminJS has not been tested.
