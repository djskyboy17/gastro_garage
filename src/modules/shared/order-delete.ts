import { env } from "cloudflare:workers";

/**
 * Lemondott rendelés végleges törlése (v50, hard delete): a rendelés és minden hozzá tartozó sor –
 * tételek, szállítási események, portálos beküldés, ismétlődő-rendelés hozzárendelés, raktári kiadás,
 * és a rendelés naplóbejegyzései – egy tranzakcióban törlődik. Napló sem marad (a tulajdonos döntése).
 *
 * `guard` SQL-feltétel (paraméterei: `guardBinds`): csak akkor fut le a törlés, ha igaz – pl. a rendelés még
 * ugyanabban a változatban van, és a főzés még nem kezdődött el. Ha hamis, az első utasítás NOT NULL hibával
 * leállítja az egész tranzakciót, így részleges törlés nem maradhat. A segédsor a tranzakció végén törlődik.
 *
 * v75/v76: avizos vagy befizetéssel rendelkező (bizonylattal rendelkező) rendelés soha nem törlődik – a bizonylat megmarad, a rendelés csak lemondható.
 *
 * Visszaadja, hogy történt-e törlés (false: a feltétel nem teljesült, semmi nem változott).
 */
export async function hardDeleteOrder(orderId: string, guard: string, guardBinds: unknown[]): Promise<boolean> {
  const guardRow = crypto.randomUUID(),
    now = new Date().toISOString();
  try {
    await env.DB!.batch([
      env.DB!.prepare(
        `INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN (${guard}) AND NOT EXISTS (SELECT 1 FROM delivery_notes WHERE order_id=?) AND NOT EXISTS (SELECT 1 FROM payments WHERE order_id=?) AND NOT EXISTS (SELECT 1 FROM fiscal_receipts WHERE order_id=?) THEN 'system' ELSE NULL END,'order_delete_guard','','',?)`,
      ).bind(guardRow, ...guardBinds, orderId, orderId, orderId, now),
      env.DB!.prepare("DELETE FROM order_items WHERE order_id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM delivery_events WHERE order_id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM portal_submissions WHERE order_id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM recurring_occurrences WHERE order_id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM stock_issues WHERE order_id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM audit WHERE entity=?").bind(orderId),
      env.DB!.prepare("DELETE FROM orders WHERE id=?").bind(orderId),
      env.DB!.prepare("DELETE FROM audit WHERE id=?").bind(guardRow),
    ]);
  } catch (e) {
    if (/NOT NULL/.test(String(e))) return false;
    throw e;
  }
  return true;
}
