ALTER TABLE `orders` ADD `packing_items` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `packing_ready` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `orders` ADD `packing_checked_at` text DEFAULT '' NOT NULL;