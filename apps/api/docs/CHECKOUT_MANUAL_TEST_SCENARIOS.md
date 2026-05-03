# Checkout API Manual Testing Scenarios

> **Mục đích**: Hướng dẫn test tay 2 kịch bản checkout với các giải thích chi tiết về tại sao kết quả lại như vậy.

---

## 📋 Tóm tắt nhanh

| Kịch bản | Mục đích | Mong đợi |
|----------|----------|---------|
| **Scenario 1** | Checkout cơ bản **không có delivery zone** | `shippingFee = 0`, `estimatedDeliveryMinutes = null` |
| **Scenario 2** | Checkout **có delivery zone pricing** | `shippingFee = 2.5`, `estimatedDeliveryMinutes ≈ 22` |

---

## 🔐 Step 0: Lấy Auth Token

Trước hết, ta cần đăng ký & đăng nhập để lấy bearer token.

### 0.1 POST /api/auth/register

```bash
curl -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@test.soli",
    "password": "TestPass123!",
    "name": "Test Owner"
  }'
```

**Response (201):**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "owner@test.soli",
    "name": "Test Owner",
    "role": "restaurant"
  },
  "token": "eyJhbGc..."
}
```

**Lưu token này vào variable `TOKEN`:**
```bash
TOKEN="eyJhbGc..."
```

---

## 📦 Step 1: Tạo Restaurant (nếu cần)

Kiểm tra xem là một owner của restaurant chưa. Nếu chưa, tạo mới:

### 1.1 POST /api/restaurants

```bash
curl -X POST http://localhost:3000/api/restaurants \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Manual Test Restaurant",
    "description": "For manual checkout testing",
    "address": "123 Test Street, HCM",
    "phone": "+84-0123-456-789"
  }'
```

**Response (201):**
```json
{
  "id": "12345678-1234-1234-1234-123456789abc",
  "name": "Manual Test Restaurant",
  "description": "For manual checkout testing",
  "address": "123 Test Street, HCM",
  "phone": "+84-0123-456-789",
  "latitude": null,
  "longitude": null,
  "isOpen": true,
  "isApproved": true,
  "ownerId": "550e8400-e29b-41d4-a716-446655440000",
  "createdAt": "2025-05-03T10:00:00.000Z",
  "updatedAt": "2025-05-03T10:00:00.000Z"
}
```

**Lưu Restaurant ID:**
```bash
RESTAURANT_ID="12345678-1234-1234-1234-123456789abc"
```

---

## 🍔 Step 2: Tạo Menu Item

### 2.1 POST /api/menu-items

```bash
curl -X POST http://localhost:3000/api/menu-items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "restaurantId": "'$RESTAURANT_ID'",
    "name": "Beef Burger",
    "price": 10.0,
    "description": "Delicious beef burger"
  }'
```

**Response (201):**
```json
{
  "id": "87654321-4321-4321-4321-abcdef012345",
  "restaurantId": "12345678-1234-1234-1234-123456789abc",
  "name": "Beef Burger",
  "price": 10.0,
  "status": "available",
  "modifiers": [],
  "createdAt": "2025-05-03T10:01:00.000Z",
  "updatedAt": "2025-05-03T10:01:00.000Z"
}
```

**Lưu Menu Item ID:**
```bash
MENU_ITEM_ID="87654321-4321-4321-4321-abcdef012345"
```

**Đợi ~200ms để snapshot được project:**
```bash
sleep 0.2
```

---

---

# 🎯 SCENARIO 1: Checkout Cơ Bản (Không Có Delivery Zone)

## Mục đích
Test checkout khi restaurant **chưa có delivery zone** hoặc **delivery address không có GPS coordinates**.  
Trong trường hợp này, **soft guard** kích hoạt → `shippingFee = 0`, `estimatedDeliveryMinutes = null`.

---

## Step 1S1: Thêm item vào cart

### 1S1.1 POST /api/carts/my/items

```bash
curl -X POST http://localhost:3000/api/carts/my/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "menuItemId": "'$MENU_ITEM_ID'",
    "restaurantId": "'$RESTAURANT_ID'",
    "restaurantName": "Manual Test Restaurant",
    "itemName": "Beef Burger",
    "unitPrice": 10.0,
    "quantity": 2
  }'
```

**Response (201):**
```json
{
  "success": true,
  "message": "Item added to cart"
}
```

---

## Step 2S1: Checkout (không có GPS)

### 2S1.1 POST /api/carts/my/checkout

```bash
curl -X POST http://localhost:3000/api/carts/my/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryAddress": {
      "street": "999 Destination Street",
      "district": "District 1",
      "city": "Ho Chi Minh City"
    },
    "paymentMethod": "cod"
  }'
