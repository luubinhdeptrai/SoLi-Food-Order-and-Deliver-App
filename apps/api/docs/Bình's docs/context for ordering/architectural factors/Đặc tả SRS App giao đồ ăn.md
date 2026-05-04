Software Requirements Specification

for

<UITfood>

**Version 1.0 approved**

**Prepared by <Development Team>**

**<University of Information Technology>**

**<09/03/2026>**

**Table of Contents**

**Table of Contents ii**

**Revision History ii**

**1.** **Introduction 2**

1.1 Document Purpose 2

1.2 Document Conventions 2

1.3 Project Scope 2

1.4 References 2

**2.** **Overall Description 2**

2.1 Product Perspective 2

2.2 User Classes and Characteristics 2

2.3 Operating Environment 2

2.4 Design and Implementation Constraints 2

2.5 Assumptions and Dependencies 2

**3.** **System Features 2**

3.1 System Feature 1 2

3.2 System Feature 2 (and so on) 2

**4.** **Data Requirements 2**

4.1 Logical Data Model 2

4.2 Data Dictionary 2

4.3 Reports 2

4.4 Data Acquisition, Integrity, Retention, and Disposal 2

**5.** **External Interface Requirements 2**

5.1 User Interfaces 2

5.2 Software Interfaces 2

5.3 Hardware Interfaces 2

5.4 Communications Interfaces 2

**6.** **Quality Attributes 2**

6.1 Usability 2

6.2 Performance 2

6.3 Security 2

6.4 Safety 2

6.5 [Others as relevant] 2

**7.** **Internationalization and Localization Requirements 2**

**8.** **Other Requirements 2**

**9. Glossary 2**

**10. Analysis Models 2**

**Revision History**

| **Name** | **Date** | **Reason For Changes** | **Version** |
| -------- | -------- | ---------------------- | ----------- |
|          |          |                        |             |
|          |          |                        |             |

# Introduction

## Document Purpose

This Software Requirements Specification (SRS) details the requirements for Release 1 (MVP) of the Food Delivery Platform. It is intended to guide the development team, which includes business analysts, frontend developers, backend developers, and DevOps roles.

## Document Conventions

This document follows standard typographical and formatting conventions to ensure clarity and consistency. The following rules apply throughout the document:

**Bold Text**: Used to emphasize important terms, specific UI elements, or distinct roles (e.g., Customer, Restaurant Partner, Shipper).

_Italics_: Used for referencing external documents, specific technologies (e.g., NestJS, Socket.io), or highlighting definitions.

Requirement Priorities: Functional requirements will be explicitly labeled with priorities:

- High: Essential for the Release 1 (MVP) launch.
- Medium: Important but can be deferred to a minor update or Release 2.
- Low: Desirable enhancements planned for Release 3 or beyond.

**Requirement and Feature Identifiers**:

To maintain traceability between this SRS and the Vision and Scope Document, unique ID codes are manually assigned to features, risks, and metrics. If new items are added, they must follow this sequential numbering format:

FE-[X]: Major System Features (e.g., FE-1, FE-2)

FR-[X]: Specific Functional Requirements belonging to a Feature (e.g., FR-1.1, FR-1.2)

NFR-[X]: Non-Functional Requirements (Performance, Security, Reliability)

BO-[X]: Business Objectives (e.g., BO-1)

SM-[X]: Success Metrics (e.g., SM-1)

RI-[X]: Business Risks (e.g., RI-1)

LI-[X]: Limitations and Exclusions (e.g., LI-1)

## Project Scope

For a comprehensive breakdown of long-term strategic goals, detailed business objectives, and overall success metrics, please check out the foundational Vision and Scope Document - Food Delivery Platform (Version 1.0).

## References

Vision and Scope Document – Food Delivery Platform (Version 1.0)

# Overall Description

## Product Perspective

The Food Delivery Platform is an entirely new, independent product developed from the ground up. It is designed to serve as both a practical marketplace solution for the Vietnamese food and beverage service industry and a comprehensive academic reference for modern multi-role web application development.

**Context and Origin:**

