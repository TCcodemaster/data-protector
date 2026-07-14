#!/usr/bin/env node
const fs = require("fs");
const path = require("path");
const { loadConfig, isFileConfigured, CONFIG_PATH } = require("./config_manager");

const PLUGIN_ROOT = path.dirname(__dirname);
const FILTER_SCRIPT = path.join(PLUGIN_ROOT, "scripts", "filter.js");
const LAST_FILE_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude",
  "data-protector-last-file.txt"
);
const NODE = process.execPath;

const DATA_EXTENSIONS = new Set([".csv", ".tsv", ".xlsx", ".xls", ".json", ".parquet"]);
const DATA_EXT_RE = /\.(csv|tsv|xlsx|xls|parquet)\b/i;
const SQL_RE = /\b(sqlite3|psql|mysql|duckdb)\b.*\bSELECT\b/i;
const COPY_RE = /\b(cp|ln|mv|copy|symlink)\b/;
const R_RE = /(read\.csv|read\.table|read\.delim|readr::read_csv|readr::read_tsv|data\.table::fread|fread|read_excel|readxl::read_excel|read\.xlsx|openxlsx::read\.xlsx)/;

function isAlreadyFiltered(cmd) {
  return cmd.includes("filter.js") || cmd.includes("filter.py");
}
function hasDataFileRef(text) {
  return DATA_EXT_RE.test(text);
}

