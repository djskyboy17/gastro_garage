CREATE TABLE `auth_identities` (
	`id` text PRIMARY KEY NOT NULL,
	`provider` text NOT NULL,
	`subject` text NOT NULL,
	`user_id` text NOT NULL,
	`email` text NOT NULL,
	`created_at` text NOT NULL,
	FOREIGN KEY (`user_id`) REFERENCES `auth_users`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `auth_identities_user` ON `auth_identities` (`user_id`);--> statement-breakpoint
CREATE TABLE `oauth_states` (
	`id` text PRIMARY KEY NOT NULL,
	`verifier` text NOT NULL,
	`nonce` text NOT NULL,
	`return_to` text NOT NULL,
	`created_at` text NOT NULL
);
--> statement-breakpoint
ALTER TABLE `auth_failures` ADD `ip` text DEFAULT '' NOT NULL;--> statement-breakpoint
CREATE INDEX `auth_failures_ip` ON `auth_failures` (`ip`,`created_at`);--> statement-breakpoint
ALTER TABLE `auth_users` ADD `must_change_password` integer DEFAULT 0 NOT NULL;