Currently, the food delivery ecosystem often relies on fragmented third-party services, manual phone calls, or in-person visits, resulting in wasted time for customers, lost revenue for restaurants, and suboptimal routing for delivery personnel. While mature systems like GrabFood and ShopeeFood exist in the market , this platform is being newly architected to provide a streamlined, centralized alternative that connects the three core participants of the food delivery value chain:

1. **Customers (Food Orderers):** Seeking fast, convenient browsing and ordering.
2. **Restaurant Partners (Food Providers):** Seeking to expand their digital customer base and manage orders efficiently.
3. **Delivery Personnel (Shippers):** Seeking structured route optimization and flexible earning opportunities.

**System Ecosystem and Major Interfaces:**

The platform operates as a closely integrated mobile ecosystem. For Release 1 (MVP), the strategic priority is placed entirely on native mobile applications (iOS and Android) to provide a superior, platform-specific user experience, utilizing mobile hardware features like native GPS and push notifications.

The product consists of several interconnected front-end applications interacting with a centralized backend REST API and WebSocket server:

- **Customer Native App (iOS & Android):** A mobile application that interfaces with the backend to fetch restaurant data, manage carts, and receive real-time order status updates via push notifications and WebSockets.
- **Shipper Native App (iOS & Android):** A dedicated mobile application for delivery personnel equipped with live location tracking, allowing them to manage availability, receive dispatch requests, and trigger delivery lifecycle events.
- **Restaurant App/Portal (Tablet/Mobile):** A mobile-optimized application designed for kitchen environments to manage menus and quickly update order preparation statuses.
- **Admin Dashboard:** A centralized web-based interface reserved for system administrators to perform manual reviews, monitor platform health, and manage system configurations.

_External System Interfaces:_ To support the native mobile environment, the system will interface with mobile-specific external services. This includes integration with Apple Push Notification service (APNs) and Firebase Cloud Messaging (FCM) for real-time alerts. Mapping and geolocation services will rely on native mobile SDKs provided by external partners (e.g., Google Maps SDK for iOS/Android or Mapbox). For Release 1, the platform supports Cash on Delivery (COD) and online payments via VNPay; subsequent releases may introduce additional mobile-optimized payment gateway integrations (e.g., MoMo, Apple Pay, Google Pay).

## User Classes and Characteristics

The Food Delivery Platform serves a multi-sided marketplace ecosystem. The system is designed for four primary user classes, each with distinct environments, technical proficiencies, and operational needs.

### Customers (Food Orderers) - _Favored User Class_

- **Description:** The general public who use the platform to discover restaurants, order food, and track deliveries. As the primary revenue drivers, their user experience dictates the platform's success, making them the favored user class.
- **Characteristics & Environment:** They encompass a wide demographic with varying levels of technical expertise. They will access the platform exclusively via native iOS or Android applications on their personal smartphones.
- **Key Needs:** They require a highly intuitive, low-friction mobile interface. Key features include fast search functionality, seamless cart management, clear checkout workflows supporting both Cash on Delivery (COD) and VNPay, and real-time push notifications for order tracking.

### Restaurant Partners (Food Providers)

- **Description:** Restaurant owners, managers, and kitchen staff responsible for maintaining menus, receiving orders, and preparing food.
- **Characteristics & Environment:** They operate in fast-paced, high-stress, and often messy kitchen environments. They will primarily use mobile-optimized native apps on tablets or large-screen smartphones. Their technical proficiency ranges from low to moderate.
- **Key Needs:** The interface must be highly visible and require minimal interaction to perform tasks. They need loud, distinct push notifications for new orders, high-contrast buttons to quickly accept orders or update preparation statuses, and simple mobile workflows for toggling menu item availability.

### Delivery Personnel (Shippers)

- **Description:** Independent gig-economy workers who pick up food from restaurants and deliver it to customers.
- **Characteristics & Environment:** They are constantly on the move, operating outdoors in various weather conditions and lighting. They rely entirely on their iOS or Android smartphones, which are typically mounted on their motorbikes. They are highly dependent on mobile data and GPS hardware.
- **Key Needs:** Their native mobile app must be optimized for low battery consumption and stable performance under fluctuating network conditions. The UI requires high contrast for sunlight readability, large touch targets, seamless native map integration for routing, and quick access to call customers or confirm deliveries.

