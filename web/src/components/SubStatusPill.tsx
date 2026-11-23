import type { Subscription } from "@/lib/api";

export function SubStatusPill({ s }: { s: Subscription }) {
  if (s.status === "active" && s.pastDue) return <span className="pill wait">Payment due</span>;
  if (s.status === "active") return <span className="pill ok">Active</span>;
  if (s.status === "lapsed") return <span className="pill bad">Lapsed</span>;
  if (s.status === "completed") return <span className="pill ok">Completed</span>;
  return <span className="pill bad">Cancelled</span>;
}
