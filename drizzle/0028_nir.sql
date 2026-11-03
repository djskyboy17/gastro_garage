CREATE TABLE `nir_documents` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`year` integer NOT NULL,
	`number` integer NOT NULL,
	`kind` text DEFAULT 'receipt' NOT NULL,
	`status` text DEFAULT 'issued' NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`issue_date` text NOT NULL,
	`content` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `supplier_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "nir_kind" CHECK("nir_documents"."kind" IN ('receipt','reversal')),
	CONSTRAINT "nir_status" CHECK("nir_documents"."status" IN ('issued','reversed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `nir_number` ON `nir_documents` (`year`,`number`);--> statement-breakpoint
CREATE INDEX `nir_invoice` ON `nir_documents` (`invoice_id`);--> statement-breakpoint
ALTER TABLE `purchase_settings` ADD `nir_committee` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `supplier_invoice_lines` ADD `received_quantity` integer;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD `supplier_id` text REFERENCES suppliers(id);--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD `due_date` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `supplier_invoices` ADD `mismatch_reason` text DEFAULT '' NOT NULL;