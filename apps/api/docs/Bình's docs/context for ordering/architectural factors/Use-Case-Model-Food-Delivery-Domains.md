# Mô hình Use Case — Hệ thống Giao Đồ Ăn (Release 1 / MVP)

Version 1.0  
Ngày: 24/03/2026  
Nhóm thực hiện: Development Team

## Bảng ghi nhận thay đổi tài liệu

| Ngày       | Phiên bản | Mô tả                                                                      | Tác giả          |
| ---------- | --------: | -------------------------------------------------------------------------- | ---------------- |
| 24/03/2026 |       1.0 | Use case theo miền nghiệp vụ: sơ đồ, actor, danh sách use case, đặc tả MVP | Development Team |

---

# 1. Sơ đồ Use-case

> Mỗi sơ đồ tương ứng một **miền nghiệp vụ** (business domain). PlantUML blocks bên dưới là runnable (`@startuml` → `@enduml`).

## 1.1 Use-case Quản lý người dùng & truy cập

Nguồn `.puml`: `Documents/usecase-diagrams/01-user-access.puml`

```plantuml
@startuml
title Use Case Diagram - User & Access Management (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Customer" as A_Customer
actor "Restaurant Partner" as A_Restaurant
actor "Shipper" as A_Shipper
actor "System Administrator" as A_Admin
actor "OAuth Provider\n(Google/Apple)" as A_OAuth

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-01 Customer Register/Login" as UC01
  usecase "UC-02 Submit Partner Application\n(Restaurant/Shipper)" as UC02

  usecase "UC-03 Admin Sign-in + RBAC" as UC03
  usecase "UC-04 Approve/Reject Partners" as UC04
  usecase "UC-05 Suspend/Reactivate Partners" as UC05
  usecase "UC-06 Search User Accounts" as UC06

  usecase "UC-07 Write Immutable Audit Log" as UC07
}

A_Customer -- UC01
A_Restaurant -- UC02
A_Shipper -- UC02
A_Admin -- UC03
A_Admin -- UC04
A_Admin -- UC05
A_Admin -- UC06
A_OAuth -- UC01

UC04 .> UC07 : <<include>>
UC05 .> UC07 : <<include>>
UC06 .> UC07 : <<include>>

@enduml
```

## 1.2 Use-case Khám phá & giỏ hàng (Customer)

Nguồn `.puml`: `Documents/usecase-diagrams/02-discovery-cart.puml`

```plantuml
@startuml
title Use Case Diagram - Discovery & Cart (Customer) (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Customer" as A_Customer
actor "Maps / Geocoding API" as A_Maps

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-10 Browse/Search Restaurants" as UC10
  usecase "UC-11 Search/Filter Food Items\n(Category + Proximity)" as UC11
  usecase "UC-12 View Restaurant/Item Availability" as UC12

  usecase "UC-13 Manage Shopping Cart" as UC13
  usecase "UC-14 Enforce Single-Restaurant Cart" as UC14

  usecase "UC-15 Resolve Location for Proximity" as UC15
}

A_Customer -- UC10
A_Customer -- UC11
A_Customer -- UC12
A_Customer -- UC13
A_Maps -- UC15

UC13 .> UC14 : <<include>>
UC11 .> UC15 : <<include>>

@enduml
```

## 1.3 Use-case Checkout & thanh toán

Nguồn `.puml`: `Documents/usecase-diagrams/03-checkout-payment.puml`

```plantuml
@startuml
title Use Case Diagram - Checkout & Payment (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Customer" as A_Customer
actor "VNPay" as A_VNPay
actor "Maps / Geocoding API" as A_Maps

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-20 Validate Deliverability\n(Service Area + Radius)" as UC20
  usecase "UC-21 Checkout / Place Order" as UC21
  usecase "UC-22 Select Payment Method" as UC22

  usecase "UC-23 Place Order with COD" as UC23
  usecase "UC-24 Pay via VNPay" as UC24
  usecase "UC-25 Confirm VNPay Payment" as UC25
  usecase "UC-26 Handle VNPay Failure/Cancel" as UC26

  usecase "UC-27 Ensure Checkout Idempotency" as UC27
  usecase "UC-28 Finalize & Route Order" as UC28
}

A_Customer -- UC21
A_Customer -- UC22
A_Customer -- UC23
A_Customer -- UC24
A_VNPay -- UC25
A_Maps -- UC20

UC21 .> UC20 : <<include>>
UC21 .> UC22 : <<include>>
UC21 .> UC27 : <<include>>

UC23 .> UC21 : <<extend>>\n[payment=COD]
UC24 .> UC21 : <<extend>>\n[payment=VNPay]

UC24 .> UC25 : <<include>>
UC26 .> UC24 : <<extend>>\n[fail/cancel]

UC23 .> UC28 : <<include>>
UC28 .> UC24 : <<extend>>\n[VNPay success]

@enduml
```

