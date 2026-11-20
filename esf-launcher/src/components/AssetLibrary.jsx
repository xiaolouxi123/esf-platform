import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';
import Avatar from './Avatar';
import DragonHeroBackdrop from './DragonHeroBackdrop';
import SelectMenu from './SelectMenu';
import { formatBytes, formatNumber, formatRelative } from '../lib/format';

const KIND_FILTERS = [
  { value: '', label: '全部' },
  { value: 'map', label: '地图' },
  { value: 'model', label: '模型' },
  { value: 'sound', label: '声音' },
  { value: 'sprite', label: '特效' },
  { value: 'other', label: '其它' },
];

const KIND_META = {
  map: {
    label: '地图',
    icon: 'map',
    accept: '只收 .bsp（≤64MB）',
    hint: '路径可留空，自动保存为 maps/<文件名>.bsp',
  },
  model: {
    label: '模型',
    icon: 'user',
    accept: '只收 .mdl',
    hint: '落地路径例：models/player/goku/goku.mdl',
  },
  sound: {
    label: '声音',
    icon: 'signal',
    accept: '只收 .wav / .mp3',
    hint: '落地路径例：sound/weapons/beam.wav',
  },
  sprite: {
    label: '特效',
    icon: 'spark',
    accept: '只收 .spr',
    hint: '落地路径例：sprites/beam.spr',
  },
  other: {
    label: '其它',
    icon: 'folder',
    accept: '只收 .tga / .bmp',
    hint: '落地路径例：gfx/env/sky.tga',
  },
};

const SORT_OPTIONS = [
  { value: 'recent', label: '最近更新' },
  { value: 'downloads', label: '下载最多' },
  { value: 'name', label: '名称' },
];

const KIND_OPTIONS = Object.entries(KIND_META).map(([value, meta]) => ({
  value,
  label: meta.label,
}));

const PAGE_SIZE = 100;

const assetTime = (asset) => {
  const value = new Date(asset.updatedAt || asset.createdAt || 0).getTime();
  return Number.isFinite(value) ? value : 0;
};

const assetPathPlaceholder = (kind) =>
  kind === 'map'
    ? 'maps/ape_forestshadow.bsp（可留空）'
    : KIND_META[kind]?.hint || KIND_META.model.hint;

