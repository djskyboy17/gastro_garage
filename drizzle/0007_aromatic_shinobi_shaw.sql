CREATE TABLE `portal_profiles` (
	`user_id` text PRIMARY KEY NOT NULL,
	`customer_id` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `portal_customer` ON `portal_profiles` (`customer_id`);--> statement-breakpoint
CREATE TABLE `portal_submissions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`order_id` text NOT NULL,
	`request` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `portal_profiles`(`user_id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `portal_submission_user_time` ON `portal_submissions` (`user_id`,`created_at`);--> statement-breakpoint
ALTER TABLE `orders` ADD `portal_user_id` text REFERENCES portal_profiles(user_id);--> statement-breakpoint
ALTER TABLE `orders` ADD `review_note` text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `portal_visible` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `products` ADD `portal_revision` integer DEFAULT 0 NOT NULL;