### System Administrators

- **Description:** Platform operators and internal support staff responsible for maintaining ecosystem quality, onboarding users, and monitoring platform health.
- **Characteristics & Environment:** They have high technical proficiency and operate from standard office environments. Unlike the other user classes, administrators will interact with the platform via a secure, web-based desktop dashboard.
- **Key Needs:** They require comprehensive data views, efficient workflows for manually verifying and approving new Restaurant and Shipper registrations, and access to basic revenue and volume reporting.

## Operating Environment

The Food Delivery Platform will operate across a distributed environment, encompassing native mobile applications for end-users, web interfaces for administrators, and a containerized cloud backend.

**Client-Side Operating Environments:**

- **Customer Application:**
  - **Platform:** Native mobile applications for iOS and Android.
  - **OS Versions:** Target support for iOS 14.0 and later, and Android 8.0 (Oreo) and later.
  - **Hardware:** Smartphones with active internet connections (4G/5G/Wi-Fi) and location services enabled.
- **Shipper Application:**
  - **Platform:** Native mobile applications for iOS and Android.
  - **OS Versions:** Target support for iOS 14.0+ and Android 8.0+.
  - **Hardware:** Smartphones with persistent mobile data connections, GPS hardware, and sufficient battery capacity to handle continuous location tracking.
- **Restaurant Portal:**
  - **Platform:** Mobile-optimized native application or responsive web portal (accessible via Chrome, Safari).
  - **Hardware:** Tablets (e.g., iPads, Android tablets) or large-screen smartphones situated in kitchen environments, requiring a stable Wi-Fi or cellular connection.
- **Admin Dashboard:**
  - **Platform:** Web browser-based application.
  - **Compatibility:** Optimized for modern desktop browsers (Google Chrome, Mozilla Firefox, Apple Safari, Microsoft Edge).

**Server and Backend Environment:**

- **Hosting & Infrastructure:** The system will be hosted on a cloud platform (AWS, Google Cloud, or Azure), utilizing free-tier or student-tier resources for the initial release to manage academic budget constraints. Servers should ideally be located in a Southeast Asia region (e.g., Singapore or Vietnam, if available) to ensure low latency for users.
- **Server OS:** Linux-based environments operating Docker containers.
- **Backend Framework:** Node.js running the NestJS framework.
- **Database Systems:** PostgreSQL for the primary relational database and Redis for caching, session management, and WebSocket message brokering.
- **Asynchronous Processing:** Message queues managed via Bull Queue or RabbitMQ to handle asynchronous tasks like order dispatching at scale.
- **Real-time Communication:** WebSocket infrastructure powered by Socket.io, requiring a server environment configured to handle high numbers of concurrent, persistent TCP connections.

**Geographical Scope:**

- For Release 1 (MVP), the software's operational usage will be geographically restricted to a single, designated service area within Vietnam.

**Coexistence Requirements:**

- The mobile applications must peacefully coexist with native OS push notification services (APNs for Apple, FCM for Firebase/Android).
- The system must cleanly integrate with external mapping and geolocation SDKs (such as Google Maps or Mapbox) operating on the client devices.

## Design and Implementation Constraints

The design and development of the Food Delivery Platform are subject to several technical, financial, and operational constraints that the development team must adhere to during Release 1 (MVP):

### Budget and Infrastructure Constraints

- **Zero/Low-Cost Cloud Hosting:** Due to the academic nature of the project, all cloud infrastructure (servers, databases, message queues) must utilize free-tier or student-tier resources on platforms such as AWS, Google Cloud, or Microsoft Azure. This places strict limitations on available server RAM, CPU compute time, and database storage capacity.
- **Third-Party Services:** Any external APIs used for mapping (e.g., Google Maps, Mapbox) or push notifications (e.g., Firebase) must operate within their respective free usage quotas.

### Technology Stack Restrictions

