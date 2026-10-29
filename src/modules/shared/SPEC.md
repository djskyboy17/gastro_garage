# Shared domain and first vertical slice

## Implemented boundaries

- Catalog: bilingual names/descriptions, category, gross integer-bani price, gram portion, explicit 14-allergen selection.
- Customers: name, address, phone and operational note. No CUI lookup or contracts yet.
- Orders: date/time, customer snapshot, item snapshots; confirmed/cancelled, independent production/delivery/payment states.
- Production: read-only daily item aggregation from active orders, with ready quantities. Not a recipe or manufacturing execution system.
- Delivery: chronological stops, dispatch only after ready, delivered/failed states. No courier assignment or route optimizer yet.
- Audit: atomic writes with identity, time, action, entity and transition detail.

## API

GET /api/data returns the owner's workspace data. POST /api/products and /api/customers create master records. POST /api/orders validates item references and snapshots server prices. Request UUID is an idempotency key. POST /api/orders/state uses revision compare-and-swap and a transition allowlist. POST /api/demo inserts explicit, marked, deterministic sample records idempotently.

## Access and persistence

The user made Sites public for testing. API actions require the platform-injected ChatGPT identity header; authenticated testers use the shared test dataset. Employee roles are not yet implemented. Local preview auth is the starter's loopback-only simulation; production never uses the simulation. Records persist in D1, language preference only in localStorage.

## Acceptance examples

1. Create a dish and customer, then a dated order. Reload: all records persist and the dish quantities appear in the selected daily kitchen plan.
2. Mark cooking → ready → transit → delivered. Payment remains unpaid until explicitly changed.
3. Dispatch a queued order: reject. Cancel a queued order: exclude from daily totals and production plan. Cancel after cooking: reject.
4. Repeat an order creation UUID: return the original order without duplicates. Send an outdated state revision: reject with 409 and preserve audit consistency.
5. Switch HU/RO: labels and dish names change, IDs/prices/quantities remain stable.

## Deferred requirements

Employee roles, tax classifications, invoices/e-Factura, complete consumer ingredient/nutrition disclosure, subrecipes, NIR, HACCP, notifications, capacity limits, offline writes, customer portal, recurring orders, deletion/correction workflows and accounting export. Recipe versions, lots, expiry and procurement proposals are now described in ../inventory/SPEC.md. Do not use this prototype to issue tax documents or certify food safety.