## 1.4 Use-case Quản lý đơn hàng phía Nhà hàng

Nguồn `.puml`: `Documents/usecase-diagrams/04-restaurant-orders.puml`

```plantuml
@startuml
title Use Case Diagram - Restaurant Order Management (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Restaurant Partner" as A_Restaurant

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-30 Manage Menu Items" as UC30
  usecase "UC-31 Control Availability\n(Item/Restaurant)" as UC31

  usecase "UC-32 Accept/Reject Incoming Orders" as UC32
  usecase "UC-33 Update Preparation Status\n(Preparing/Ready)" as UC33
  usecase "UC-34 Cancel Order with Reason" as UC34

  usecase "UC-35 New Order Alert" as UC35
}

A_Restaurant -- UC30
A_Restaurant -- UC31
A_Restaurant -- UC32
A_Restaurant -- UC33
A_Restaurant -- UC34

UC32 .> UC35 : <<include>>

@enduml
```

## 1.5 Use-case Quản lý giao hàng (Shipper)

Nguồn `.puml`: `Documents/usecase-diagrams/05-delivery-shipper.puml`

```plantuml
@startuml
title Use Case Diagram - Delivery Management (Shipper) (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Shipper" as A_Shipper

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-40 Toggle Availability" as UC40
  usecase "UC-41 Accept Delivery Job" as UC41
  usecase "UC-42 Confirm Pickup" as UC42
  usecase "UC-43 Confirm Delivery" as UC43
}

A_Shipper -- UC40
A_Shipper -- UC41
A_Shipper -- UC42
A_Shipper -- UC43

@enduml
```

## 1.6 Use-case Theo dõi đơn & thông báo

Nguồn `.puml`: `Documents/usecase-diagrams/06-tracking-notifications.puml`

```plantuml
@startuml
title Use Case Diagram - Order Tracking & Notifications (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "Customer" as A_Customer
actor "Restaurant Partner" as A_Restaurant
actor "Shipper" as A_Shipper
actor "System Administrator" as A_Admin
actor "Push Provider\n(APNs/FCM)" as A_Push

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-50 Receive Order Status Updates" as UC50
  usecase "UC-51 Publish Order Status Update" as UC51

  usecase "UC-52 WebSocket Update\n(Foreground)" as UC52
  usecase "UC-53 Push Notification\n(Background)" as UC53
  usecase "UC-54 Sync Latest Status\n(on reconnect)" as UC54
  usecase "UC-55 Notify Cancellation Reason" as UC55
}

A_Customer -- UC50
A_Restaurant -- UC51
A_Shipper -- UC51
A_Admin -- UC51
A_Push -- UC53

UC50 .> UC52 : <<include>>
UC50 .> UC53 : <<include>>
UC50 .> UC54 : <<include>>
UC55 .> UC51 : <<extend>>\n[order cancelled]

@enduml
```

## 1.7 Use-case Vận hành Admin & báo cáo

Nguồn `.puml`: `Documents/usecase-diagrams/07-admin-ops-reporting.puml`

```plantuml
@startuml
title Use Case Diagram - Admin Operations & Reporting (Release 1 / MVP)

left to right direction
skinparam packageStyle rectangle
skinparam shadowing false

actor "System Administrator" as A_Admin

rectangle "Food Delivery System (MVP)" as SYS {
  usecase "UC-60 Monitor Platform Health" as UC60
  usecase "UC-61 Monitor Orders & View Details" as UC61
  usecase "UC-62 Cancel Order with Reason" as UC62

  usecase "UC-63 Configure Commission %\n(+ Change History)" as UC63
  usecase "UC-64 View Reports" as UC64
  usecase "UC-65 Export Reports (CSV)" as UC65

  usecase "UC-66 Calculate GMV & Commission" as UC66
}

A_Admin -- UC60
A_Admin -- UC61
A_Admin -- UC62
A_Admin -- UC63
A_Admin -- UC64

UC64 .> UC65 : <<include>>
UC64 .> UC66 : <<include>>

@enduml
```

---

# 2. Danh sách các Actor

