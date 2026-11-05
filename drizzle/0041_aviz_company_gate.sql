-- v84: aviz csak céges (és külön kért) kiszállításhoz kell, és ilyenkor aviz nélkül a rendelés nem indulhat el.
-- A könyvelési profil többé nem írja elő az avizt minden kiszállításhoz.
DROP TRIGGER IF EXISTS `accounting_delivery_insert`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `accounting_delivery_update`;
--> statement-breakpoint
DROP TRIGGER IF EXISTS `accounting_aviz_departure`;
--> statement-breakpoint
CREATE TRIGGER `aviz_departure` BEFORE UPDATE OF delivery ON `orders`
WHEN NEW.delivery = 'transit' AND OLD.delivery <> 'transit' AND NEW.fulfillment_mode <> 'pickup'
AND (NEW.delivery_note_required = 1
  OR EXISTS (SELECT 1 FROM customer_billing b WHERE b.customer_id = NEW.customer_id AND b.kind = 'company')
  OR EXISTS (SELECT 1 FROM delivery_note_settings s WHERE s.id = 1 AND s.all_deliveries = 1))
AND NOT EXISTS (SELECT 1 FROM delivery_notes WHERE order_id = NEW.id AND kind = 'issue' AND status = 'issued')
BEGIN SELECT RAISE(ABORT, 'AVIZ_REQUIRED'); END;
