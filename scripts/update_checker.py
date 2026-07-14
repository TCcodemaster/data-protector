import json
import os
import time
import urllib.request

PLUGIN_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
LOCAL_PLUGIN_JSON = os.path.join(PLUGIN_ROOT, ".claude-plugin", "plugin.json")
CACHE_FILE = os.path.expanduser("~/.claude/data-protector-update-cache.json")
REMOTE_URL = "https://raw.githubusercontent.com/TCcodemaster/data-protector/main/.claude-plugin/plugin.json"
CHECK_INTERVAL = 86400


def get_local_version():
    try:
        with open(LOCAL_PLUGIN_JSON) as f:
            return json.load(f).get("version", "0.0.0")
    except Exception:
        return "0.0.0"


def check_for_update():
    """Returns update message string if new version available, else empty string."""
    now = time.time()

    try:
        if os.path.exists(CACHE_FILE):
            with open(CACHE_FILE) as f:
                cache = json.load(f)
            if now - cache.get("last_check", 0) < CHECK_INTERVAL:
                if cache.get("has_update"):
                    return _update_msg(cache["remote_version"])
                return ""
    except Exception:
        pass

    try:
        req = urllib.request.Request(REMOTE_URL, headers={"User-Agent": "data-protector"})
        with urllib.request.urlopen(req, timeout=3) as resp:
            remote = json.loads(resp.read().decode())
        remote_version = remote.get("version", "0.0.0")
    except Exception:
        _save_cache(now, False, "")
        return ""

    local_version = get_local_version()
    has_update = _version_newer(remote_version, local_version)
    _save_cache(now, has_update, remote_version)

    if has_update:
        return _update_msg(remote_version)
    return ""


def _version_newer(remote, local):
    try:
        r = [int(x) for x in remote.split(".")]
        l = [int(x) for x in local.split(".")]
        return r > l
    except Exception:
        return False


def _update_msg(remote_version):
    local = get_local_version()
    return (
        f"\n⚡ data-protector 有新版本 {remote_version}（目前 {local}）。"
        f"執行以下指令更新：\n"
        f"  claude plugin marketplace update data-protector && "
        f"claude plugin install data-protector@data-protector"
    )


def _save_cache(timestamp, has_update, remote_version):
    try:
        os.makedirs(os.path.dirname(CACHE_FILE), exist_ok=True)
        with open(CACHE_FILE, "w") as f:
            json.dump({"last_check": timestamp, "has_update": has_update,
                        "remote_version": remote_version}, f)
    except Exception:
        pass
