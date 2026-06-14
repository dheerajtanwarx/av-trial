import QRCode from "qrcode";

/* ============================================================
   QR codes for internal pack/dispatch handling
   ------------------------------------------------------------
   The QR encodes ONLY the human order number (e.g. "AVC-000024").
   It is a dumb pointer, never a credential: the admin scan page
   resolves it and every admin route stays behind requireAdmin.
   Knowing an order number grants no access on its own.
   ============================================================ */

/** Render the order number as a PNG data URL (embeddable in <img> or a PDF). */
export function orderQrDataUrl(orderNo: string): Promise<string> {
  return QRCode.toDataURL(orderNo, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });
}

/** Render the order number as a raw PNG buffer (for pdfkit image embedding). */
export function orderQrBuffer(orderNo: string): Promise<Buffer> {
  return QRCode.toBuffer(orderNo, {
    errorCorrectionLevel: "M",
    margin: 1,
    width: 240,
  });
}
