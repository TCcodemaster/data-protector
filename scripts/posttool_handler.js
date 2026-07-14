#!/usr/bin/env node
const path = require("path");
const { loadConfig } = require("./config_manager");

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
    const toolOutput = (data.tool_result || data.tool_output || "").toString();

    if (!toolOutput || toolOutput.length < 10) process.exit(0);

    const config = loadConfig();
    const columns = config.columns || [];
    if (!columns.length && config.mode === "block") process.exit(0);

    const leaked = findLeakedColumns(toolOutput, config);
    const tabularLeak = detectUnfilteredTabular(toolOutput, config);

    if (!leaked.length && !tabularLeak) process.exit(0);

    const warnings = [];
    if (tabularLeak) {
      warnings.push(
        "CRITICAL: The output above contains UNFILTERED tabular data with protected columns. " +
          "This data bypassed the filter. You MUST NOT display, quote, or reference ANY values " +
          'from the protected columns. Discard this output entirely and use the filter command.'
      );
    } else if (leaked.length) {
      warnings.push(
        `The output above contains protected columns: ${leaked.join(", ")}. ` +
          "Do NOT reference, quote, display, or use the actual values from these columns. " +
          "Treat them as confidential."
      );
    }

    if (warnings.length) {
      console.log(
        JSON.stringify({
          systemMessage: "DATA PROTECTOR WARNING:\n" + warnings.join("\n"),
        })
      );
    }
    process.exit(0);
  });
}

function findLeakedColumns(output, config) {
  const columns = config.columns || [];
  const mode = config.mode || "block";
  const caseSensitive = config.case_sensitive || false;

  let checkCols;
  if (mode === "block") {
    checkCols = columns;
  } else {
    return [];
  }

  const leaked = [];
  for (const col of checkCols) {
    const target = caseSensitive ? col : col.toLowerCase();
    const text = caseSensitive ? output : output.toLowerCase();
    if (text.includes(target)) leaked.push(col);
  }
  return leaked;
}

function detectUnfilteredTabular(output, config) {
  const lines = output.split("\n").filter((l) => l.trim());
  if (lines.length < 3) return false;

  const delimiters = ["\t", ",", "|"];
  for (const d of delimiters) {
    const counts = lines.slice(0, 5).map((l) => l.split(d).length);
    if (counts[0] >= 2 && counts.every((c) => c === counts[0])) {
      const hasProtected = !output.includes("[PROTECTED]");
      if (hasProtected) {
        const headerLine = lines[0].toLowerCase();
        const columns = config.columns || [];
        for (const col of columns) {
          if (headerLine.includes(col.toLowerCase())) return true;
        }
      }
    }
  }
  return false;
}

main();
