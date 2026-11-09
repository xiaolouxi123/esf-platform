'use strict';

/**
 * 本地持久化：设置 + 登录态。
 *
 * 全部放在 Electron 的 userData 目录（%APPDATA%\ESF 平台），
 * 不能放在安装目录 —— 打包成 asar 之后那里是只读的。
 * JWT 用 safeStorage 加密落盘（Windows 上走 DPAPI，绑定当前用户）。
 */

const fs = require('fs');
const path = require('path');
const { app, safeStorage } = require('electron');

// 0.4.7 及更早版本的默认后端地址。0.4.8 起平台迁到 119.29.82.217。
const LEGACY_DEFAULT_API_BASE_URL = 'http://119.91.99.176:3000';

// 开发/测试版用独立 profile，避免和正式版的登录态、设置、自建服务器混在一起。
// 快捷方式传 --test-profile 即可；正式版不带这个参数，仍用原来的 userData。
const TEST_PROFILE = process.argv.includes('--test-profile');
const TEST_PROFILE_DIR = 'esf-launcher-test';

const DEFAULT_SETTINGS = {
  hlPath: '',
  esfModDir: '',
  apiBaseUrl: TEST_PROFILE ? 'http://127.0.0.1:3000' : 'http://119.29.82.217:3000',
  localServerKey: 'fcx-1v1-1',
  updateFeedUrl: '',
  soundEnabled: true,
};

function baseDir() {
  const dir = TEST_PROFILE
    ? path.join(app.getPath('appData'), TEST_PROFILE_DIR)
    : app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/** 测试 profile 第一次启动时，从正式版复制游戏目录，但后端固定到本机。 */
function seedTestProfile() {
  if (!TEST_PROFILE) return;
  try {
    if (fs.existsSync(settingsPath())) return;
    const prodPath = path.join(app.getPath('userData'), 'settings.json');
    let prod = {};
    try {
      prod = JSON.parse(fs.readFileSync(prodPath, 'utf-8'));
    } catch {
      prod = {};
    }
    const seed = {
      ...DEFAULT_SETTINGS,
      hlPath: String(prod.hlPath || ''),
      esfModDir: String(prod.esfModDir || ''),
      localServerKey: String(prod.localServerKey || 'fcx-1v1-1'),
      apiBaseUrl: 'http://127.0.0.1:3000',
      updateFeedUrl: '',
      soundEnabled: true,
    };
    fs.writeFileSync(settingsPath(), JSON.stringify(seed, null, 2), 'utf8');
  } catch {
    /* 生成失败就退回默认设置 */
  }
}

function settingsPath() {
  return path.join(baseDir(), 'settings.json');
}

function legacyConfigPath() {
  return path.join(__dirname, 'config.json');
}

function sessionPath() {
  return path.join(baseDir(), 'session.bin');
}

function normalizeSettings(raw) {
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  for (const key of Object.keys(DEFAULT_SETTINGS)) {
    if (typeof DEFAULT_SETTINGS[key] === 'string') {
      merged[key] = String(merged[key] || '');
    }
  }
  merged.soundEnabled = merged.soundEnabled !== false;
  return merged;
}

/** 老版本把 config.json 放在安装目录，这里做一次性迁移 */
function migrateLegacyConfig(settings) {
  if (settings.hlPath || settings.esfModDir) return settings;

  try {
    if (!fs.existsSync(legacyConfigPath())) return settings;
    const legacy = JSON.parse(fs.readFileSync(legacyConfigPath(), 'utf-8'));
    if (legacy.hlPath) settings.hlPath = String(legacy.hlPath);
    if (legacy.esfModDir) settings.esfModDir = String(legacy.esfModDir);
  } catch {
    /* 迁移失败不影响启动 */
  }
  return settings;
}

/**
 * 平台机房迁移：老版本把默认后端写进了 settings.json，
 * 升级到 0.4.8 后仍会指向 119.91.99.176。只改「还是旧默认值」的情况，
 * 玩家手动填过的地址原样保留。
 */
function migrateApiBaseUrl(settings) {
  if (String(settings.apiBaseUrl || '').trim() === LEGACY_DEFAULT_API_BASE_URL) {
    settings.apiBaseUrl = DEFAULT_SETTINGS.apiBaseUrl;
  }
  return settings;
}

function loadSettings() {
  seedTestProfile();
  let raw = {};
  try {
    if (fs.existsSync(settingsPath())) {
      raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
    }
  } catch {
    raw = {};
  }

  const settings = migrateApiBaseUrl(migrateLegacyConfig(normalizeSettings(raw)));
  try {
    saveSettings(settings);
  } catch {
    /* ignore */
  }
  return settings;
}

function saveSettings(patch) {
  const current = (() => {
    try {
      return JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
    } catch {
      return {};
    }
  })();

  const next = normalizeSettings({ ...current, ...(patch || {}) });
  fs.writeFileSync(settingsPath(), JSON.stringify(next, null, 2), 'utf8');
  return next;
}

function saveSession(session) {
  const raw = JSON.stringify(session);
  if (safeStorage.isEncryptionAvailable()) {
    fs.writeFileSync(sessionPath(), safeStorage.encryptString(raw));
    return;
  }
  // 极端情况下（比如某些 Linux 环境）退回明文，并在日志里提示
  fs.writeFileSync(sessionPath(), raw, 'utf8');
  console.warn('[store] safeStorage 不可用，登录态以明文保存');
}

function loadSession() {
  try {
    if (!fs.existsSync(sessionPath())) return null;
    const buffer = fs.readFileSync(sessionPath());
    let raw;
    if (safeStorage.isEncryptionAvailable()) {
      try {
        raw = safeStorage.decryptString(buffer);
      } catch {
        // 可能是明文写的旧文件
        raw = buffer.toString('utf8');
      }
    } else {
      raw = buffer.toString('utf8');
    }
    const parsed = JSON.parse(raw);
    if (!parsed || !parsed.token) return null;
    return parsed;
  } catch {
    return null;
  }
}

function clearSession() {
  try {
    fs.rmSync(sessionPath(), { force: true });
  } catch {
    /* ignore */
  }
}

// ================= 玩家自建服务器 =================

function customServersPath() {
  return path.join(baseDir(), 'custom-servers.json');
}

function normalizeCustomServer(raw) {
  if (!raw || typeof raw !== 'object') return null;
  const address = String(raw.address || '').trim();
  if (!/^[0-9A-Za-z.-]{3,64}:\d{2,5}$/.test(address)) return null;
  return {
    name: String(raw.name || '').trim().slice(0, 48) || address,
    address,
    addedAt: String(raw.addedAt || new Date().toISOString()),
  };
}

function loadCustomServers() {
  try {
    const parsed = JSON.parse(fs.readFileSync(customServersPath(), 'utf8'));
    if (!Array.isArray(parsed)) return [];
    return parsed.map(normalizeCustomServer).filter(Boolean).slice(0, 50);
  } catch {
    return [];
  }
}

function saveCustomServers(list) {
  const cleaned = (Array.isArray(list) ? list : [])
    .map(normalizeCustomServer)
    .filter(Boolean)
    .slice(0, 50);

  // 同一个地址只留一条
  const seen = new Set();
  const unique = cleaned.filter((item) => {
    if (seen.has(item.address)) return false;
    seen.add(item.address);
    return true;
  });

  fs.writeFileSync(customServersPath(), JSON.stringify(unique, null, 2), 'utf8');
  return unique;
}

module.exports = {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  saveSession,
  loadSession,
  clearSession,
  loadCustomServers,
  saveCustomServers,
  baseDir,
  settingsPath,
  sessionPath,
  customServersPath,
};
