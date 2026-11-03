CREATE TABLE `document_series` (
	`key` text PRIMARY KEY NOT NULL,
	`doc_type` text NOT NULL,
	`year` integer NOT NULL,
	`prefix` text NOT NULL,
	`next_number` integer DEFAULT 1 NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "document_series_next" CHECK("document_series"."next_number">=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `document_series_type_year` ON `document_series` (`doc_type`,`year`);