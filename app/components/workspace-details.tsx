import { ChevronDown } from "lucide-react";
import type { ReactNode } from "react";

export default function WorkspaceDetails({ title, hint, attention = false, children }: { title: string; hint?: string; attention?: boolean; children: ReactNode }) {
  return <details className={"workspace-details" + (attention ? " needs-attention" : "")} open={attention || undefined}>
    <summary><span><strong>{title}</strong>{hint && <small>{hint}</small>}</span><ChevronDown size={18} aria-hidden="true" /></summary>
    <div className="workspace-details-body">{children}</div>
  </details>;
}
