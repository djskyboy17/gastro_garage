CREATE TABLE `billing_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`mode` text DEFAULT 'simulated' NOT NULL,
	`company_cif` text DEFAULT '' NOT NULL,
	`series_name` text DEFAULT '' NOT NULL,
	`storno_series_name` text DEFAULT '' NOT NULL,
	`vat_food_bps` integer DEFAULT 1100 NOT NULL,
	`vat_delivery_bps` integer DEFAULT 2100 NOT NULL,
	`cash_collect_type` text DEFAULT 'Alta incasare numerar' NOT NULL,
	`receipt_series` text DEFAULT '' NOT NULL,
	`auto_spv` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "billing_settings_singleton" CHECK("billing_settings"."id"=1),
	CONSTRAINT "billing_settings_mode" CHECK("billing_settings"."mode" IN ('simulated','live'))
);
--> statement-breakpoint
CREATE TABLE `customer_billing` (
	`customer_id` text PRIMARY KEY NOT NULL,
	`kind` text DEFAULT 'person' NOT NULL,
	`mode` text DEFAULT 'receipt' NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`cif` text DEFAULT '' NOT NULL,
	`reg_com` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`city` text DEFAULT '' NOT NULL,
	`county` text DEFAULT '' NOT NULL,
	`country` text DEFAULT 'România' NOT NULL,
	`email` text DEFAULT '' NOT NULL,
	`payment_days` integer DEFAULT 15 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "customer_billing_kind" CHECK("customer_billing"."kind" IN ('person','company')),
	CONSTRAINT "customer_billing_mode" CHECK("customer_billing"."mode" IN ('receipt','per_order','monthly')),
	CONSTRAINT "customer_billing_days" CHECK("customer_billing"."payment_days">=0 AND "customer_billing"."payment_days"<=120)
);
--> statement-breakpoint
CREATE TABLE `oblio_simulated` (
	`idempotency_key` text PRIMARY KEY NOT NULL,
	`series_name` text NOT NULL,
	`number` integer NOT NULL,
	`payload` text NOT NULL,
	`spv_code` integer,
	`collected` integer DEFAULT 0 NOT NULL,
	`cancelled` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `sales_invoice_collects` (
	`source_id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`source` text NOT NULL,
	`amount` integer NOT NULL,
	`collect_type` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`last_error` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	`sent_at` text,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_invoice_collects_status" CHECK("sales_invoice_collects"."status" IN ('pending','sent','failed','skipped'))
);
--> statement-breakpoint
CREATE INDEX `sales_invoice_collects_invoice` ON `sales_invoice_collects` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `sales_invoice_orders` (
	`invoice_id` text NOT NULL,
	`order_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	PRIMARY KEY(`invoice_id`, `order_id`),
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_invoice_order_active` ON `sales_invoice_orders` (`order_id`) WHERE "sales_invoice_orders"."active"=1;--> statement-breakpoint
CREATE TABLE `sales_invoice_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`day` text NOT NULL,
	`amount` integer NOT NULL,
	`reference` text DEFAULT '' NOT NULL,
	`reversal_of` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `sales_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_invoice_payments_amount" CHECK("sales_invoice_payments"."amount"<>0)
);
--> statement-breakpoint
CREATE INDEX `sales_invoice_payments_invoice` ON `sales_invoice_payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `sales_invoices` (
	`id` text PRIMARY KEY NOT NULL,
	`kind` text NOT NULL,
	`customer_id` text NOT NULL,
	`period` text DEFAULT '' NOT NULL,
	`idempotency_key` text NOT NULL,
	`status` text DEFAULT 'pending' NOT NULL,
	`content` text NOT NULL,
	`total` integer NOT NULL,
	`issue_date` text NOT NULL,
	`due_date` text DEFAULT '' NOT NULL,
	`oblio_series` text DEFAULT '' NOT NULL,
	`oblio_number` text DEFAULT '' NOT NULL,
	`oblio_link` text DEFAULT '' NOT NULL,
	`spv_code` integer,
	`spv_text` text DEFAULT '' NOT NULL,
	`spv_checked_at` text,
	`last_error` text DEFAULT '' NOT NULL,
	`attempts` integer DEFAULT 0 NOT NULL,
	`storno_of` text,
	`stornoed_by` text,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`issued_at` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "sales_invoice_kind" CHECK("sales_invoices"."kind" IN ('order','monthly','storno')),
	CONSTRAINT "sales_invoice_status" CHECK("sales_invoices"."status" IN ('pending','failed','issued','stornoed'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sales_invoice_key` ON `sales_invoices` (`idempotency_key`);--> statement-breakpoint
CREATE INDEX `sales_invoice_customer` ON `sales_invoices` (`customer_id`);