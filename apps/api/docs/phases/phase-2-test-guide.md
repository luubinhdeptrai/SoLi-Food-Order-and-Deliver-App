# Phase 2 — Cart Module Test Guide

> **Copy & paste** — mỗi block là lệnh hoàn chỉnh, chạy được ngay.

---

## 0. Setup (chạy một lần)

```powershell
# Terminal 1 — Start API
cd D:\SoLi-Food-Order-and-Deliver-App\apps\api
pnpm start:dev
```

```powershell
# Terminal 2 — Seed database
cd D:\SoLi-Food-Order-and-Deliver-App\apps\api
pnpm db:seed
```

### Fixed IDs sau khi seed

| Tên | UUID |
|-----|------|
| **Restaurant: Sunset Bistro** (open, approved) | `fe8b2648-2260-4bc5-9acd-d88972148c78` |
| **Restaurant: Closed Kitchen** (closed) | `00000000-0000-0000-0000-000000000004` |
| **MenuItem: Margherita Pizza** — R1, 12.50 | `4dc7cdfa-5a54-402f-b1a8-2d47de146081` |
| **MenuItem: Caesar Salad** — R1, 9.00 | `00000000-0000-0000-0000-000000000006` |
| **MenuItem: Tiramisu** — R1, 6.50 | `00000000-0000-0000-0000-000000000007` |
| **MenuItem: Classic Burger** — R2, 11.00 | `00000000-0000-0000-0000-000000000008` |

> **Lưu ý auth (dev):** `disableGlobalAuthGuard: true` trong `AuthModule.forRoot` tắt global Better Auth guard.
> `JwtAuthGuard` (placeholder) accept mọi Bearer token và hardcode `user.sub = 'user-id'`.
> Cart Redis key luôn là `cart:user-id` bất kể token gì.

```powershell
# Biến dùng chung cho mọi test (PowerShell)
$BASE = "http://localhost:3000/api"
$H    = @{ "Authorization" = "Bearer dev-token"; "Content-Type" = "application/json" }
```

---

## Scenario 1 — GET cart rỗng

**Expected:** 200, body `null`

```powershell
$H = @{ "Authorization" = "Bearer dev-token"; "Content-Type" = "application/json" }
Invoke-RestMethod -Method GET "http://localhost:3000/api/carts/my" -Headers $H
```

Redis check:
```bash
redis-cli GET "cart:user-id"
# Expected: (nil)
```

---

## Scenario 2 — Thêm item đầu tiên (tạo cart mới)

**Expected:** 201, response có `cartId`, `items[0]`, `totalAmount = 25`

```powershell
$H = @{ "Authorization" = "Bearer dev-token"; "Content-Type" = "application/json" }
$body = @{
  menuItemId    = "4dc7cdfa-5a54-402f-b1a8-2d47de146081"
  restaurantId  = "fe8b2648-2260-4bc5-9acd-d88972148c78"
  restaurantName = "Sunset Bistro"
  itemName      = "Margherita Pizza"
  unitPrice     = 12.50
  quantity      = 2
} | ConvertTo-Json
Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H -Body $body
```

Redis check:
```bash
redis-cli GET "cart:user-id"
redis-cli TTL "cart:user-id"
# Expected: TTL ~604800 (7 ngày)
```

---

## Scenario 3 — Thêm cùng item (merge quantity)

**Expected:** 201, `items[0].quantity = 4` (2+2)

```powershell
Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H -Body $body
```

---

## Scenario 4 — Thêm item thứ hai cùng nhà hàng

**Expected:** 201, cart có 2 items khác nhau

```powershell
$body2 = @{
  menuItemId    = "00000000-0000-0000-0000-000000000006"
  restaurantId  = "fe8b2648-2260-4bc5-9acd-d88972148c78"
  restaurantName = "Sunset Bistro"
  itemName      = "Caesar Salad"
  unitPrice     = 9.00
  quantity      = 1
} | ConvertTo-Json
Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H -Body $body2
```

---

## Scenario 5 — Thêm item từ nhà hàng khác (BR-2 violation)

**Expected:** 409 Conflict

