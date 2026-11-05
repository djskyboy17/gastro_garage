/** Monthly invoices collect at invoice level, never against individual orders. One order-id bind. */
export const orderCollectionAllowedSql = `NOT EXISTS (
  SELECT 1 FROM orders collection_order
  JOIN customer_billing collection_profile ON collection_profile.customer_id=collection_order.customer_id
  WHERE collection_order.id=? AND collection_profile.mode='monthly'
)`;
