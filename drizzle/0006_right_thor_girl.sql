CREATE TABLE `recurring_occurrences` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`day` text NOT NULL,
	`order_id` text NOT NULL,
	`run_id` text NOT NULL,
	`template_revision` integer NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`order_id`) REFERENCES `orders`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`run_id`) REFERENCES `recurring_runs`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_template_day` ON `recurring_occurrences` (`template_id`,`day`);--> statement-breakpoint
CREATE UNIQUE INDEX `recurring_order` ON `recurring_occurrences` (`order_id`);--> statement-breakpoint
CREATE TABLE `recurring_runs` (
	`id` text PRIMARY KEY NOT NULL,
	`template_id` text NOT NULL,
	`request` text NOT NULL,
	`requested_count` integer NOT NULL,
	`actor` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`template_id`) REFERENCES `recurring_templates`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE TABLE `recurring_templates` (
	`id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`customer_id` text NOT NULL,
	`content` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`customer_id`) REFERENCES `customers`(`id`) ON UPDATE no action ON DELETE no action
);
