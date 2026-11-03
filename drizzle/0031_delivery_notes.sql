CREATE TABLE `delivery_note_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`all_deliveries` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "delivery_note_settings_singleton" CHECK("delivery_note_settings"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `delivery_notes` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`year` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text DEFAULT 'issue' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`issue_date` text NOT NULL,
	`day` text NOT NULL,
	`content` text NOT NULL,
	`invoice_id` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "delivery_note_kind" CHECK("delivery_notes"."kind" IN ('issue','reversal')),
	CONSTRAINT "delivery_note_status" CHECK("delivery_notes"."status" IN ('issued','reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_note_number` ON `delivery_notes` (`year`,`number`);--> statement-breakpoint
CREATE UNIQUE INDEX `delivery_note_one_active` ON `delivery_notes` (`order_id`) WHERE "delivery_notes"."kind"='issue' AND "delivery_notes"."status"='issued';--> statement-breakpoint
CREATE INDEX `delivery_note_day` ON `delivery_notes` (`day`);--> statement-breakpoint
ALTER TABLE `orders` ADD `delivery_note_required` integer DEFAULT 0 NOT NULL;