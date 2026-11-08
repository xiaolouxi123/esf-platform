import { useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import releases from '../data/releases.json';

const compareVersion = (a, b) => {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const diff = (pa[i] || 0) - (pb[i] || 0);
    if (diff !== 0) return diff;
  }
  return 0;
};

const SORTED = [...releases].sort((a, b) => compareVersion(b.version, a.version));

/**
 * 版本记录：按版本倒序列出每次更新改了什么。
 * 数据来自 src/data/releases.json（随构建发布），不依赖后端。
 */
export default function ReleasesModal({ currentVersion = '', onClose }) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(SORTED[0]?.version || '');
  const searchRef = useRef(null);

  useEffect(() => {
    const onKey = (event) => {
      if (event.key === 'Escape') onClose?.();
    };
    window.addEventListener('keydown', onKey);
    searchRef.current?.focus();
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const filtered = useMemo(() => {
    const keyword = query.trim().toLowerCase();
    if (!keyword) return SORTED;
    return SORTED.filter((release) => {
      if (`v${release.version}`.includes(keyword)) return true;
      if (release.date.includes(keyword)) return true;
      if ((release.summary || '').toLowerCase().includes(keyword)) return true;
      return release.items.some((item) => item.toLowerCase().includes(keyword));
    });
  }, [query]);

  const selected = useMemo(
    () => filtered.find((release) => release.version === active) || filtered[0] || null,
    [filtered, active]
  );

  const total = SORTED.length;
  const oldest = SORTED[total - 1]?.version || '';
  const hasCurrent = SORTED.some((release) => release.version === currentVersion);

  const badgeOf = (release, index) => {
    if (hasCurrent && release.version === currentVersion) return '当前';
    if (!hasCurrent && index === 0) return '最新';
    return '';
  };

  return (
    <div className="release-backdrop" onMouseDown={onClose}>
      <div
        className="release-modal"
        role="dialog"
        aria-modal="true"
        aria-label="版本记录"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="release-head">
          <div className="release-head-text">
            <span className="release-kicker">CHANGELOG · 版本记录</span>
            <h2>版本记录</h2>
            <p>
              从 v{oldest} 到 v{SORTED[0]?.version}，共 {total} 个版本，只保留每次更新真正改了什么。
            </p>
          </div>
          <button type="button" className="release-close" onClick={onClose} aria-label="关闭版本记录">
            <Icon name="close" size={14} />
          </button>
        </header>

        <div className="release-body">
          <div className="release-side">
            <label className="release-search">
              <Icon name="search" size={13} />
              <input
                ref={searchRef}
                type="search"
                value={query}
                placeholder="搜索版本号或关键词"
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>

            <div className="release-list" role="listbox" aria-label="版本列表">
              {filtered.map((release) => {
                const isActive = selected && release.version === selected.version;
                const badge = badgeOf(release, SORTED.indexOf(release));
                return (
                  <button
                    key={release.version}
                    type="button"
                    role="option"
                    aria-selected={isActive}
                    className={`release-item${isActive ? ' is-active' : ''}`}
                    onClick={() => setActive(release.version)}
                  >
                    <b>v{release.version}</b>
                    {badge && <em className="release-current">{badge}</em>}
                    <span>{release.date}</span>
                  </button>
                );
              })}
              {filtered.length === 0 && <p className="release-empty">没有匹配的版本</p>}
            </div>
          </div>

          <div className="release-detail">
            {selected ? (
              <>
                <div className="release-detail-head">
                  <h3>v{selected.version}</h3>
                  <span>{selected.date}</span>
                  {hasCurrent && currentVersion === selected.version && (
                    <em className="release-current">当前版本</em>
                  )}
                  {!hasCurrent && selected.version === SORTED[0]?.version && (
                    <em className="release-current">最新版本</em>
                  )}
                </div>
                {selected.summary && <p className="release-summary">{selected.summary}</p>}
                <ul className="release-points">
                  {selected.items.map((item) => (
                    <li key={item}>{item}</li>
                  ))}
                </ul>
                <p className="release-note">
                  版本记录随安装包一起发布；更早的改动只保留摘要。
                </p>
              </>
            ) : (
              <p className="release-empty">换个关键词试试，比如「排位」「约战」「音效」。</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