- **Backend Architecture:** The backend API must be developed specifically using **NestJS (Node.js)**.
- **Database Systems:** The system is constrained to using **PostgreSQL** as the primary relational database and **Redis** for caching, session management, and WebSocket brokering. No other database engines (like MongoDB or MySQL) may be substituted without approval.
- **Deployment:** All backend services, including databases and queues, must be completely containerized using **Docker** and orchestrated via **Docker Compose** to ensure environment consistency.
- **Client Architecture:** Customer and Shipper frontends must be developed as **native mobile applications (iOS and Android)**. Web-based alternatives for these user classes are strictly excluded for Release 1.

### Team and Timeline Constraints

- **Resource Limitations:** The development team is restricted to an academic group size of 3 members. Consequently, complex features like ML-based predictive ETAs, multi-branch restaurant chains, and additional online payment integrations beyond VNPay (e.g., MoMo) are explicitly deferred to later releases.

### Hardware and Operating System Constraints

- **Shipper App Resource Usage:** Because delivery personnel rely heavily on mobile data and battery life, the native Shipper application is constrained to highly optimized background geolocation tracking. It must not drain a standard smartphone battery within a 4-hour delivery shift.
- **Real-time Concurrency:** The WebSocket server (Socket.io) must be artificially capped or highly optimized to prevent memory exhaustion on the free-tier server instances when handling multiple concurrent real-time order tracking connections.

### Security and Compliance

- **Credential Management:** All API keys, database credentials, and secret tokens must be injected via environment variables (.env files) and are strictly prohibited from being hardcoded or committed to any source code repository (e.g., GitHub, GitLab).

## Assumptions and Dependencies

The requirements and subsequent development of the Food Delivery Platform MVP (Release 1) are based on the following assumptions and external dependencies. If any of these factors change or prove incorrect, the project scope, timeline, or technical architecture may need to be re-evaluated.

**Assumptions:**

- **Hardware Availability:** It is assumed that all primary users (Customers and Shippers) possess iOS or Android smartphones capable of running modern native applications and have reliable access to mobile data (4G/5G). It is also assumed that Restaurant Partners have access to tablets or smartphones within their kitchen environments connected to stable Wi-Fi.
- **User Participation:** The marketplace model assumes a minimum viable pool of registered restaurants and delivery personnel will be onboarded prior to the launch to ensure orders can actually be fulfilled.
- **Operational Accuracy:** The system assumes that Restaurant Partners will accurately and promptly update their menu availability and operational hours, and that Shippers will honestly toggle their online/offline status.
- **Academic Budget:** It is assumed that the compute, database, and caching requirements for Release 1 can be comfortably supported within the free-tier or student-tier limits of the chosen cloud provider (AWS, Google Cloud, or Azure) without incurring unexpected financial costs.

**Dependencies:**

- **Push Notification Services:** Real-time mobile alerts rely entirely on the availability and performance of external services: Apple Push Notification service (APNs) for iOS devices and Firebase Cloud Messaging (FCM) for Android devices.
- **Mapping and Geolocation SDKs:** The accuracy of delivery routing and location tracking depends on third-party mobile SDKs (such as Google Maps SDK or Mapbox) and the native GPS hardware of the users' smartphones. The project is heavily dependent on staying within the free-tier usage quotas provided by these external mapping APIs.
- **App Store Review Processes:** Because the system prioritizes native mobile applications, the release timeline is strictly dependent on the review and approval processes of the Apple App Store and Google Play Store. Delays or rejections by these platforms are outside the development team's control.
- **Open Source Ecosystem:** The project relies on the continued maintenance, security, and compatibility of its core open-source frameworks, primarily NestJS, React Native (or chosen mobile framework), Docker, PostgreSQL, and Socket.io.

# System Features

## Customer Core Functionality (Native Mobile)

### Description

This feature encompasses the primary user journey for food orderers using the native iOS/Android application. It includes user registration, restaurant discovery, shopping cart management, and the checkout process. Because it directly drives platform transactions, this feature is of **High** priority.

### Stimulus/Response Sequences

