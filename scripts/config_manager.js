const fs = require("fs");
const path = require("path");

const CONFIG_PATH = path.join(
  process.env.HOME || process.env.USERPROFILE,
  ".claude",
  "data-protector.json"
);

const DEFAULT_CONFIG = {
  default: { mode: "block", columns: [], case_sensitive: false },
  files: {},
};

const UNCONFIGURED_CONFIG = {
  mode: "allow",
  columns: [],
  case_sensitive: false,
};

function loadRawConfig() {
  if (!fs.existsSync(CONFIG_PATH)) return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    const config = JSON.parse(fs.readFileSync(CONFIG_PATH, "utf-8"));
    if (!config.default && !config.files) {
      const migrated = {
        default: {
          mode: config.mode || "block",
          columns: config.columns || [],
          case_sensitive: config.case_sensitive || false,
        },
        files: {},
      };
      saveRawConfig(migrated);
      return migrated;
    }
    if (!config.default) config.default = { mode: "block", columns: [], case_sensitive: false };
    if (!config.files) config.files = {};
    return config;
  } catch {
    return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  }
}

function saveRawConfig(config) {
  const dir = path.dirname(CONFIG_PATH);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2), "utf-8");
}

function loadConfig(filePath) {
  const raw = loadRawConfig();
  if (filePath) {
    const abs = path.resolve(filePath);
    const fileConfig = (raw.files || {})[abs];
    if (fileConfig) {
      return { ...raw.default, ...fileConfig };
    }
    return { ...UNCONFIGURED_CONFIG };
  }
  return raw.default || { ...UNCONFIGURED_CONFIG };
}

function isFileConfigured(filePath) {
  const raw = loadRawConfig();
  const abs = path.resolve(filePath);
  return abs in (raw.files || {});
}

function isProtected(colName, config) {
  const columns = config.columns || [];
  const mode = config.mode || "block";
  const caseSensitive = config.case_sensitive || false;

  let col = caseSensitive ? colName.trim() : colName.trim().toLowerCase();
  let list = caseSensitive
    ? columns.map((c) => c.trim())
    : columns.map((c) => c.trim().toLowerCase());

  const inList = list.includes(col);
  return mode === "block" ? inList : !inList;
}

function getProtectedIndices(headers, config) {
  return headers
    .map((h, i) => (isProtected(h, config) ? i : -1))
    .filter((i) => i >= 0);
}

module.exports = {
  CONFIG_PATH,
  loadConfig,
  isFileConfigured,
  isProtected,
  getProtectedIndices,
  loadRawConfig,
  saveRawConfig,
};
