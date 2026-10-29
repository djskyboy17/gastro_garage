"use client";
import { Check, AlertCircle } from "lucide-react";
import { orderProgress, type PortalOrder } from "@/src/modules/portal/domain";

/** Az ügyfél rendelésének élő állapota lépéssorként (beérkezett → … → kézbesítve / átvéve). */
export function OrderTracker({ order, t }: { order: PortalOrder; t: (key: string) => string }) {
  const progress = orderProgress(order);
  if (progress.closed) return null;
  return (
    <div className="order-tracker" aria-label={t("progressTitle")}>
      <ol>
        {progress.steps.map((step) => (
          <li key={step.key} className={"order-step " + step.state} aria-current={step.state === "current" ? "step" : undefined}>
            <span className="order-step-dot">{step.state === "done" ? <Check size={12} /> : null}</span>
            <span className="order-step-label">{t(step.key)}</span>
          </li>
        ))}
      </ol>
      {progress.failed && (
        <p className="order-tracker-failed" role="status">
          <AlertCircle size={15} />
          {t("progressFailed")}
        </p>
      )}
    </div>
  );
}