function extractDataFilePath(text) {
  const patterns = [
    /['"]([^'"]*\.(csv|tsv|xlsx|xls|json|parquet))['"]/i,
    /(\S+\.(csv|tsv|xlsx|xls|json|parquet))\b/i,
  ];
  for (const p of patterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return null;
}

function resolveFilePath(toolInput, toolName) {
  if (toolName === "Read") return toolInput.file_path || "";
  if (toolName === "Bash") return extractDataFilePath(toolInput.command || "");
  return null;
}

function readHeaders(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  try {
    if (ext === ".csv" || ext === ".tsv") {
      const content = fs.readFileSync(filePath, "utf-8");
      const firstLine = content.split(/\r?\n/)[0];
      const delim = ext === ".tsv" ? "\t" : ",";
      return firstLine.split(delim).map((h) => h.replace(/^"|"$/g, "").trim());
    }
    if (ext === ".xlsx" || ext === ".xls") {
      return readXlsxHeaders(filePath);
    }
    if (ext === ".json") {
      const data = JSON.parse(fs.readFileSync(filePath, "utf-8"));
      if (Array.isArray(data) && data.length && typeof data[0] === "object")
        return Object.keys(data[0]);
      if (typeof data === "object" && data) return Object.keys(data);
    }
  } catch {}
  return [];
}

function readXlsxHeaders(filePath) {
  try {
    const zlib = require("zlib");
    const buf = fs.readFileSync(filePath);
    const entries = parseZip(buf);
    const sheets = {};

    const wbEntry = entries["xl/workbook.xml"];
    if (!wbEntry) return [];
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
      const rowRe = /<row\s[^>]*r="1"[^>]*>([\s\S]*?)<\/row>/;
      const rowMatch = sheetXml.match(rowRe);
      if (!rowMatch) continue;
      const cellRe = /<c\s[^>]*>([\s\S]*?)<\/c>/g;
      const headers = [];
      let cm;
      while ((cm = cellRe.exec(rowMatch[1]))) {
        const typeMatch = cm[0].match(/t="([^"]*)"/);
        const valMatch = cm[1].match(/<v>([\s\S]*?)<\/v>/);
        const inlineMatch = cm[1].match(/<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>[\s\S]*?<\/is>/);
        if (typeMatch && typeMatch[1] === "inlineStr" && inlineMatch) {
          headers.push(inlineMatch[1]);
        } else if (valMatch) {
          if (typeMatch && typeMatch[1] === "s") {
            headers.push(strings[parseInt(valMatch[1])] || "");
          } else {
            headers.push(valMatch[1]);
          }
        }
      }
      sheets[sheetNames[i]] = headers;
    }

    const names = Object.keys(sheets);
    if (names.length === 1) return sheets[names[0]];
    return sheets;
  } catch {
    return [];
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

    if (compSize > 0) {
      entries[name] = buf.slice(dataStart, dataStart + compSize);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return entries;
}

function saveLastFile(filePath) {
  if (!filePath) return;
  try {
    const abs = path.resolve(filePath);
    const dir = path.dirname(LAST_FILE_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(LAST_FILE_PATH, abs, "utf-8");
  } catch {}
}

function filterCmd(filePath) {
  return `"${NODE}" "${FILTER_SCRIPT}" "${filePath}"`;
}

function filterCmdStdin(prefix, fmt) {
  return `${prefix} | "${NODE}" "${FILTER_SCRIPT}" --stdin --format ${fmt}`;
}

function getUnconfiguredHint(filePath) {
  if (!filePath || isFileConfigured(filePath)) return "";
  const headers = readHeaders(filePath);
  if (!headers || (Array.isArray(headers) && !headers.length)) return "";

  let colInfo;
  if (typeof headers === "object" && !Array.isArray(headers)) {
    const parts = Object.entries(headers).map(
      ([sheet, cols]) => `  [${sheet}]: ${cols.join(", ")}`
    );
    colInfo = "各 sheet 欄位：\n" + parts.join("\n");
  } else {
    colInfo = `欄位清單：${headers.join(", ")}`;
  }
  return (
    `此檔案尚未設定保護欄位，預設全部遮蔽。\n${colInfo}\n` +
    "After showing the filtered output, tell the user they can use " +
    "/protect allow <columns> or /protect block <columns> to configure which columns to reveal or hide."
  );
}

function blockWithFilter(reason, cmd, extraInfo, filePath) {
  saveLastFile(filePath);
  let msg =
    `DATA PROTECTOR: ${reason}\n` +
    `You MUST immediately run this filtered command instead — do not ask the user, just run it:\n\n` +
    `${cmd}\n\n` +
    `Protected columns will show as [PROTECTED]. ` +
    `Do NOT attempt any other way to read this data. ` +
    `Do NOT write a script file to bypass this filter. ` +
    `Do NOT try alternative commands. ONLY use the command above.`;
  if (extraInfo) msg += `\n\n${extraInfo}`;
  console.log(JSON.stringify({ systemMessage: msg }));
  process.stderr.write(reason + "\n");
  process.exit(2);
}

function isDataReadTool(toolName, toolInput) {
  if (toolName === "Read") {
    const ext = path.extname(toolInput.file_path || "").toLowerCase();
    return DATA_EXTENSIONS.has(ext);
  }
  if (toolName === "Bash") {
    const cmd = (toolInput.command || "").trim();
    if (!cmd) return false;
    if (isAlreadyFiltered(cmd) || cmd.includes("__dp_header_read__")) return false;
    if (hasDataFileRef(cmd)) return true;
    if (SQL_RE.test(cmd)) return true;
  }
  if (toolName.startsWith("mcp__r-studio__execute_r")) {
    return R_RE.test(toolInput.code || "");
  }
  return false;
}

function handleConfigured(toolName, toolInput, config) {
  if (toolName === "Read") {
    const filePath = toolInput.file_path || "";
    blockWithFilter(
      `Blocked direct Read on '${path.basename(filePath)}'.`,
      filterCmd(filePath),
      getUnconfiguredHint(filePath),
      filePath
    );
  } else if (toolName === "Bash") {
    const command = toolInput.command || "";
    const filePath = extractDataFilePath(command);

    if (COPY_RE.test(command) && hasDataFileRef(command)) {
      blockWithFilter(
        "Blocked copy/link/move of protected data file. Do NOT duplicate data files to bypass protection.",
        filePath ? filterCmd(filePath) : "# no bypass",
        "",
        filePath
      );
    } else if (SQL_RE.test(command)) {
      blockWithFilter("Blocked unfiltered SQL query.", filterCmdStdin(command, "sql"));
    } else if (filePath) {
      blockWithFilter(
        `Blocked unfiltered access to '${path.basename(filePath)}'.`,
        filterCmd(filePath),
        getUnconfiguredHint(filePath),
        filePath
      );
    }
  } else if (toolName.startsWith("mcp__r-studio__execute_r")) {
    const columns = config.columns || [];
    const mode = config.mode || "block";
    const colsR = columns.map((c) => `"${c}"`).join(", ");
    let maskFn;
    if (mode === "block") {
      maskFn =
        `.dp_cols <- c(${colsR})\n` +
        '.dp_mask <- function(df) { for(col in .dp_cols) { if(col %in% names(df)) df[[col]] <- "[PROTECTED]" }; df }';
    } else {
      maskFn =
        `.dp_allow <- c(${colsR})\n` +
        '.dp_mask <- function(df) { for(col in names(df)) { if(!(col %in% .dp_allow)) df[[col]] <- "[PROTECTED]" }; df }';
    }
    console.log(
      JSON.stringify({
        systemMessage:
          "DATA PROTECTOR: R code reads data with protected columns.\n" +
          `Add this and wrap output with .dp_mask(df):\n\n${maskFn}`,
      })
    );
  }
}

function main() {
  let input = "";
  process.stdin.setEncoding("utf-8");
  process.stdin.on("data", (chunk) => (input += chunk));
  process.stdin.on("end", () => {
    let data;
    try {
      data = JSON.parse(input);
    } catch {
      process.exit(0);
    }

    const toolName = data.tool_name || "";
    const toolInput = data.tool_input || {};

    if (!isDataReadTool(toolName, toolInput)) process.exit(0);

    const filePath = resolveFilePath(toolInput, toolName);
    const config = loadConfig(filePath || undefined);
    handleConfigured(toolName, toolInput, config);
    process.exit(0);
  });
}

main();
