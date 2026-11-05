
--> statement-breakpoint
CREATE TRIGGER production_day_no_new_batch BEFORE INSERT ON production_batches
WHEN EXISTS(SELECT 1 FROM production_day_closes WHERE day=NEW.day AND status='closed')
BEGIN SELECT RAISE(ABORT,'DAY_CLOSED'); END;
--> statement-breakpoint
CREATE TRIGGER production_day_no_changed_batch BEFORE UPDATE OF planned,actual,status,recipe_id,preparation_version_ids ON production_batches
WHEN EXISTS(SELECT 1 FROM production_day_closes WHERE day=NEW.day AND status='closed')
BEGIN SELECT RAISE(ABORT,'DAY_CLOSED'); END;
