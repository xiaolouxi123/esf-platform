import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import { formatBytes, formatNumber } from '../lib/format';

const KIND_FILTERS = [
  { value: '', label: '全部' },
  { value: 'model', label: '模型' },
  { value: 'sound', label: '声音' },
  { value: 'sprite', label: '特效' },
  { value: 'other', label: '其它' },
];

const KIND_LABEL = { model: '模型', sound: '声音', sprite: '特效', other: '其它' };

const KIND_HINT = {
  model: '只收 .mdl，落地路径例：models/player/goku/goku.mdl',
  sound: '只收 .wav / .mp3，落地路径例：sound/weapons/beam.wav',
  sprite: '只收 .spr，落地路径例：sprites/beam.spr',
  other: '只收 .zip / .tga / .bmp',
};

export default function AssetLibrary({ toast, settings }) {
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');
  const [assets, setAssets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [installingId, setInstallingId] = useState(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [form, setForm] = useState({
    kind: 'model',
    name: '',
    version: '1.0.0',
    targetPath: '',
    description: '',
  });
  const [cover, setCover] = useState(null);
  const uploadRef = useRef(null);

  const assetUrl = (url) => {
    if (!url) return '';
    if (/^(data:|https?:)/i.test(url)) return url;
    return `${String(settings?.apiBaseUrl || '').replace(/\/$/, '')}${url}`;
  };

  const pickCover = async () => {
    try {
      const picked = await window.electronAPI.assets.pickCover();
      setCover({
        ...picked,
        preview: `data:${picked.mime};base64,${picked.base64}`,
      });
    } catch (err) {
      if (err.code !== 'CANCELED') toast(err.message, 'error');
    }
  };

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.assets.list({ q: keyword.trim() || undefined });
      setAssets(data.assets || []);
    } catch (err) {
      toast(err.message, 'error');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [keyword, toast]);

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 200);
    return () => clearTimeout(timer);
  }, [refresh]);

  const visible = useMemo(
    () => (kind ? assets.filter((asset) => asset.kind === kind) : assets),
    [assets, kind]
  );

  const counts = useMemo(() => {
    const acc = { model: 0, sound: 0, sprite: 0, other: 0 };
    assets.forEach((asset) => {
      if (acc[asset.kind] === undefined) acc.other += 1;
      else acc[asset.kind] += 1;
    });
    return acc;
  }, [assets]);

  const totalDownloads = useMemo(
    () => assets.reduce((sum, asset) => sum + (Number(asset.downloads) || 0), 0),
    [assets]
  );

  const openUpload = () => {
    setUploadOpen(true);
    window.setTimeout(() => {
      uploadRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      uploadRef.current?.querySelector('input, select')?.focus();
    }, 30);
  };

  const install = async (asset) => {
    setInstallingId(asset.id);
    try {
      const result = await window.electronAPI.assets.install(asset.id);
      toast(
        `已安装到 ${result.targetPath}（${formatBytes(result.bytes)}${result.backedUp ? '，原文件已备份' : ''}）`,
        'ok'
      );
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInstallingId(null);
    }
  };

  const submit = async () => {
    if (uploading) return;
    if (!form.name.trim()) return toast('请填写资源名称', 'error');
    if (!form.targetPath.trim()) return toast('请填写落地路径', 'error');

    setUploading(true);
    try {
      const asset = await window.electronAPI.assets.upload({
        kind: form.kind,
        name: form.name.trim(),
        version: form.version.trim() || '1.0.0',
        targetPath: form.targetPath.trim(),
        description: form.description.trim() || undefined,
        coverBase64: cover?.base64,
        coverName: cover?.name,
        coverMime: cover?.mime,
      });

      toast(
        asset.status === 'approved' ? `已上架：${asset.name}` : `已提交审核：${asset.name}，等管理员通过后其他玩家可见`,
        'ok'
      );
      setUploadOpen(false);
      setForm({ kind: 'model', name: '', version: '1.0.0', targetPath: '', description: '' });
      setCover(null);
      await refresh();
    } catch (err) {
      if (err.code !== 'CANCELED') toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="assets-page">
      <header className="hero assets-hero">
        <span className="hero-art" aria-hidden="true" />
        <span className="hero-mask" aria-hidden="true" />

        <div className="hero-content">
          <div className="eyebrow">
            <Icon name="spark" size={12} />
            资源库
            <span className={`eyebrow-status${settings?.esfModDir ? ' is-on' : ' is-off'}`}>
              {settings?.esfModDir ? '可安装' : '未配置目录'}
            </span>
            <span className="eyebrow-note">作者上传 · 管理员审核 · 安装前自动备份</span>
          </div>

          <h1 className="hero-title">资源库</h1>

          <div className="hero-tags">
            <span className="tag tag--code">asset library</span>
            <span className="tag">{formatNumber(assets.length)} 条上架</span>
            <span className="tag">模型 · 声音 · 特效</span>
            <span className="tag tag--mode tag--asset">安装到模组</span>
          </div>
        </div>

        <div className="hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--assets">
              <span>已上架</span>
              <b>{assets.length}</b>
            </div>
            <div className="hud-cell hud-cell--model">
              <span>模型</span>
              <b>{counts.model}</b>
            </div>
            <div className="hud-cell hud-cell--download">
              <span>总下载</span>
              <b>{formatNumber(totalDownloads)}</b>
            </div>
          </div>

          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-ghost btn-lg assets-refresh"
              onClick={refresh}
              disabled={loading}
            >
              {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
              {loading ? '刷新中…' : '刷新'}
            </button>
            <button type="button" className="btn btn-primary btn-lg hero-cta" onClick={openUpload}>
              <Icon name="plus" size={15} /> 上传资源
            </button>
          </div>
        </div>
      </header>

      {uploadOpen && (
        <section className="upload-panel" ref={uploadRef}>
          <div className="section-head">
            <h2>上传资源</h2>
            <span className="tag">NEW ASSET</span>
            <span className="admin-muted">作者提交后由管理员审核，通过才出现在列表里</span>
            <button type="button" className="icon-btn icon-btn--sm upload-close" onClick={() => setUploadOpen(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>

          <div className="upload-body">
            <div className="upload-row">
              <label className="field">
                <span className="field-label">类型</span>
                <div className="field-input">
                  <select
                    value={form.kind}
                    onChange={(event) => setForm((prev) => ({ ...prev, kind: event.target.value }))}
                  >
                    <option value="model">模型</option>
                    <option value="sound">声音</option>
                    <option value="sprite">特效</option>
                    <option value="other">其它</option>
                  </select>
                </div>
              </label>

              <label className="field">
                <span className="field-label">名称</span>
                <div className="field-input">
                  <input
                    type="text"
                    value={form.name}
                    placeholder="悟空新模型"
                    onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))}
                  />
                </div>
              </label>

              <label className="field">
                <span className="field-label">版本</span>
                <div className="field-input">
                  <input
                    type="text"
                    value={form.version}
                    placeholder="1.0.0"
                    onChange={(event) => setForm((prev) => ({ ...prev, version: event.target.value }))}
                  />
                </div>
              </label>

              <label className="field field--wide">
                <span className="field-label">说明（可选）</span>
                <div className="field-input">
                  <input
                    type="text"
                    value={form.description}
                    placeholder="替换默认模型 / 音效说明"
                    onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                  />
                </div>
              </label>
            </div>

            <div className="upload-row">
              <label className="field field--wide">
                <span className="field-label">落地路径（相对模组目录）</span>
                <div className="field-input">
                  <Icon name="folder" size={15} />
                  <input
                    type="text"
                    value={form.targetPath}
                    placeholder={
                      form.kind === 'sprite'
                        ? 'sprites/beam.spr'
                        : form.kind === 'sound'
                          ? 'sound/weapons/beam.wav'
                          : 'models/player/goku/goku.mdl'
                    }
                    onChange={(event) => setForm((prev) => ({ ...prev, targetPath: event.target.value }))}
                  />
                </div>
                <span className="field-hint">{KIND_HINT[form.kind]}</span>
              </label>

              <div className="field field--cover">
                <span className="field-label">封面（可选，支持 GIF / 动态 WebP）</span>
                <div className="cover-picker">
                  {cover ? (
                    <img className="cover-preview" src={cover.preview} alt="封面预览" />
                  ) : (
                    <span className="cover-empty">
                      <Icon name="image" size={16} /> 还没有封面
                    </span>
                  )}

                  <div className="cover-actions">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={pickCover}>
                      <Icon name="image" size={14} /> {cover ? '更换封面' : '选择封面'}
                    </button>
                    {cover && (
                      <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCover(null)}>
                        移除
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="upload-actions">
            <span className="admin-muted">下一步会弹出文件选择框，单文件上限 64MB。</span>
            <div className="admin-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setUploadOpen(false)}>
                取消
              </button>
              <button type="button" className="btn btn-primary" onClick={submit} disabled={uploading}>
                {uploading ? <span className="spinner" /> : <Icon name="plus" size={15} />}
                {uploading ? '上传中…' : '选择文件并上传'}
              </button>
            </div>
          </div>
        </section>
      )}

      <div className="servers-filters assets-filters">
        <div className="search">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={keyword}
            placeholder="搜索资源名称 / 标识"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>

        <div className="servers-modes">
          {KIND_FILTERS.map((item) => {
            const count = item.value ? counts[item.value] || 0 : assets.length;
            return (
              <button
                key={item.value || 'all'}
                type="button"
                className={`hall-mode${kind === item.value ? ' is-active' : ''}`}
                onClick={() => setKind(item.value)}
              >
                {item.label}
                <em>{count}</em>
              </button>
            );
          })}
        </div>
      </div>

      <div className="assets-body">
        <section className="assets-table">
          <div className="assets-table-head">
            <span />
            <span>资源</span>
            <span>落地路径</span>
            <span>作者</span>
            <span>大小</span>
            <span>下载</span>
            <span />
          </div>

          {visible.length === 0 ? (
            <div className="empty empty--inline">
              <Icon name="spark" size={20} />
              <p>{loading ? '正在加载资源…' : '没有符合条件的资源'}</p>
            </div>
          ) : (
            visible.map((asset) => (
              <div className="assets-row" key={asset.id}>
                <span className={`asset-thumb asset-thumb--${asset.kind}`}>
                  {asset.coverUrl ? (
                    <img src={assetUrl(asset.coverUrl)} alt={`${asset.name} 封面`} loading="lazy" />
                  ) : (
                    <Icon name="spark" size={16} />
                  )}
                </span>

                <span className="assets-name">
                  <b>
                    {asset.name}
                    <span className={`tag tag--kind tag--${asset.kind}`}>
                      {KIND_LABEL[asset.kind] || asset.kind}
                    </span>
                    <em className="asset-version">v{asset.version}</em>
                  </b>
                  <small>{asset.description || '暂无说明'}</small>
                </span>

                <code className="assets-path">{asset.targetPath}</code>

                <span className="assets-author">
                  <Avatar user={{ gameName: asset.authorName || '?' }} size="xs" />
                  {asset.authorName || '未知作者'}
                </span>

                <span className="assets-size">{formatBytes(asset.fileSize)}</span>
                <span className="assets-downloads">{formatNumber(asset.downloads)}</span>

                <span className="assets-ops">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    disabled={installingId === asset.id || !settings?.esfModDir}
                    onClick={() => install(asset)}
                  >
                    {installingId === asset.id ? <span className="spinner" /> : <Icon name="folder" size={13} />}
                    {installingId === asset.id
                      ? '安装中…'
                      : settings?.esfModDir
                        ? '安装'
                        : '先设目录'}
                  </button>
                </span>
              </div>
            ))
          )}

          <p className="assets-sync">
            <Icon name="refresh" size={12} /> 共 {visible.length} 条
            {kind ? `（全部 ${assets.length} 条）` : ''} · 模型 {counts.model} · 声音 {counts.sound} · 特效{' '}
            {counts.sprite}
          </p>
        </section>

        <aside className="assets-side">
          <div className="section-head">
            <h2>安装位置</h2>
            <span className="tag">MOD DIR</span>
          </div>

          <code className="assets-dir">{settings?.esfModDir || '还没有设置游戏目录'}</code>

          <p className="assets-note">安装前会备份原文件；同一资源重复安装会覆盖上一次。</p>

          <div className="assets-kinds">
            {KIND_FILTERS.filter((item) => item.value).map((item) => (
              <span key={item.value}>
                <b>{item.label}</b>
                <em>{KIND_HINT[item.value].replace('只收 ', '').split('，')[0]}</em>
              </span>
            ))}
          </div>

          <p className="assets-note">作者上传后要等管理员审核，通过才会出现在左边列表里。</p>
        </aside>
      </div>
    </div>
  );
}