| **Stimulus**                                                                                               | **Response**                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Customer opens the app and enters email or OAuth credentials                                               | System authenticates the user, creates/retrieves the profile, and grants access to the home screen.                                                                                                                                                                                                                                                          |
| Customer searches for a restaurant by name or filters by food category and geographic location.            | System queries the database and returns a list of active restaurants matching the criteria within the user's delivery radius.                                                                                                                                                                                                                                |
| Customer adds a menu item (specifying quantity) to their shopping cart.                                    | System queries the database and returns a list of active restaurants matching the criteria within the user's delivery radius.                                                                                                                                                                                                                                |
| Customer adds a menu item (specifying quantity) to their shopping cart.                                    | System updates the cart state, calculates the running total, and stores the cart locally/remotely.                                                                                                                                                                                                                                                           |
| Customer proceeds to checkout, confirms the delivery address, and selects a payment method (COD or VNPay). | If COD is selected, the system finalizes the order, calculates the final total (including delivery fees), routes the order to the respective restaurant, and transitions the user to the order tracking screen. If VNPay is selected, the system initiates the VNPay payment flow and only finalizes/routes the order after successful payment confirmation. |

### Functional Requirements

- **FR-1.1:** The system shall allow customers to register, log in, and manage their profiles via email and standard OAuth providers (e.g., Google, Apple) on native mobile devices.
- **FR-1.2:** The system shall provide a search and filtering interface to browse restaurants by name, food category, and proximity.
- **FR-1.3:** The system shall prevent users from adding items from multiple different restaurants into a single shopping cart simultaneously. If attempted, the system shall prompt the user to clear the current cart first.
- **FR-1.4:** The system shall allow customers to select a payment method at checkout and shall support both Cash on Delivery (COD) and online payment via VNPay for Release 1.
- **FR-1.5:** The system shall validate that the provided delivery address falls within the restaurant's designated operational radius before allowing order submission.

## Real-Time Order Tracking (Native Mobile)

### Description

This feature provides visibility into the order lifecycle for the customer via the native mobile app. For the MVP, it utilizes WebSockets and native push notifications to provide status updates. Full map-based live GPS tracking is deferred to a future release. Priority is **High**.

### Stimulus/Response Sequences

- **Stimulus:** The restaurant partner accepts the order or updates the status to "Preparing".
  - **Response:** System sends a push notification (APNs/FCM) to the customer's phone and updates the in-app order status tracker via WebSocket.
- **Stimulus:** The shipper marks the order as "Picked Up".
  - **Response:** System alerts the customer that the food is on the way and provides the shipper's basic contact details (name, phone number, license plate).
- **Stimulus:** The shipper marks the order as "Delivered".
  - **Response:** System notifies the customer of the completed delivery and prompts for an optional rating (TBD in Release 2).

**3.2.3 Functional Requirements**

- **FR-2.1:** The system shall provide basic order status updates (Pending, Accepted, Preparing, Picked Up, Delivered, Cancelled) to the customer.
- **FR-2.2:** The system shall utilize WebSocket connectivity (Socket.io) to push status updates in real-time while the application is active in the foreground.
- **FR-2.3:** The system shall utilize native push notifications (APNs for iOS, FCM for Android) to deliver critical status updates when the application is in the background or closed.
- **FR-2.4:** If an order is canceled by the restaurant or administrator, the system shall immediately notify the customer and display the cancellation reason.

## Restaurant Menu and Order Management

### Description

A tablet or mobile-optimized portal allowing restaurant partners to manage their offerings, control item availability, and process incoming customer orders in a fast-paced kitchen environment. Priority is **High**.

### Stimulus/Response Sequences

- **Stimulus:** Restaurant staff toggles a menu item's status to "Sold Out".
  - **Response:** System immediately updates the customer-facing database, preventing new users from adding the item to their carts.
- **Stimulus:** A new customer order is routed to the restaurant.
  - **Response:** System plays a loud, continuous audio alert and displays a high-contrast popup until a staff member acknowledges it.
- **Stimulus:** Restaurant staff clicks "Accept Order".
  - **Response:** System stops the audio alert, moves the order to the "Preparing" queue, and triggers the customer notification sequence.

### Functional Requirements

