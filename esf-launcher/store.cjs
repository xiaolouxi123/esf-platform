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

const DEFAULT_SETTINGS = {
  hlPath: '',
  esfModDir: '',
  apiBaseUrl: 'http://127.0.0.1:3000',
  localServerKey: 'fcx-1v1-1',
};

function baseDir() {
  const dir = app.getPath('userData');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
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

function loadSettings() {
  let raw = {};
  try {
    if (fs.existsSync(settingsPath())) {
      raw = JSON.parse(fs.readFileSync(settingsPath(), 'utf-8'));
    }
  } catch {
    raw = {};
  }

  const settings = migrateLegacyConfig(normalizeSettings(raw));
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

module.exports = {
  DEFAULT_SETTINGS,
  loadSettings,
  saveSettings,
  saveSession,
  loadSession,
  clearSession,
  baseDir,
  settingsPath,
  sessionPath,
};
