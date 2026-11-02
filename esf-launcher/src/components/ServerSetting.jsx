import { useEffect, useState } from 'react';
import Icon from './Icon';

/**
 * 登录/注册页的「服务器设置」。
 * 玩家只需要填域名根地址（如 https://xxx.lhr.life），
 * 这里会自动去掉误填的 /api/health、末尾斜杠，并在保存后真实测试连接。
 */
function normalizeBase(raw) {
  let value = String(raw || '').trim();
  if (!value) return '';

  // 去掉末尾斜杠
  value = value.replace(/\/+$/, '');

  // 误填了 /api/health、/api/config 之类，截到 /api 之前
  const apiIndex = value.search(/\/api(\/|$)/i);
  if (apiIndex >= 0) value = value.slice(0, apiIndex);

  return value.replace(/\/+$/, '');
}

export default function ServerSetting({ onChanged }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [current, setCurrent] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI.settings
      .get()
      .then((value) => {
        if (!alive) return;
        const base = normalizeBase(value?.apiBaseUrl || '');
        setUrl(base);
        setCurrent(base);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const next = normalizeBase(url);
    if (!/^https?:\/\//i.test(next)) {
      setMessage('请填写 http:// 或 https:// 开头的地址');
      return;
    }

    setBusy(true);
    setMessage('正在连接…');
    try {
      await window.electronAPI.settings.update({ apiBaseUrl: next });
      const config = await window.electronAPI.app.config();
      setUrl(next);
      setCurrent(next);
      setMessage(`已连接 · v${config.version || '?'}${config.db === 'up' ? ' · 数据库正常' : ''}`);
      await onChanged?.();
    } catch (err) {
      setMessage(`地址已保存，但连接失败：${err.message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-server">
      <button type="button" className="link auth-server-toggle" onClick={() => setOpen((value) => !value)}>
        <Icon name="wifi" size={12} />
        {open ? '收起服务器设置' : `服务器：${current || '未设置'} · 修改`}
      </button>

      {open && (
        <div className="auth-server-box">
          <input
            type="text"
            value={url}
            placeholder="只填根地址，例如 https://xxxx.lhr.life"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : '保存并连接'}
          </button>
          <small className="auth-server-msg">
            {message || '填域名根地址即可，不要带 /api/health'}
          </small>
        </div>
      )}
    </div>
  );
}
