# Konyha development rules

One application with domain modules. English code identifiers; Hungarian and Romanian UI dictionaries. New modules must include a SPEC.md with boundaries, business rules and acceptance examples. Keep catalog, customers, orders, production, delivery and payments distinct.

- All writes require authenticated identity, same-origin JSON requests and server validation.
- The user explicitly made this prototype public for testing. Preserve this audience. API writes require ChatGPT identity. Employee roles are not implemented; use sample data until the user announces production use.
- Prices are integer bani, quantities are integer portions, dates are kitchen-local calendar dates in Europe/Bucharest. Use decimal arithmetic if fractional stock quantities are introduced.
- Order creation snapshots item names, prices, allergens and customer delivery details. Never recalculate historical orders from current catalog data.
- States and transitions belong to src/modules/shared/domain.ts. Use revision checks to reject stale updates. Save associated changes and audit entries atomically.
- No stock consumption when an order is created; future inventory consumption is a separate production event.
- No schema changes at request time. Generate and inspect Drizzle migrations; never edit applied migration history.
- Keep real credentials, personal data and runtime state out of Git and generated source archives.
- Verify changes with TypeScript, domain tests and a production build. For workflow changes, test browser → API → database → reload.

Current deployment uses Sites D1/SQLite. PostgreSQL is a future architectural decision, not a completed feature. A migration requires a separate adapter, hosting choice and migration plan; a Drizzle dialect change alone is insufficient.
