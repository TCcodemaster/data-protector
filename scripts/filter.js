#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { loadConfig, getProtectedIndices, isProtected } = require("./config_manager");

const MASK = "[PROTECTED]";

function detectDelimiter(line) {
  for (const d of ["\t", ",", "|", ";"]) {
    if (line.includes(d)) return d;
  }
  return ",";
}

function parseCsvLine(line, delim) {
  const result = [];
  let current = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delim && !inQuotes) {
      result.push(current);
      current = "";
    } else {
      current += ch;
    }
  }
  result.push(current);
  return result;
}

function filterCsv(text, config, delimiter) {
  const lines = text.trim().split(/\r?\n/);
  if (!lines.length) return text;
  if (!delimiter) delimiter = detectDelimiter(lines[0]);

  const headers = parseCsvLine(lines[0], delimiter);
  const protectedIdx = getProtectedIndices(headers, config);
  if (!protectedIdx.length) return text;

  const result = [lines[0]];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const fields = parseCsvLine(lines[i], delimiter);
    for (const idx of protectedIdx) {
      if (idx < fields.length) fields[idx] = MASK;
    }
    result.push(fields.map((f) => (f.includes(delimiter) || f.includes('"') ? `"${f.replace(/"/g, '""')}"` : f)).join(delimiter));
  }
  return result.join("\n") + "\n";
}

function filterJson(text, config) {
  try {
    const data = JSON.parse(text);
    if (Array.isArray(data) && data.length && typeof data[0] === "object") {
      for (const record of data) {
        for (const key of Object.keys(record)) {
          if (isProtected(key, config)) record[key] = MASK;
        }
      }
      return JSON.stringify(data, null, 2);
    }
    if (typeof data === "object" && data) {
      for (const key of Object.keys(data)) {
        if (isProtected(key, config)) data[key] = MASK;
      }
      return JSON.stringify(data, null, 2);
    }
  } catch {}
  return text;
}

function filterSqlOutput(text, config) {
  const lines = text.split("\n");
  if (lines.length < 2) return text;

  let headerLine = null;
  let separatorLine = null;

  for (let i = 0; i < lines.length; i++) {
    if (/^[\s|]*-+[\s|+-]*-+/.test(lines[i])) {
      separatorLine = i;
      if (i > 0) headerLine = i - 1;
      break;
    }
  }
  if (headerLine === null) return text;

  const headerText = lines[headerLine];
  let headers, delim;
  if (headerText.includes("|")) {
    headers = headerText.split("|").map((h) => h.trim()).filter(Boolean);
    delim = "|";
  } else {
    headers = headerText.trim().split(/\s+/);
    delim = null;
  }

  const protectedIdx = getProtectedIndices(headers, config);
  if (!protectedIdx.length) return text;

  const dataStart = separatorLine !== null ? separatorLine + 1 : headerLine + 1;
  const result = [];

  for (let i = 0; i < lines.length; i++) {
    if (i <= headerLine || (separatorLine !== null && i === separatorLine)) {
      result.push(lines[i]);
    } else if (i >= dataStart && lines[i].trim() && !/^\s*\+/.test(lines[i]) && !/^\s*\(?\d+ rows?\)?/.test(lines[i])) {
      if (delim === "|") {
        const parts = lines[i].split("|");
        const realParts = [];
        let prefix = "", suffix = "";
        for (let j = 0; j < parts.length; j++) {
          if (j === 0 && !parts[j].trim()) { prefix = parts[j]; continue; }
          if (j === parts.length - 1 && !parts[j].trim()) { suffix = parts[j]; continue; }
          realParts.push(parts[j]);
        }
        for (const idx of protectedIdx) {
          if (idx < realParts.length) {
            const w = realParts[idx].length;
            realParts[idx] = w > MASK.length ? MASK.padStart((w + MASK.length) / 2).padEnd(w) : MASK;
          }
        }
        result.push(prefix + realParts.join("|") + suffix);
      } else {
        result.push(lines[i]);
      }
    } else {
      result.push(lines[i]);
    }
  }
  return result.join("\n");
}