- **FR-3.1:** The system shall allow authenticated restaurant staff to view, add, edit, and remove menu items, categories, and prices.
- **FR-3.2:** The system shall provide a single-tap toggle for staff to mark specific menu items or the entire restaurant as "Unavailable/Closed" in real-time.
- **FR-3.3:** The system must generate an auditory and visual alert for all incoming orders that bypasses standard device notification limits where possible.
- **FR-3.4:** The system shall allow staff to transition order states sequentially (New -> Accepted -> Preparing -> Ready for Pickup).

## Admin Dashboard (Web-Based)

### Description

This feature provides a secure, web-based dashboard for System Administrators to operate and govern the platform. It includes manual verification and approval workflows for Restaurant Partners and Delivery Personnel (Shippers), operational oversight of orders, lightweight reporting access, and configuration management required to run Release 1 (MVP). Priority is **High**.

### Stimulus/Response Sequences

- **Stimulus:** An administrator logs in to the Admin Dashboard.
  - **Response:** The system authenticates the administrator and displays an overview of pending approvals and active orders.
- **Stimulus:** An administrator reviews a pending Restaurant Partner or Shipper registration.
  - **Response:** The system records an approve/reject decision, updates the applicant's verification status, and makes the decision outcome visible to the applicant.
- **Stimulus:** An administrator monitors or intervenes in an order lifecycle.
  - **Response:** The system displays order details and status history, and (when authorized) records administrative actions such as cancellation with a reason.

### Functional Requirements

- **FR-4.1 (Must-have):** The system shall restrict Admin Dashboard access to authenticated System Administrator accounts.
- **FR-4.2 (Must-have):** The system shall enforce role-based access control (RBAC) for administrative actions (e.g., approvals, suspensions, order intervention, configuration updates).
- **FR-4.3 (Must-have):** The system shall allow administrators to view and search user accounts by role (Customer, Restaurant Partner, Shipper) and by account status (Pending Verification, Approved, Rejected, Suspended).

- **FR-4.4 (Must-have):** The system shall provide administrators with a queue of pending Restaurant Partner registrations requiring manual verification and approval.
- **FR-4.5 (Must-have):** The system shall provide administrators with a queue of pending Shipper registrations requiring manual verification and approval.
- **FR-4.6 (Must-have):** The system shall allow administrators to approve or reject Restaurant Partner and Shipper registrations and shall require a decision note (reason) for rejections.
- **FR-4.7 (Must-have):** Upon an approval or rejection decision, the system shall persist the verification status and shall make the status visible to the applicant upon subsequent authentication attempts.

- **FR-4.8 (Must-have):** The system shall allow administrators to suspend and reactivate Restaurant Partner and Shipper accounts.
- **FR-4.9 (Must-have):** When an account is suspended, the system shall prevent the suspended Restaurant Partner or Shipper from receiving or processing new orders.

- **FR-4.10 (Must-have):** The system shall provide administrators with an order monitoring view that lists orders and supports filtering at minimum by status, time range, and Restaurant Partner.
- **FR-4.11 (Must-have):** The system shall allow administrators to view order details including status history, assigned Shipper (if any), and any cancellation reason.
- **FR-4.12 (Must-have):** The system shall allow authorized administrators to cancel an order and shall require a cancellation reason; the system shall record the actor (administrator) and timestamp and notify affected parties.

- **FR-4.13 (Must-have):** The system shall allow administrators to configure the platform commission percentage used to calculate Estimated Platform Commission on completed orders.
- **FR-4.14 (Must-have):** The system shall maintain a history of commission configuration changes including effective date/time and the administrator who performed the change.

- **FR-4.15 (Must-have):** The system shall provide administrators access to the logical reports defined in the Reports section and shall support exporting report data in a machine-readable format (e.g., CSV).
- **FR-4.16 (Must-have):** The system shall record an immutable audit log for administrative actions, including at minimum administrator identity, action type, target entity, timestamp, and before/after status when applicable.

- **FR-4.17 (Should-have):** The system shall allow administrators to define and maintain the active service area boundaries and geographic zones used to enforce the MVP geographical scope constraint.
- **FR-4.18 (Should-have):** The system shall allow administrators to hide or unpublish Restaurant Partner profile information or menu items that violate platform content standards.
- **FR-4.19 (Should-have):** The system shall allow administrators to attach internal operational notes to a user account or order record for support and investigation purposes.

