# Documentation: Event-Driven CQRS with Local Projections

This document describes the communication pattern used to enable autonomous, decoupled interactions between Bounded Contexts within a modular monolith. This pattern ensures that no module directly calls another module's services or database, facilitating future microservice extraction and improved system resilience.

---

## 1. Pattern Overview: The "Local Projection" Strategy

The core philosophy of this pattern is that **no module should ever reach across its boundary to query data from another module.** Instead, if Module B needs data owned by Module A, it maintains its own "Local Read Model" (Projection) of that data.

### How it works:

1.  **Event Broadcast:** When a state change occurs in the "owner" module (e.g., a price changes in the Restaurant module), it publishes a **Domain Event**.
2.  **Autonomous Update:** The "consuming" module (e.g., Ordering) listens for this event and updates its own local database or in-memory cache—the **Projection**.
3.  **Local Query:** When the consuming module needs that data to process a command (like placing an order), it queries its **local projection** instead of calling the owner module.

---

## 2. Benefits and Trade-offs

| Benefit              | Description                                                                                                                      |
| :------------------- | :------------------------------------------------------------------------------------------------------------------------------- |
| **Zero Coupling**    | Modules depend only on shared event contracts, never on each other's internal logic or entities.                                 |
| **High Performance** | Data is resolved locally without cross-module service calls or expensive network hops.                                           |
| **Migration Ready**  | Extracting a module to a microservice requires zero changes to business logic; only the event transport (e.g., Kafka) changes.   |
| **Fault Tolerance**  | If the Restaurant module is down, the Ordering module can still function because it has a local copy of the necessary menu data. |

**The Trade-off:** This pattern introduces **Eventual Consistency**. There is a brief window between an update in the owner module and the projection update in the consuming module where data might be slightly stale.

---

## 3. Implementation Guide

Follow these five steps to implement this pattern for any new module.

### Step 1: Define the Shared Event Contract

Create an immutable event class in a shared location. This is the only point of coupling between modules.

- **File:** `src/shared/events/your-domain.event.ts`
- **Guideline:** Include only the minimal data required by potential consumers (IDs and changed fields).

### Step 2: Publish the Event from the "Owner" Module

After the primary module successfully persists a change, broadcast the event using an Event Bus.

- **Implementation:** Inject `EventBus` into your Command Handler and call `.publish(new YourEvent(...))`.
- **Requirement:** Ensure the event is published **after** the database transaction succeeds to maintain consistency.

### Step 3: Define the Consuming Read Model

In the module that needs the data, define an interface or entity that represents the data _as that module perceives it_.

- **Location:** `src/modules/consuming-module/projections/model.read-model.ts`
- **Guideline:** This model should act as an **Anti-Corruption Layer (ACL)**, containing only the fields your specific module cares about.

### Step 4: Implement the Projector

Create a class decorated with `@EventsHandler` to subscribe to the shared event and update the local read model.

- **Implementation:** The `handle(event)` method should update your local database or cache.
- **Note:** In a production environment, this data should be persisted in the consuming module's own database tables.

### Step 5: Consume the Projection Locally

Your internal services or command handlers should now inject the Projector to retrieve data.

- **Implementation:** Use methods like `findById()` or `findManyByIds()` on the Projector to resolve data instantly from local storage.
- **Logic:** Perform validations and state snapshots based on this local data.

---

## 4. Coupling Audit Checklist

To ensure the pattern is implemented correctly, verify the following:

- [ ] Does the consuming module import any services from the owner module? (**Should be NO**).
- [ ] Does the consuming module import any entities from the owner module? (**Should be NO**).
- [ ] Is the only shared artifact between modules located in the `shared/events/` directory? (**Should be YES**).
- [ ] Can the module be extracted to a separate repository without changing the `execute()` logic of its handlers? (**Should be YES**).
