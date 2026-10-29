CREATE TABLE `purchase_events` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`kind` text NOT NULL,
	`detail` text NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `purchase_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`purchase_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`hu` text NOT NULL,
	`ro` text NOT NULL,
	`unit` text NOT NULL,
	`quantity` integer NOT NULL,
	`received` integer DEFAULT 0 NOT NULL,
	`pack_quantity` integer NOT NULL,
	`pack_price` integer NOT NULL,
	FOREIGN KEY (`purchase_id`) REFERENCES `purchase_orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "purchase_received_bounds" CHECK("purchase_lines"."received">=0 AND "purchase_lines"."received"<="purchase_lines"."quantity")
);
--> statement-breakpoint
CREATE UNIQUE INDEX `purchase_ingredient` ON `purchase_lines` (`purchase_id`,`ingredient_id`);--> statement-breakpoint
CREATE TABLE `purchase_orders` (
	`id` text PRIMARY KEY NOT NULL,
	`supplier_id` text NOT NULL,
	`supplier_name` text NOT NULL,
	`supplier_tax_id` text NOT NULL,
	`supplier_address` text NOT NULL,
	`due` text NOT NULL,
	`note` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`supplier_id`) REFERENCES `suppliers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `suppliers` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`tax_id` text NOT NULL,
	`address` text NOT NULL,
	`email` text NOT NULL,
	`phone` text NOT NULL,
	`note` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `stock_lots` ADD `purchase_line_id` text REFERENCES purchase_lines(id);