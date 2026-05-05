




## Step 3 — Add item to cart

### Endpoint
```
POST /api/carts/my/items
```

### Request

```bash
curl -s -X POST http://localhost:3000/api/carts/my/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "menuItemId":     "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
    "restaurantId":   "fe8b2648-2260-4bc5-9acd-d88972148c78",
    "restaurantName": "Phở Bắc",
    "itemName":       "Phở Bò Tái Nạm",
    "unitPrice":      85000,
    "quantity":       1,
    "selectedModifiers": [
      {
        "groupId":    "ee000001-0000-4000-8000-000000000001",
        "groupName":  "Kích cỡ",
        "optionId":   "ff000001-0000-4000-8000-000000000001",
        "optionName": "Tô nhỏ",
        "price":      0
      }
    ]
  }' | jq .
```

**Expected response (201 Created):**
```json
{
  "cartId": "...",
  "customerId": "...",
  "restaurantId": "fe8b2648-2260-4bc5-9acd-d88972148c78",
  "restaurantName": "Phở Bắc",
  "items": [
    {
      "cartItemId": "...",
      "menuItemId": "4dc7cdfa-5a54-402f-b1a8-2d47de146081",
      "itemName": "Phở Bò Tái Nạm",
      "unitPrice": 85000,
      "quantity": 1,
      "subtotal": 85000,
      "selectedModifiers": [{ "groupId": "ee000001-…", "optionId": "ff000001-…", "price": 0 }]
    }
  ],
  "totalAmount": 85000
}
```

---

## Step 4 — Checkout with VNPay

### Endpoint
```
POST /api/carts/my/checkout
```

### Delivery address

The restaurant is at **10.762622, 106.660172** (45 Nguyễn Huệ, Quận 1).

The delivery address below is approximately **1.0 km north** — well inside the inner delivery zone (radius 2 km):

```
latitude:  10.7716
longitude: 106.6602
```

> The inner zone covers the full 2 km radius from the restaurant. Any address within ~2 km will use `baseFee = 15,000` and `perKmRate = 5,000/km`.

### Request

```bash
curl -s -X POST http://localhost:3000/api/carts/my/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "X-Idempotency-Key: manual-test-$(date +%s)" \
  -d '{
    "paymentMethod": "vnpay",
    "deliveryAddress": {
      "city": "HCM",
      "district": "Q1",
      "street":    "Số 10 Lý Thái Tổ, Phường Lý Thái Tổ, Quận 1, TP.HCM",
      "latitude":  10.7716,
      "longitude": 106.6602
    },
    "note": "Ít hành, không mì chính"
  }' | jq .
```



### Expected response (201 Created)

```json
{
  "orderId":     "<uuid>",
  "status":      "pending",
  "paymentMethod": "vnpay",
  "totalAmount": 105000,
  "shippingFee": 20000,
  "paymentUrl":  "https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?vnp_Amount=10500000&vnp_Command=pay&...",
  "createdAt":   "2026-05-05T10:00:00.000Z"
}
```

> **Amounts are approximate.** The exact `shippingFee` and `totalAmount` depend on the Haversine distance computed at runtime. Both values are always multiples of 1000 VND.

### Why each value is what it is

#### `status: "pending"`
The order is created in `pending` state the moment it is persisted. It transitions to `confirmed` after the restaurant accepts it (or after `RESTAURANT_ACCEPT_TIMEOUT_SECONDS = 600` via the `OrderTimeoutTask`). Payment status is tracked separately in the `payment_transactions` table.

#### `shippingFee` calculation

```
distanceKm  ≈ haversine(10.762622, 106.660172  →  10.7716, 106.6602)
            ≈ 1.001 km

shippingFee = Math.round((baseFee + distanceKm × perKmRate) / 1000) × 1000
            = Math.round((15000  + 1.001 × 5000) / 1000) × 1000
            = Math.round(20005 / 1000) × 1000
            = Math.round(20.005) × 1000
            = 20 × 1000
            = 20000 VND
```

Zone selection logic: the innermost zone whose `radiusKm ≥ distanceKm` is chosen. Since 1.001 km ≤ 2 km, the **Nội thành (2 km)** zone applies.

> `shippingFee` is normalised to the nearest 1000 VND (`Math.round(raw / 1000) * 1000`), so it is always a multiple of 1000.

