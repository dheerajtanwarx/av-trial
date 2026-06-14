import PDFDocument from "pdfkit";
import { orderQrBuffer } from "./qr";

/** The serialized-order shape (subset) the invoice needs — matches the output
    of serializeOrder() in routes/orders.ts. */
export type InvoiceOrder = {
  no: string;
  status: string;
  placedAt: string | Date;
  subtotal: number;
  discount: number;
  shippingFee: number;
  total: number;
  shippingMethod: string | null;
  payment: string | null;
  address: {
    fullName: string;
    phone: string;
    street: string;
    city: string;
    state: string;
    pincode: string;
  } | null;
  items: {
    name: string;
    color: string;
    size: string | null;
    qty: number;
    unitPrice: number;
  }[];
  customer?: { name: string | null; email: string | null } | null;
};

/** pdfkit's built-in fonts have no Rupee glyph, so amounts use "Rs." */
const rs = (n: number) => "Rs. " + Math.round(n).toLocaleString("en-IN");

const fmtDate = (d: string | Date) =>
  new Date(d).toLocaleDateString("en-IN", { day: "numeric", month: "long", year: "numeric" });

const INK = "#2a2320";
const MUTED = "#8a7f78";
const RANI = "#b3375b";
const LINE = "#e7ddd6";

/** Render a tax-invoice PDF for a delivered order and resolve with the bytes. */
export async function buildInvoicePdf(order: InvoiceOrder): Promise<Buffer> {
  // Pack/dispatch QR (encodes the order number) — generated up front so it can
  // be drawn synchronously while the document is built. Best-effort: a QR
  // failure must never block the invoice.
  const qr = await orderQrBuffer(order.no).catch(() => null);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margin: 50 });
    const chunks: Buffer[] = [];
    doc.on("data", (c: Buffer) => chunks.push(c));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const left = doc.page.margins.left;
    const right = doc.page.width - doc.page.margins.right;
    const width = right - left;

    // ── Header ───────────────────────────────────────────────
    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(22)
      .text("AV CREATION", left, 50);
    doc
      .fillColor(RANI)
      .font("Helvetica")
      .fontSize(9)
      .text("HANDCRAFTED IN JAIPUR", left, 76, { characterSpacing: 2 });

    doc
      .fillColor(INK)
      .font("Helvetica-Bold")
      .fontSize(16)
      .text("TAX INVOICE", left, 50, { width, align: "right" });
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(10)
      .text(`Invoice: INV-${order.no}`, left, 74, { width, align: "right" })
      .text(`Order: ${order.no}`, { width, align: "right" })
      .text(`Date: ${fmtDate(order.placedAt)}`, { width, align: "right" });

    // ── Billed-to ────────────────────────────────────────────
    let y = 130;
    doc.moveTo(left, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 16;

    const a = order.address;
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("BILLED TO", left, y, { characterSpacing: 1 });
    doc.fillColor(INK).font("Helvetica-Bold").fontSize(11).text(a?.fullName ?? order.customer?.name ?? "Customer", left, y + 14);
    doc.font("Helvetica").fontSize(10).fillColor(MUTED);
    if (a) {
      doc.text(a.street, left, y + 30, { width: width / 2 });
      doc.text(`${a.city}, ${a.state} - ${a.pincode}`);
      doc.text(`Phone: ${a.phone}`);
    }
    if (order.customer?.email) doc.text(order.customer.email);

    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9).text("PAYMENT", left + width / 2, y, { characterSpacing: 1 });
    doc
      .fillColor(INK)
      .font("Helvetica")
      .fontSize(10)
      .text(order.payment === "COD" ? "Cash on Delivery" : order.payment ?? "—", left + width / 2, y + 14);
    doc.fillColor(MUTED).text(
      order.shippingMethod === "priority" ? "Priority Shipping" : "Standard Shipping",
      left + width / 2,
      y + 28
    );
    doc.text(`Status: ${order.status}`, left + width / 2);

    // ── Pack/dispatch QR (top-right of the billed-to band) ───
    if (qr) {
      const qrSize = 64;
      const qrX = right - qrSize;
      doc.image(qr, qrX, y, { width: qrSize, height: qrSize });
      doc
        .fillColor(MUTED)
        .font("Helvetica")
        .fontSize(7)
        .text("SCAN AT DISPATCH", qrX - 8, y + qrSize + 2, {
          width: qrSize + 16,
          align: "center",
          characterSpacing: 0.5,
        });
    }

    // ── Items table ──────────────────────────────────────────
    y += 90;
    const cols = { item: left, qty: left + width * 0.62, price: left + width * 0.74, total: right };

    doc.fillColor(INK).rect(left, y, width, 24).fill("#faf6f2");
    doc.fillColor(MUTED).font("Helvetica-Bold").fontSize(9);
    doc.text("ITEM", cols.item + 8, y + 8, { characterSpacing: 1 });
    doc.text("QTY", cols.qty, y + 8, { width: width * 0.1, align: "right", characterSpacing: 1 });
    doc.text("PRICE", cols.price, y + 8, { width: width * 0.12, align: "right", characterSpacing: 1 });
    doc.text("TOTAL", cols.item, y + 8, { width: width - 16, align: "right", characterSpacing: 1 });
    y += 24;

    for (const it of order.items) {
      const meta = [it.color, it.size].filter(Boolean).join(" · ");
      const rowH = meta ? 36 : 26;
      if (y + rowH > doc.page.height - 140) {
        doc.addPage();
        y = doc.page.margins.top;
      }
      doc.fillColor(INK).font("Helvetica").fontSize(10).text(it.name, cols.item + 8, y + 6, { width: width * 0.58 });
      if (meta) doc.fillColor(MUTED).fontSize(9).text(meta, cols.item + 8, y + 20, { width: width * 0.58 });
      doc.fillColor(INK).fontSize(10);
      doc.text(String(it.qty), cols.qty, y + 6, { width: width * 0.1, align: "right" });
      doc.text(rs(it.unitPrice), cols.price, y + 6, { width: width * 0.12, align: "right" });
      doc.text(rs(it.unitPrice * it.qty), cols.item, y + 6, { width: width - 16, align: "right" });
      doc.moveTo(left, y + rowH).lineTo(right, y + rowH).strokeColor(LINE).stroke();
      y += rowH;
    }

    // ── Totals ───────────────────────────────────────────────
    y += 14;
    const tLabel = right - 220;
    const tVal = right - 120;
    const line = (label: string, value: string, bold = false, color = INK) => {
      doc.font(bold ? "Helvetica-Bold" : "Helvetica").fontSize(bold ? 12 : 10).fillColor(bold ? INK : MUTED);
      doc.text(label, tLabel, y, { width: 100 });
      doc.fillColor(color).text(value, tVal, y, { width: 120, align: "right" });
      y += bold ? 22 : 18;
    };
    line("Subtotal", rs(order.subtotal));
    if (order.discount > 0) line("Discount", "- " + rs(order.discount), false, "#2e7d52");
    line("Shipping", order.shippingFee === 0 ? "Free" : rs(order.shippingFee));
    doc.moveTo(tLabel, y).lineTo(right, y).strokeColor(LINE).stroke();
    y += 10;
    line("Total", rs(order.total), true);

    // ── Footer ───────────────────────────────────────────────
    const fy = doc.page.height - 90;
    doc.moveTo(left, fy).lineTo(right, fy).strokeColor(LINE).stroke();
    doc
      .fillColor(MUTED)
      .font("Helvetica")
      .fontSize(9)
      .text("Thank you for shopping with AV Creation.", left, fy + 14, { width, align: "center" })
      .text("This is a computer-generated invoice and does not require a signature.", { width, align: "center" });

    doc.end();
  });
}
