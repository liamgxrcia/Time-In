/** Browser decoding only. The API performs authoritative row validation and deduplication. */
export function csvHeaders(csv: string): string[] {
  const headers: string[] = []; let field = "", quoted = false, closed = false;
  for (let i=0; i<csv.length; i++) {
    const c=csv[i];
    if (quoted) { if (c === '"') { if (csv[i+1] === '"') { field+='"'; i++; } else { quoted=false; closed=true; } } else field+=c; }
    else if (c === ',' || c === '\n' || c === '\r') { headers.push(field.trim()); field=""; closed=false; if (c !== ',') return validate(headers); }
    else if (c === '"' && !field && !closed) quoted=true;
    else { if (closed || c === '"') throw new Error("Malformed CSV header."); field+=c; }
  }
  if (quoted) throw new Error("Unclosed CSV header quote.");
  headers.push(field.trim()); return validate(headers);
}
function validate(headers: string[]) {
  if (headers.some(h => !h) || new Set(headers.map(h => h.toLowerCase())).size !== headers.length) throw new Error("CSV headers must be nonempty and unique.");
  return headers;
}
export async function readImportFile(file: File) {
  if (file.size > 1_048_576) throw new Error("Choose a CSV of at most 1 MiB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const encoding = bytes[0] === 255 && bytes[1] === 254 ? "utf-16le" : bytes[0] === 254 && bytes[1] === 255 ? "utf-16be" : "utf-8";
  let csv: string;
  try { csv = new TextDecoder(encoding,{ fatal:true }).decode(bytes).replace(/^\uFEFF/,""); } catch { throw new Error("The file must be valid UTF-8 or BOM-marked UTF-16 CSV."); }
  if (csv.includes("\0")) throw new Error("The CSV contains unsupported null characters.");
  return { csv, headers: csvHeaders(csv) };
}