| STT | Tên Actor                     | Ý nghĩa/Ghi chú                                                                                                |
| --: | ----------------------------- | -------------------------------------------------------------------------------------------------------------- |
|   1 | Customer                      | Người đặt món: khám phá nhà hàng/món, quản lý giỏ, checkout, theo dõi đơn.                                     |
|   2 | Restaurant Partner            | Nhà hàng/nhân viên bếp: quản lý menu & availability, nhận và xử lý đơn.                                        |
|   3 | Shipper                       | Nhân viên giao hàng: bật/tắt sẵn sàng, nhận job, pickup, delivered.                                            |
|   4 | System Administrator          | Vận hành hệ thống: duyệt đối tác, giám sát, can thiệp hủy đơn, cấu hình commission, báo cáo.                   |
|   5 | VNPay                         | Cổng thanh toán online; hệ thống chỉ finalize/routing sau khi nhận xác nhận thành công (BR-4).                 |
|   6 | OAuth Provider (Google/Apple) | Xác thực đăng nhập OAuth cho luồng đăng ký/đăng nhập (SRS FR-1.1).                                             |
|   7 | Maps/Geocoding API            | Geocoding và tính toán khoảng cách: proximity search + kiểm tra bán kính + service area (Vision dependencies). |
|   8 | Push Provider (APNs/FCM)      | Gửi push notification khi ứng dụng nền/đóng (SRS FR-2.3).                                                      |

---

# 3. Danh sách các Use-case

Danh sách dưới đây là **7 Use Case theo miền nghiệp vụ** (mỗi Use Case tương ứng 1 sơ đồ ở Mục 1). Mỗi Use Case miền sẽ được **phân rã** thành các Use Case con (UC-xx) đã thể hiện trong PlantUML.

| STT | Use Case ID (Miền) | Tên Use Case (Miền nghiệp vụ)           | Actor chính                                                                 | Nguồn sơ đồ                                                 | Bao gồm (Use Case con)       |
| --: | ------------------ | --------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------- | ---------------------------- |
|   1 | UC-D1              | Use-case Quản lý người dùng & truy cập  | Customer; Restaurant Partner; Shipper; System Administrator; OAuth Provider | `Documents/usecase-diagrams/01-user-access.puml`            | UC-01..UC-07                 |
|   2 | UC-D2              | Use-case Khám phá & giỏ hàng (Customer) | Customer; Device Location Service (GPS); Maps/Geocoding API                 | `Documents/usecase-diagrams/02-discovery-cart.puml`         | UC-10..UC-20 (theo sơ đồ 02) |
|   3 | UC-D3              | Use-case Checkout & thanh toán          | Customer; VNPay; Maps/Geocoding API                                         | `Documents/usecase-diagrams/03-checkout-payment.puml`       | UC-20..UC-28                 |
|   4 | UC-D4              | Use-case Quản lý đơn hàng phía Nhà hàng | Restaurant Partner                                                          | `Documents/usecase-diagrams/04-restaurant-orders.puml`      | UC-30..UC-35                 |
|   5 | UC-D5              | Use-case Quản lý giao hàng (Shipper)    | Shipper                                                                     | `Documents/usecase-diagrams/05-delivery-shipper.puml`       | UC-40..UC-43                 |
|   6 | UC-D6              | Use-case Theo dõi đơn & thông báo       | Customer; Restaurant Partner; Shipper; System Administrator; Push Provider  | `Documents/usecase-diagrams/06-tracking-notifications.puml` | UC-50..UC-55                 |
|   7 | UC-D7              | Use-case Vận hành Admin & báo cáo       | System Administrator                                                        | `Documents/usecase-diagrams/07-admin-ops-reporting.puml`    | UC-60..UC-66                 |

---

# 4. Đặc tả Use-case

Ghi chú chung (áp dụng cho nhiều Use Case miền):

- BR-2: Giỏ hàng chỉ chứa món của 1 nhà hàng.
- BR-3: Địa chỉ giao phải nằm trong bán kính phục vụ nhà hàng.
- BR-4: VNPay thành công mới được finalize/routing đơn.
- BR-6: MVP chỉ hoạt động trong một service area.
- BR-7: Trạng thái đơn phải đi theo chuỗi hợp lệ.
- FR-2.3/FR-2.4: Push notification và hiển thị lý do hủy.

Dưới đây là **đặc tả cho 7 Use Case miền** ở Mục 3 (theo format tham khảo).

## UC-D1 — Use-case Quản lý người dùng & truy cập

