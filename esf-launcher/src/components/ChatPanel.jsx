import { useCallback, useEffect, useRef, useState } from 'react';
import Avatar from './Avatar';
import Icon from './Icon';
import { formatRelative } from '../lib/format';

/**
 * 大厅频道：轻量公共聊天。
 * 6 秒轮询增量消息（after=最后一条 id），不做 WebSocket —— 这个量级没必要。
 */
export default function ChatPanel({ user, toast }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const lastIdRef = useRef(0);
  const listRef = useRef(null);

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
      } catch {
        /* 轮询失败静默重试 */
      }
    },
    [merge]
  );

  useEffect(() => {
    const boot = setTimeout(() => load(0), 0);
    const timer = setInterval(() => load(lastIdRef.current), 6000);
    return () => {
      clearTimeout(boot);
      clearInterval(timer);
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
        {messages.length === 0 ? (
          <p className="admin-muted">还没有消息，打个招呼吧</p>
        ) : (
          messages.map((message) => (
            <div
              key={message.id}
              className={`chat-row${message.user.id === user?.id ? ' is-self' : ''}`}
            >
              <Avatar user={message.user} size="xs" />
              <div className="chat-body">
                <div className="chat-meta">
                  <b>{message.user.gameName}</b>
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
