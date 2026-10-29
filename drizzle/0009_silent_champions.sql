CREATE TABLE `stocktake_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`stocktake_id` text NOT NULL,
	`lot_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`expected` integer NOT NULL,
	`lot_revision` integer NOT NULL,
	`counted` integer,
	`note` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`stocktake_id`) REFERENCES `stocktakes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`lot_id`) REFERENCES `stock_lots`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stocktake_count" CHECK("stocktake_lines"."counted" IS NULL OR ("stocktake_lines"."counted">=0 AND "stocktake_lines"."counted"<=10000000))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `stocktake_lot` ON `stocktake_lines` (`stocktake_id`,`lot_id`);--> statement-breakpoint
CREATE TABLE `stocktakes` (
	`id` text PRIMARY KEY NOT NULL,
	`title` text NOT NULL,
	`status` text DEFAULT 'draft' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`request` text NOT NULL,
	`created_by` text NOT NULL,
	`created_at` text NOT NULL,
	`posted_by` text DEFAULT '' NOT NULL,
	`posted_at` text DEFAULT '' NOT NULL,
	`closed_by` text DEFAULT '' NOT NULL,
	`closed_at` text DEFAULT '' NOT NULL,
	`close_note` text DEFAULT '' NOT NULL,
	CONSTRAINT "stocktake_status" CHECK("stocktakes"."status" IN ('draft','posted','cancelled','reversed'))
);
--> statement-breakpoint
PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_stock_lots` (
	`revision` integer DEFAULT 0 NOT NULL,
	`adjustment_total` integer DEFAULT 0 NOT NULL,
	`purchase_line_id` text,
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
	FOREIGN KEY (`purchase_line_id`) REFERENCES `purchase_lines`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "stock_lot_balance" CHECK("__new_stock_lots"."remaining" >= 0 AND "__new_stock_lots"."remaining" <= "__new_stock_lots"."quantity"+"__new_stock_lots"."adjustment_total" AND ABS("__new_stock_lots"."adjustment_total")<=1000000000)
);
--> statement-breakpoint
INSERT INTO `__new_stock_lots`("revision", "adjustment_total", "purchase_line_id", "id", "ingredient_id", "batch", "supplier", "received", "expires", "quantity", "remaining", "total_cost", "document", "created_at") SELECT 0, 0, "purchase_line_id", "id", "ingredient_id", "batch", "supplier", "received", "expires", "quantity", "remaining", "total_cost", "document", "created_at" FROM `stock_lots`;--> statement-breakpoint
DROP TABLE `stock_lots`;--> statement-breakpoint
ALTER TABLE `__new_stock_lots` RENAME TO `stock_lots`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
CREATE INDEX `stock_lot_ingredient_expiry` ON `stock_lots` (`ingredient_id`,`expires`);
--> statement-breakpoint
CREATE TRIGGER stock_lot_balance_revision AFTER UPDATE OF remaining ON stock_lots
BEGIN UPDATE stock_lots SET revision=OLD.revision+1 WHERE id=NEW.id; END;
