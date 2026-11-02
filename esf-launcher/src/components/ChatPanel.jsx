import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import { formatRelative } from '../lib/format';

/**
 * 大厅频道：轻量公共聊天，6 秒增量轮询。
 * 失败时显示错误并保留已有消息；窗口重新聚焦会立即补拉。
 */
export default function ChatPanel({ user, toast, titles = [], showIntro = false }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const lastIdRef = useRef(0);
  const listRef = useRef(null);
  const titleById = new Map(titles.map((item) => [Number(item.id), item]));
  const titleOf = (member) => titleById.get(Number(member?.titleId));

  const merge = useCallback((incoming) => {
    if (!incoming || incoming.length === 0) return;

    setMessages((prev) => {
      const map = new Map(prev.map((item) => [item.id, item]));
      for (const item of incoming) map.set(item.id, item);
      return [...map.values()].sort((a, b) => a.id - b.id).slice(-80);
    });

    lastIdRef.current = Math.max(lastIdRef.current, ...incoming.map((item) => item.id));
  }, []);

  const load = useCallback(
    async (after) => {
      try {
        const data = await window.electronAPI.chat.list(after);
        merge(data.messages || []);
        setError('');
      } catch (err) {
        setError(err.message || '频道暂时不可用');
      }
    },
    [merge]
  );

  useEffect(() => {
    const boot = setTimeout(() => load(0), 0);
    const timer = setInterval(() => load(lastIdRef.current), 6000);

    const refresh = () => {
      if (document.visibilityState === 'visible') load(lastIdRef.current);
    };
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);

    return () => {
      clearTimeout(boot);
      clearInterval(timer);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [load]);

  useEffect(() => {
    const el = listRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages.length]);

  const send = async () => {
    const text = draft.trim();
    if (!text || sending) return;

    setSending(true);
    try {
      const data = await window.electronAPI.chat.send(text);
      setDraft('');
      merge([data.message]);
      setError('');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setSending(false);
    }
  };

  return (
    <section className="card card--chat">
      <div className="presence-head">
        <h3>
          <Icon name="bell" size={14} /> 大厅频道
        </h3>
        <span className="presence-sub">公开可见</span>
      </div>

      <div className="chat-list" ref={listRef}>
        {showIntro && (
          <div className="channel-welcome">
            <div className="channel-welcome-title">
              <span>#</span> 大厅频道
            </div>
            <p>全服玩家实时聊天。组队、约战、反馈问题都可以在这里发，进服遇到问题优先带截图。</p>
            <div className="channel-rules">
              <span>保持友好</span>
              <span>禁止广告</span>
              <span>组队可发 IP</span>
            </div>
          </div>
        )}
        {messages.length === 0 ? (
          <p className={`admin-muted${error ? ' chat-error' : ''}`}>
            {error ? `频道连接失败：${error}（自动重试中）` : '还没有消息，打个招呼吧'}
          </p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-row${message.user.id === user?.id ? ' is-self' : ''}`}
            >
              <Avatar user={message.user} size="xs" />
              <div className="chat-body">
                <div className="chat-meta">
                  <b style={{ color: titleOf(message.user)?.color }}>{message.user.gameName}</b>
                  {titleOf(message.user) && (
                    <span
                      className="chat-title"
                      style={{
                        color: titleOf(message.user).color,
                        borderColor: `${titleOf(message.user).color}55`,
                      }}
                    >
                      {titleOf(message.user).name}
                    </span>
                  )}
                  <span>{formatRelative(message.createdAt)}</span>
                </div>
                <p>{message.body}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="chat-input">
        <input
          type="text"
          value={draft}
          maxLength={200}
          placeholder="说点什么…"
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
        />
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={sending || !draft.trim()}
          onClick={send}
        >
          {sending ? <span className="spinner" /> : <Icon name="play" size={12} />}
        </button>
      </div>
    </section>
  );
}
