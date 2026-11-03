CREATE TABLE `finished_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`batch_id` text NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`quantity` integer NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "finished_moves_kind" CHECK("finished_moves"."kind" IN ('sold','staff','waste','donation')),
	CONSTRAINT "finished_moves_quantity" CHECK("finished_moves"."quantity">0)
);
--> statement-breakpoint
CREATE INDEX `finished_moves_batch` ON `finished_moves` (`batch_id`);--> statement-breakpoint
CREATE INDEX `finished_moves_day` ON `finished_moves` (`day`);--> statement-breakpoint
CREATE TABLE `production_day_closes` (
	`day` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`content` text DEFAULT '{}' NOT NULL,
	`write_off_id` text,
	`closed_by` text,
	`closed_at` text,
	CONSTRAINT "production_day_close_status" CHECK("production_day_closes"."status" IN ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE `production_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_type` text NOT NULL,
	`year` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text DEFAULT 'issue' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`issue_date` text NOT NULL,
	`day` text NOT NULL,
	`batch_id` text,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "production_document_type" CHECK("production_documents"."doc_type" IN ('write_off','handover')),
	CONSTRAINT "production_document_kind" CHECK("production_documents"."kind" IN ('issue','reversal')),
	CONSTRAINT "production_document_status" CHECK("production_documents"."status" IN ('issued','reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `production_document_number` ON `production_documents` (`doc_type`,`year`,`number`);--> statement-breakpoint
CREATE INDEX `production_document_day` ON `production_documents` (`day`);--> statement-breakpoint
ALTER TABLE `production_settings` ADD `write_off_committee` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `production_settings` ADD `handover_enabled` integer DEFAULT 0 NOT NULL;