```powershell
$bodyWrong = @{
  menuItemId    = "00000000-0000-0000-0000-000000000008"
  restaurantId  = "00000000-0000-0000-0000-000000000004"
  restaurantName = "Closed Kitchen"
  itemName      = "Classic Burger"
  unitPrice     = 11.00
  quantity      = 1
} | ConvertTo-Json
try {
  Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H -Body $bodyWrong
} catch {
  Write-Host "Status:" $_.Exception.Response.StatusCode
  Write-Host "Message:" ($_.ErrorDetails.Message | ConvertFrom-Json).message
}
# Expected: 409, message chứa "Sunset Bistro"
```

---

## Scenario 6 — Cập nhật số lượng item

**Expected:** 200, `items[0].quantity = 1`

```powershell
Invoke-RestMethod -Method PATCH `
  "http://localhost:3000/api/carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081" `
  -Headers $H `
  -Body (@{ quantity = 1 } | ConvertTo-Json)
```

---

## Scenario 7 — Cập nhật quantity = 0 (xoá item, cart còn 1 item)

**Expected:** 200, cart còn Caesar Salad, Margherita Pizza bị xoá

```powershell
Invoke-RestMethod -Method PATCH `
  "http://localhost:3000/api/carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081" `
  -Headers $H `
  -Body (@{ quantity = 0 } | ConvertTo-Json)
```

---

## Scenario 8 — Xoá item cụ thể (DELETE)

Trước tiên thêm lại Margherita Pizza để cart có 2 items:
```powershell
Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H -Body $body
```

Xoá Caesar Salad:
```powershell
Invoke-RestMethod -Method DELETE `
  "http://localhost:3000/api/carts/my/items/00000000-0000-0000-0000-000000000006" `
  -Headers $H
# Expected: 200, cart chỉ còn Margherita Pizza
```

---

## Scenario 9 — DELETE item không có trong cart

**Expected:** 404 Not Found

```powershell
try {
  Invoke-RestMethod -Method DELETE `
    "http://localhost:3000/api/carts/my/items/00000000-0000-0000-0000-000000000007" `
    -Headers $H
} catch {
  Write-Host "Status:" $_.Exception.Response.StatusCode
}
# Expected: 404
```

---

## Scenario 10 — Xoá toàn bộ cart

**Expected:** 204 No Content

```powershell
Invoke-RestMethod -Method DELETE "http://localhost:3000/api/carts/my" -Headers $H
```

Redis check:
```bash
redis-cli EXISTS "cart:user-id"
# Expected: 0
```

---

## Scenario 11 — GET cart sau khi clear

**Expected:** 200, body `null`

```powershell
Invoke-RestMethod -Method GET "http://localhost:3000/api/carts/my" -Headers $H
```

---

## Scenario 12 — Input không hợp lệ (validation)

**Expected:** 400 Bad Request

```powershell
try {
  Invoke-RestMethod -Method POST "http://localhost:3000/api/carts/my/items" -Headers $H `
    -Body (@{ menuItemId = "not-a-uuid"; quantity = 0 } | ConvertTo-Json)
} catch {
  Write-Host "Status:" $_.Exception.Response.StatusCode
}
# Expected: 400
```

---

## Scenario 13 — TTL reset mỗi lần mutation

```bash
# Trước khi mutation
redis-cli TTL "cart:user-id"

# Chạy bất kỳ mutation nào (add/patch/delete-item) rồi check lại
redis-cli TTL "cart:user-id"
# Expected: reset về ~604800
```

---

## Redis helpers

```bash
# Xem toàn bộ cart JSON
redis-cli GET "cart:user-id"

# Xem đẹp (nếu có python)
redis-cli GET "cart:user-id" | python -m json.tool

# List tất cả cart keys
redis-cli KEYS "cart:*"

# Xoá manual để reset test
redis-cli DEL "cart:user-id"
```

---

## Chạy toàn bộ sequence nhanh

Paste cả block này vào PowerShell để chạy từ đầu đến cuối:

```powershell
$BASE = "http://localhost:3000/api"
$H    = @{ "Authorization" = "Bearer dev-token"; "Content-Type" = "application/json" }

# Reset
redis-cli DEL "cart:user-id" | Out-Null

