CREATE TABLE `archive_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`doc_type` text NOT NULL,
	`source_table` text NOT NULL,
	`source_id` text NOT NULL,
	`version` integer DEFAULT 1 NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`partner_key` text NOT NULL,
	`partner_name` text DEFAULT '' NOT NULL,
	`issue_date` text NOT NULL,
	`r2_key` text NOT NULL,
	`mime` text NOT NULL,
	`size_bytes` integer NOT NULL,
	`sha256` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `archive_documents_key` ON `archive_documents` (`r2_key`);--> statement-breakpoint
CREATE UNIQUE INDEX `archive_documents_source` ON `archive_documents` (`source_table`,`source_id`,`doc_type`,`version`);--> statement-breakpoint
CREATE INDEX `archive_documents_issue` ON `archive_documents` (`issue_date`);--> statement-breakpoint
CREATE INDEX `archive_documents_partner` ON `archive_documents` (`partner_key`);