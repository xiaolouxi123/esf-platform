import { useEffect, useState } from 'react';
import Icon from './Icon';

/**
 * 登录/注册页的「服务器设置」。
 * 私服场景下玩家需要自己填平台地址（尤其是临时隧道地址），
 * 保存后立刻生效，并回调父组件重新检测后端。
 */
export default function ServerSetting({ onChanged }) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    let alive = true;
    window.electronAPI.settings
      .get()
      .then((value) => {
        if (alive) setUrl(value?.apiBaseUrl || '');
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const save = async () => {
    const next = url.trim().replace(/\/+$/, '');
    if (!/^https?:\/\//i.test(next)) {
      setMessage('地址要以 http:// 或 https:// 开头');
      return;
    }

    setBusy(true);
    setMessage('');
    try {
      await window.electronAPI.settings.update({ apiBaseUrl: next });
      setUrl(next);
      setMessage('已保存，正在重新连接…');
      await onChanged?.();
      setMessage('已连接');
    } catch (err) {
      setMessage(err.message || '保存失败');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-server">
      <button type="button" className="link auth-server-toggle" onClick={() => setOpen((value) => !value)}>
        <Icon name="wifi" size={12} /> 服务器设置
      </button>

      {open && (
        <div className="auth-server-box">
          <input
            type="text"
            value={url}
            placeholder="https://xxxx.trycloudflare.com 或 http://IP:3000"
            onChange={(event) => setUrl(event.target.value)}
            onKeyDown={(event) => event.key === 'Enter' && save()}
          />
          <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={busy}>
            {busy ? <span className="spinner" /> : '保存并连接'}
          </button>
          {message ? <small className="auth-server-msg">{message}</small> : null}
        </div>
      )}
    </div>
  );
}
