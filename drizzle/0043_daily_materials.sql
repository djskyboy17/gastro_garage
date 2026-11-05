CREATE TABLE `production_materials` (
	`batch_id` text PRIMARY KEY NOT NULL,
	`day` text NOT NULL,
	`content` text NOT NULL,
	`consumption_id` text,
	`revision` integer DEFAULT 0 NOT NULL,
	FOREIGN KEY (`batch_id`) REFERENCES `production_batches`(`id`) ON UPDATE no action ON DELETE no action,
	FOREIGN KEY (`consumption_id`) REFERENCES `consumption_documents`(`id`) ON UPDATE no action ON DELETE no action
);
--> statement-breakpoint
CREATE INDEX `production_materials_day` ON `production_materials` (`day`);
--> statement-breakpoint
DROP TRIGGER IF EXISTS accounting_batch_handover;
--> statement-breakpoint
CREATE TRIGGER accounting_batch_handover BEFORE UPDATE OF status ON production_batches
WHEN NEW.status='closed' AND OLD.status<>'closed' AND NEW.actual>0
AND EXISTS(SELECT 1 FROM accounting_profile)
AND NOT EXISTS(SELECT 1 FROM production_documents WHERE batch_id=NEW.id AND doc_type='handover' AND kind='issue' AND status='issued')
AND NOT EXISTS(SELECT 1 FROM production_materials WHERE batch_id=NEW.id AND consumption_id IS NULL)
BEGIN SELECT RAISE(ABORT,'ACCOUNTING_HANDOVER_REQUIRED'); END;