- **FR-4.20 (Nice-to-have):** The system shall provide near real-time operational monitoring widgets (e.g., counts of active orders by status, recent cancellations, and pending approvals) on the Admin Dashboard homepage.
- **FR-4.21 (Nice-to-have):** The system shall provide administrators with advanced monitoring and analytics views (e.g., heat maps by zone and peak-hour volume trends) for subsequent releases.
- **FR-4.22 (Nice-to-have):** The system shall support administrative fraud/anomaly detection alerts (e.g., repeated cancellation patterns) for subsequent releases.

# Data Requirements

This section defines the data entities, their attributes, and the relationships required to support the Food Delivery Platform's core operations. The system utilizes a relational database (PostgreSQL) as its primary data store, supplemented by Redis for ephemeral data (like active shopping carts and active shipper locations).

## Logical Data Model

The logical data model represents the core business objects manipulated by the system. Below is a structural breakdown of the primary database entities and their Entity-Relationship (ER) mappings.

![](data:image/png;base64...)

## Reports

For Release 1 (MVP), reporting capabilities are kept lightweight and are exclusively accessible to system administrators via the secure Web Dashboard. These reports are designed to monitor platform health, track early user adoption, and calculate basic financial metrics across both Cash on Delivery (COD) and VNPay transactions.

The system shall generate the following logical reports. (Note: Specific visual layouts and charts will be determined during the UI/UX design phase).

### Daily and Weekly Order Volume Report

- **Purpose:** To track overall platform usage and assess whether the system is meeting the target of 30 active restaurant partners and 500 active customers.
- **Content/Columns:** Date, Total Orders Placed, Total Orders Completed, Total Orders Cancelled, Average Order-to-Delivery Time.
- **Sorting & Grouping:** Data shall be grouped by Day or Week. Default sort is descending by Date.
- **Filtering Options:** Administrators must be able to filter the data by a specific Date Range and by specific Geographic Zones (if multiple zones are tested in the MVP).

### Financial & Commission Summary (COD + VNPay)

- **Purpose:** Since the MVP supports both Cash on Delivery (COD) and VNPay, the platform needs a reliable way to calculate the total Gross Merchandise Value (GMV) and the platform's expected commission from the restaurants across all completed orders.
- **Content/Columns:** Restaurant Name, Total Completed Orders, Gross Merchandise Value (sum of completed order totals regardless of payment method), Payment Method Breakdown (COD count/amount, VNPay count/amount), Estimated Platform Commission (calculated as a configured fixed percentage of the GMV).
- **Sorting & Grouping:** Grouped by Restaurant. Default sort is descending by Gross Merchandise Value.
- **Filtering Options:** Filterable by Date Range (e.g., current month, previous week) to facilitate manual billing or reconciliation processes outside the system.

### User Registration & Approval Status Report

- **Purpose:** To monitor the backlog of new restaurants and delivery personnel awaiting manual verification.
- **Content/Columns:** User Role (Restaurant/Shipper), Total Pending Accounts, Total Approved Accounts, Total Rejected Accounts.
- **Sorting & Grouping:** Grouped by User Role and Status.
- **Filtering Options:** Filterable by Date of Registration.

## Data Acquisition, Integrity, Retention, and Disposal

_<If relevant, describe how data is acquired and maintained. State any requirements regarding the need to protect the integrity of the system's data. Identify any specific techniques that are necessary, such as backups, checkpointing, mirroring, or data accuracy verification. State policies the system must enforce for either retaining or disposing of data, including temporary data, metadata, residual data (such as deleted records), cached data, local copies, archives, and interim backups.>_

# External Interface Requirements

_<This section provides information to ensure that the system will communicate properly with users and with external hardware or software elements.>_

## User Interfaces

_<Describe the logical characteristics of each interface between the software product and the users. This may include sample screen images, any GUI standards or product family style guides that are to be followed, screen layout constraints, standard buttons and functions (e.g., help) that will appear on every screen, keyboard shortcuts, error message display standards, and so on. Define the software components for which a user interface is needed. Details of the user interface design should be documented in a separate user interface specification.>_

