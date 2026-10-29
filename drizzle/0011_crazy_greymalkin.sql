PRAGMA defer_foreign_keys=ON;--> statement-breakpoint
CREATE TABLE `__new_members` (
	`user_id` text PRIMARY KEY NOT NULL,
	`name` text NOT NULL,
	`email` text NOT NULL,
	`role` text DEFAULT 'pending' NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`created_at` text NOT NULL,
	CONSTRAINT "member_role" CHECK("__new_members"."role" IN ('admin','dispatcher','kitchen','warehouse','courier','pending','disabled'))
);
--> statement-breakpoint
INSERT INTO `__new_members`("user_id", "name", "email", "role", "revision", "created_at") SELECT "user_id", "name", "email", "role", "revision", "created_at" FROM `members`;--> statement-breakpoint
DROP TABLE `members`;--> statement-breakpoint
ALTER TABLE `__new_members` RENAME TO `members`;--> statement-breakpoint
PRAGMA defer_foreign_keys=OFF;--> statement-breakpoint
ALTER TABLE `couriers` ADD `user_id` text REFERENCES members(user_id);--> statement-breakpoint
ALTER TABLE `couriers` ADD `binding_revision` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX `courier_account_unique` ON `couriers` (`user_id`);
--> statement-breakpoint
CREATE TRIGGER courier_unlink_role AFTER UPDATE OF role ON members
WHEN NEW.role<>'courier'
BEGIN UPDATE couriers SET user_id=NULL,binding_revision=binding_revision+1 WHERE user_id=NEW.user_id; END;
--> statement-breakpoint
CREATE INDEX orders_courier_date ON orders (courier_id,date,status);
