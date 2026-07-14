#!/usr/bin/env python3
"""PostToolUse safety net for data-protector plugin.

Two layers of detection:
1. Column name detection — check if protected column names appear as headers
2. Tabular data leak detection — check if output looks like unfiltered multi-column data
   (many rows of delimiter-separated values without [PROTECTED] markers)
"""
import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from config_manager import load_config

MASK = "[PROTECTED]"
TABULAR_ROW = re.compile(r"^.+[,\t|].+[,\t|].+$")


def find_leaked_columns(text, config):
    columns = config.get("columns", [])
    mode = config.get("mode", "block")
    case_sensitive = config.get("case_sensitive", False)

    if mode != "block":
        return []

    found = []
    for col in columns:
        pattern = re.escape(col)
        flags = 0 if case_sensitive else re.IGNORECASE
        if re.search(r"\b" + pattern + r"\b", text, flags):
            found.append(col)
    return found


def detect_unfiltered_tabular(text, config):
    """Detect if output contains tabular data that should have been filtered but wasn't.

    Heuristic: if we see 3+ rows of delimiter-separated data AND none contain [PROTECTED],
    this is likely an unfiltered data leak.
    """
    columns = config.get("columns", [])
    if not columns:
        return False

    lines = text.strip().split("\n")
    tabular_lines = [l for l in lines if TABULAR_ROW.match(l.strip())]

    if len(tabular_lines) < 3:
        return False

    has_protected = any(MASK in l for l in tabular_lines)
    if has_protected:
        return False

    case_sensitive = config.get("case_sensitive", False)
    first_tabular = tabular_lines[0]
    flags = 0 if case_sensitive else re.IGNORECASE
    col_matches = 0
    for col in columns:
        if re.search(r"\b" + re.escape(col) + r"\b", first_tabular, flags):
            col_matches += 1

    return col_matches >= 1


def main():
    try:
        input_data = json.load(sys.stdin)
    except json.JSONDecodeError:
        sys.exit(0)

    config = load_config()
    if not config.get("columns"):
        sys.exit(0)

    tool_result = input_data.get("tool_result", "")
    if isinstance(tool_result, dict):
        tool_result = json.dumps(tool_result)

    if not tool_result:
        sys.exit(0)

    text = str(tool_result)
    leaked = find_leaked_columns(text, config)
    tabular_leak = detect_unfiltered_tabular(text, config)

    warnings = []

    if tabular_leak:
        warnings.append(
            "CRITICAL: The output above contains UNFILTERED tabular data with protected columns. "
            "This data bypassed the filter. You MUST NOT display, quote, or reference ANY values "
            "from the protected columns. Discard this output entirely and use the filter command:\n"
            f'python3 "<plugin>/scripts/filter.py" "<file_path>"'
        )
    elif leaked:
        cols_str = ", ".join(leaked)
        warnings.append(
            f"The output above contains protected columns: {cols_str}. "
            f"Do NOT reference, quote, display, or use the actual values from these columns. "
            f"Treat them as confidential."
        )

    if warnings:
        result = {
            "systemMessage": "DATA PROTECTOR WARNING: " + " ".join(warnings)
        }
        print(json.dumps(result))

    sys.exit(0)


if __name__ == "__main__":
    main()
