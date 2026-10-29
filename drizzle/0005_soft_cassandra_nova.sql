CREATE TABLE `safety_points` (
	`id` text PRIMARY KEY NOT NULL,
	`hu` text NOT NULL,
	`ro` text NOT NULL,
	`area` text NOT NULL,
	`kind` text NOT NULL,
	`min` integer,
	`max` integer,
	`instructions_hu` text NOT NULL,
	`instructions_ro` text NOT NULL,
	`active` integer DEFAULT 1 NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "safety_point_limits" CHECK(("safety_points"."kind"='temperature' AND "safety_points"."min" IS NOT NULL AND "safety_points"."max" IS NOT NULL AND "safety_points"."min"<="safety_points"."max") OR ("safety_points"."kind"='checklist' AND "safety_points"."min" IS NULL AND "safety_points"."max" IS NULL))
);
--> statement-breakpoint
CREATE TABLE `safety_records` (
	`id` text PRIMARY KEY NOT NULL,
	`point_id` text NOT NULL,
	`snapshot` text NOT NULL,
	`temperature` integer,
	`answer` text,
	`outcome` text NOT NULL,
	`day` text NOT NULL,
	`note` text NOT NULL,
	`actor` text NOT NULL,
	`actor_name` text NOT NULL,
	`created_at` text NOT NULL,
	`request` text NOT NULL,
	`status` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`correction` text DEFAULT '' NOT NULL,
	`recheck_id` text,
	`resolved_by` text DEFAULT '' NOT NULL,
	`resolved_at` text DEFAULT '' NOT NULL,
	FOREIGN KEY (`point_id`) REFERENCES `safety_points`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `safety_record_point_day` ON `safety_records` (`point_id`,`day`);--> statement-breakpoint
CREATE INDEX `safety_record_status` ON `safety_records` (`status`);