## Software Interfaces

_<Describe the connections between this product and other software components (identified by name and version), including other applications, databases, operating systems, tools, libraries, websites, and integrated commercial components. State the purpose, formats, and contents of the messages, data, and control values exchanged between the software components. Specify the mappings of input and output data between the systems and any translations that need to be made for the data to get from one system to the other. Describe the services needed by or from external software components and the nature of the intercomponent communications. Identify data that will be exchanged between or shared across software components. Specify nonfunctional requirements affecting the interface, such as service levels for responses times and frequencies, or security controls and restrictions.>_

## Hardware Interfaces

_<Describe the characteristics of each interface between the software and hardware (if any) components of the system. This description might include the supported device types, the data and control interactions between the software and the hardware, and the communication protocols to be used. List the inputs and outputs, their formats, their valid values or ranges, and any timing issues developers need to be aware of. If this information is extensive, consider creating a separate interface specification document.>_

## Communications Interfaces

_<State the requirements for any communication functions the product will use, including e-mail, Web browser, network protocols, and electronic forms. Define any pertinent message formatting. Specify communication security or encryption issues, data transfer rates, handshaking, and synchronization mechanisms. State any constraints around these interfaces, such as whether e-mail attachments are acceptable or not.>_

# Quality Attributes

## Usability

_<Specify any requirements regarding characteristics that will make the software appear to be “user-friendly.” Usability encompasses ease of use, ease of learning; memorability; error avoidance, handling, and recovery; efficiency of interactions; accessibility; and ergonomics. Sometimes these can conflict with each other, as with ease of use over ease of learning. Indicate any user interface design standards or guidelines to which the application must conform.>_

## Performance

_<State specific performance requirements for various system operations. If different functional requirements or features have different performance requirements, it's appropriate to specify those performance goals right with the corresponding functional requirements, rather than collecting them in this section.>_

## Security

_<Specify any requirements regarding security or privacy issues that restrict access to or use of the product. These could refer to physical, data, or software security. Security requirements often originate in business rules, so identify any security or privacy policies or regulations to which the product must conform. If these are documented in a business rules repository, just refer to them.>_

## Safety

_<Specify requirements that are concerned with possible loss, damage, or harm that could result from use of the product. Define any safeguards or actions that must be taken, as well as potentially dangerous actions that must be prevented. Identify any safety certifications, policies, or regulations to which the product must conform.>_

## [Others as relevant]

_<Create a separate section in the SRS for each additional product quality attribute to describe characteristics that will be important to either customers or developers. Possibilities include availability, efficiency, installability, integrity, interoperability, modifiability, portability, reliability, reusability, robustness, scalability, and verifiability. Write these to be specific, quantitative, and verifiable. Clarify the relative priorities for various attributes, such as security over performance.>_

# Internationalization and Localization Requirements

_<Internationalization and localization requirements ensure that the product will be suitable for use in nations, cultures, and geographic locations other than those in which it was created. Such requirements might address differences in: currency; formatting of dates, numbers, addresses, and telephone numbers; language, including national spelling conventions within the same language (such as American versus British English), symbols used, and character sets; given name and family name order; time zones; international regulations and laws; cultural and political issues; paper sizes used; weights and measures; electrical voltages and plug shapes; and many others.>_

# Other Requirements

_<Examples are: legal, regulatory or financial compliance, and standards requirements; requirements for product installation, configuration, startup, and shutdown; and logging, monitoring and audit trail requirements. Instead of just combining these all under "Other," add any new sections to the template that are pertinent to your project. Omit this section if all your requirements are accommodated in other sections. >_

# Glossary

_<Define any specialized terms that a reader needs to know to understand the SRS, including acronyms and abbreviations. Spell out each acronym and provide its definition. Consider building a reusable enterprise-level glossary that spans multiple projects and incorporating by reference any terms that pertain to this project.>_

# Analysis Models

_<This optional section includes or points to pertinent analysis models such as data flow diagrams, feature trees, state-transition diagrams, or entity-relationship diagrams. You might prefer to insert certain models into the relevant sections of the specification instead of collecting them at the end.>_
