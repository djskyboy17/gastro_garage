CREATE TABLE `menu_settings` (
	`id` integer PRIMARY KEY NOT NULL,
	`set_price` integer DEFAULT 0 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	CONSTRAINT "menu_settings_single" CHECK("menu_settings"."id" = 1),
	CONSTRAINT "menu_set_price" CHECK("menu_settings"."set_price">=0 AND "menu_settings"."set_price"<=10000000)
);
--> statement-breakpoint
ALTER TABLE `menu_days` ADD `set_soup_id` text REFERENCES products(id);--> statement-breakpoint
ALTER TABLE `menu_days` ADD `set_main_id` text REFERENCES products(id);--> statement-breakpoint
ALTER TABLE `menu_days` ADD `set_dessert_id` text REFERENCES products(id);--> statement-breakpoint
ALTER TABLE `order_items` ADD `set_group` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `section` text DEFAULT 'alacarte' NOT NULL;--> statement-breakpoint
INSERT OR IGNORE INTO `menu_settings` (`id`,`set_price`,`revision`) VALUES (1,0,0);
