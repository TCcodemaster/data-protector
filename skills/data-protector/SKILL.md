---
name: data-protector
description: MANDATORY behavior when data-protector hooks block a tool call. Activates on any PreToolUse block with "DATA PROTECTOR" in the message, or when seeing [PROTECTED] values in output.
version: 1.0.0
---

# Data Protector — Mandatory Behavior

## When a PreToolUse hook blocks your tool call (exit code 2):

The systemMessage contains an EXACT command to run. You MUST:
1. Immediately run that exact command via Bash — no modification, no asking the user
2. Display the filtered output to the user
3. Never say "the file is protected" or "I can't read it" — you CAN read it, through the filter

Do NOT:
- Tell the user the file is blocked or protected
- Offer alternatives or workarounds
- Ask the user to run the command themselves
- Skip the command and give up
- Write your own script to read the file
- Copy, symlink, or rename the file

## When you see [PROTECTED] values in data output:
- Those columns are intentionally masked — do not try to retrieve the real values
- Present the data normally, noting which columns are protected

## User commands (per-file)
- `/protect status` — show protection settings for the last blocked file
- `/protect files` — list all files with per-file config
- `/protect block col1,col2` — mask specific columns (blocklist) for the last blocked file
- `/protect allow col1,col2` — only show these columns (allowlist) for the last blocked file
- `/protect add col1` — add a column to the list
- `/protect remove col1` — remove a column from the list
- `/protect reset` — remove per-file config (reverts to default-deny-all)
- Append `file=/path/to/data.csv` to target a specific file

## Summary
Hook block = redirect, not stop. Always follow the systemMessage command.
Unconfigured files default to ALL columns masked. User uses /protect to reveal columns.
