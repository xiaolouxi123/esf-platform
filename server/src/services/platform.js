'use strict';

/**
 * 平台级运营设置（公告 / 维护模式）。
 *
 * 存在 platform_settings 表里，管理员改完立即生效，不用改 .env 重启后端。
 * 表里读不到时回落到 env，保证老部署不会白屏。
 */

const { q } = require('../db');
const env = require('../env');

const DEFAULTS = {
  notice: '',
  maintenance: false,
  maintenanceText: '平台维护中，请稍后再试',
};

async function getPlatformSettings() {
  try {
    const rows = await q('SELECT setting_key, setting_value FROM platform_settings');
    const map = Object.fromEntries(rows.map((row) => [row.setting_key, row.setting_value]));
    return {
      notice: map.notice ?? env.notice ?? DEFAULTS.notice,
      maintenance: String(map.maintenance ?? '') === '1' || Boolean(env.maintenance),
      maintenanceText: map.maintenance_text || DEFAULTS.maintenanceText,
      latestVersion: map.release_latest_version || env.latestVersion,
      releaseNotes: map.release_notes || env.releaseNotes,
      downloadUrl: map.release_download_url || env.downloadUrl,
    };
  } catch {
    return {
      notice: env.notice || DEFAULTS.notice,
      maintenance: Boolean(env.maintenance),
      maintenanceText: DEFAULTS.maintenanceText,
      latestVersion: env.latestVersion,
      releaseNotes: env.releaseNotes,
      downloadUrl: env.downloadUrl,
    };
  }
}

async function updatePlatformSettings(patch) {
  const entries = [];

  if (patch.notice !== undefined) entries.push(['notice', String(patch.notice)]);
  if (patch.maintenance !== undefined) entries.push(['maintenance', patch.maintenance ? '1' : '0']);
  if (patch.maintenanceText !== undefined) {
    entries.push(['maintenance_text', String(patch.maintenanceText)]);
  }
  if (patch.latestVersion !== undefined) {
    entries.push(['release_latest_version', String(patch.latestVersion)]);
  }
  if (patch.releaseNotes !== undefined) {
    entries.push(['release_notes', String(patch.releaseNotes)]);
  }
  if (patch.downloadUrl !== undefined) {
    entries.push(['release_download_url', String(patch.downloadUrl)]);
  }

  for (const [key, value] of entries) {
    await q(
      `INSERT INTO platform_settings (setting_key, setting_value) VALUES (?, ?)
       ON DUPLICATE KEY UPDATE setting_value = VALUES(setting_value)`,
      [key, value]
    );
  }

  return getPlatformSettings();
}

module.exports = { getPlatformSettings, updatePlatformSettings, DEFAULTS };
