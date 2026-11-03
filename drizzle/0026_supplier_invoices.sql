CREATE TABLE `invoice_item_mappings` (
	`key` text PRIMARY KEY NOT NULL,
	`ingredient_id` text NOT NULL,
	`factor` integer NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`cost_basis` text DEFAULT 'net' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "purchase_settings_singleton" CHECK("purchase_settings"."id"=1),
	CONSTRAINT "purchase_settings_basis" CHECK("purchase_settings"."cost_basis" IN ('net','gross'))
);
--> statement-breakpoint
CREATE TABLE `supplier_invoice_files` (
	`invoice_id` text PRIMARY KEY NOT NULL,
	`mime` text NOT NULL,
	`bytes` integer NOT NULL,
	`data` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `supplier_invoices`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `supplier_invoice_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`position` integer NOT NULL,
	`description` text NOT NULL,
	`invoice_quantity` integer NOT NULL,
	`invoice_unit` text DEFAULT '' NOT NULL,
	`line_net` integer,
	`vat_rate` integer,
	`line_gross` integer,
	`deposit` integer DEFAULT 0 NOT NULL,
	`skip` integer DEFAULT 0 NOT NULL,
	`ingredient_id` text,
	`base_quantity` integer DEFAULT 0 NOT NULL,
	`expires` text DEFAULT '' NOT NULL,
	`batch` text DEFAULT '' NOT NULL,
	`lot_id` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `supplier_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_invoice_line_quantity" CHECK("supplier_invoice_lines"."invoice_quantity">=0 AND "supplier_invoice_lines"."base_quantity">=0)
);
--> statement-breakpoint
CREATE INDEX `supplier_invoice_line_invoice` ON `supplier_invoice_lines` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `supplier_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`supplier_name` text DEFAULT '' NOT NULL,
	`supplier_tax_id` text DEFAULT '' NOT NULL,
	`series` text DEFAULT '' NOT NULL,
	`number` text DEFAULT '' NOT NULL,
	`issue_date` text DEFAULT '' NOT NULL,
	`currency` text DEFAULT 'RON' NOT NULL,
	`subtotal` integer,
	`vat_total` integer,
	`sgr_total` integer DEFAULT 0 NOT NULL,
	`total` integer,
	`source` text NOT NULL,
	`model` text DEFAULT '' NOT NULL,
	`has_file` integer DEFAULT 0 NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`cost_basis` text DEFAULT '' NOT NULL,
	`received_date` text DEFAULT '' NOT NULL,
	`received_by` text DEFAULT '' NOT NULL,
	`received_at` text DEFAULT '' NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "supplier_invoice_kind" CHECK("supplier_invoices"."kind" IN ('factura','bon_fiscal')),
	CONSTRAINT "supplier_invoice_status" CHECK("supplier_invoices"."status" IN ('draft','received')),
	CONSTRAINT "supplier_invoice_source" CHECK("supplier_invoices"."source" IN ('ai','manual'))
);
--> statement-breakpoint
CREATE INDEX `supplier_invoice_created` ON `supplier_invoices` (`created_at`);