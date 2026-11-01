-- v51: egyetlen futár van – a futártörzs (couriers), a napi beosztás (courier_shifts), a fiók–futár
-- összekötés triggere és a rendelés futár-hivatkozása (orders.courier_id) megszűnik. A rendelésen a futár
-- neve (courier_name) szövegként megmarad.
--
-- A rendelések táblája újraépül (SQLite-ban a külső kulcsos oszlop csak így távolítható el). Előtte a
-- rendelésekre név szerint hivatkozó triggerek törlődnek, utána ugyanazzal a definícióval visszakerülnek
-- (0008), a kézzel létrehozott index (0010) is.
DROP TRIGGER IF EXISTS `courier_unlink_role`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `order_item_menu_capacity`;--> statement-breakpoint
DROP TRIGGER IF EXISTS `menu_line_capacity_insert`;--> statement-breakpoint
DROP TABLE `courier_shifts`;--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_orders` (
	`packing_items` text DEFAULT '[]' NOT NULL,
	`packing_ready` integer DEFAULT 0 NOT NULL,
	`packing_checked_at` text DEFAULT '' NOT NULL,
	`fulfillment_mode` text DEFAULT 'delivery' NOT NULL,
	`fulfillment_slot_id` text,
	`fulfillment_postal_code` text DEFAULT '' NOT NULL,
	`fulfillment_snapshot` text DEFAULT '' NOT NULL,
	`delivery_fee` integer DEFAULT 0 NOT NULL,
	`portal_user_id` text,
	`review_note` text DEFAULT '' NOT NULL,
	`courier_name` text DEFAULT '' NOT NULL,
	`courier_phone` text DEFAULT '' NOT NULL,
	`id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`customer_name` text NOT NULL,
	`address` text NOT NULL,
	`phone` text NOT NULL,
	`date` text NOT NULL,
	`time` text NOT NULL,
	`note` text NOT NULL,
	`production` text DEFAULT 'queued' NOT NULL,
	`delivery` text DEFAULT 'pending' NOT NULL,
	`payment` text DEFAULT 'unpaid' NOT NULL,
	`status` text DEFAULT 'confirmed' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`portal_user_id`) REFERENCES `portal_profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
INSERT INTO `__new_orders`("packing_items", "packing_ready", "packing_checked_at", "fulfillment_mode", "fulfillment_slot_id", "fulfillment_postal_code", "fulfillment_snapshot", "delivery_fee", "portal_user_id", "review_note", "courier_name", "courier_phone", "id", "customer_id", "customer_name", "address", "phone", "date", "time", "note", "production", "delivery", "payment", "status", "revision", "created_at") SELECT "packing_items", "packing_ready", "packing_checked_at", "fulfillment_mode", "fulfillment_slot_id", "fulfillment_postal_code", "fulfillment_snapshot", "delivery_fee", "portal_user_id", "review_note", "courier_name", "courier_phone", "id", "customer_id", "customer_name", "address", "phone", "date", "time", "note", "production", "delivery", "payment", "status", "revision", "created_at" FROM `orders`;--> statement-breakpoint
DROP TABLE `orders`;--> statement-breakpoint
ALTER TABLE `__new_orders` RENAME TO `orders`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `orders_date_status` ON `orders` (`date`,`status`);--> statement-breakpoint
CREATE INDEX orders_slot_date ON orders (fulfillment_slot_id,date,status);--> statement-breakpoint
DROP TABLE `couriers`;--> statement-breakpoint
CREATE TRIGGER menu_line_capacity_insert BEFORE INSERT ON menu_lines
WHEN NEW.capacity < (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date=NEW.date AND i.product_id=NEW.product_id AND o.status IN ('requested','confirmed'))
BEGIN SELECT RAISE(ABORT,'MENU_CAPACITY'); END;
--> statement-breakpoint
CREATE TRIGGER order_item_menu_capacity BEFORE INSERT ON order_items
WHEN EXISTS (SELECT 1 FROM orders o JOIN menu_lines l ON l.date=o.date AND l.product_id=NEW.product_id WHERE o.id=NEW.order_id AND o.status IN ('requested','confirmed') AND l.capacity < NEW.quantity + (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders booked ON booked.id=i.order_id WHERE booked.date=o.date AND i.product_id=NEW.product_id AND booked.status IN ('requested','confirmed')))
BEGIN SELECT RAISE(ABORT,'MENU_CAPACITY'); END;
