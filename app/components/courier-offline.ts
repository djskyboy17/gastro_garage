"use client";
import type { CourierTasks } from "@/src/modules/courier/domain";

/**
 * Futár offline (v98): a nap feladatai és a bejelentkezés a telefonon tárolódnak; térerő nélkül a műveletek
 * (indulás, kézbesítés, sikertelen kézbesítés, beszedett összeg) sorba kerülnek, és netkapcsolatkor sorrendben elmennek.
 * Minden művelet saját requestId-vel megy, így az ismételt küldés nem rögzül kétszer.
 */
export type QueuedAction = { requestId: string; orderId: string; revision: number; value: string; note: string; payment?: { method: string; amount: number } | null };
const QUEUE = "gg-courier-queue";
const cacheKey = (date: string) => "gg-courier-day:" + date;

const read = <T,>(key: string, fallback: T): T => {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
};
const write = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* tele a tárhely vagy privát mód – ilyenkor offline mód nélkül működik */
  }
};

export const queued = (): QueuedAction[] => read<QueuedAction[]>(QUEUE, []);
export function enqueue(action: QueuedAction) {
  const q = queued().filter((a) => a.requestId !== action.requestId);
  write(QUEUE, [...q, action]);
}
export const saveDay = (date: string, session: unknown, data: CourierTasks) => write(cacheKey(date), { session, data, at: new Date().toISOString() });
export const loadDay = (date: string) => read<{ session: unknown; data: CourierTasks; at: string } | null>(cacheKey(date), null);

/** A sorban álló műveletek hatása a tárolt napra (a futár azonnal látja, amit megnyomott). */
export function applyQueued(data: CourierTasks): CourierTasks {
  const q = queued();
  if (!q.length) return data;
  let cash = data.cashOnHand;
  const tasks = data.tasks.map((task) => {
    let t = task;
    for (const a of q.filter((x) => x.orderId === task.id)) {
      // A szerver minden állapotváltásnál eggyel növeli a változatszámot; a következő offline művelet már ehhez igazodik.
      t = { ...t, delivery: a.value, revision: a.revision + 1 };
      if (a.value === "delivered" && a.payment && a.payment.amount > 0) {
        t = { ...t, due: Math.max(0, t.due - a.payment.amount) };
        if (a.payment.method === "cash") cash += a.payment.amount;
      }
    }
    return t;
  });
  return { ...data, tasks, cashOnHand: cash };
}

/** A sor elküldése sorrendben. Hálózati hibánál megáll (később újra); szerverhibánál a műveletet elveti és jelzi. */
export async function flushQueue(): Promise<{ sent: number; rejected: { orderId: string; code: string }[]; offline: boolean }> {
  const rejected: { orderId: string; code: string }[] = [];
  let sent = 0;
  for (const action of queued()) {
    let res: Response;
    try {
      res = await fetch("/api/courier/state", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(action) });
    } catch {
      return { sent, rejected, offline: true };
    }
    if (res.status === 401) return { sent, rejected, offline: true };
    if (!res.ok) {
      const v = (await res.json().catch(() => ({}))) as { error?: string };
      rejected.push({ orderId: action.orderId, code: v.error ?? "saveError" });
    } else sent++;
    write(QUEUE, queued().filter((a) => a.requestId !== action.requestId));
  }
  return { sent, rejected, offline: false };
}
