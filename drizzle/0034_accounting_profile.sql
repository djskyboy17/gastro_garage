CREATE TABLE `accounting_profile` (
	`id` integer PRIMARY KEY NOT NULL,
	`tax_status` text NOT NULL,
	`exemption_note` text DEFAULT '' NOT NULL,
	`applied_on` text NOT NULL,
	`revision` integer DEFAULT 0 NOT NULL,
	`updated_by` text NOT NULL,
	`updated_at` text NOT NULL,
	CONSTRAINT "accounting_profile_singleton" CHECK("accounting_profile"."id"=1),
	CONSTRAINT "accounting_profile_tax_status" CHECK("accounting_profile"."tax_status"='non_vat_payer')
);
--> statement-breakpoint
CREATE TRIGGER `accounting_gross_insert` BEFORE INSERT ON `purchase_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.cost_basis <> 'gross'
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_GROSS_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_gross_update` BEFORE UPDATE OF cost_basis ON `purchase_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.cost_basis <> 'gross'
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_GROSS_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_handover_insert` BEFORE INSERT ON `production_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.handover_enabled <> 1
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_HANDOVER_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_handover_update` BEFORE UPDATE OF handover_enabled ON `production_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.handover_enabled <> 1
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_HANDOVER_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_delivery_insert` BEFORE INSERT ON `delivery_note_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.all_deliveries <> 1
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_DELIVERY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_delivery_update` BEFORE UPDATE OF all_deliveries ON `delivery_note_settings`
WHEN EXISTS (SELECT 1 FROM accounting_profile) AND NEW.all_deliveries <> 1
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_DELIVERY_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_aviz_departure` BEFORE UPDATE OF delivery ON `orders`
WHEN NEW.delivery = 'transit' AND OLD.delivery <> 'transit' AND NEW.fulfillment_mode <> 'pickup'
AND EXISTS (SELECT 1 FROM accounting_profile)
AND NOT EXISTS (SELECT 1 FROM delivery_notes WHERE order_id=NEW.id AND kind='issue' AND status='issued')
BEGIN SELECT RAISE(ABORT, 'AVIZ_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_nir_basis` BEFORE UPDATE OF status ON `supplier_invoices`
WHEN NEW.status='received' AND OLD.status <> 'received'
AND EXISTS (SELECT 1 FROM accounting_profile) AND NEW.cost_basis <> 'gross'
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_GROSS_REQUIRED'); END;
--> statement-breakpoint
CREATE TRIGGER `accounting_batch_handover` BEFORE UPDATE OF status ON `production_batches`
WHEN NEW.status='closed' AND OLD.status <> 'closed' AND NEW.actual > 0
AND EXISTS (SELECT 1 FROM accounting_profile)
AND NOT EXISTS (SELECT 1 FROM production_documents WHERE batch_id=NEW.id AND doc_type='handover' AND kind='issue' AND status='issued')
BEGIN SELECT RAISE(ABORT, 'ACCOUNTING_HANDOVER_REQUIRED'); END;