|                                               |                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Case ID                                   | UC-D1                                                                                                                                                                                                                                                                                                                                  |
| Tên Use Case                                  | Use-case Quản lý người dùng & truy cập                                                                                                                                                                                                                                                                                                 |
| Actor                                         | Customer; Restaurant Partner; Shipper; System Administrator; OAuth Provider (Google/Apple)                                                                                                                                                                                                                                             |
| Mô tả (Description)                           | Quản lý đăng ký/đăng nhập, nộp hồ sơ đối tác, đăng nhập admin + RBAC, duyệt/tạm khóa, tra cứu tài khoản và ghi audit log cho hành động quản trị (FR-1.1; FR-4.1..FR-4.3; FR-4.16; BR-1).                                                                                                                                               |
| Điều kiện tiên quyết (Preconditions)          | (1) Hệ thống hoạt động; (2) Có kết nối mạng; (3) OAuth provider sẵn sàng (nếu dùng OAuth).                                                                                                                                                                                                                                             |
| Kết quả sau cùng (Postconditions)             | (1) Session người dùng được tạo hoặc bị từ chối an toàn; (2) Hồ sơ partner ở trạng thái `Pending Approval`/`Approved`/`Rejected`; (3) Admin action được enforce RBAC và có audit log.                                                                                                                                                  |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                                                    |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                                                              |
| Luồng sự kiện chính (Normal Course of Events) | 1) Người dùng đăng ký/đăng nhập (email hoặc OAuth).<br>2) Partner nộp hồ sơ đăng ký hoạt động trên nền tảng.<br>3) Admin đăng nhập dashboard, hệ thống nạp quyền và enforce RBAC.<br>4) Admin duyệt/từ chối hồ sơ hoặc tạm khóa/mở lại account theo quy định.<br>5) Hệ thống ghi audit log cho các hành động quản trị theo chính sách. |
| Luồng thay thế (Alternative Courses)          | A1) Đăng nhập OAuth thay cho email/password.<br>A2) Admin thao tác nhưng thiếu quyền → bị từ chối và ghi nhận attempt (không lộ thông tin nhạy cảm).                                                                                                                                                                                   |
| Ngoại lệ (Exceptions)                         | E1) Dịch vụ auth/OAuth lỗi → hiển thị lỗi retryable; không crash; không tạo session sai.<br>E2) Ghi audit log thất bại → xử lý theo policy thống nhất (block hoặc retry).                                                                                                                                                              |
| Bao gồm (Includes)                            | UC-01..UC-07 (theo sơ đồ 01).                                                                                                                                                                                                                                                                                                          |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                                                  |
| Yêu cầu đặc biệt (Special Requirements)       | Bảo mật (không log dữ liệu nhạy cảm); RBAC bắt buộc cho admin actions; audit log bất biến cho admin actions (FR-4.16).                                                                                                                                                                                                                 |
| Giả định (Assumptions)                        | OAuth provider tuân thủ SLA và hợp đồng tích hợp; Admin quy trình duyệt là thủ công (MVP).                                                                                                                                                                                                                                             |
| Ghi chú & Vấn đề (Notes and Issues)           | Có thể cho phép browse menu không cần login (tuỳ chính sách MVP); nếu vậy thì UC-D2 có thể độc lập UC-D1 ở mức UI.                                                                                                                                                                                                                     |

## UC-D2 — Use-case Khám phá & giỏ hàng (Customer)

