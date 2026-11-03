# Shared domain and first vertical slice

## Local performance update, 2026-11-03

- Explicit-table Drizzle queries do not initialize unused relational-query metadata. Database adapters stay request-local; identity/session/query results are never cached.
- Only immutable Intl formatters are reused, in bounded caches. Formatting still uses the current date/value and the original HU/RO locale and Bucharest timezone.
- Parent/child rows are grouped once per response, preserving order, duplicates and historical snapshots. No history is truncated to improve performance.
- `/api/data` skips loaders for data that `projectData` would discard for the current role. The final role projection and authorization still run. Administrators retain all existing modules, including local v73 production.

## Implemented boundaries

- Catalog: bilingual names/descriptions, category, gross integer-bani price, gram portion, explicit 14-allergen selection.
- Customers: name, address, phone and operational note. No CUI lookup or contracts yet.
- Orders: date/time, customer snapshot, item snapshots; requested/confirmed/rejected/cancelled with independent production/delivery/payment states. Only confirmed orders enter operations. Portal ownership and review are described in ../portal/SPEC.md.
- Production: read-only daily item aggregation from active orders, with ready quantities. Not a recipe or manufacturing execution system.
- Delivery: chronological stops, dispatch only after ready, delivered/failed states. Courier master data, assignment and filtered manifests are described in ../delivery/SPEC.md. No route optimizer yet.
- Audit: atomic writes with identity, time, action, entity and transition detail.

## API

GET /api/data returns the owner's workspace data. POST /api/products and /api/customers create master records. POST /api/orders validates item references and snapshots server prices. Request UUID is an idempotency key. POST /api/orders/state uses revision compare-and-swap and a transition allowlist. POST /api/demo inserts explicit, marked, deterministic sample records idempotently.

## Ügyfél az új rendelésben — v56

- Az „Új rendelés” ablakban az ügyfél keresővel választható ki: név vagy cím (ékezet nélkül is), illetve telefonszám (legalább 3 számjegy, szóközök nélkül is egyezik). Legfeljebb 8 találat látszik.
- Ha nincs meg, ugyanitt felvehető új ügyfél: név és cím kötelező, telefonszám nem. A keresett szöveg előre bekerül a név vagy (ha számnak látszik) a telefon mezőbe. Ha a megadott telefonszám (legalább 6 számjegy) már egy meglévő ügyfélé, az ablak felajánlja őt („Őt választom”).
- `POST /api/orders`: pontosan egy kell a `customerId` és a `newCustomer {name, address, phone}` közül, különben `CUSTOMER_MISSING` (400). Az új ügyfél (napló: `customer_created`) és a rendelés egy kötegben jön létre; a rendelés azonosítója idempotenciakulcs, így ismételt küldés nem hoz létre második ügyfelet.
- Új rendelés ügyfél nélkül is indítható (az ügyfél helyben felvehető); az Ügyfelek modul változatlan.

## Access and persistence

The user made Sites public for testing. API actions require the platform-injected ChatGPT identity header; authenticated testers use the shared test dataset. Staff membership, server authorization and role-based data projections are described in ../access/SPEC.md. Local preview auth is the starter's loopback-only simulation; production never uses the simulation. Records persist in D1, language preference only in localStorage.

## Acceptance examples

1. Create a dish and customer, then a dated order. Reload: all records persist and the dish quantities appear in the selected daily kitchen plan.
2. Mark cooking → ready → transit → delivered. Payment remains unpaid until explicitly changed.
3. Dispatch a queued order: reject. Cancel a queued order: exclude from daily totals and production plan. Cancel after cooking: reject.
4. Repeat an order creation UUID: return the original order without duplicates. Send an outdated state revision: reject with 409 and preserve audit consistency.
5. Switch HU/RO: labels and dish names change, IDs/prices/quantities remain stable.

## Deferred requirements

Tax classifications, invoices/e-Factura, complete consumer ingredient/nutrition disclosure, subrecipes, NIR, HACCP, notifications, capacity limits, offline writes, customer portal, recurring orders, deletion/correction workflows and accounting export. Recipe versions, lots, expiry and procurement proposals are now described in ../inventory/SPEC.md. Do not use this prototype to issue tax documents or certify food safety.
