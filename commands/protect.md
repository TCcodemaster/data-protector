---
description: Configure data column protection (blocklist/allowlist) per file
argument-hint: "[block|allow|add|remove|status|files] [columns...]"
allowed-tools: ["Read", "Bash", "Write"]
---

# Data Protector Configuration

The user wants to configure data column protection. Their input: $ARGUMENTS

## Configuration file
Location: ~/.claude/data-protector.json

Format (per-file config):
```json
{
  "default": {"mode": "block", "columns": [], "case_sensitive": false},
  "files": {
    "/absolute/path/to/file.csv": {"mode": "allow", "columns": ["name", "age"]}
  }
}
```

## Target file resolution

Commands operate on a SPECIFIC FILE. Determine the target file:
1. If the user specifies a file path in the arguments (e.g. `/protect allow name,age file=/path/to/data.csv`), use that path (resolve to absolute).
2. Otherwise, read `~/.claude/data-protector-last-file.txt` — this contains the path of the last file blocked by the hook.
3. If neither exists, tell the user to specify a file path.

## Instructions

1. Read ~/.claude/data-protector.json (create with defaults if missing)
2. Determine the target file (see above)
3. Parse arguments:
   - No arguments or "status": Show the target file's current config. If no target file, show all configured files.
   - "files": List all files that have per-file config, with their mode and column count.
   - "block col1,col2,col3" or "block col1 col2 col3": Set mode to "block" for target file, set columns list. Block mode = these columns are masked, everything else visible.
   - "allow col1,col2" or "allow col1 col2": Set mode to "allow" for target file, set columns list. Allow mode = only these columns are visible, everything else masked.
   - "add col1" or "add col1,col2": Add columns to target file's current list (keep existing)
   - "remove col1" or "remove col1,col2": Remove columns from target file's current list
   - "reset": Remove per-file config for target file (reverts to default-deny-all)
   - "case on" / "case off": Toggle case_sensitive for target file

4. Write the per-file config into the `files` section of ~/.claude/data-protector.json:
   ```python
   import json, os
   config_path = os.path.expanduser("~/.claude/data-protector.json")
   with open(config_path) as f:
       config = json.load(f)
   config.setdefault("files", {})
   config["files"]["/absolute/path/to/file.csv"] = {
       "mode": "allow",
       "columns": ["name", "age"]
   }
   with open(config_path, "w") as f:
       json.dump(config, f, indent=2, ensure_ascii=False)
   ```

5. Report what changed: show the file path, mode, and column list. Remind: changes take effect immediately on next read.

## Important
- Column names in arguments can be separated by commas or spaces
- Always show the final state after any change
- Always write to the `files` section using the absolute path as key — never modify `default`
- mode "block" = these columns are masked, everything else visible
- mode "allow" = only these columns are visible, everything else masked
- If a file has no per-file config, ALL columns are masked by default (default-deny-all)
