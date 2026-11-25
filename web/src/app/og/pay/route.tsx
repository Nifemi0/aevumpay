import { ImageResponse } from "next/og";

/** The link-preview card for a pay link: "@kemi is requesting $5.00", in AevumPay's look. */
const LOOP = "M12 12c-3.2-4.2-9.4-4.2-9.4 0s6.2 4.2 9.4 0 9.4-4.2 9.4 0-6.2 4.2-9.4 0z";
const INK = "#152709";
const LIME = "#b8e77f";

export async function GET(request: Request) {
  const q = new URL(request.url).searchParams;
  const user = (q.get("u") ?? "").toLowerCase().replace(/[^a-z0-9_.]/g, "").slice(0, 24) || "someone";
  const a = q.get("a") ?? "";
  const amount = /^\d+(\.\d{1,6})?$/.test(a) ? `$${Number(a).toFixed(2)}` : "";
  const note = (q.get("n") ?? "").slice(0, 60);
  const status = q.get("s") ?? "open";
  const closed = status === "paid" ? "PAID" : status === "expired" ? "EXPIRED" : status === "cancelled" ? "CANCELLED" : "";

  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", flexDirection: "column", background: LIME, color: INK, padding: 64, fontFamily: "sans-serif" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div style={{ width: 64, height: 64, borderRadius: 18, background: INK, display: "flex", alignItems: "center", justifyContent: "center" }}>
            <svg width="44" height="44" viewBox="0 0 24 24" fill="none" stroke={LIME} strokeWidth="2.6" strokeLinecap="round">
              <path d={LOOP} />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>AevumPay</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", marginTop: 70, gap: 8 }}>
          <div style={{ fontSize: 44, opacity: 0.8 }}>{amount ? `@${user} is requesting` : `Pay @${user}`}</div>
          <div style={{ display: "flex", alignItems: "center", gap: 28 }}>
            <div style={{ fontSize: amount ? 150 : 96, fontWeight: 800, letterSpacing: -4, lineHeight: 1 }}>{amount || "by @name"}</div>
            {closed && (
              <div style={{ fontSize: 40, fontWeight: 800, color: closed === "PAID" ? "#1d6b2a" : "#9a2b1d", border: "6px solid currentColor", borderRadius: 16, padding: "6px 18px", transform: "rotate(-8deg)" }}>
                {closed}
              </div>
            )}
          </div>
          {note && <div style={{ display: "flex", fontSize: 40, marginTop: 14, opacity: 0.85 }}>{`for ${note}`}</div>}
        </div>

        <div style={{ display: "flex", marginTop: "auto", justifyContent: "space-between", fontSize: 28, opacity: 0.75 }}>
          <div>No fees · no wallet address · settles in about a second</div>
          <div>QDay Aevum</div>
        </div>
      </div>
    ),
    { width: 1200, height: 630, headers: { "Cache-Control": "public, max-age=300, s-maxage=86400" } },
  );
}
