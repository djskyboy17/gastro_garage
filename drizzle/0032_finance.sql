CREATE TABLE `cash_days` (
	`day` text PRIMARY KEY NOT NULL,
	`status` text DEFAULT 'open' NOT NULL,
	`opening` integer DEFAULT 0 NOT NULL,
	`closing` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`closed_by` text,
	`closed_at` text,
	CONSTRAINT "cash_days_status" CHECK("cash_days"."status" IN ('open','closed'))
);
--> statement-breakpoint
CREATE TABLE `cash_entries` (
	`id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`kind` text NOT NULL,
	`amount` integer NOT NULL,
	`document` text DEFAULT '' NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`ref_id` text,
	`reversal_of` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "cash_entries_kind" CHECK("cash_entries"."kind" IN ('counter_sale','courier_handover','supplier_payment','deposit','bank_deposit','other_in','other_out','reversal')),
	CONSTRAINT "cash_entries_amount" CHECK("cash_entries"."amount"<>0)
);
--> statement-breakpoint
CREATE INDEX `cash_entries_day` ON `cash_entries` (`day`);--> statement-breakpoint
CREATE TABLE `courier_handovers` (
	`id` text PRIMARY KEY NOT NULL,
	`courier_user_id` text NOT NULL,
	`courier_name` text NOT NULL,
	`day` text NOT NULL,
	`expected` integer NOT NULL,
	`counted` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`cash_entry_id` text,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "courier_handovers_counted" CHECK("courier_handovers"."counted">=0)
);
--> statement-breakpoint
CREATE INDEX `courier_handovers_day` ON `courier_handovers` (`day`);--> statement-breakpoint
CREATE TABLE `payments` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`day` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`collected_by` text NOT NULL,
	`collector_id` text NOT NULL,
	`collector_name` text DEFAULT '' NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`handover_id` text,
	`cash_entry_id` text,
	`note` text DEFAULT '' NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`handover_id`) REFERENCES `courier_handovers`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "payments_method" CHECK("payments"."method" IN ('cash','card')),
	CONSTRAINT "payments_collected_by" CHECK("payments"."collected_by" IN ('courier','office')),
	CONSTRAINT "payments_amount" CHECK("payments"."amount"<>0)
);
--> statement-breakpoint
CREATE INDEX `payments_order` ON `payments` (`order_id`);--> statement-breakpoint
CREATE INDEX `payments_day` ON `payments` (`day`);--> statement-breakpoint
CREATE TABLE `supplier_payments` (
	`id` text PRIMARY KEY NOT NULL,
	`invoice_id` text NOT NULL,
	`day` text NOT NULL,
	`method` text NOT NULL,
	`amount` integer NOT NULL,
	`reversal_of` text,
	`reversed_by` text,
	`cash_entry_id` text,
	`note` text DEFAULT '' NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`invoice_id`) REFERENCES `supplier_invoices`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "supplier_payments_method" CHECK("supplier_payments"."method" IN ('cash','bank')),
	CONSTRAINT "supplier_payments_amount" CHECK("supplier_payments"."amount"<>0)
);
--> statement-breakpoint
CREATE INDEX `supplier_payments_invoice` ON `supplier_payments` (`invoice_id`);--> statement-breakpoint
CREATE TABLE `z_reports` (
	`day` text PRIMARY KEY NOT NULL,
	`z_number` text NOT NULL,
	`total` integer NOT NULL,
	`cash` integer NOT NULL,
	`card` integer NOT NULL,
	`note` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`actor` text NOT NULL,
	`updated_at` text NOT NULL
);