|                                               |                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Case ID                                   | UC-D2                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Tên Use Case                                  | Use-case Khám phá & giỏ hàng (Customer)                                                                                                                                                                                                                                                                                                                                                                                                                        |
| Actor                                         | Customer; Device Location Service (GPS); Maps/Geocoding API                                                                                                                                                                                                                                                                                                                                                                                                    |
| Mô tả (Description)                           | Customer khám phá nhà hàng/món theo tên/category/proximity, xem availability, quản lý giỏ hàng và enforce giỏ chỉ 1 nhà hàng (FR-1.2; FR-1.3; BR-2; BR-8; US-2/3/4/5/22).                                                                                                                                                                                                                                                                                      |
| Điều kiện tiên quyết (Preconditions)          | Có dữ liệu nhà hàng/menu active; có location (GPS permission hoặc địa chỉ nhập tay) khi dùng proximity.                                                                                                                                                                                                                                                                                                                                                        |
| Kết quả sau cùng (Postconditions)             | Customer nhìn thấy danh sách nhà hàng/món phù hợp; giỏ hàng cập nhật đúng; không thể chứa món từ nhiều nhà hàng; món sold-out/nhà hàng closed bị chặn add-to-cart.                                                                                                                                                                                                                                                                                             |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Luồng sự kiện chính (Normal Course of Events) | 1) Customer browse/search nhà hàng và/hoặc tìm món theo category + proximity.<br>2) Khi cần proximity, Customer cung cấp vị trí (GPS hoặc nhập địa chỉ) và hệ thống geocode/reverse-geocode.<br>3) Customer mở chi tiết nhà hàng/menu và xem availability (closed/sold out).<br>4) Customer thêm/xóa/sửa số lượng món trong giỏ; hệ thống tính tổng.<br>5) Khi Customer cố thêm món khác nhà hàng, hệ thống chặn và đưa lựa chọn clear cart hoặc hủy thao tác. |
| Luồng thay thế (Alternative Courses)          | A1) Không có GPS permission → yêu cầu nhập địa chỉ; không trả kết quả proximity sai lệch.<br>A2) Customer chọn “Clear Cart” để chuyển sang nhà hàng khác.                                                                                                                                                                                                                                                                                                      |
| Ngoại lệ (Exceptions)                         | E1) Maps/Geocoding API lỗi/quá quota → báo lỗi retry; không cho hiển thị “proximity giả”.<br>E2) Availability thay đổi trong lúc browse → UI cần refresh trong cửa sổ mục tiêu.                                                                                                                                                                                                                                                                                |
| Bao gồm (Includes)                            | Các UC con trong sơ đồ 02 (UC-10..UC-20 tuỳ phiên bản sơ đồ 02).                                                                                                                                                                                                                                                                                                                                                                                               |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| Yêu cầu đặc biệt (Special Requirements)       | Enforce BR-2 bắt buộc; enforce BR-8 (không add-to-cart item sold-out/restaurant closed).                                                                                                                                                                                                                                                                                                                                                                       |
| Giả định (Assumptions)                        | Customer có internet ổn định; dữ liệu menu/availability được partner cập nhật kịp thời (BR-8).                                                                                                                                                                                                                                                                                                                                                                 |
| Ghi chú & Vấn đề (Notes and Issues)           | Logic “deliverability” chi tiết được kiểm tra chặt ở UC-D3 (checkout). Ở UC-D2 có thể dùng proximity filter để giảm thất bại khi checkout (tuỳ cách thiết kế UX).                                                                                                                                                                                                                                                                                              |

## UC-D3 — Use-case Checkout & thanh toán

|                                               |                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Case ID                                   | UC-D3                                                                                                                                                                                                                                                                                                                                                                                  |
| Tên Use Case                                  | Use-case Checkout & thanh toán                                                                                                                                                                                                                                                                                                                                                         |
| Actor                                         | Customer; VNPay; Maps/Geocoding API                                                                                                                                                                                                                                                                                                                                                    |
| Mô tả (Description)                           | Customer checkout và đặt đơn theo COD hoặc VNPay; hệ thống enforce deliverability (service area + radius), chọn payment, idempotency, và chỉ finalize/routing khi VNPay confirm success (FR-1.4; FR-1.5; BR-3/4/6; US-6/7).                                                                                                                                                            |
| Điều kiện tiên quyết (Preconditions)          | Giỏ hợp lệ (1 nhà hàng); Customer có địa chỉ giao; hệ thống tích hợp VNPay sẵn sàng khi chọn VNPay.                                                                                                                                                                                                                                                                                    |
| Kết quả sau cùng (Postconditions)             | COD: đơn được finalize/routing ngay.<br>VNPay: chỉ finalize/routing sau khi nhận confirm success; fail/cancel → không routing và hiển thị trạng thái rõ ràng.                                                                                                                                                                                                                          |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                                                                                                    |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                                                                                                              |
| Luồng sự kiện chính (Normal Course of Events) | 1) Customer mở checkout và xác nhận địa chỉ giao.<br>2) Hệ thống validate deliverability (service area + bán kính).<br>3) Customer chọn COD hoặc VNPay.<br>4) Hệ thống enforce idempotency chống tạo đơn trùng khi retry.<br>5) Nếu COD: tạo đơn và finalize/routing.<br>6) Nếu VNPay: khởi tạo phiên thanh toán, nhận callback/return, xác thực, và chỉ finalize/routing khi success. |
| Luồng thay thế (Alternative Courses)          | A1) VNPay fail/cancel → hiển thị thất bại/hủy, cho retry; không routing.<br>A2) Retry checkout với cùng idempotency key trong TTL → trả về cùng order ID.                                                                                                                                                                                                                              |
| Ngoại lệ (Exceptions)                         | E1) Deliverability fail → chặn checkout và hiển thị lý do (ngoài service area / ngoài bán kính).<br>E2) Callback VNPay không hợp lệ → coi như fail; không finalize/routing.                                                                                                                                                                                                            |
| Bao gồm (Includes)                            | UC-20..UC-28 (theo sơ đồ 03).                                                                                                                                                                                                                                                                                                                                                          |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                                                                                                  |
| Yêu cầu đặc biệt (Special Requirements)       | BR-4 là ràng buộc cứng: VNPay chưa confirm success thì không finalize/routing; idempotency bắt buộc cho luồng checkout.                                                                                                                                                                                                                                                                |
| Giả định (Assumptions)                        | VNPay sandbox/production hoạt động theo hợp đồng và có cơ chế verify chữ ký.                                                                                                                                                                                                                                                                                                           |
| Ghi chú & Vấn đề (Notes and Issues)           | Cần quy định rõ trạng thái đơn khi VNPay fail/cancel (payment_failed/cancelled) để đảm bảo thống kê/hiển thị nhất quán.                                                                                                                                                                                                                                                                |

