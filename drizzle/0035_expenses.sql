CREATE TABLE `expense_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`kind` text NOT NULL,
	`posting_day` text NOT NULL,
	`amount` integer NOT NULL,
	`content` text NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `supplier_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "expense_document_kind" CHECK("expense_documents"."kind" IN ('expense','reversal'))
);
--> statement-breakpoint
CREATE INDEX `expense_document_period` ON `expense_documents` (`posting_day`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_document_reversal` ON `expense_documents` (`reversal_of`);--> statement-breakpoint
CREATE UNIQUE INDEX `expense_document_active` ON `expense_documents` (`invoice_id`) WHERE "expense_documents"."kind"='expense' AND "expense_documents"."reversed_by" IS NULL;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD `purpose` text DEFAULT 'stock' NOT NULL;