#### `totalAmount` calculation

```
unitPrice      = 85000   (from ordering_menu_item_snapshots — authoritative price at checkout)
modifiersPrice = 0       (Tô nhỏ is free)
subtotal       = (85000 + 0) × 1 = 85000

itemsTotal     = 85000   (sum of all order_item subtotals)
totalAmount    = itemsTotal + shippingFee
               = 85000   + 20000
               = 105000 VND
```

> The checkout handler re-reads the price from `ordering_menu_item_snapshots`, **not** from the cart. If the restaurant changed the price between add-to-cart and checkout, the snapshot price wins.

#### `paymentUrl` is generated
Because `paymentMethod = "vnpay"`, the handler calls `PaymentService.initiateVNPayPayment()` which:
1. Creates a `payment_transactions` row with `status = awaiting_ipn`
2. Calls `VNPayService.buildPaymentUrl()` which encodes `vnp_Amount = totalAmount × 100` (VNPay requires the amount in "×100 VND units", so `105000 × 100 = 10500000`)
3. Attaches the `paymentUrl` to the order response

---

## Step 5 — Inspect the payment transaction (optional)

```bash
# Using psql or any DB client:
psql postgresql://food_order:foodordersecret@localhost:5433/food_order_db \
  -c "SELECT id, order_id, amount, status, payment_url FROM payment_transactions ORDER BY created_at DESC LIMIT 1;"
```

You should see `status = awaiting_ipn`.

---

## Step 6 — VNPay payment flow

### 6a — Redirect the user

Open `paymentUrl` in a browser. The user is redirected to the VNPay sandbox payment page:

```
https://sandbox.vnpayment.vn/paymentv2/vpcpay.html?...
```

Use the **NCB sandbox test card**:
```
Card number : 9704198526191432198
Cardholder  : NGUYEN VAN A
Expiry date : 07/15
OTP         : 123456
```

### 6b — VNPay calls the IPN endpoint

After payment, VNPay sends a server-to-server callback (before the browser redirect):

```
GET /api/payments/vnpay/ipn?vnp_TxnRef=<paymentTxnId>&vnp_Amount=<amount×100>&vnp_ResponseCode=00&vnp_SecureHash=<hmac>&...
```

The `ProcessIpnHandler`:
1. Verifies `vnp_SecureHash` (HMAC SHA512 with `VNPAY_HASH_SECRET`)
2. Compares `vnp_Amount / 100` with `payment_transactions.amount` using **exact equality** (`!==`) — no epsilon
3. On success: updates `payment_transactions.status → completed`, sets `paidAt` and `providerTxnId`
4. Publishes `PaymentConfirmedEvent` → the Ordering BC transitions the order to `confirmed` (if restaurant already accepted) or waits

**IPN response (always 200):**
```json
{ "RspCode": "00", "Message": "Success" }
```

### 6c — Browser redirect (return URL)

After the IPN, the browser is redirected to:

```
GET /api/payments/vnpay/return?vnp_TxnRef=<id>&vnp_SecureHash=<hmac>&...
```

**Return response (200):**
```json
{
  "txnRef":        "<paymentTxnId>",
  "signatureValid": true,
  "status":        "completed",
  "vnpResponseCode": "00",
  "orderId":       "<orderId>"
}
```

> The return URL endpoint **does not mutate state** — it only reads the current transaction status and validates the signature. State changes happen exclusively in the IPN handler.

### 6d — Post-payment order state

```
payment_transactions.status  →  completed
orders.status                →  confirmed  (after PaymentConfirmedEvent + restaurant accept)
```

---

## Step 7 — Verify final state

```bash
curl -s "http://localhost:3000/api/orders/my" \
  -H "Authorization: Bearer $TOKEN" | jq '.[0]'
```