## UC-D4 — Use-case Quản lý đơn hàng phía Nhà hàng

|                                               |                                                                                                                                                                                                                                                                                                                                                                                                                 |
| --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Case ID                                   | UC-D4                                                                                                                                                                                                                                                                                                                                                                                                           |
| Tên Use Case                                  | Use-case Quản lý đơn hàng phía Nhà hàng                                                                                                                                                                                                                                                                                                                                                                         |
| Actor                                         | Restaurant Partner                                                                                                                                                                                                                                                                                                                                                                                              |
| Mô tả (Description)                           | Nhà hàng quản lý menu & availability, nhận đơn mới, accept/reject theo timeout, cập nhật trạng thái chuẩn bị và hủy đơn với lý do (FR-3.1..FR-3.4; BR-7/8; US-11/12/13/23/24).                                                                                                                                                                                                                                  |
| Điều kiện tiên quyết (Preconditions)          | Partner đã được admin duyệt; đã đăng nhập portal; đơn đã được route tới nhà hàng.                                                                                                                                                                                                                                                                                                                               |
| Kết quả sau cùng (Postconditions)             | Menu/availability cập nhật và phản ánh cho customer; đơn được accept/reject/hủy đúng rule; trạng thái đơn tiến triển đúng chuỗi (BR-7).                                                                                                                                                                                                                                                                         |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                                                                                                                             |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                                                                                                                                       |
| Luồng sự kiện chính (Normal Course of Events) | 1) Partner cập nhật menu và trạng thái sold-out/closed khi cần.<br>2) Khi có đơn mới, hệ thống phát alert nổi bật và hiển thị chi tiết đơn.<br>3) Partner accept hoặc reject đơn trong thời gian cho phép; hệ thống cập nhật trạng thái và notify các bên.<br>4) Partner cập nhật Preparing/Ready for Pickup theo chuỗi hợp lệ.<br>5) Nếu cần hủy trước pickup, partner nhập lý do và hệ thống notify customer. |
| Luồng thay thế (Alternative Courses)          | A1) Quá hạn accept timeout → hệ thống đánh dấu expired/unaccepted và notify customer.                                                                                                                                                                                                                                                                                                                           |
| Ngoại lệ (Exceptions)                         | E1) Thao tác chuyển trạng thái sai chuỗi (BR-7) → bị từ chối.<br>E2) Lỗi kết nối/lưu trạng thái → retry, không tạo trạng thái “nửa chừng”.                                                                                                                                                                                                                                                                      |
| Bao gồm (Includes)                            | UC-30..UC-35 (theo sơ đồ 04).                                                                                                                                                                                                                                                                                                                                                                                   |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                                                                                                                           |
| Yêu cầu đặc biệt (Special Requirements)       | Alert đơn mới phải nổi bật, dễ nhận biết trong bếp (FR-3.3); availability phải có hiệu lực nhanh để chặn đơn mới (BR-8).                                                                                                                                                                                                                                                                                        |
| Giả định (Assumptions)                        | Thiết bị bếp có kết nối ổn định; staff thao tác tối thiểu.                                                                                                                                                                                                                                                                                                                                                      |
| Ghi chú & Vấn đề (Notes and Issues)           | Thống nhất reason codes cho reject/timeout/cancel để tracking & hỗ trợ vận hành dễ hơn.                                                                                                                                                                                                                                                                                                                         |

