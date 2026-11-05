CREATE TABLE `fiscal_receipts` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`mode` text NOT NULL,
	`state` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`day` text NOT NULL,
	`method` text NOT NULL,
	`total` integer NOT NULL,
	`content` text NOT NULL,
	`token` text NOT NULL,
	`device_serial` text NOT NULL,
	`receipt_number` text DEFAULT '' NOT NULL,
	`receipt_counter` integer,
	`expires_at` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`completed_at` text DEFAULT '' NOT NULL,
	`result` text DEFAULT '' NOT NULL,
	`resolution` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "fiscal_receipt_mode" CHECK("fiscal_receipts"."mode" IN ('simulation','live')),
	CONSTRAINT "fiscal_receipt_state" CHECK("fiscal_receipts"."state" IN ('prepared','uncertain','issued','not_issued')),
	CONSTRAINT "fiscal_receipt_method" CHECK("fiscal_receipts"."method" IN ('cash','card')),
	CONSTRAINT "fiscal_receipt_total" CHECK("fiscal_receipts"."total">0 AND "fiscal_receipts"."total"<=100000000)
);
--> statement-breakpoint
CREATE INDEX `fiscal_receipt_order` ON `fiscal_receipts` (`order_id`);--> statement-breakpoint
CREATE INDEX `fiscal_receipt_day` ON `fiscal_receipts` (`day`,`mode`,`state`);--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_receipt_live_order` ON `fiscal_receipts` (`order_id`) WHERE "fiscal_receipts"."mode"='live' AND "fiscal_receipts"."state"<>'not_issued';--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_receipt_device_busy` ON `fiscal_receipts` (`device_serial`) WHERE "fiscal_receipts"."mode"='live' AND "fiscal_receipts"."state" IN ('prepared','uncertain');--> statement-breakpoint
CREATE UNIQUE INDEX `fiscal_receipt_number` ON `fiscal_receipts` (`device_serial`,`day`,`receipt_number`) WHERE "fiscal_receipts"."mode"='live' AND "fiscal_receipts"."state"='issued';--> statement-breakpoint
CREATE TABLE `fiscal_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'simulation' NOT NULL,
	`device_serial` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "fiscal_settings_singleton" CHECK("fiscal_settings"."id"=1),
	CONSTRAINT "fiscal_settings_mode" CHECK("fiscal_settings"."mode" IN ('simulation','live'))
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `expected_payment_method` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE TRIGGER fiscal_order_snapshot_locked BEFORE UPDATE OF expected_payment_method,delivery_fee,date,status ON orders
WHEN EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id=OLD.id AND mode='live' AND state<>'not_issued')
AND (NEW.expected_payment_method<>OLD.expected_payment_method OR NEW.delivery_fee<>OLD.delivery_fee OR NEW.date<>OLD.date OR NEW.status<>OLD.status)
BEGIN SELECT RAISE(ABORT,'FISCAL_ORDER_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER fiscal_items_snapshot_locked BEFORE UPDATE OF price,quantity,product_id,ro,order_id ON order_items
WHEN EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id IN (OLD.order_id,NEW.order_id) AND mode='live' AND state<>'not_issued')
BEGIN SELECT RAISE(ABORT,'FISCAL_ORDER_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER fiscal_items_delete_locked BEFORE DELETE ON order_items
WHEN EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id=OLD.order_id AND mode='live' AND state<>'not_issued')
BEGIN SELECT RAISE(ABORT,'FISCAL_ORDER_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER fiscal_items_insert_locked BEFORE INSERT ON order_items
WHEN EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id=NEW.order_id AND mode='live' AND state<>'not_issued')
BEGIN SELECT RAISE(ABORT,'FISCAL_ORDER_LOCKED'); END;
--> statement-breakpoint
CREATE TRIGGER fiscal_receipt_snapshot_locked BEFORE UPDATE OF order_id,mode,day,method,total,content,token,device_serial,expires_at ON fiscal_receipts
BEGIN SELECT RAISE(ABORT,'FISCAL_ORDER_LOCKED'); END;
