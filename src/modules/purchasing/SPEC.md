# Purchasing module

Supplier records store contact and reference data. No emails, messages or supplier API calls are sent. Purchase orders are internal documents, printable for manual communication. Creation snapshots supplier identity and ingredient names, units and negotiated pack prices. Creation UUIDs provide replay protection; a draft can be updated with a revision check. Confirmed lines cannot be edited.

Persisted status is draft/ordered/cancelled/closed. Derived phases distinguish ordered, partially received and fully received. Only orders without receipts can be cancelled; partial orders may close the remaining balance with a reason. Closing never reverses received stock. Confirming changes expected supply only and creates no stock movement.

Each receipt records one ingredient lot, potentially one of many partial deliveries. The request includes order revision and line ID. Its atomic D1 batch guards current order status/revision, increments the line's received quantity, creates the linked stock lot and movement, increments order revision and writes purchase event plus audit. A database CHECK enforces 0 <= received <= ordered. Request UUID replay returns the existing lot; reusing it with changed receipt details is rejected. Actual receipt value is separate from the quoted estimate. No duplicate or partial writes are accepted on concurrency conflicts.

Expected supply includes outstanding quantities of confirmed orders due on or before the selected planning day. Drafts, cancelled/closed remainders and future-due supply are excluded. Expected supply reduces the suggested new purchase quantity but never becomes available inventory before receipt. Other planning days do not reserve stock.

API: POST /api/purchasing/suppliers, /create, /update, /state, /receive. GET /api/data includes supplier/order/event data. Limits: 25 distinct ingredient lines per purchase, integer g/ml/pieces, integer bani, up to 200 recent purchase events in the workspace response.

Deferred: external supplier transmission, supplier catalog APIs, formal Romanian NIR generation, incoming e-Factura import, financial/tax settlement, returns and receipt reversal. Existing stock correction restrictions remain in force.
