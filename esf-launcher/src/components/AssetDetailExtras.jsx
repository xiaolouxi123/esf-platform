import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import { formatBytes, formatRelative, isStaff } from '../lib/format';

function Stars({ value, count, onRate, disabled }) {
  const [hover, setHover] = useState(0);
  const shown = hover || Math.round(Number(value) || 0);
  return (
    <div className="asset-rating" aria-label={'评分 ' + (Number(value) || 0) + ' 分'}>
      <div className="asset-stars">
        {[1, 2, 3, 4, 5].map((star) => (
          <button
            key={star}
            type="button"
            className={'asset-star' + (star <= shown ? ' is-on' : '')}
            aria-label={'打 ' + star + ' 星'}
            disabled={disabled}
            onMouseEnter={() => setHover(star)}
            onMouseLeave={() => setHover(0)}
            onClick={() => onRate(star)}
          >
            ★
          </button>
        ))}
      </div>
      <span>
        {Number(value) ? Number(value).toFixed(1) : '暂无评分'}
        {count ? ' · ' + count + ' 人' : ''}
      </span>
    </div>
  );
}

export default function AssetDetailExtras({ asset, user, toast, onChanged }) {
  const staff = isStaff(user?.role);
  const canDeleteComment = (comment) =>
    staff || Boolean(asset.canManage) || (user?.id != null && Number(comment.userId) === Number(user.id));
  const [tab, setTab] = useState('files');
  const [comments, setComments] = useState([]);
  const [commentTotal, setCommentTotal] = useState(0);
  const [commentText, setCommentText] = useState('');
  const [busy, setBusy] = useState(false);
  const [reportOpen, setReportOpen] = useState(false);
  const [reportText, setReportText] = useState('');
  const [myRating, setMyRating] = useState(Number(asset.myRating) || 0);

  const files = Array.isArray(asset.files) ? asset.files : [];
  const versions = Array.isArray(asset.versions) ? asset.versions : [];
  const tags = String(asset.tags || '').split(',').map((tag) => tag.trim()).filter(Boolean);

  const loadComments = useCallback(async () => {
    try {
      const data = await window.electronAPI.assets.comments(asset.id, { limit: 30, offset: 0 });
      setComments(data.comments || []);
      setCommentTotal(Number(data.total) || 0);
    } catch {
      setComments([]);
      setCommentTotal(0);
    }
  }, [asset.id]);

  useEffect(() => {
    const timer = setTimeout(loadComments, 0);
    return () => clearTimeout(timer);
  }, [loadComments]);

  const rate = async (stars) => {
    if (busy) return;
    setBusy(true);
    try {
      const data = await window.electronAPI.assets.rate(asset.id, stars);
      setMyRating(stars);
      toast('已评 ' + stars + ' 星', 'ok');
      onChanged?.({ rating: data.rating });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const sendComment = async () => {
    const body = commentText.trim();
    if (!body) return;
    setBusy(true);
    try {
      await window.electronAPI.assets.comment(asset.id, body);
      setCommentText('');
      await loadComments();
      onChanged?.({ commentDelta: 1 });
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeComment = async (commentId) => {
    try {
      await window.electronAPI.assets.deleteComment(asset.id, commentId);
      await loadComments();
      onChanged?.({ commentDelta: -1 });
    } catch (err) {
      toast(err.message, 'error');
    }
  };

  const sendReport = async () => {
    if (reportText.trim().length < 2) return toast('写两句举报原因', 'error');
    setBusy(true);
    try {
      await window.electronAPI.assets.report(asset.id, reportText.trim());
      setReportOpen(false);
      setReportText('');
      toast('已提交举报，管理员会处理', 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const tabs = useMemo(
    () => [
      { value: 'files', label: '文件 ' + (files.length || asset.fileCount || 0) },
      { value: 'versions', label: '版本 ' + (versions.length || 1) },
      { value: 'comments', label: '评论 ' + (commentTotal || asset.commentCount || 0) },
    ],
    [files.length, versions.length, commentTotal, asset.fileCount, asset.commentCount]
  );

  return (
    <div className="asset-extras">
      <div className="asset-rating-line">
        <Stars
          value={asset.rating?.average || 0}
          count={asset.rating?.count || 0}
          onRate={rate}
          disabled={busy || !window.electronAPI?.assets}
        />
        <button type="button" className="asset-report-link" onClick={() => setReportOpen((open) => !open)}>
          <Icon name="alert" size={11} /> 举报
        </button>
      </div>
      {myRating ? <p className="asset-my-rating">你打了 {myRating} 星</p> : null}

      {reportOpen ? (
        <div className="asset-report-box">
          <textarea
            value={reportText}
            maxLength={500}
            placeholder="说明问题：文件损坏 / 盗用 / 含可执行文件 / 与说明不符…"
            onChange={(event) => setReportText(event.target.value)}
          />
          <div>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setReportOpen(false)}>
              取消
            </button>
            <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={sendReport}>
              提交举报
            </button>
          </div>
        </div>
      ) : null}

      {tags.length ? (
        <div className="asset-tag-list">
          {tags.map((tag) => (
            <span key={tag} className="asset-tag">#{tag}</span>
          ))}
        </div>
      ) : null}

      <div className="asset-tabs" role="tablist" aria-label="资源详情分区">
        {tabs.map((item) => (
          <button
            key={item.value}
            type="button"
            role="tab"
            aria-selected={tab === item.value}
            className={'asset-tab' + (tab === item.value ? ' is-active' : '')}
            onClick={() => setTab(item.value)}
          >
            {item.label}
          </button>
        ))}
      </div>

      {tab === 'files' ? (
        <div className="asset-file-list">
          {files.length ? (
            files.map((file) => (
              <div className="asset-file-row" key={file.id || file.path}>
                <code title={file.path}>{file.path}</code>
                <span>{formatBytes(file.size)}</span>
              </div>
            ))
          ) : (
            <p className="asset-extra-empty">这个版本只登记了一个主文件。</p>
          )}
          <p className="asset-extra-hint">安装时逐文件校验 sha256，失败会自动回滚。</p>
        </div>
      ) : null}

      {tab === 'versions' ? (
        <div className="asset-version-list">
          {versions.length ? (
            versions.map((version) => (
              <div className="asset-version-row" key={version.version + version.createdAt}>
                <div>
                  <b>v{version.version}</b>
                  <em>{formatRelative(version.createdAt)}</em>
                </div>
                <span className={'asset-version-state is-' + version.status}>
                  {version.status === 'approved' ? '已上架' : version.status === 'pending' ? '待审核' : '已驳回'}
                </span>
                <p>{version.changelog || '这个版本没有写更新说明。'}</p>
                <small>{version.fileCount} 个文件 · {formatBytes(version.totalSize)}</small>
              </div>
            ))
          ) : (
            <p className="asset-extra-empty">还没有版本历史。</p>
          )}
        </div>
      ) : null}

      {tab === 'comments' ? (
        <div className="asset-comments">
          <div className="asset-comment-form">
            <textarea
              value={commentText}
              maxLength={300}
              placeholder="说点什么：手感、兼容性、安装遇到的问题…"
              onChange={(event) => setCommentText(event.target.value)}
            />
            <button type="button" className="btn btn-primary btn-sm" disabled={busy || !commentText.trim()} onClick={sendComment}>
              发表
            </button>
          </div>
          {comments.length ? (
            comments.map((comment) => (
              <div className="asset-comment" key={comment.id}>
                <Avatar user={{ gameName: comment.userName }} size="xs" />
                <div>
                  <div className="asset-comment-head">
                    <b>{comment.userName}</b>
                    <span>{formatRelative(comment.createdAt)}</span>
                    {canDeleteComment(comment) ? (
                      <button type="button" aria-label="删除评论" onClick={() => removeComment(comment.id)}>
                        <Icon name="close" size={10} />
                      </button>
                    ) : null}
                  </div>
                  <p>{comment.body}</p>
                </div>
              </div>
            ))
          ) : (
            <p className="asset-extra-empty">还没有评论，来当第一个。</p>
          )}
        </div>
      ) : null}
    </div>
  );
}
