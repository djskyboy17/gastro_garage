ALTER TABLE `billing_settings` ADD `vat_payer` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE `billing_settings` ADD `vat_note` text DEFAULT '' NOT NULL;