## UC-D5 — Use-case Quản lý giao hàng (Shipper)

|                                               |                                                                                                                                                                                                                                                                                                                            |
| --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Use Case ID                                   | UC-D5                                                                                                                                                                                                                                                                                                                      |
| Tên Use Case                                  | Use-case Quản lý giao hàng (Shipper)                                                                                                                                                                                                                                                                                       |
| Actor                                         | Shipper                                                                                                                                                                                                                                                                                                                    |
| Mô tả (Description)                           | Shipper bật/tắt sẵn sàng, nhận job, xác nhận pickup và delivered; hệ thống enforce chỉ shipper được assign mới cập nhật trạng thái; cập nhật tuân BR-7 (US-15/16/17; BR-7).                                                                                                                                                |
| Điều kiện tiên quyết (Preconditions)          | Shipper đã được admin duyệt; đã đăng nhập; có job được dispatch.                                                                                                                                                                                                                                                           |
| Kết quả sau cùng (Postconditions)             | Trạng thái shipper availability đồng bộ; job được assign duy nhất; trạng thái đơn chuyển đúng (Picked Up/Delivered) và publish cho customer/admin.                                                                                                                                                                         |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                                        |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                                                  |
| Luồng sự kiện chính (Normal Course of Events) | 1) Shipper set Available để nhận job.<br>2) Shipper nhận dispatch request và accept job; hệ thống lock assignment chống double-assign.<br>3) Shipper đến nhà hàng và confirm pickup; hệ thống validate trạng thái hợp lệ.<br>4) Shipper giao đến khách và confirm delivered; hệ thống ghi timestamp/actor để traceability. |
| Luồng thay thế (Alternative Courses)          | A1) Mạng chập chờn → app hiển thị trạng thái queued/retry; server không đổi trạng thái nếu chưa ghi nhận thành công.                                                                                                                                                                                                       |
| Ngoại lệ (Exceptions)                         | E1) Out-of-sequence (BR-7) → từ chối transition.<br>E2) Shipper không phải người được assign → bị từ chối (security).                                                                                                                                                                                                      |
| Bao gồm (Includes)                            | UC-40..UC-43 (theo sơ đồ 05).                                                                                                                                                                                                                                                                                              |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                                      |
| Yêu cầu đặc biệt (Special Requirements)       | Bảo mật: chỉ shipper assigned cập nhật pickup/delivered; độ tin cậy cao tránh double-assign.                                                                                                                                                                                                                               |
| Giả định (Assumptions)                        | Shipper sử dụng smartphone + GPS; có kết nối mobile data.                                                                                                                                                                                                                                                                  |
| Ghi chú & Vấn đề (Notes and Issues)           | Có thể cần tách “dispatch/assignment” thành module riêng nếu mở rộng thuật toán phân công.                                                                                                                                                                                                                                 |

## UC-D6 — Use-case Theo dõi đơn & thông báo

|                                               |                                                                                                                                                                                                                                                                                |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use Case ID                                   | UC-D6                                                                                                                                                                                                                                                                          |
| Tên Use Case                                  | Use-case Theo dõi đơn & thông báo                                                                                                                                                                                                                                              |
| Actor                                         | Customer; Restaurant Partner; Shipper; System Administrator; Push Provider (APNs/FCM)                                                                                                                                                                                          |
| Mô tả (Description)                           | Hệ thống publish/receive cập nhật trạng thái đơn theo thời gian gần thực; khi app foreground dùng WebSocket, khi background/closed dùng push; khi hủy phải kèm lý do (FR-2.1..FR-2.4; US-9).                                                                                   |
| Điều kiện tiên quyết (Preconditions)          | Order tồn tại; các bên thực hiện hành động làm thay đổi trạng thái; push provider/WebSocket sẵn sàng.                                                                                                                                                                          |
| Kết quả sau cùng (Postconditions)             | Customer nhận cập nhật trạng thái đúng & kịp thời; nếu hủy có reason; khi reconnect có thể sync latest state.                                                                                                                                                                  |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                            |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                      |
| Luồng sự kiện chính (Normal Course of Events) | 1) Restaurant/Shipper/Admin thay đổi trạng thái đơn hợp lệ.<br>2) Hệ thống publish update sự kiện trạng thái.<br>3) Nếu app foreground: đẩy WebSocket cập nhật UI.<br>4) Nếu app background/closed: gửi push notification.<br>5) Nếu đơn bị hủy: notify kèm lý do theo FR-2.4. |
| Luồng thay thế (Alternative Courses)          | A1) App reconnect sau mất mạng → sync trạng thái mới nhất để tránh lệch UI.                                                                                                                                                                                                    |
| Ngoại lệ (Exceptions)                         | E1) Push/WebSocket bị degraded → cần cơ chế fallback theo thiết kế (ví dụ polling) để không “mất update”.                                                                                                                                                                      |
| Bao gồm (Includes)                            | UC-50..UC-55 (theo sơ đồ 06).                                                                                                                                                                                                                                                  |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                          |
| Yêu cầu đặc biệt (Special Requirements)       | Độ trễ cập nhật mục tiêu phải đáp ứng UX; khi hủy luôn có reason; không lộ thông tin nhạy cảm qua push payload.                                                                                                                                                                |
| Giả định (Assumptions)                        | APNs/FCM và WebSocket infra đáp ứng mức sẵn sàng theo kế hoạch MVP.                                                                                                                                                                                                            |
| Ghi chú & Vấn đề (Notes and Issues)           | Nếu MVP chưa có live map tracking, vẫn cần đảm bảo trạng thái “Picked Up/Delivered” cập nhật đúng và nhanh.                                                                                                                                                                    |

