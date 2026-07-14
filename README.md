# data-protector

Claude Code plugin that masks sensitive data columns when reading CSV, Excel, SQL, R, or pandas output.

## Features

- **Default-deny-all**: unconfigured files have ALL columns masked — no data leaks by default
- **Per-file configuration**: each file gets its own protection settings, persisted across sessions
- **Block & Allow modes**: blocklist (mask specific columns) or allowlist (only show specific columns)
- **Multi-sheet Excel**: each sheet filtered independently, all sheet headers listed on first encounter
- **Broad coverage**: intercepts Read, Bash (cat/head/pandas/etc.), SQL queries, R data reads
- **Anti-bypass**: blocks copy/symlink/move of protected files, detects unfiltered tabular data in PostToolUse
- **Never modifies original files**: filtering happens in memory only

## Install

```bash
claude plugin marketplace add TCcodemaster/data-protector
claude plugin install data-protector
```

## Usage

1. Read any data file — all columns show as `[PROTECTED]` (headers visible)
2. Use `/protect` to configure which columns to reveal:

```
/protect allow name,age          # only show name and age columns
/protect block ssn,password      # hide ssn and password, show everything else
/protect add credit_card         # add a column to the list
/protect remove age              # remove a column from the list
/protect status                  # show current settings for last read file
/protect files                   # list all configured files
/protect reset                   # remove config for current file (back to deny-all)
```

## Config

Stored at `~/.claude/data-protector.json`:

```json
{
  "default": {"mode": "block", "columns": [], "case_sensitive": false},
  "files": {
    "/path/to/data.csv": {"mode": "allow", "columns": ["name", "age"]}
  }
}
```

## License

MIT
