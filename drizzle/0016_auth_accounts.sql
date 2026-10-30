CREATE TABLE `auth_failures` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
CREATE INDEX `auth_failures_email` ON `auth_failures` (`email`,`created_at`);--> statement-breakpoint
CREATE TABLE `auth_sessions` (
	`id` text PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	`created_at` text NOT NULL,
	`expires_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_sessions_user` ON `auth_sessions` (`user_id`);--> statement-breakpoint
CREATE TABLE `auth_users` (
	`id` text PRIMARY KEY NOT NULL,
	`email` text NOT NULL,
	`name` text NOT NULL,
	`password_hash` text NOT NULL,
	`created_at` text NOT NULL,
	`password_changed_at` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `auth_users_email` ON `auth_users` (`email`);