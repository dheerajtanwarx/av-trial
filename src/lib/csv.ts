import { Response } from "express";

type Cell = string | number | null | undefined;

/** Escape a single CSV cell: quote it when it contains a comma, quote or
    newline, doubling any embedded quotes (RFC 4180). */
function escapeCell(v: Cell): string {
  const s = v == null ? "" : String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** Build a CSV document (CRLF line endings) from a header row + data rows. */
export function toCsv(headers: string[], rows: Cell[][]): string {
  const lines = [headers, ...rows].map((row) => row.map(escapeCell).join(","));
  return lines.join("\r\n");
}

/** Send a CSV string as a downloadable attachment. A UTF-8 BOM is prepended so
    Excel renders ₹ and other non-ASCII characters correctly. */
export function sendCsv(res: Response, filename: string, csv: string): void {
  const safe = filename.replace(/[^a-zA-Z0-9_-]/g, "-");
  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", `attachment; filename="${safe}.csv"`);
  res.send("﻿" + csv);
}