```

**Response (201):**
```json
{
  "orderId": "11111111-1111-1111-1111-111111111111",
  "status": "pending",
  "totalAmount": 20.0,
  "shippingFee": 0,
  "estimatedDeliveryMinutes": null,
  "paymentMethod": "cod",
  "paymentUrl": null,
  "createdAt": "2025-05-03T10:02:00.000Z"
}
```

---

## ✅ Kết quả & Giải thích

### **Tại sao `shippingFee = 0`?**

1. **Delivery address không có GPS** (`latitude`/`longitude` không được cung cấp)
2. **Soft guard kích hoạt**: Nếu delivery address không có toạ độ, hệ thống **bỏ qua** tính toán delivery zone  
3. **Kết quả**: `shippingFee = 0`, `estimatedDeliveryMinutes = null`

### **Tại sao `estimatedDeliveryMinutes = null`?**

- Delivery time estimate yêu cầu:
  - Restaurant có `latitude`/`longitude` ✓ (chưa có)
  - Delivery address có `latitude`/`longitude` ✗ (không có)
  - Ít nhất 1 active delivery zone ✓ (chưa tạo)
- Vì delivery address không có GPS → **không thể tính khoảng cách** → `estimatedDeliveryMinutes = null`

### **Tại sao `totalAmount = 20.0`?**

- `itemsTotal = unitPrice × quantity = 10.0 × 2 = 20.0`
- `shippingFee = 0` (soft guard)
- **`totalAmount = itemsTotal + shippingFee = 20.0 + 0 = 20.0`**

### **Tại sao cart bị clear?**

Sau khi checkout thành công, Redis cache tự động xóa cart key (`cart:<customerId>`) để tránh duplicate orders nếu user retry.

---

---

# 🎯 SCENARIO 2: Checkout Với Delivery Zone Pricing

## Mục đích
Test checkout khi restaurant **có delivery zone** và **delivery address nằm trong zone**.  
Hệ thống sẽ tính toán:
- `shippingFee = baseFee + (distance_km × perKmRate)`
- `estimatedDeliveryMinutes = prepTime + travelTime + buffer`

---

## Step 1S2: Setup Restaurant với GPS & Delivery Zone

### 1S2.1 PATCH /api/restaurants/:id (cập nhật GPS)

```bash
curl -X PATCH http://localhost:3000/api/restaurants/$RESTAURANT_ID \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "latitude": 10.7769,
    "longitude": 106.7009
  }'
```

**Response (200):**
```json
{
  "id": "12345678-1234-1234-1234-123456789abc",
  "name": "Manual Test Restaurant",
  "latitude": 10.7769,
  "longitude": 106.7009,
  ...
}
```

**Đợi ~200ms cho snapshot update:**
```bash
sleep 0.2
```

---

### 1S2.2 POST /api/restaurants/:id/delivery-zones

Tạo 1 delivery zone với:
- **radiusKm**: 10 (phạm vi 10 km)
- **baseFee**: 2.5 (phí cơ bản)
- **perKmRate**: 0 (không tính theo km — để kết quả deterministic)
- **avgSpeedKmh**: 30 (tốc độ giao hàng trung bình)
- **prepTimeMinutes**: 15 (thời gian chuẩn bị)
- **bufferMinutes**: 5 (thời gian buffer)

```bash
curl -X POST http://localhost:3000/api/restaurants/$RESTAURANT_ID/delivery-zones \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "City Zone",
    "radiusKm": 10,
    "baseFee": 2.5,
    "perKmRate": 0,
    "avgSpeedKmh": 30,
    "prepTimeMinutes": 15,
    "bufferMinutes": 5
  }'
```

**Response (201):**
```json
{
  "id": "zone-uuid-12345",
  "restaurantId": "12345678-1234-1234-1234-123456789abc",
  "name": "City Zone",
  "radiusKm": 10,
  "baseFee": 2.5,
  "perKmRate": 0,
  "avgSpeedKmh": 30,
  "prepTimeMinutes": 15,
  "bufferMinutes": 5,
  "isActive": true,
  "createdAt": "2025-05-03T10:03:00.000Z"
}
```

**Đợi ~200ms cho zone snapshot:**
```bash
sleep 0.2
```

---

## Step 2S2: Thêm item vào cart

### 2S2.1 POST /api/carts/my/items

```bash
curl -X POST http://localhost:3000/api/carts/my/items \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "menuItemId": "'$MENU_ITEM_ID'",
    "restaurantId": "'$RESTAURANT_ID'",
    "restaurantName": "Manual Test Restaurant",
    "itemName": "Beef Burger",
    "unitPrice": 10.0,
    "quantity": 3
  }'
```

**Response (201):**
```json
{
  "success": true,
  "message": "Item added to cart"
}
```

---

## Step 3S2: Checkout với GPS (delivery address nằm trong zone)

Delivery address tại **latitude: 10.7859, longitude: 106.7009**  
(~1 km phía bắc của restaurant — nằm trong 10 km zone)

### 3S2.1 POST /api/carts/my/checkout

```bash
curl -X POST http://localhost:3000/api/carts/my/checkout \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "deliveryAddress": {
      "street": "456 Nearby Street",
      "district": "District 3",
      "city": "Ho Chi Minh City",
      "latitude": 10.7859,
      "longitude": 106.7009
    },
    "paymentMethod": "cod"
  }'
