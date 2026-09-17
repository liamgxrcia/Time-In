import type { Snapshot, ImportPreview, ImportRow } from "@/contracts/crm";
import { ApiError } from "./errors";
export function parseCSV(csv: string): { headers: string[]; rows: string[][] } {
  if (Buffer.byteLength(csv) > 1024 * 1024)
    throw new ApiError("IMPORT_INVALID");
  const text = csv.replace(/^\uFEFF/, "");
  let row: string[] = [],
    field = "",
    quoted = false,
    closed = false;
  const rows: string[][] = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
          closed = true;
        }
      } else field += c;
    } else if (c === ",") {
      row.push(field);
      field = "";
      closed = false;
    } else if (c === "\r" || c === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
      closed = false;
      if (c === "\r" && text[i + 1] === "\n") i++;
    } else if (c === '"') {
      if (field || closed) throw new ApiError("IMPORT_INVALID");
      quoted = true;
    } else {
      if (closed) throw new ApiError("IMPORT_INVALID");
      field += c;
    }
  }
  if (quoted) throw new ApiError("IMPORT_INVALID");
  if (row.length || field || closed) {
    row.push(field);
    rows.push(row);
  }
  const headers = rows.shift()?.map((x) => x.trim());
  if (
    !headers?.length ||
    headers.some((x) => !x) ||
    new Set(headers.map((x) => x.toLowerCase())).size !== headers.length
  )
    throw new ApiError("IMPORT_INVALID");
  const body = rows.filter((r) => r.some(Boolean));
  if (body.length > 1000 || body.some((r) => r.length !== headers.length))
    throw new ApiError("IMPORT_INVALID");
  return { headers, rows: body };
}
export const normalizeEmail = (value: string) => value.trim().toLowerCase();
export function normalizePhone(value: string) {
  const trimmed = value.trim();
  return /^[+\d ().-]+$/.test(trimmed)
    ? (trimmed.startsWith("+") ? "+" : "") + trimmed.replace(/\D/g, "")
    : trimmed;
}
export function previewImport(
  csv: string,
  mapping: { name: string; email?: string; phone?: string },
  db: Snapshot,
): ImportPreview {
  const table = parseCSV(csv);
  const ni = table.headers.indexOf(mapping.name),
    ei = mapping.email ? table.headers.indexOf(mapping.email) : -1,
    pi = mapping.phone ? table.headers.indexOf(mapping.phone) : -1;
  if (
    new Set(Object.values(mapping)).size !== Object.values(mapping).length ||
    ni < 0 ||
    (mapping.email && ei < 0) ||
    (mapping.phone && pi < 0)
  )
    throw new ApiError("IMPORT_INVALID");
  const names = new Map<string, Set<string>>(),
    emails = new Map<string, Set<string>>(),
    phones = new Map<string, Set<string>>();
  function index(map: Map<string, Set<string>>, key: string, id: string) {
    if (!key) return;
    const values = map.get(key) ?? new Set();
    values.add(id);
    map.set(key, values);
  }
  for (const p of db.people.filter((p) => !p.archivedAt && !p.mergedInto)) {
    index(names, p.name.toLowerCase(), p.id);
    p.emails.forEach((e) => index(emails, normalizeEmail(e), p.id));
    p.phones.forEach((pn) =>
      index(phones, normalizePhone(pn).replace(/\D/g, ""), p.id),
    );
  }
  const rows: ImportRow[] = table.rows.map((values, i) => {
    const name = values[ni].trim(),
      email = ei >= 0 ? normalizeEmail(values[ei]) : "",
      phone = pi >= 0 ? normalizePhone(values[pi]) : "";
    const errors: string[] = [];
    if (!name || name.length > 200)
      errors.push("Name is required and must be 200 characters or fewer");
    if (
      email &&
      (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    )
      errors.push("Email format needs review");
    if (
      phone &&
      (!/^[+\d ().-]+$/.test(phone) ||
        phone.replace(/\D/g, "").length < 7 ||
        phone.length > 40)
    )
      errors.push("Phone format needs review");
    const matches = new Map<string, string[]>();
    for (const [map, key, reason] of [
      [names, name.toLowerCase(), "Matching name"],
      [emails, email, "Exact normalized email"],
      [phones, phone.replace(/\D/g, ""), "Exact normalized phone"],
    ] as const) {
      for (const id of map.get(key) ?? []) {
        const reasons = matches.get(id) ?? [];
        reasons.push(reason);
        matches.set(id, reasons);
      }
    }
    const duplicates = [...matches]
      .map(([id, reasons]) => ({
        id,
        reasons,
        confidence: reasons.some((r) => r.startsWith("Exact")) ? 0.98 : 0.65,
      }))
      .sort((a, b) => b.confidence - a.confidence || a.id.localeCompare(b.id));
    if (!errors.length) {
      const id = `row:${i + 2}`;
      index(names, name.toLowerCase(), id);
      index(emails, email, id);
      index(phones, phone.replace(/\D/g, ""), id);
    }
    return { row: i + 2, name, email, phone, errors, duplicates };
  });
  return {
    rows,
    validCount: rows.filter((x) => !x.errors.length).length,
    duplicateCount: rows.filter((x) => x.duplicates.length).length,
  };
}
