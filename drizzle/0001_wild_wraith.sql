CREATE TABLE `ingredients` (
	`id` text PRIMARY KEY NOT NULL,
	`hu` text NOT NULL,
	`ro` text NOT NULL,
	`unit` text NOT NULL,
	`pack_quantity` integer NOT NULL,
	`pack_price` integer NOT NULL,
	`min_stock` integer DEFAULT 0 NOT NULL,
	`allergens` text NOT NULL,
	`supplier` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipe_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`loss_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_ingredient` ON `recipe_lines` (`recipe_id`,`ingredient_id`);--> statement-breakpoint
CREATE TABLE `recipes` (
	`id` text PRIMARY KEY NOT NULL,
	`product_id` text NOT NULL,
	`version` integer NOT NULL,
	`yield` integer NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_product_version` ON `recipes` (`product_id`,`version`);--> statement-breakpoint
CREATE TABLE `stock_issues` (
	`id` text PRIMARY KEY NOT NULL,
	`order_id` text NOT NULL,
	`recipe_snapshot` text NOT NULL,
	`created_at` text NOT NULL,
	`actor` text NOT NULL,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `one_issue_per_order` ON `stock_issues` (`order_id`);--> statement-breakpoint
CREATE TABLE `stock_lots` (
	`id` text PRIMARY KEY NOT NULL,
	`ingredient_id` text NOT NULL,
	`batch` text NOT NULL,
	`supplier` text NOT NULL,
	`received` text NOT NULL,
	`expires` text NOT NULL,
	`quantity` integer NOT NULL,
	`remaining` integer NOT NULL,
	`total_cost` integer NOT NULL,
	`document` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_lot_balance" CHECK("stock_lots"."remaining" >= 0 AND "stock_lots"."remaining" <= "stock_lots"."quantity")
);
--> statement-breakpoint
CREATE INDEX `stock_lot_ingredient_expiry` ON `stock_lots` (`ingredient_id`,`expires`);--> statement-breakpoint
CREATE TABLE `stock_moves` (
	`id` text PRIMARY KEY NOT NULL,
	`lot_id` text NOT NULL,
	`issue_id` text,
	`quantity` integer NOT NULL,
	`kind` text NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`issue_id`) REFERENCES `stock_issues`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
ALTER TABLE `order_items` ADD `recipe_id` text REFERENCES recipes(id);