# S1: GET cart rỗng
Write-Host "`n[S1] GET empty cart"
Invoke-RestMethod -Method GET "$BASE/carts/my" -Headers $H | ConvertTo-Json

# S2: Add Margherita Pizza x2
Write-Host "`n[S2] Add Margherita Pizza x2"
$r = Invoke-RestMethod -Method POST "$BASE/carts/my/items" -Headers $H -Body (@{
  menuItemId="4dc7cdfa-5a54-402f-b1a8-2d47de146081"; restaurantId="fe8b2648-2260-4bc5-9acd-d88972148c78"
  restaurantName="Sunset Bistro"; itemName="Margherita Pizza"; unitPrice=12.50; quantity=2
} | ConvertTo-Json); Write-Host "qty=$($r.items[0].quantity)  total=$($r.totalAmount)"

# S3: Merge same item — qty becomes 4
Write-Host "`n[S3] Merge same item (qty should be 4)"
$r = Invoke-RestMethod -Method POST "$BASE/carts/my/items" -Headers $H -Body (@{
  menuItemId="4dc7cdfa-5a54-402f-b1a8-2d47de146081"; restaurantId="fe8b2648-2260-4bc5-9acd-d88972148c78"
  restaurantName="Sunset Bistro"; itemName="Margherita Pizza"; unitPrice=12.50; quantity=2
} | ConvertTo-Json); Write-Host "qty=$($r.items[0].quantity)"

# S4: Add Caesar Salad x1
Write-Host "`n[S4] Add Caesar Salad x1"
$r = Invoke-RestMethod -Method POST "$BASE/carts/my/items" -Headers $H -Body (@{
  menuItemId="00000000-0000-0000-0000-000000000006"; restaurantId="fe8b2648-2260-4bc5-9acd-d88972148c78"
  restaurantName="Sunset Bistro"; itemName="Caesar Salad"; unitPrice=9.00; quantity=1
} | ConvertTo-Json); Write-Host "itemCount=$($r.items.Count)"

# S5: Wrong restaurant → 409
Write-Host "`n[S5] Wrong restaurant → expect 409"
try {
  Invoke-RestMethod -Method POST "$BASE/carts/my/items" -Headers $H -Body (@{
    menuItemId="00000000-0000-0000-0000-000000000008"; restaurantId="00000000-0000-0000-0000-000000000004"
    restaurantName="Closed Kitchen"; itemName="Classic Burger"; unitPrice=11.00; quantity=1
  } | ConvertTo-Json)
} catch { Write-Host "Got $($_.Exception.Response.StatusCode)" }

# S6: PATCH quantity to 1
Write-Host "`n[S6] PATCH Margherita qty→1"
$r = Invoke-RestMethod -Method PATCH "$BASE/carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081" `
  -Headers $H -Body (@{ quantity=1 } | ConvertTo-Json)
Write-Host "qty=$($r.items[0].quantity)"

# S7: PATCH quantity to 0 → removes item
Write-Host "`n[S7] PATCH Margherita qty→0 (remove)"
$r = Invoke-RestMethod -Method PATCH "$BASE/carts/my/items/4dc7cdfa-5a54-402f-b1a8-2d47de146081" `
  -Headers $H -Body (@{ quantity=0 } | ConvertTo-Json)
Write-Host "itemCount=$($r.items.Count)  (should be 1)"

# S8: DELETE item not in cart → 404
Write-Host "`n[S8] DELETE Tiramisu (not in cart) → expect 404"
try {
  Invoke-RestMethod -Method DELETE "$BASE/carts/my/items/00000000-0000-0000-0000-000000000007" -Headers $H
} catch { Write-Host "Got $($_.Exception.Response.StatusCode)" }

# S9: DELETE cart
Write-Host "`n[S9] DELETE entire cart → 204"
Invoke-RestMethod -Method DELETE "$BASE/carts/my" -Headers $H
Write-Host "Done (204 expected, no body)"

# S10: GET empty again
Write-Host "`n[S10] GET cart after clear → null"
Invoke-RestMethod -Method GET "$BASE/carts/my" -Headers $H | ConvertTo-Json

Write-Host "`n✅ All scenarios done"
```