export default function AssetLibrary({ toast, settings, onOpenSettings }) {
  const [kind, setKind] = useState('');
  const [keyword, setKeyword] = useState('');
  const [sort, setSort] = useState('recent');
  const [assets, setAssets] = useState([]);
  const [pageTotal, setPageTotal] = useState(0);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [activeId, setActiveId] = useState(null);
  const [installingId, setInstallingId] = useState(null);
  const [restoringId, setRestoringId] = useState(null);
  const [receipts, setReceipts] = useState([]);
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
  const lastFocusRef = useRef(null);

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

  const loadReceipts = useCallback(async () => {
    try {
      const data = await window.electronAPI.assets.receipts();
      setReceipts(data.receipts || []);
    } catch {
      setReceipts([]);
    }
  }, []);

  const refresh = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const data = await window.electronAPI.assets.list({ limit: PAGE_SIZE, offset: 0 });
      setAssets(data.assets || []);
      setPageTotal(Number(data.total) || 0);
      setStats(data.stats || null);
      await loadReceipts();
    } catch (err) {
      const message = String(err.message || '');
      setLoadError(
        /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|fetch failed|网络|连接/i.test(message)
          ? '连接平台服务失败，请检查网络后重试。'
          : message || '资源加载失败'
      );
      setAssets([]);
      setPageTotal(0);
      setStats(null);
    } finally {
      setLoading(false);
    }
  }, [loadReceipts]);

  const loadMore = async () => {
    if (loadingMore || assets.length >= pageTotal) return;
    setLoadingMore(true);
    try {
      const data = await window.electronAPI.assets.list({
        limit: PAGE_SIZE,
        offset: assets.length,
      });
      setAssets((prev) => {
        const seen = new Set(prev.map((item) => Number(item.id)));
        return [...prev, ...(data.assets || []).filter((item) => !seen.has(Number(item.id)))];
      });
      setPageTotal(Number(data.total) || assets.length);
      if (data.stats) setStats(data.stats);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setLoadingMore(false);
    }
  };

  useEffect(() => {
    const timer = setTimeout(() => refresh(), 80);
    return () => clearTimeout(timer);
  }, [refresh]);

  useEffect(() => {
    if (!uploadOpen) return undefined;
    const onKeyDown = (event) => {
      if (event.key !== 'Escape' || uploading) return;
      event.stopPropagation();
      setUploadOpen(false);
      window.setTimeout(() => {
        if (lastFocusRef.current instanceof HTMLElement) lastFocusRef.current.focus();
        lastFocusRef.current = null;
      }, 0);
    };
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [uploadOpen, uploading]);

  useEffect(() => {
    if (!uploadOpen) return undefined;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [uploadOpen]);

  const visible = useMemo(() => {
    const query = keyword.trim().toLowerCase();
    return assets.filter((asset) => {
      if (kind && asset.kind !== kind) return false;
      if (!query) return true;
      return [asset.name, asset.targetPath, asset.description, asset.authorName]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(query));
    });
  }, [assets, keyword, kind]);

  const sorted = useMemo(() => {
    const list = [...visible];
    if (sort === 'downloads') {
      list.sort((a, b) => (Number(b.downloads) || 0) - (Number(a.downloads) || 0));
    } else if (sort === 'name') {
      list.sort((a, b) => String(a.name || '').localeCompare(String(b.name || ''), 'zh-Hans-CN'));
    } else {
      list.sort((a, b) => assetTime(b) - assetTime(a) || Number(b.id) - Number(a.id));
    }
    return list;
  }, [visible, sort]);

  const counts = useMemo(() => {
    if (stats?.counts) return stats.counts;
    const acc = { map: 0, model: 0, sound: 0, sprite: 0, other: 0 };
    assets.forEach((asset) => {
      if (acc[asset.kind] === undefined) acc.other += 1;
      else acc[asset.kind] += 1;
    });
    return acc;
  }, [assets, stats]);

  const totalDownloads = useMemo(() => {
    if (stats?.totalDownloads !== undefined) return Number(stats.totalDownloads) || 0;
    return assets.reduce((sum, asset) => sum + (Number(asset.downloads) || 0), 0);
  }, [assets, stats]);

  const authorCount = useMemo(() => {
    if (stats?.authorCount !== undefined) return Number(stats.authorCount) || 0;
    return new Set(assets.map((asset) => asset.authorName).filter(Boolean)).size;
  }, [assets, stats]);

  const totalCount = stats ? Object.values(counts).reduce((sum, value) => sum + Number(value || 0), 0) : pageTotal;

  const receiptByAsset = useMemo(() => {
    const map = new Map();
    receipts.forEach((receipt) => {
      map.set(Number(receipt.id), receipt);
      if (receipt.slug) map.set(`slug:${receipt.slug}`, receipt);
    });
    return map;
  }, [receipts]);

  const getReceipt = (asset) =>
    receiptByAsset.get(Number(asset.id)) || (asset.slug ? receiptByAsset.get(`slug:${asset.slug}`) : null);

  const activeAsset = useMemo(
    () => sorted.find((asset) => Number(asset.id) === Number(activeId)) || sorted[0] || null,
    [activeId, sorted]
  );

  const handleRowKeyDown = (event, asset) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const index = sorted.findIndex((item) => Number(item.id) === Number(asset.id));
    if (index < 0) return;
    const next =
      event.key === 'Home'
        ? 0
        : event.key === 'End'
          ? sorted.length - 1
          : Math.min(sorted.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)));
    if (next === index) return;
    const container = event.currentTarget.closest('.asset-list-scroll');
    const nextId = sorted[next].id;
    const nextRow = container?.querySelector(`[data-asset-id="${nextId}"].asset-row-main`);
    nextRow?.focus();
    setActiveId(nextId);
  };

  const activeReceipt = activeAsset ? getReceipt(activeAsset) : null;
  const activeInstalled = Boolean(activeReceipt?.exists);
  const activeHasUpdate =
    activeInstalled && activeAsset && activeReceipt.version !== activeAsset.version;

  const hasFilter = Boolean(keyword.trim() || kind);

  const openUpload = (event) => {
    const trigger = event?.currentTarget;
    lastFocusRef.current =
      trigger instanceof HTMLElement ? trigger : document.activeElement;
    setUploadOpen(true);
    window.setTimeout(() => {
      uploadRef.current?.querySelector('.asset-upload-grid button, .asset-upload-grid input')?.focus();
    }, 40);
  };

  const closeUpload = () => {
    if (uploading) return;
    setUploadOpen(false);
    window.setTimeout(() => {
      if (lastFocusRef.current instanceof HTMLElement) lastFocusRef.current.focus();
      lastFocusRef.current = null;
    }, 0);
  };

  const handleInstall = async (asset) => {
    if (!settings?.esfModDir) {
      toast('先设置游戏目录，再安装资源', 'error');
      onOpenSettings?.();
      return;
    }
    setInstallingId(asset.id);
    try {
      const result = await window.electronAPI.assets.install(asset.id);
      toast(
        `已安装到 ${result.targetPath}（${formatBytes(result.bytes)}${result.backedUp ? '，原文件已备份' : ''}）`,
        'ok'
      );
      await loadReceipts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setInstallingId(null);
    }
  };

  const handleRestore = async (asset) => {
    const receipt = getReceipt(asset);
    if (!receipt) return;
    setRestoringId(asset.id);
    try {
      const result = await window.electronAPI.assets.restore(receipt.id);
      toast(`已恢复原文件：${result.targetPath}`, 'ok');
      await loadReceipts();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setRestoringId(null);
    }
  };

  const submit = async () => {
    if (uploading) return;
    if (!form.name.trim()) return toast('请填写资源名称', 'error');
    if (!form.targetPath.trim() && form.kind !== 'map') return toast('请填写落地路径', 'error');

    setUploading(true);
    try {
      const asset = await window.electronAPI.assets.upload({
        kind: form.kind,
        name: form.name.trim(),
        version: form.version.trim() || '1.0.0',
        targetPath: form.targetPath.trim() || undefined,
        description: form.description.trim() || undefined,
        coverBase64: cover?.base64,
        coverName: cover?.name,
        coverMime: cover?.mime,
      });

      toast(
        asset.status === 'approved'
          ? `已上架：${asset.name}`
          : `已提交审核：${asset.name}，等管理员通过后其他玩家可见`,
        'ok'
      );
      setUploadOpen(false);
      window.setTimeout(() => {
        if (lastFocusRef.current instanceof HTMLElement) lastFocusRef.current.focus();
        lastFocusRef.current = null;
      }, 0);
      if (asset.status === 'approved') setActiveId(asset.id);
      setForm({ kind: 'model', name: '', version: '1.0.0', targetPath: '', description: '' });
      setCover(null);
      await refresh();
    } catch (err) {
      if (err.code === 'CANCELED') toast('已取消选择文件');
      else toast(err.message, 'error');
    } finally {
      setUploading(false);
    }
  };

  const trapUploadFocus = (event) => {
    if (event.key !== 'Tab') return;
    const nodes = uploadRef.current?.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled])'
    );
    if (!nodes?.length) return;
    const first = nodes[0];
    const last = nodes[nodes.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <div className="assets-page assets-v2">
      <header className="hero assets-hero assets-hero--v2 hero--dragon">
        <DragonHeroBackdrop />

        <div className="hero-content">
          <div className="eyebrow">
            <Icon name="spark" size={12} />
            GOLDSRC · 模组资源
            <span className={`eyebrow-status${settings?.esfModDir ? ' is-on' : ' is-off'}`}>
              {settings?.esfModDir ? '可安装' : '未配置目录'}
            </span>
            <span className="eyebrow-note">作者上传 · 管理员审核 · 安装前自动备份</span>
          </div>

          <h1 className="hero-title">资源库</h1>

          <div className="hero-tags">
            <span className="tag tag--code">GoldSrc</span>
            <span className="tag">安装前备份</span>
            <span className="tag tag--mode tag--asset">管理员审核</span>
          </div>
        </div>

        <div className="hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--assets">
              <span>已上架</span>
              <b>{stats ? formatNumber(totalCount) : '—'}</b>
            </div>
            <div className="hud-cell hud-cell--download">
              <span>总下载</span>
              <b>{stats ? formatNumber(totalDownloads) : '—'}</b>
            </div>
            <div className="hud-cell hud-cell--author">
              <span>作者</span>
              <b>{stats ? formatNumber(authorCount) : '—'}</b>
            </div>
            <div className="hud-cell hud-cell--time">
              <span>最近更新</span>
              <b>
                {loadError || !assets.length
                  ? '—'
                  : formatRelative(assets[0]?.updatedAt || assets[0]?.createdAt)}
              </b>
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

      <div className="assets-toolbar">
        <div className="search assets-search">
          <Icon name="search" size={15} />
          <input
            type="text"
            value={keyword}
            aria-label="搜索资源"
            placeholder="搜索资源名称 / 标识 / 说明"
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword ? (
            <button
              type="button"
              className="asset-search-clear"
              aria-label="清除搜索"
              onClick={() => setKeyword('')}
            >
              <Icon name="close" size={12} />
            </button>
          ) : null}
        </div>

        <div className="asset-seg" role="group" aria-label="资源类型">
          {KIND_FILTERS.map((item) => {
            const count = item.value ? counts[item.value] || 0 : totalCount;
            return (
              <button
                key={item.value || 'all'}
                type="button"
                className={`asset-seg-btn${kind === item.value ? ' is-active' : ''}`}
                aria-pressed={kind === item.value}
                onClick={() => setKind(item.value)}
              >
                {item.label}
                <em>{stats || pageTotal ? count : '—'}</em>
              </button>
            );
          })}
        </div>

        <div className="asset-sort">
          <span>排序</span>
          <SelectMenu
            value={sort}
            options={SORT_OPTIONS}
            onChange={setSort}
            ariaLabel="排序方式"
            buttonClassName="select-menu-trigger--sort"
          />
        </div>
      </div>

      <div className={`assets-body assets-body--v2${activeAsset ? '' : ' assets-body--empty'}`}>
        <section className="asset-list" aria-label="资源列表">
          <div className="asset-list-head">
            <span>资源</span>
            <span>作者 / 数据</span>
            <span>操作</span>
          </div>

          <div className="asset-list-scroll" aria-busy={loading}>
            {loading && assets.length === 0 ? (
              [0, 1, 2, 3, 4].map((item) => (
                <div className="asset-skeleton" key={item}>
                  <span className="asset-skeleton-thumb" />
                  <span className="asset-skeleton-lines">
                    <i />
                    <i />
                  </span>
                </div>
              ))
            ) : loadError ? (
              <div className="asset-empty">
                <span className="asset-empty-icon asset-empty-icon--error">
                  <Icon name="alert" size={22} />
                </span>
                <b>资源没能加载出来</b>
                <p>{loadError}</p>
                <button type="button" className="btn btn-ghost btn-sm" onClick={refresh}>
                  <Icon name="refresh" size={13} /> 重试
                </button>
              </div>
            ) : sorted.length === 0 ? (
              <div className="asset-empty">
                <span className="asset-empty-icon">
                  <Icon name={hasFilter ? 'search' : 'spark'} size={22} />
                </span>
                <b>{hasFilter ? '没有找到符合条件的资源' : '资源库还是空的'}</b>
                <p>
                  {hasFilter
                    ? '换个关键词或类型试试，也可以清除筛选看全部资源。'
                    : '上传第一份地图、模型、声音或特效，审核通过后其他玩家就能直接安装。'}
                </p>
                {hasFilter ? (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setKeyword('');
                      setKind('');
                    }}
                  >
                    <Icon name="close" size={13} /> 清除筛选
                  </button>
                ) : (
                  <button type="button" className="btn btn-primary btn-sm" onClick={openUpload}>
                    <Icon name="plus" size={13} /> 上传第一份资源
                  </button>
                )}
              </div>
            ) : (
              sorted.map((asset) => {
                const meta = KIND_META[asset.kind] || KIND_META.other;
                const selected = Number(activeAsset?.id) === Number(asset.id);
                const installing = installingId === asset.id;
                const receipt = getReceipt(asset);
                const installed = Boolean(receipt?.exists);
                const hasUpdate = installed && receipt.version !== asset.version;
                return (
                  <div
                    className={`asset-row${selected ? ' is-active' : ''}${installed ? ' is-installed' : ''}`}
                    key={asset.id}
                  >
                    <button
                      type="button"
                      className="asset-row-main"
                      data-asset-id={asset.id}
                      tabIndex={selected ? 0 : -1}
                      aria-current={selected ? 'true' : undefined}
                      title={`查看 ${asset.name} 的详情`}
                      onClick={() => setActiveId(asset.id)}
                      onFocus={() => setActiveId(asset.id)}
                      onKeyDown={(event) => handleRowKeyDown(event, asset)}
                    >
                      <span className={`asset-thumb asset-thumb--${asset.kind}`}>
                        <Icon name={meta.icon} size={17} />
                        {asset.coverUrl ? (
                          <img src={assetUrl(asset.coverUrl)} alt={`${asset.name} 封面`} loading="lazy" />
                        ) : null}
                      </span>
                      <span className="asset-main">
                        <span className="asset-title-line">
                          <b title={asset.name}>{asset.name}</b>
                          <em>v{asset.version}</em>
                          {installed ? (
                            <span className={`asset-state${hasUpdate ? ' asset-state--update' : ''}`}>
                              {hasUpdate ? '有更新' : '已安装'}
                            </span>
                          ) : null}
                        </span>
                        <span className="asset-path-line">
                          <span className={`asset-kind asset-kind--${asset.kind}`}>{meta.label}</span>
                          <code title={asset.targetPath}>{asset.targetPath}</code>
                        </span>
                      </span>
                    </button>

                    <div className="asset-row-side">
                      <span className="asset-author" title={asset.authorName || '未知作者'}>
                        <Avatar user={{ gameName: asset.authorName || '?' }} size="xs" />
                        {asset.authorName || '未知作者'}
                      </span>
                      <span className="asset-row-data">
                        {formatNumber(asset.downloads)} 下载 · {formatBytes(asset.fileSize)}
                      </span>
                    </div>

                    <div className="asset-row-ops">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost asset-row-install"
                        tabIndex={selected ? 0 : -1}
                        disabled={installing}
                        aria-label={`安装 ${asset.name}`}
                        title={settings?.esfModDir ? `安装到 ${settings.esfModDir}` : '先设置游戏目录'}
                        onClick={() => handleInstall(asset)}
                      >
                        {installing ? <span className="spinner" /> : <Icon name="folder" size={13} />}
                        {installing
                          ? '安装中'
                          : !settings?.esfModDir
                            ? '先设目录'
                            : hasUpdate
                              ? '更新'
                              : installed
                                ? '重装'
                                : '安装'}
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <div className="asset-list-foot">
            <span>
              {loadError
                ? '统计不可用'
                : hasFilter
                  ? `筛选 ${sorted.length} 条 / 全库 ${totalCount} 条`
                  : `共 ${totalCount} 条`}
              {pageTotal > assets.length ? ` · 已加载 ${assets.length}` : ''}
            </span>
            <div className="asset-list-foot-right">
              {assets.length < pageTotal ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm asset-load-more"
                  onClick={loadMore}
                  disabled={loadingMore}
                >
                  {loadingMore ? <span className="spinner" /> : <Icon name="chevron" size={12} />}
                  {loadingMore ? '加载中…' : '加载更多'}
                </button>
              ) : null}
              <span>{loading ? '正在同步…' : '安装前自动备份原文件'}</span>
            </div>
          </div>
        </section>

        <aside className="asset-side" aria-label="资源详情">
          <div className="asset-side-scroll">
            {activeAsset ? (
              <>
                <div className="asset-side-head">
                  <span>资源详情</span>
                  <span className={`asset-kind asset-kind--${activeAsset.kind}`}>
                    {KIND_META[activeAsset.kind]?.label || '其它'}
                  </span>
                </div>

                <div className={`asset-cover asset-cover--${activeAsset.kind}`}>
                  <Icon name={KIND_META[activeAsset.kind]?.icon || 'spark'} size={34} />
                  {activeAsset.coverUrl ? (
                    <img src={assetUrl(activeAsset.coverUrl)} alt={`${activeAsset.name} 封面`} />
                  ) : null}
                </div>

                <div className="asset-side-title">
                  <h3 title={activeAsset.name}>{activeAsset.name}</h3>
                  <em>v{activeAsset.version}</em>
                </div>
                {activeInstalled ? (
                  <div className={`asset-installed-banner${activeHasUpdate ? ' is-update' : ''}`}>
                    <Icon name={activeHasUpdate ? 'spark' : 'check'} size={12} />
                    <span>
                      {activeHasUpdate
                        ? `本地是 v${activeReceipt.version}，可更新到 v${activeAsset.version}`
                        : `已安装到模组 · ${formatRelative(activeReceipt.installedAt)}`}
                    </span>
                  </div>
                ) : null}

                <p className="asset-side-desc" title={activeAsset.description || ''}>
                  {activeAsset.description || '作者还没有写说明，安装前可以先看看落地路径和文件大小。'}
                </p>

                <dl className="asset-meta">
                  <div>
                    <dt>落地路径</dt>
                    <dd>
                      <code title={activeAsset.targetPath}>{activeAsset.targetPath}</code>
                    </dd>
                  </div>
                  <div>
                    <dt>作者</dt>
                    <dd>
                      <Avatar user={{ gameName: activeAsset.authorName || '?' }} size="xs" />
                      {activeAsset.authorName || '未知作者'}
                    </dd>
                  </div>
                  <div>
                    <dt>文件 / 下载</dt>
                    <dd>
                      {formatBytes(activeAsset.fileSize)} · {formatNumber(activeAsset.downloads)} 次
                    </dd>
                  </div>
                  <div>
                    <dt>更新</dt>
                    <dd>{formatRelative(activeAsset.updatedAt || activeAsset.createdAt)}</dd>
                  </div>
                </dl>

                <button
                  type="button"
                  className="btn btn-primary asset-install"
                  disabled={installingId === activeAsset.id}
                  onClick={() => handleInstall(activeAsset)}
                >
                  {installingId === activeAsset.id ? <span className="spinner" /> : <Icon name="folder" size={14} />}
                  {installingId === activeAsset.id
                    ? '安装中…'
                    : !settings?.esfModDir
                      ? '先设置游戏目录'
                      : activeHasUpdate
                        ? `更新到 v${activeAsset.version}`
                        : activeInstalled
                          ? '重新安装'
                          : '安装到模组'}
                </button>
                {activeReceipt?.backupAvailable ? (
                  <button
                    type="button"
                    className="asset-restore"
                    disabled={restoringId === activeAsset.id}
                    onClick={() => handleRestore(activeAsset)}
                  >
                    {restoringId === activeAsset.id ? <span className="spinner" /> : <Icon name="refresh" size={12} />}
                    {restoringId === activeAsset.id ? '恢复中…' : '恢复安装前的原文件'}
                  </button>
                ) : null}
                <p className="asset-install-note">
                  {activeAsset.kind === 'map'
                    ? '地图会安装到模组目录的 maps/，进游戏换图即可；安装前会备份同名 .bsp 到 .esf-backup。'
                    : '安装前会把原文件备份到模组目录的 .esf-backup；同一资源重复安装会覆盖上一次。'}
                </p>
              </>
            ) : (
              <div className="asset-side-empty">
                <span className="asset-side-empty-icon">
                  <Icon name="spark" size={26} />
                </span>
                <b>挑一个资源看细节</b>
                <p>点击左侧资源，这里会显示封面、说明、落地路径和安装按钮。</p>
              </div>
            )}
          </div>

          <div className="asset-side-foot">
            <span>安装位置</span>
            <code title={settings?.esfModDir || '未配置'}>{settings?.esfModDir || '还没有设置游戏目录'}</code>
            {!settings?.esfModDir ? (
              <button type="button" className="asset-side-setting" onClick={onOpenSettings}>
                <Icon name="settings" size={12} /> 去设置
              </button>
            ) : null}
          </div>
        </aside>
      </div>

      {uploadOpen
        ? createPortal(
            <div
              className="asset-upload-backdrop"
              role="presentation"
              onMouseDown={(event) => {
                if (event.target === event.currentTarget) closeUpload();
              }}
            >
              <section
                className="asset-upload-modal"
                ref={uploadRef}
                role="dialog"
                aria-modal="true"
                aria-busy={uploading}
                aria-labelledby="asset-upload-title"
                aria-describedby="asset-upload-desc"
                onMouseDown={(event) => event.stopPropagation()}
                onKeyDown={trapUploadFocus}
              >
                <header className="asset-upload-head">
                  <div>
                    <h2 id="asset-upload-title">上传资源</h2>
                    <p id="asset-upload-desc">作者提交后由管理员审核，通过后才会出现在资源库。</p>
                  </div>
                  <button
                    type="button"
                    className="icon-btn icon-btn--sm"
                    aria-label="关闭上传"
                    onClick={closeUpload}
                    disabled={uploading}
                  >
                    <Icon name="close" size={14} />
                  </button>
                </header>

                <div className="asset-upload-grid">
                  <div className="field">
                    <span className="field-label" id="asset-upload-kind-label">类型</span>
                    <div className="field-input field-input--select">
                      <SelectMenu
                        value={form.kind}
                        options={KIND_OPTIONS}
                        onChange={(value) => setForm((prev) => ({ ...prev, kind: value, targetPath: '' }))}
                        ariaLabel="资源类型"
                        className="asset-upload-kind"
                        buttonClassName="select-menu-trigger--field"
                      />
                    </div>
                  </div>

                  <label className="field">
                    <span className="field-label">名称</span>
                    <div className="field-input">
                      <input
                        type="text"
                        value={form.name}
                        placeholder={form.kind === 'map' ? '例如：猿影森林' : '悟空新模型'}
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

                  <label className="field asset-upload-span">
                    <span className="field-label">落地路径（相对模组目录）</span>
                    <div className="field-input">
                      <Icon name="folder" size={15} />
                      <input
                        type="text"
                        value={form.targetPath}
                        placeholder={assetPathPlaceholder(form.kind)}
                        onChange={(event) => setForm((prev) => ({ ...prev, targetPath: event.target.value }))}
                      />
                    </div>
                    <span className="field-hint">
                      {KIND_META[form.kind]?.accept}，{KIND_META[form.kind]?.hint}
                    </span>
                  </label>

                  <label className="field asset-upload-span">
                    <span className="field-label">说明（可选）</span>
                    <div className="field-input">
                      <input
                        type="text"
                        value={form.description}
                        placeholder={form.kind === 'map' ? '地图人数、模式与注意事项' : '替换默认模型 / 音效说明'}
                        onChange={(event) => setForm((prev) => ({ ...prev, description: event.target.value }))}
                      />
                    </div>
                  </label>

                  <div className="field asset-upload-span">
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
                        {cover ? (
                          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setCover(null)}>
                            移除
                          </button>
                        ) : null}
                      </div>
                    </div>
                  </div>
                </div>

                <footer className="asset-upload-foot">
                  <span>
                    {form.kind === 'map'
                      ? '点右侧按钮选 .bsp；路径留空会自动用文件名，安装后进游戏换图即可。'
                      : '点右侧按钮选文件并提交，单文件上限 64MB。'}
                  </span>
                  <div className="admin-actions">
                    <button type="button" className="btn btn-ghost" onClick={closeUpload} disabled={uploading}>
                      取消
                    </button>
                    <button type="button" className="btn btn-primary" onClick={submit} disabled={uploading}>
                      {uploading ? <span className="spinner" /> : <Icon name="folder" size={15} />}
                      {uploading ? '上传中…' : '选择文件并提交'}
                    </button>
                  </div>
                </footer>
              </section>
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