```

**Response (201):**
```json
{
  "orderId": "22222222-2222-2222-2222-222222222222",
  "status": "pending",
  "totalAmount": 32.5,
  "shippingFee": 2.5,
  "estimatedDeliveryMinutes": 22,
  "paymentMethod": "cod",
  "paymentUrl": null,
  "createdAt": "2025-05-03T10:04:00.000Z"
}
```

---

## ✅ Kết quả & Giải thích

### **Tại sao `shippingFee = 2.5`?**

**Công thức:**
```
shippingFee = baseFee + (distance_km × perKmRate)
           = 2.5 + (1.0 × 0)
           = 2.5
```

**Lý do:**
1. Delivery address nằm trong zone (1 km < 10 km radius) ✓
2. Zone có `baseFee = 2.5` và `perKmRate = 0`
3. Distance được tính bằng **Haversine formula** (khoảng cách thực trên hình cầu)
4. Vì `perKmRate = 0` → không tính phí theo km → chỉ lấy `baseFee`

---

### **Tại sao `estimatedDeliveryMinutes = 22`?**

**Công thức:**
```
estimatedDeliveryMinutes = Math.ceil(
  prepTimeMinutes 
  + (distance_km / avgSpeedKmh × 60) 
  + bufferMinutes
)
= Math.ceil(
  15 
  + (1.0 / 30 × 60) 
  + 5
)
= Math.ceil(15 + 2 + 5)
= Math.ceil(22)
= 22
```

**Breakdown:**
- **Prep time**: 15 phút (chuẩn bị đồ ăn)
- **Travel time**: 1 km ÷ 30 km/h × 60 = 2 phút
- **Buffer**: 5 phút (thời gian dự phòng)
- **Tổng**: 22 phút

---

### **Tại sao `totalAmount = 32.5`?**

**Công thức:**
```
totalAmount = itemsTotal + shippingFee
           = (unitPrice × quantity) + shippingFee
           = (10.0 × 3) + 2.5
           = 30.0 + 2.5
           = 32.5
```

---

## 🚫 Edge Case: Delivery Address Ngoài Zone

Nếu thay delivery address bằng một địa điểm **ngoài 10 km zone**:

```json
"deliveryAddress": {
  "latitude": 10.9919,
  "longitude": 106.7009
}
```

**Response (422 Unprocessable Entity):**
```json
{
  "statusCode": 422,
  "error": "Unprocessable Entity",
  "message": "Delivery address is outside all active delivery zones"
}
```

**Lý do:**
- Haversine distance từ (10.7769, 106.7009) đến (10.9919, 106.7009) ≈ 24 km
- Zone radius là 10 km → 24 > 10 → **reject**
- Không có zone nào cover được → **422**

---

---

## 📊 So Sánh 2 Scenario

| Yếu tố | Scenario 1 (Cơ bản) | Scenario 2 (Với Zone) |
|--------|-----|-----|
| **GPS restaurnat** | ❌ Không có | ✅ (10.7769, 106.7009) |
| **Delivery Zone** | ❌ Không có | ✅ 10 km, baseFee=2.5 |
| **GPS delivery** | ❌ Không có | ✅ (10.7859, 106.7009) |
| **shippingFee** | 0 | 2.5 |
| **estimatedMinutes** | null | 22 |
| **totalAmount** | 20.0 | 32.5 |
| **Kích hoạt** | Soft guard | Hard zone pricing |

---

## 🛠️ Troubleshooting

### ❌ Response 400 Bad Request

**Nguyên nhân:**
- Missing `Authorization: Bearer $TOKEN` header
- JSON malformed
- Missing required fields

**Fix:**
```bash
# Kiểm tra token còn hạn hay không
# Token từ register/login mặc định hết hạn sau 7 ngày
```

---

### ❌ Response 401 Unauthorized

**Nguyên nhân:**
- Token hết hạn
- Token không hợp lệ

**Fix:**
```bash
# Đăng nhập lại để lấy token mới
curl -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{
    "email": "owner@test.soli",
    "password": "TestPass123!"
  }'
```

---

### ❌ Response 422 (checkout)

**Scenario 1:**
- Giá trị delivery address ngoài zone → upgrade lên Scenario 2 hoặc set GPS trong Scenario 1

**Scenario 2:**
- Delivery address ngoài 10 km zone
- Restaurant chưa có GPS (PATCH restaurant trước)
- Delivery zone chưa active

---

### ⏱️ "Checkout returns 400 empty cart"

**Nguyên nhân:**
- Quên thêm item vào cart trước khi checkout

**Fix:**
```bash
# Add item lại
curl -X POST http://localhost:3000/api/carts/my/items ...
```

---

## 📝 Notes

1. **Async projections**: Sau mỗi HTTP mutation (create/update restaurant, zone, item), đợi ~200ms trước checkout để snapshot được cập nhật
2. **perKmRate = 0**: Để kết quả deterministic (không phụ thuộc vào độ chính xác tính toán Haversine)
3. **Idempotency**: Nếu retry checkout với header `X-Idempotency-Key`, response sẽ return `orderId` cũ (không tạo duplicate)
4. **Cart clear**: Sau khi checkout thành công, cart tự động clear

---

**Happy testing! 🚀**
