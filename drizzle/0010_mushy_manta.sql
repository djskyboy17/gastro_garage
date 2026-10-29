CREATE TABLE `fulfillment_policy` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "fulfillment_singleton" CHECK("fulfillment_policy"."id"=1)
);
--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment_mode` text DEFAULT 'delivery' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment_slot_id` text;--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment_postal_code` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `fulfillment_snapshot` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_fee` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE INDEX orders_slot_date ON orders (fulfillment_slot_id,date,status);
--> statement-breakpoint
CREATE TRIGGER order_fulfillment_capacity BEFORE INSERT ON orders
WHEN NEW.fulfillment_slot_id IS NOT NULL AND NEW.status IN ('requested','confirmed') AND NOT EXISTS (
 SELECT 1 FROM fulfillment_policy p,json_each(p.content,'$.slots') s
 WHERE p.id=1 AND json_extract(s.value,'$.id')=NEW.fulfillment_slot_id AND json_extract(s.value,'$.active')=1
 AND json_extract(s.value,'$.mode')=NEW.fulfillment_mode AND json_extract(s.value,'$.start')=NEW.time
 AND EXISTS (SELECT 1 FROM json_each(s.value,'$.weekdays') w WHERE w.value=CASE WHEN strftime('%w',NEW.date)='0' THEN 7 ELSE CAST(strftime('%w',NEW.date) AS INTEGER) END)
 AND CAST(json_extract(s.value,'$.capacity') AS INTEGER)>(SELECT count(*) FROM orders o WHERE o.date=NEW.date AND o.fulfillment_slot_id=NEW.fulfillment_slot_id AND o.status IN ('requested','confirmed'))
)
BEGIN SELECT RAISE(ABORT,'FULFILLMENT_CAPACITY'); END;
