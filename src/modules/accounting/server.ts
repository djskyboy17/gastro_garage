import { env } from "cloudflare:workers";
import { z } from "zod";
import { isAdmin, type Session } from "../access/domain";
import { today } from "../shared/domain";
import type { AccountingProfile, AccountingView } from "./domain";
import { accountingReport } from "./reports";
import { validDay } from "../menu/domain";

export class AccountingError extends Error {
  constructor(public code: string, public status = 400) { super(code); }
}

export async function accountingView(): Promise<AccountingView> {
  const [profile, settings] = await env.DB!.batch([
    env.DB!.prepare("SELECT tax_status AS taxStatus,exemption_note AS exemptionNote,applied_on AS appliedOn,revision FROM accounting_profile WHERE id=1"),
    env.DB!.prepare("SELECT COALESCE((SELECT cost_basis FROM purchase_settings WHERE id=1),'gross') AS costBasis,COALESCE((SELECT handover_enabled FROM production_settings WHERE id=1),0) AS handoverEnabled,COALESCE((SELECT all_deliveries FROM delivery_note_settings WHERE id=1),0) AS allDeliveries"),
  ]);
  const row = settings.results[0] as { costBasis: string; handoverEnabled: number; allDeliveries: number };
  return { profile: (profile.results[0] as AccountingProfile | undefined) ?? null,
    settings: { costBasis: row.costBasis, handoverEnabled: !!row.handoverEnabled, allDeliveries: !!row.allDeliveries } };
}

export async function handleAccounting(path: string, body: unknown, session: Session, write: boolean, req: Request) {
  if (!isAdmin(session.role)) throw new AccountingError("FORBIDDEN", 403);
  const json = (value: unknown, status = 200) => Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
  if (!write && path === "/api/accounting") return json(await accountingView());
  if (!write && path === "/api/accounting/report") {
    const params = new URL(req.url).searchParams;
    const kind = z.enum(["week", "month"]).parse(params.get("kind"));
    const value = z.string().max(10).parse(params.get("value"));
    const day = kind === "week" ? value : value + "-01";
    if (!/^[2-9]\d{3}-/.test(day) || day.slice(0, 4) > "9998" || !validDay(day)) throw new AccountingError("ACCOUNTING_REPORT_DATE");
    try { return await accountingReport(kind, value); }
    catch (e) {
      if (e instanceof Error && ["ACCOUNTING_REPORT_TOO_LARGE", "ACCOUNTING_DOCUMENT_FORMAT"].includes(e.message)) throw new AccountingError(e.message, 422);
      throw e;
    }
  }
  if (!write || path !== "/api/accounting/profile") return json({ error: "NOT_FOUND" }, 404);
  const data = z.object({ revision: z.number().int().min(0), exemptionNote: z.string().trim().max(500) }).strict().parse(body);
  const now = new Date().toISOString();
  const DB = env.DB!;
  try {
    await DB.batch([
      DB.prepare("INSERT INTO audit (id,actor,action,entity,detail,created_at) VALUES (?,CASE WHEN COALESCE((SELECT revision FROM accounting_profile WHERE id=1),0)=? THEN ? ELSE NULL END,'accounting_profile_applied','accounting_profile',?,?)")
        .bind(crypto.randomUUID(), data.revision, session.userId, JSON.stringify({ taxStatus: "non_vat_payer", exemptionNote: data.exemptionNote, costBasis: "gross", handoverEnabled: true, avizForCompanies: true }), now),
      DB.prepare("INSERT INTO purchase_settings (id,cost_basis,revision) VALUES (1,'gross',1) ON CONFLICT(id) DO UPDATE SET cost_basis='gross',revision=purchase_settings.revision+1"),
      DB.prepare("INSERT INTO production_settings (id,handover_enabled,revision) VALUES (1,1,1) ON CONFLICT(id) DO UPDATE SET handover_enabled=1,revision=production_settings.revision+1"),
      DB.prepare("INSERT INTO accounting_profile (id,tax_status,exemption_note,applied_on,revision,updated_by,updated_at) VALUES (1,'non_vat_payer',?,?,1,?,?) ON CONFLICT(id) DO UPDATE SET exemption_note=excluded.exemption_note,revision=accounting_profile.revision+1,updated_by=excluded.updated_by,updated_at=excluded.updated_at")
        .bind(data.exemptionNote, today(), session.userId, now),
    ]);
  } catch (e) {
    if (/NOT NULL|UNIQUE/i.test(String(e))) throw new AccountingError("CONFLICT", 409);
    throw e;
  }
  return json(await accountingView());
}
