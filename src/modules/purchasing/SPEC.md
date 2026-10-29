# Purchasing module

Supplier records store contact and reference data. No emails, messages or supplier API calls are sent. Purchase orders are internal documents, printable for manual communication. Creation snapshots supplier identity and ingredient names, units and negotiated pack prices. Creation UUIDs provide replay protection; a draft can be updated with a revision check. Confirmed lines cannot be edited.

Persisted status is draft/ordered/cancelled/closed. Derived phases distinguish ordered, partially received and fully received. Only orders without receipts can be cancelled; partial orders may close the remaining balance with a reason. Closing never reverses received stock. Confirming changes expected supply only and creates no stock movement.

Each receipt records one ingredient lot, potentially one of many partial deliveries. The request includes order revision and line ID. Its atomic D1 batch guards current order status/revision, increments the line's received quantity, creates the linked stock lot and movement, increments order revision and writes purchase event plus audit. A database CHECK enforces 0 <= received <= ordered. Request UUID replay returns the existing lot; reusing it with changed receipt details is rejected. Actual receipt value is separate from the quoted estimate. No duplicate or partial writes are accepted on concurrency conflicts.

Expected supply includes outstanding quantities of confirmed orders due on or before the selected planning day. Drafts, cancelled/closed remainders and future-due supply are excluded. Expected supply reduces the suggested new purchase quantity but never becomes available inventory before receipt. Other planning days do not reserve stock.

API: POST /api/purchasing/suppliers, /create, /update, /state, /receive. GET /api/data includes supplier/order/event data. Limits: 25 distinct ingredient lines per purchase, integer g/ml/pieces, integer bani, up to 200 recent purchase events in the workspace response.

Deferred: external supplier transmission, supplier catalog APIs, formal Romanian NIR generation, incoming e-Factura import, financial/tax settlement, returns and receipt reversal. Existing stock correction restrictions remain in force.

## Előretekintő beszerzési terv — v25
- A Beszerzés oldal tetején a „Mikorra mi kell? – következő napok” panel 7, 14 vagy 30 napra előre, napokra bontva mutatja a hiányzó alapanyagokat (`forwardProcurement`).
- Számolás: a visszaigazolt, még nem kész, ki nem adott és ki nem szállított rendelések receptigénye (al-receptekkel). A készletet napról napra fogyasztja: előbb a hamarabb lejáró tételt, lejárt tételt nem használ, és ami egy nap elfogyott, az a következő napokra már nem számít. A megrendelt, még be nem érkezett beszerzés a határidejétől számít (`inboundSchedule`).
- Az aznapi hiányt megvettnek tekinti, így a későbbi napok nem számolják újra.
- Soronként: hiányzó mennyiség, csomagszám (felfelé kerekítve), beszállító, becsült költség. Recept nélküli ételnél figyelmeztetés.
- A „Beszerzési rendelés erre a napra” gomb kitöltött beszerzési rendelést nyit a hiánylistával; mentés csak jóváhagyással történik.
- [FELTÉTELEZÉS] A beszerzés határideje a gyártási nap előtti nap (de nem korábbi a mai napnál). Ha a beszállító másképp szállít, az űrlapon átírható.
- A jóváhagyásra váró (portálos) rendelések nem számítanak bele, csak a visszaigazoltak.
