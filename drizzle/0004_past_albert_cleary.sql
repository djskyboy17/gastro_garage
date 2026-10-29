CREATE TABLE `members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'pending' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "member_role" CHECK("members"."role" IN ('admin','dispatcher','kitchen','warehouse','pending','disabled'))
);
--> statement-breakpoint
CREATE TABLE `workspace_owners` (
	`id` integer PRIMARY KEY NOT NULL,
	`user_id` text NOT NULL,
	CONSTRAINT "single_workspace_owner" CHECK("workspace_owners"."id"=1)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `workspace_owners_user_id_unique` ON `workspace_owners` (`user_id`);