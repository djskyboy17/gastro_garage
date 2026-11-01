ALTER TABLE `menu_settings` ADD `default_cutoff` text DEFAULT '09:00' NOT NULL;--> statement-breakpoint
-- v54: a napi menü csak leves + főétel. A Napi menü részben lévő desszertek (és más nem leves/főétel) visszakerülnek az Étlapra,
-- és a napok menüjéből a desszert kikerül.
UPDATE `products` SET `section`='alacarte' WHERE `section`='daily' AND `category` NOT IN ('soup','main');--> statement-breakpoint
UPDATE `menu_days` SET `set_dessert_id`=NULL WHERE `set_dessert_id` IS NOT NULL;
