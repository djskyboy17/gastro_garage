# Scheduled menu

One dated menu per kitchen-local calendar day. Weekly UI groups seven individual days; no implicit weekly recurrence. Admin/owner and dispatcher edit dated menus. Missing or inactive days are closed to portal orders. Products must also be active and explicitly published in the portal catalog. Existing orders and their snapshots remain intact when menus close.

Each date has a UTC cutoff instant entered/displayed in Europe/Bucharest, explicit per-product integer portion limits and a revision. Cutoff cannot follow the service day. Nonexistent or ambiguous daylight-saving wall times are rejected. Editing is limited to today through 90 days ahead. Portal delivery remains limited to 30 days and future time slots.

Requested and confirmed orders reserve capacity, including staff and recurring orders. Cancellation/rejection frees capacity; confirmation keeps the same reservation. An item-insert trigger prevents concurrent overselling and a menu-line trigger prevents reducing capacity below current reservations. Staff may order unlisted dishes (an intentional internal exception); a listed dish's capacity is enforced for every channel. There is no expiry of pending reservations in this slice.

Menu replacement, revision guard and audit commit atomically. Removing a line with reservations is prohibited. Closing a day blocks new portal requests but does not cancel reservations. Portal previews include menu revision in the fingerprint. Submit checks active menu, cutoff and revision within the order transaction. Capacity is checked again by database trigger. Responses expose available portions without customer identities or order details.

Acceptance: two simultaneous requests for the last portion yield one success; cancellation restores availability; stale revision edits and quotes fail; a closed/unconfigured day or passed cutoff blocks a portal request; kitchen/warehouse cannot edit menus; a weekly view shows HU/RO labels. No seeded production menu or automatic publication of dishes.

Deferred: global kitchen capacity, time-slot capacity, fees/zones, minimum order, weekly template copying, holiday calendar, reservation expiry and notifications.
