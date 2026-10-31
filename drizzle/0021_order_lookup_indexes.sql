CREATE INDEX `order_items_order` ON `order_items` (`order_id`);--> statement-breakpoint
CREATE INDEX `orders_date_status` ON `orders` (`date`,`status`);