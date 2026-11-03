CREATE TABLE `consumption_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`year` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text DEFAULT 'consumption' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`issue_date` text NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "consumption_kind" CHECK("consumption_documents"."kind" IN ('consumption','reversal')),
	CONSTRAINT "consumption_status" CHECK("consumption_documents"."status" IN ('issued','reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `consumption_number` ON `consumption_documents` (`year`,`number`);--> statement-breakpoint
CREATE INDEX `consumption_batch` ON `consumption_documents` (`batch_id`);--> statement-breakpoint
CREATE TABLE `production_batches` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`product_id` text NOT NULL,
	`code` text NOT NULL,
	`recipe_id` text,
	`preparation_version_ids` text DEFAULT '[]' NOT NULL,
	`ordered` integer DEFAULT 0 NOT NULL,
	`planned` integer DEFAULT 0 NOT NULL,
	`actual` integer,
	`issued_before` integer DEFAULT 0 NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`consumption_id` text,
	`use_by` text,
	`note` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`closed_by` text,
	`closed_at` text,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "production_batch_status" CHECK("production_batches"."status" IN ('open','closed')),
	CONSTRAINT "production_batch_quantities" CHECK("production_batches"."planned">=0 AND "production_batches"."ordered">=0 AND ("production_batches"."actual" IS NULL OR "production_batches"."actual">=0))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_batch_day_product` ON `production_batches` (`day`,`product_id`);--> statement-breakpoint
CREATE TABLE `production_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`margin_bps` integer DEFAULT 1000 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "production_settings_singleton" CHECK("production_settings"."id"=1),
	CONSTRAINT "production_settings_margin" CHECK("production_settings"."margin_bps">=0 AND "production_settings"."margin_bps"<=10000)
);
--> statement-breakpoint
ALTER TABLE `stock_moves` ADD `batch_id` text REFERENCES production_batches(id);