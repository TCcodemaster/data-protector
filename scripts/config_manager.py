import json
import os

CONFIG_PATH = os.path.expanduser("~/.claude/data-protector.json")

DEFAULT_CONFIG = {
    "default": {
        "mode": "block",
        "columns": [],
        "case_sensitive": False
    },
    "files": {}
}


def load_raw_config():
    if not os.path.exists(CONFIG_PATH):
        return DEFAULT_CONFIG.copy()
    try:
        with open(CONFIG_PATH, "r", encoding="utf-8") as f:
            config = json.load(f)

        if "default" not in config and "files" not in config:
            old_config = config
            config = {
                "default": {
                    "mode": old_config.get("mode", "block"),
                    "columns": old_config.get("columns", []),
                    "case_sensitive": old_config.get("case_sensitive", False)
                },
                "files": {}
            }
            save_raw_config(config)

        config.setdefault("default", DEFAULT_CONFIG["default"].copy())
        config.setdefault("files", {})
        return config
    except (json.JSONDecodeError, IOError):
        return DEFAULT_CONFIG.copy()


def save_raw_config(config):
    os.makedirs(os.path.dirname(CONFIG_PATH), exist_ok=True)
    with open(CONFIG_PATH, "w", encoding="utf-8") as f:
        json.dump(config, f, indent=2, ensure_ascii=False)


UNCONFIGURED_CONFIG = {
    "mode": "allow",
    "columns": [],
    "case_sensitive": False
}


def load_config(file_path=None):
    """Load effective config for a specific file.

    If file has per-file config: use it (merged with default).
    If file has NO per-file config: return allow-nothing (mask all columns).
    If no file_path given: return global default.
    """
    raw = load_raw_config()

    if file_path:
        abs_path = os.path.abspath(file_path)
        file_config = raw.get("files", {}).get(abs_path)
        if file_config:
            result = raw["default"].copy()
            result.update(file_config)
            return result
        return UNCONFIGURED_CONFIG.copy()

    return raw.get("default", DEFAULT_CONFIG["default"].copy())


def is_file_configured(file_path):
    """Check if a specific file has its own column config."""
    raw = load_raw_config()
    abs_path = os.path.abspath(file_path)
    return abs_path in raw.get("files", {})


def save_file_config(file_path, mode, columns):
    """Save per-file column protection config."""
    raw = load_raw_config()
    abs_path = os.path.abspath(file_path)
    raw.setdefault("files", {})[abs_path] = {
        "mode": mode,
        "columns": columns
    }
    save_raw_config(raw)


def save_config(config):
    """Legacy save — writes to default section."""
    raw = load_raw_config()
    raw["default"] = {
        "mode": config.get("mode", "block"),
        "columns": config.get("columns", []),
        "case_sensitive": config.get("case_sensitive", False)
    }
    save_raw_config(raw)


def is_protected(col_name, config):
    columns = config.get("columns", [])
    mode = config.get("mode", "block")
    case_sensitive = config.get("case_sensitive", False)

    if not case_sensitive:
        col_name = col_name.strip().lower()
        columns = [c.strip().lower() for c in columns]
    else:
        col_name = col_name.strip()
        columns = [c.strip() for c in columns]

    in_list = col_name in columns

    if mode == "block":
        return in_list
    else:  # allow
        return not in_list


def get_protected_indices(headers, config):
    return [i for i, h in enumerate(headers) if is_protected(h, config)]