## UC-D7 — Use-case Vận hành Admin & báo cáo

|                                               |                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Use Case ID                                   | UC-D7                                                                                                                                                                                                                                                                                                  |
| Tên Use Case                                  | Use-case Vận hành Admin & báo cáo                                                                                                                                                                                                                                                                      |
| Actor                                         | System Administrator                                                                                                                                                                                                                                                                                   |
| Mô tả (Description)                           | Admin giám sát nền tảng và đơn hàng, can thiệp hủy đơn với lý do, cấu hình commission và truy cập báo cáo/xuất CSV; các hành động nhạy cảm cần audit log (FR-4.10..FR-4.16; BR-5).                                                                                                                     |
| Điều kiện tiên quyết (Preconditions)          | Admin đã đăng nhập và có quyền phù hợp (RBAC).                                                                                                                                                                                                                                                         |
| Kết quả sau cùng (Postconditions)             | Admin xem được trạng thái hệ thống/đơn; can thiệp hợp lệ có ghi nhận; báo cáo/xuất CSV phục vụ đối soát; cấu hình commission có lịch sử.                                                                                                                                                               |
| Mức độ ưu tiên (Priority)                     | Cao                                                                                                                                                                                                                                                                                                    |
| Tần suất sử dụng (Frequency of Use)           | Hàng ngày                                                                                                                                                                                                                                                                                              |
| Luồng sự kiện chính (Normal Course of Events) | 1) Admin mở dashboard và xem tổng quan health/orders.<br>2) Admin lọc/tìm và mở chi tiết đơn để điều tra.<br>3) Khi cần, admin hủy đơn và nhập lý do; hệ thống notify các bên và ghi audit.<br>4) Admin cấu hình commission % và hệ thống lưu lịch sử thay đổi.<br>5) Admin xem báo cáo và export CSV. |
| Luồng thay thế (Alternative Courses)          | A1) Một số báo cáo/metric có thể được precompute theo lịch (scheduler) để tăng hiệu năng (tuỳ thiết kế).                                                                                                                                                                                               |
| Ngoại lệ (Exceptions)                         | E1) Admin không đủ quyền → bị từ chối (RBAC).<br>E2) Export lỗi → retry; bảo toàn tính đúng đắn dữ liệu xuất.                                                                                                                                                                                          |
| Bao gồm (Includes)                            | UC-60..UC-66 (theo sơ đồ 07).                                                                                                                                                                                                                                                                          |
| Mở rộng (Extends)                             | Không                                                                                                                                                                                                                                                                                                  |
| Yêu cầu đặc biệt (Special Requirements)       | Audit log bất biến cho admin actions (FR-4.16); báo cáo phải có định dạng ổn định cho đối soát (CSV).                                                                                                                                                                                                  |
| Giả định (Assumptions)                        | Dữ liệu đơn hàng và commission snapshot đủ để tính GMV/commission đúng (BR-5).                                                                                                                                                                                                                         |
| Ghi chú & Vấn đề (Notes and Issues)           | Cần thống nhất mô hình tính report (on-demand vs precomputed) để phản ánh đúng trong sơ đồ 07 và thiết kế backend.                                                                                                                                                                                     |
