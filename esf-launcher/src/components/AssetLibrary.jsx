import { useCallback, useEffect, useState } from 'react';
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

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const data = await window.electronAPI.assets.list({
        kind: kind || undefined,
        q: keyword.trim() || undefined,
      });
      setAssets(data.assets || []);
    } catch (err) {
      toast(err.message, 'error');
      setAssets([]);
    } finally {
      setLoading(false);
    }
  }, [kind, keyword, toast]);

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 200);
    return () => clearTimeout(timer);
  }, [refresh]);

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
      });

      toast(
        asset.status === 'approved' ? `已上架：${asset.name}` : `已提交审核：${asset.name}，等管理员通过后其他玩家可见`,
        'ok'
      );
      setUploadOpen(false);
      setForm({ kind: 'model', name: '', version: '1.0.0', targetPath: '', description: '' });
      await refresh();
    } catch (err) {
      if (err.code !== 'CANCELED') toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="assets-page">
      <header className="assets-head">
        <div>
          <h2>
            资源库
            <span className="pill">{assets.length}</span>
          </h2>
          <p>模型、声音与特效由作者上传、管理员审核；安装后会落到模组目录，原文件自动备份。</p>
        </div>

        <div className="assets-head-actions">
          <button type="button" className="btn btn-ghost" onClick={refresh} disabled={loading}>
            {loading ? <span className="spinner" /> : <Icon name="refresh" size={15} />}
            {loading ? '刷新中…' : '刷新'}
          </button>
          <button type="button" className="btn btn-primary" onClick={() => setUploadOpen((v) => !v)}>
            <Icon name="plus" size={15} /> 上传资源
          </button>
        </div>
      </header>

      {uploadOpen && (
        <section className="upload-panel">
          <div className="upload-grid">
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
          </div>

          <label className="field">
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

          <label className="field">
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

      <div className="assets-toolbar">
        <div className="segmented">
          {KIND_FILTERS.map((item) => (
            <button
              key={item.value || 'all'}
              type="button"
              className={kind === item.value ? 'is-active' : ''}
              onClick={() => setKind(item.value)}
            >
              {item.label}
            </button>
          ))}
        </div>

        <div className="search">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={keyword}
            placeholder="搜索资源名称 / 标识"
            onChange={(event) => setKeyword(event.target.value)}
          />
        </div>
      </div>

      {assets.length === 0 ? (
        <div className="empty">
          <Icon name="spark" size={26} />
          <p>{loading ? '正在加载资源…' : '还没有已上架的资源'}</p>
        </div>
      ) : (
        <div className="asset-grid">
          {assets.map((asset) => (
            <article key={asset.id} className="asset-card">
              <header className="asset-card-head">
                <span className={`tag tag--kind tag--${asset.kind}`}>{KIND_LABEL[asset.kind] || asset.kind}</span>
                <span className="asset-version">v{asset.version}</span>
              </header>

              <h3>{asset.name}</h3>
              <p className="asset-desc">{asset.description || '暂无说明'}</p>
              <code className="asset-path">{asset.targetPath}</code>

              <footer className="asset-foot">
                <span className="asset-author">
                  <Avatar user={{ gameName: asset.authorName || '?' }} size="xs" />
                  {asset.authorName || '未知作者'}
                </span>
                <span>{formatBytes(asset.fileSize)}</span>
                <span>{formatNumber(asset.downloads)} 次下载</span>
              </footer>

              <div className="asset-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm btn-block"
                  disabled={installingId === asset.id || !settings?.esfModDir}
                  onClick={() => install(asset)}
                >
                  {installingId === asset.id ? <span className="spinner" /> : <Icon name="folder" size={13} />}
                  {installingId === asset.id
                    ? '安装中…'
                    : settings?.esfModDir
                      ? '安装到模组'
                      : '先设置游戏目录'}
                </button>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
