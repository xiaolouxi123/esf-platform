/**
 * 界面音效：合成音，随包发布，无版权负担。
 *
 * 原则：
 *  - 悬停、点击这类高频声音必须极短（< 120ms），否则会烦
 *  - 同一个动作只响一次，连续悬停同一个元素不重复播
 *  - 总开关在设置里（settings.soundEnabled），默认开
 */

import hoverUrl from '../assets/sfx/ui-hover.wav';
import clickUrl from '../assets/sfx/ui-click.wav';
import tabUrl from '../assets/sfx/ui-tab.wav';
import matchUrl from '../assets/sfx/ui-match.wav';
import winUrl from '../assets/sfx/ui-win.wav';
import loseUrl from '../assets/sfx/ui-lose.wav';
import errorUrl from '../assets/sfx/ui-error.wav';

const SOURCES = {
  hover: hoverUrl,
  click: clickUrl,
  tab: tabUrl,
  match: matchUrl,
  win: winUrl,
  lose: loseUrl,
  error: errorUrl,
};

const VOLUME = {
  hover: 0.22,
  click: 0.5,
  tab: 0.42,
  match: 0.55,
  win: 0.6,
  lose: 0.55,
  error: 0.45,
};

const pool = new Map();
let enabled = true;
let lastPlayedAt = 0;
let lastPlayedName = '';

/** 由 App 在启动/设置变更时调用 */
export function setSoundEnabled(value) {
  enabled = value !== false;
}

export function isSoundEnabled() {
  return enabled;
}

function audioFor(name) {
  let audio = pool.get(name);
  if (!audio) {
    audio = new Audio(SOURCES[name]);
    audio.preload = 'auto';
    audio.volume = VOLUME[name] ?? 0.5;
    pool.set(name, audio);
  }
  return audio;
}

/**
 * 播放一个音效。
 * @param {'hover'|'click'|'tab'|'match'|'win'|'lose'|'error'} name
 */
export function playSfx(name) {
  if (!enabled || !SOURCES[name]) return;
  const now = Date.now();
  // 悬停是高频动作：同一个音效 60ms 内只响一次
  if (name === 'hover' && lastPlayedName === 'hover' && now - lastPlayedAt < 60) return;
  lastPlayedAt = now;
  lastPlayedName = name;

  try {
    const audio = audioFor(name);
    audio.currentTime = 0;
    const playing = audio.play();
    if (playing && typeof playing.catch === 'function') playing.catch(() => {});
  } catch {
    /* 音频失败不影响功能 */
  }
}

/** 结算用：赢了放 win，输了放 lose */
export function playResultSfx(won) {
  playSfx(won ? 'win' : 'lose');
}

export default { playSfx, playResultSfx, setSoundEnabled, isSoundEnabled };
