import { useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import { DEFAULT_RANKS, normalizeRanks } from '../lib/ranks';

const LEVEL_HINTS = {
  0: '未定级 / 新手',
  1: 'D · 入门',
  2: 'C · 进阶',
  3: 'B · 熟练',
  4: 'A · 高手',
  5: 'X · 顶尖',
  6: 'S · 传奇',
};

export default function AdminRanks({ toast, onRanksChanged }) {
  const [ranks, setRanks] = useState(DEFAULT_RANKS);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [dirty, setDirty] = useState(false);

  const load = async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.admin?.ranks?.();
      setRanks(normalizeRanks(data?.ranks));
      setDirty(false);
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- 异步读取后台配置后落地
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sorted = useMemo(
    () => [...ranks].sort((a, b) => a.sortOrder - b.sortOrder || a.level - b.level),
    [ranks]
  );

  const update = (level, patch) => {
    setRanks((prev) =>
      prev.map((rank) => (rank.level === level ? { ...rank, ...patch } : rank))
    );
    setDirty(true);
  };

  const save = async () => {
    if (saving) return;
    const names = new Set(ranks.map((rank) => rank.name.trim()));
    if (ranks.some((rank) => !rank.name.trim())) {
      toast?.('等级名称不能为空', 'error');
      return;
    }
    if (names.size !== ranks.length) {
      toast?.('等级名称不能重复', 'error');
      return;
    }
    setSaving(true);
    try {
      const data = await window.electronAPI.admin.saveRanks(
        ranks.map((rank) => ({
          level: rank.level,
          name: rank.name.trim(),
          color: rank.color,
          sortOrder: Number(rank.sortOrder) || 0,
        }))
      );
      setRanks(normalizeRanks(data?.ranks));
      setDirty(false);
      await onRanksChanged?.();
      toast?.('格斗等级配置已保存', 'ok');
    } catch (err) {
      toast?.(err.message, 'error');
    } finally {
      setSaving(false);
    }
  };

  const resetDefaults = () => {
    setRanks(DEFAULT_RANKS);
    setDirty(true);
  };

  return (
    <section className="admin-section admin-ranks">
      <div className="admin-section-head">
        <h3>
          <Icon name="shield" size={15} /> 格斗等级
          <span className="pill">{ranks.length}</span>
        </h3>
        <span className="admin-muted">管理员可自定义名称、颜色与排序；成员列表按权重从高到低排列</span>
      </div>

      <div className="rank-admin-preview" aria-hidden="true">
        {sorted.map((rank) => (
          <span
            key={rank.level}
            className={`rank-badge${rank.level === 0 ? ' rank-badge--unranked' : ''}`}
            style={{
              color: rank.color,
              borderColor: `${rank.color}55`,
              background: `${rank.color}14`,
            }}
          >
            {rank.name}
          </span>
        ))}
      </div>

      <div className="admin-table-wrap">
        <table className="admin-table rank-admin-table">
          <thead>
            <tr>
              <th>等级</th>
              <th>显示名称</th>
              <th>颜色</th>
              <th>排序权重</th>
              <th>定位</th>
            </tr>
          </thead>
          <tbody>
            {ranks.map((rank) => (
              <tr key={rank.level}>
                <td className="rank-admin-level">{rank.level === 0 ? '未定级' : `Lv.${rank.level}`}</td>
                <td>
                  <input
                    type="text"
                    value={rank.name}
                    maxLength={16}
                    disabled={loading || saving}
                    onChange={(event) => update(rank.level, { name: event.target.value })}
                    aria-label={`等级 ${rank.level} 名称`}
                  />
                </td>
                <td>
                  <div className="rank-color-cell">
                    <input
                      type="color"
                      value={rank.color}
                      disabled={loading || saving}
                      onChange={(event) => update(rank.level, { color: event.target.value })}
                      aria-label={`等级 ${rank.level} 颜色`}
                    />
                    <code>{rank.color.toUpperCase()}</code>
                  </div>
                </td>
                <td>
                  <input
                    type="number"
                    min="0"
                    max="99"
                    value={rank.sortOrder}
                    disabled={loading || saving}
                    onChange={(event) =>
                      update(rank.level, { sortOrder: Number(event.target.value) || 0 })
                    }
                    aria-label={`等级 ${rank.level} 排序权重`}
                  />
                </td>
                <td className="admin-muted">{LEVEL_HINTS[rank.level] || '自定义等级'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="admin-actions">
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetDefaults} disabled={saving}>
          恢复默认
        </button>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          onClick={save}
          disabled={loading || saving || !dirty}
        >
          {saving ? '保存中…' : '保存等级配置'}
        </button>
      </div>
    </section>
  );
}
