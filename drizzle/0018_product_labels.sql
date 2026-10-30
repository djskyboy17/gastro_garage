CREATE TABLE `label_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`content` text NOT NULL,
	CONSTRAINT "label_settings_singleton" CHECK("label_settings"."id"=1)
);
--> statement-breakpoint
CREATE TABLE `product_labels` (
	`product_id` text PRIMARY KEY NOT NULL,
	`shelf_life_days` integer NOT NULL,
	`storage_ro` text DEFAULT '' NOT NULL,
	`storage_hu` text DEFAULT '' NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
