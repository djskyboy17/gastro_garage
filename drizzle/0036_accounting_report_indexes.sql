CREATE INDEX `consumption_issued` ON `consumption_documents` (`issue_date`);--> statement-breakpoint
CREATE INDEX `delivery_note_issued` ON `delivery_notes` (`issue_date`);--> statement-breakpoint
CREATE INDEX `nir_issued` ON `nir_documents` (`issue_date`);--> statement-breakpoint
CREATE INDEX `production_document_issued` ON `production_documents` (`issue_date`);--> statement-breakpoint
CREATE INDEX `sales_invoice_issued` ON `sales_invoices` (`issue_date`);--> statement-breakpoint
CREATE INDEX `supplier_invoice_issued` ON `supplier_invoices` (`issue_date`);--> statement-breakpoint
CREATE INDEX `supplier_invoice_received` ON `supplier_invoices` (`received_date`);