Expected: `"status": "confirmed"` (or `"pending"` if restaurant hasn't accepted yet).

---

## Failure Scenarios

### Scenario A — Tampered amount (invalid signature)

Simulate what happens if the payment amount is modified after VNPay signs the callback.

```bash
# Replace <txnRef> with the payment_transactions.id from your checkout response

curl -s "http://localhost:3000/api/payments/vnpay/ipn?\
vnp_TxnRef=<txnRef>&\
vnp_Amount=1&\
vnp_ResponseCode=00&\
vnp_TransactionStatus=00&\
vnp_BankCode=NCB&\
vnp_OrderInfo=SoLi_Order_<txnRef>&\
vnp_PayDate=20260505120000&\
vnp_TmnCode=QYVC9P4C&\
vnp_TransactionNo=99999&\
vnp_SecureHash=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" | jq .
```

**Expected:**
```json
{ "RspCode": "97", "Message": "Invalid signature" }
```

The `payment_transactions` row remains `status = awaiting_ipn`. No state change.

---

### Scenario B — Cancelled payment (user presses Back on VNPay)

When the user cancels or the payment times out, VNPay redirects to the return URL with `vnp_ResponseCode = 24` (cancelled) or `02` (declined).

```bash
# Build valid return params with responseCode=24 (cancelled)
# Note: you still need a valid signature — VNPay computes this on their end.
# In sandbox, you can observe this by pressing "Quay lại" on the payment page.

curl -s "http://localhost:3000/api/payments/vnpay/return?\
vnp_TxnRef=<txnRef>&\
vnp_ResponseCode=24&\
vnp_TransactionStatus=02&\
vnp_Amount=<amount×100>&\
vnp_SecureHash=<valid_hmac>" | jq .
```

**Expected:**
```json
{
  "txnRef":          "<txnRef>",
  "signatureValid":  true,
  "status":          "awaiting_ipn",
  "vnpResponseCode": "24",
  "orderId":         "<orderId>"
}
```

The return URL handler reports `vnpResponseCode: 24` but does **not** mark the transaction as failed — that only happens via IPN. The `PaymentTimeoutTask` (Phase 8.5, scheduled cron) will expire stale `awaiting_ipn` transactions after `PAYMENT_SESSION_TIMEOUT_SECONDS` (default 1800s), publish `PaymentFailedEvent`, and the Ordering BC will cancel the order.

---

## Appendix — Key seed values reference

### Phở Bắc delivery zones

| Zone | ID | Radius | Base fee | Per km |
|---|---|---|---|---|
| Nội thành | `bb000001-0000-4000-8000-000000000001` | 2 km | 15,000 VND | 5,000 VND |
| Toàn thành | `bb000002-0000-4000-8000-000000000002` | 5 km | 15,000 VND | 7,000 VND |

### Phở Bò Tái Nạm modifier options (for `selectedModifiers`)

| Group | Option ID | Name | Price |
|---|---|---|---|
| Kích cỡ (`ee000001-…`) | `ff000001-…` | Tô nhỏ (default) | 0 |
| Kích cỡ (`ee000001-…`) | `ff000002-…` | Tô vừa | 5,000 VND |
| Kích cỡ (`ee000001-…`) | `ff000003-…` | Tô lớn | 10,000 VND |
| Topping thêm (`ee000002-…`) | `ff000004-…` | Thêm tái | 10,000 VND |
| Topping thêm (`ee000002-…`) | `ff000005-…` | Thêm nạm | 10,000 VND |
| Topping thêm (`ee000002-…`) | `ff000006-…` | Thêm gân | 15,000 VND |
| Topping thêm (`ee000002-…`) | `ff000007-…` | Thêm sách | 15,000 VND |

> **ACL note:** `pnpm db:seed` seeds `ordering_menu_item_snapshots` with `modifiers: []`. This means the checkout handler sees **no** required modifier groups in the snapshot and will **not** enforce modifier selection even though the catalog `modifier_groups` table has `minSelections = 1` for Kích cỡ. The `selectedModifiers` you pass in the cart are stored as-is but not validated against catalog constraints at checkout.

### VND amount rules (validation layer)

| Rule | Applies to |
|---|---|
| Integer, minimum 1000, multiple of 1000 | `price` in menu item / modifier DTOs |
| Integer, minimum 0, multiple of 1000 | `baseFee`, `perKmRate` in zone DTOs |
| Computed with `Math.round((baseFee + distanceKm × perKmRate) / 1000) × 1000` | `shippingFee` — always a multiple of 1000 |
| `totalAmount × 100` → `vnp_Amount` (exact integer, no rounding) | VNPay integration |
| `vnp_Amount / 100` compared with `===` to DB amount | IPN verification — exact equality, no epsilon |
