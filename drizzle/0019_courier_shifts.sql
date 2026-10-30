CREATE TABLE `courier_shifts` (
	`date` text NOT NULL,
	`courier_id` text NOT NULL,
	`created_at` text NOT NULL,
	PRIMARY KEY(`date`, `courier_id`),
	FOREIGN KEY (`courier_id`) REFERENCES `couriers`(`id`) ON UPDATE no action ON DELETE no action
);
