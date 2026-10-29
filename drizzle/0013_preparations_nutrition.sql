CREATE TABLE `preparation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`version_id` text NOT NULL,
	`ingredient_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`loss_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`version_id`) REFERENCES `preparation_versions`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`ingredient_id`) REFERENCES `ingredients`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_ingredient` ON `preparation_lines` (`version_id`,`ingredient_id`);--> statement-breakpoint
CREATE TABLE `preparation_versions` (
	`id` text PRIMARY KEY NOT NULL,
	`preparation_id` text NOT NULL,
	`version` integer NOT NULL,
	`output` integer NOT NULL,
	`note` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`preparation_id`) REFERENCES `preparations`(`id`) ON UPDATE no action ON DELETE no action,
	CONSTRAINT "preparation_output_positive" CHECK("preparation_versions"."output" > 0)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `preparation_version` ON `preparation_versions` (`preparation_id`,`version`);--> statement-breakpoint
CREATE TABLE `preparations` (
	`id` text PRIMARY KEY NOT NULL,
	`hu` text NOT NULL,
	`ro` text NOT NULL,
	`unit` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE TABLE `recipe_preparation_lines` (
	`id` text PRIMARY KEY NOT NULL,
	`recipe_id` text NOT NULL,
	`preparation_id` text NOT NULL,
	`quantity` integer NOT NULL,
	`loss_bps` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`recipe_id`) REFERENCES `recipes`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`preparation_id`) REFERENCES `preparations`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recipe_preparation` ON `recipe_preparation_lines` (`recipe_id`,`preparation_id`);--> statement-breakpoint
ALTER TABLE `ingredients` ADD `nutrition` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `ingredients` ADD `frozen` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `ingredients` ADD `grams_per_piece` integer;