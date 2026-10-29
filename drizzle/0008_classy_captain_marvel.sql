CREATE TABLE `menu_days` (
	`date` text PRIMARY KEY NOT NULL,
	`cutoff_at` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_day_active" CHECK("menu_days"."active" IN (0,1))
);
--> statement-breakpoint
CREATE TABLE `menu_lines` (
	`date` text NOT NULL,
	`product_id` text NOT NULL,
	`capacity` integer NOT NULL,
	FOREIGN KEY (`date`) REFERENCES `menu_days`(`date`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`product_id`) REFERENCES `products`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "menu_capacity" CHECK("menu_lines"."capacity">=0 AND "menu_lines"."capacity"<=100000)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `menu_date_product` ON `menu_lines` (`date`,`product_id`);--> statement-breakpoint
CREATE TRIGGER menu_line_capacity_insert BEFORE INSERT ON menu_lines
WHEN NEW.capacity < (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders o ON o.id=i.order_id WHERE o.date=NEW.date AND i.product_id=NEW.product_id AND o.status IN ('requested','confirmed'))
BEGIN SELECT RAISE(ABORT,'MENU_CAPACITY'); END;
--> statement-breakpoint
CREATE TRIGGER order_item_menu_capacity BEFORE INSERT ON order_items
WHEN EXISTS (SELECT 1 FROM orders o JOIN menu_lines l ON l.date=o.date AND l.product_id=NEW.product_id WHERE o.id=NEW.order_id AND o.status IN ('requested','confirmed') AND l.capacity < NEW.quantity + (SELECT COALESCE(SUM(i.quantity),0) FROM order_items i JOIN orders booked ON booked.id=i.order_id WHERE booked.date=o.date AND i.product_id=NEW.product_id AND booked.status IN ('requested','confirmed')))
BEGIN SELECT RAISE(ABORT,'MENU_CAPACITY'); END;