function filterXlsx(filePath, config) {
  const zlib = require("zlib");
  const buf = fs.readFileSync(filePath);
  const entries = parseZip(buf);

  const wbEntry = entries["xl/workbook.xml"];
  if (!wbEntry) { console.log("[DATA PROTECTOR] Cannot parse xlsx"); return; }
  const wbXml = zlib.inflateRawSync(wbEntry).toString("utf-8");
  const sheetNames = [];
  const sheetRe = /<sheet\s[^>]*name="([^"]*)"[^>]*\/>/g;
  let m;
  while ((m = sheetRe.exec(wbXml))) sheetNames.push(m[1]);

  const ssEntry = entries["xl/sharedStrings.xml"];
  const strings = [];
  if (ssEntry) {
    const ssXml = zlib.inflateRawSync(ssEntry).toString("utf-8");
    const siRe = /<si>([\s\S]*?)<\/si>/g;
    let sm;
    while ((sm = siRe.exec(ssXml))) {
      const tRe = /<t[^>]*>([\s\S]*?)<\/t>/g;
      let parts = [];
      let tm;
      while ((tm = tRe.exec(sm[1]))) parts.push(tm[1]);
      strings.push(parts.join(""));
    }
  }

  for (let i = 0; i < sheetNames.length; i++) {
    const sheetFile = entries[`xl/worksheets/sheet${i + 1}.xml`];
    if (!sheetFile) continue;
    const sheetXml = zlib.inflateRawSync(sheetFile).toString("utf-8");

    const rows = [];
    const rowRe = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
    let rm;
    while ((rm = rowRe.exec(sheetXml))) {
      const cells = [];
      const cellRe = /<c\s([^>]*)>([\s\S]*?)<\/c>|<c\s([^>]*)\/>/g;
      let cm;
      while ((cm = cellRe.exec(rm[1]))) {
        const attrs = cm[1] || cm[3] || "";
        const inner = cm[2] || "";
        const typeMatch = attrs.match(/t="([^"]*)"/);
        const valMatch = inner.match(/<v>([\s\S]*?)<\/v>/);
        const inlineMatch = inner.match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
        if (typeMatch && typeMatch[1] === "inlineStr" && inlineMatch) {
          cells.push(inlineMatch[1]);
        } else if (valMatch) {
          if (typeMatch && typeMatch[1] === "s") {
            cells.push(strings[parseInt(valMatch[1])] || "");
          } else {
            cells.push(valMatch[1]);
          }
        } else {
          cells.push("");
        }
      }
      rows.push(cells);
    }

    if (!rows.length) continue;
    const headers = rows[0];
    const protectedIdx = getProtectedIndices(headers, config);

    console.log(`=== Sheet: ${sheetNames[i]} (${rows.length - 1} rows x ${headers.length} cols) ===`);
    console.log(headers.join("\t"));
    for (let r = 1; r < rows.length; r++) {
      const vals = rows[r].map((v, ci) => (protectedIdx.includes(ci) ? MASK : v));
      console.log(vals.join("\t"));
    }
    console.log();
  }
}

function parseZip(buf) {
  const entries = {};
  let pos = buf.length - 22;
  while (pos >= 0 && buf.readUInt32LE(pos) !== 0x06054b50) pos--;
  if (pos < 0) return entries;
  const cdOffset = buf.readUInt32LE(pos + 16);
  let p = cdOffset;
  while (p < pos && buf.readUInt32LE(p) === 0x02014b50) {
    const compSize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const localOffset = buf.readUInt32LE(p + 42);
    const name = buf.toString("utf-8", p + 46, p + 46 + nameLen);
    const lp = localOffset;
    const lNameLen = buf.readUInt16LE(lp + 26);
    const lExtraLen = buf.readUInt16LE(lp + 28);
    const dataStart = lp + 30 + lNameLen + lExtraLen;
    if (compSize > 0) entries[name] = buf.slice(dataStart, dataStart + compSize);
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function filterFile(filePath, config) {
  const ext = path.extname(filePath).toLowerCase();
  if (ext === ".xlsx" || ext === ".xls") {
    filterXlsx(filePath, config);
    return;
  }
  if (ext === ".parquet") {
    console.error("[DATA PROTECTOR] Parquet not supported directly.");
    process.exit(1);
  }
  const content = fs.readFileSync(filePath, "utf-8");
  if (ext === ".json") console.log(filterJson(content, config));
  else if (ext === ".csv") console.log(filterCsv(content, config, ","));
  else if (ext === ".tsv") console.log(filterCsv(content, config, "\t"));
  else console.log(filterCsv(content, config));
}

function filterStdin(config, fmt) {
  let input = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    if (!input.trim()) { process.stdout.write(input); return; }
    if (fmt === "sql") console.log(filterSqlOutput(input, config));
    else if (fmt === "json") console.log(filterJson(input, config));
    else {
      try { JSON.parse(input); console.log(filterJson(input, config)); return; } catch {}
      if (/^[\s|]*-+[\s|+-]*-+/m.test(input)) console.log(filterSqlOutput(input, config));
      else console.log(filterCsv(input, config));
    }
  });
}

function main() {
  let filePath = null;
  const args = process.argv.slice(2);

  for (let i = 0; i < args.length; i++) {
    if (args[i] !== "--stdin" && args[i] !== "--format") {
      filePath = args[i];
      break;
    }
    if (args[i] === "--format") i++;
  }

  const config = loadConfig(filePath || undefined);

  if (args.includes("--stdin")) {
    let fmt = null;
    const fmtIdx = args.indexOf("--format");
    if (fmtIdx >= 0 && fmtIdx + 1 < args.length) fmt = args[fmtIdx + 1];
    filterStdin(config, fmt);
  } else if (filePath) {
    filterFile(filePath, config);
  } else {
    console.error("Usage: filter.js <file_path> | filter.js --stdin [--format sql|json]");
    process.exit(1);
  }
}

main();
