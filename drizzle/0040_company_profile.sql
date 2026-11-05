CREATE TABLE `company_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`name` text DEFAULT '' NOT NULL,
	`cui` text DEFAULT '' NOT NULL,
	`reg_com` text DEFAULT '' NOT NULL,
	`address` text DEFAULT '' NOT NULL,
	`work_point` text DEFAULT '' NOT NULL,
	`phone` text DEFAULT '' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by` text DEFAULT '' NOT NULL,
	`updated_at` text DEFAULT '' NOT NULL,
	CONSTRAINT "company_profile_singleton" CHECK("company_profile"."id"=1)
);
--> statement-breakpoint
ALTER TABLE `delivery_note_settings` ADD `legal_footer` text DEFAULT '' NOT NULL;