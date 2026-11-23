"use client";

import QRCode from "qrcode";
import { useEffect, useState } from "react";

/** QR code drawn locally (no network) as a PNG data URL. Always dark on white so any camera reads it. */
export function QrCode({ value, label }: { value: string; label: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    QRCode.toDataURL(value, { margin: 0, width: 360, errorCorrectionLevel: "M", color: { dark: "#152709", light: "#ffffff" } })
      .then((url) => live && setSrc(url))
      .catch(() => live && setSrc(null));
    return () => {
      live = false;
    };
  }, [value]);
  return (
    <div className="qr">
      {src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt={label} width={180} height={180} />
      ) : (
        <div style={{ aspectRatio: "1", background: "#eef7e0", borderRadius: 12 }} />
      )}
    </div>
  );
}
