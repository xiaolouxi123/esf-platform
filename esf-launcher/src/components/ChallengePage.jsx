import { useCallback, useEffect, useMemo, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';

const MODE_META = {
  '1v1': { label: '1v1', slots: 1, note: '单挑 · 2 人' },
  '2v2': { label: '2v2', slots: 2, note: '组队 · 4 人' },
};

function timeLabel(value) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const diff = Math.max(0, Date.now() - date.getTime());
  if (diff < 60000) return '刚刚';
  if (diff < 3600000) return `${Math.floor(diff / 60000)} 分钟前`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)} 小时前`;
  return `${Math.floor(diff / 86400000)} 天前`;
}

function playerLabel(player) {
  return player?.gameName || player?.username || '玩家';
}

function TeamSeat({ player, hostId, selfId, emptyLabel }) {
  if (!player) {
    return (
      <div className="challenge-seat challenge-seat--empty">
        <span className="challenge-seat-plus">+</span>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  return (
    <div className="challenge-seat">
      <Avatar user={player} size="sm" />
      <div className="challenge-seat-text">
        <b>
          {playerLabel(player)}
          {Number(player.id) === Number(hostId) && <em className="challenge-host-tag">房主</em>}
          {Number(player.id) === Number(selfId) && <em className="challenge-self-tag">你</em>}
        </b>
        <small>
          战斗等级 {player.combatLevel || 0}
          {player.ready ? ' · 已准备' : ' · 未准备'}
        </small>
      </div>
      <span className={`challenge-ready-dot${player.ready ? ' is-ready' : ''}`} />
    </div>
  );
}

export default function ChallengePage({ user, toast, servers = [], maps = [], onJoinServer }) {
  const [state, setState] = useState({ myRoom: null, rooms: [], invites: [] });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [members, setMembers] = useState([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [form, setForm] = useState({ mode: '1v1', title: '', map: '', serverKey: '' });

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      if (!silent) setLoading(true);
      try {
        const data = await window.electronAPI.challenges.state();
        setState({
          myRoom: data?.myRoom || null,
          rooms: Array.isArray(data?.rooms) ? data.rooms : [],
          invites: Array.isArray(data?.invites) ? data.invites : [],
        });
      } catch (err) {
        if (!silent) toast(err.message, 'error');
      } finally {
        if (!silent) setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    // 首屏和轮询都是异步请求；状态在 await 后落地。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const timer = setInterval(() => refresh({ silent: true }), 3000);
    return () => clearInterval(timer);
  }, [refresh]);

  const myRoom = state.myRoom;
  const mode = MODE_META[myRoom?.mode || form.mode] || MODE_META['1v1'];
  const slots = mode.slots;

  const loadMembers = useCallback(async () => {
    setMembersLoading(true);
    try {
      const data = await window.electronAPI.members.list();
      setMembers(Array.isArray(data?.members) ? data.members : []);
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setMembersLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    if (!inviteOpen) return;
    // 打开邀请面板时异步加载在线成员。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadMembers();
  }, [inviteOpen, loadMembers]);

  const inviteCandidates = useMemo(() => {
    const keyword = memberQuery.trim().toLowerCase();
    const inRoom = new Set((myRoom?.members || []).map((member) => Number(member.id)));
    const pending = new Set(
      (myRoom?.pendingInvites || []).map((invite) => Number(invite.user?.id))
    );
    return members
      .filter((member) => Number(member.id) !== Number(user?.id))
      .filter((member) => !inRoom.has(Number(member.id)))
      .filter((member) => {
        if (!keyword) return true;
        return (
          String(member.gameName || '').toLowerCase().includes(keyword) ||
          String(member.username || '').toLowerCase().includes(keyword)
        );
      })
      .sort((a, b) => Number(Boolean(b.online)) - Number(Boolean(a.online)))
      .slice(0, 30)
      .map((member) => ({ ...member, invited: pending.has(Number(member.id)) }));
  }, [members, memberQuery, myRoom, user?.id]);

  const act = async (key, work, success) => {
    if (busy) return;
    setBusy(key);
    try {
      await work();
      await refresh({ silent: true });
      if (success) toast(success, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const createRoom = () =>
    act(
      'create',
      () =>
        window.electronAPI.challenges.create({
          mode: form.mode,
          title: form.title.trim() || undefined,
          map: form.map.trim() || undefined,
          serverKey: form.serverKey || undefined,
        }),
      '约战房间已创建，去邀请玩家吧'
    );

  const joinRoom = (room) =>
    act(`join-${room.id}`, () => window.electronAPI.challenges.join(room.id), '已加入房间');

  const leaveRoom = () =>
    act('leave', () => window.electronAPI.challenges.leave(myRoom.id), '已离开房间');

  const closeRoom = () =>
    act('close', () => window.electronAPI.challenges.close(myRoom.id), '房间已关闭');

  const toggleReady = () => {
    const me = myRoom?.members?.find((member) => Number(member.id) === Number(user?.id));
    return act('ready', () => window.electronAPI.challenges.ready(myRoom.id, !me?.ready), null);
  };

  const startRoom = () =>
    act('start', () => window.electronAPI.challenges.start(myRoom.id), '约战已开始，进入服务器准备开打');

  const respond = (invite, action) =>
    act(
      `invite-${invite.id}`,
      () => window.electronAPI.challenges.respond(invite.id, action),
      action === 'accept' ? '已接受邀请' : '已拒绝邀请'
    );

  const invite = (member) =>
    act(
      `invite-player-${member.id}`,
      () => window.electronAPI.challenges.invite(myRoom.id, member.id),
      `已邀请 ${playerLabel(member)}`
    );

  const copyRoom = async () => {
    const text = `【ESF 约战】${myRoom.title} · ${myRoom.mode} · 房间 #${myRoom.id}${
      myRoom.map ? ` · 地图 ${myRoom.map}` : ''
    }${myRoom.server ? ` · ${myRoom.server.name}` : ''}`;
    try {
      await navigator.clipboard.writeText(text);
      toast('房间信息已复制', 'ok');
    } catch {
      toast(text, 'ok');
    }
  };

  const me = myRoom?.members?.find((member) => Number(member.id) === Number(user?.id));
  const isLive = myRoom?.status === 'live';

  return (
    <div className="challenge-page">
      <datalist id="challenge-maps">
        {maps.slice(0, 300).map((map) => (
          <option key={map} value={map} />
        ))}
      </datalist>

      <header className="challenge-head">
        <div>
          <span className="eyebrow">
            <Icon name="swords" size={13} />
            PLAYER CHALLENGE
          </span>
          <h1>约战大厅</h1>
          <p>自己定模式、地图和服务器，邀请好友进房。约战不计分、不锁服。</p>
        </div>
        <button type="button" className="btn btn-ghost btn-sm" onClick={() => refresh()} disabled={loading}>
          <Icon name="refresh" size={14} />
          刷新
        </button>
      </header>

      {state.invites.length > 0 && !myRoom && (
        <section className="challenge-invites">
          <div className="section-head">
            <h2>
              收到的邀请 <span className="pill">{state.invites.length}</span>
            </h2>
            <span className="tag">待处理</span>
          </div>
          <div className="challenge-invite-list">
            {state.invites.map((invite) => (
              <div key={invite.id} className="challenge-invite">
                <Avatar user={invite.from} size="sm" />
                <div>
                  <b>{playerLabel(invite.from)}</b>
                  <small>
                    邀请你加入「{invite.room.title}」· {invite.room.mode} · {invite.room.playerCount}/
                    {invite.room.maxPlayers} 人
                  </small>
                </div>
                <div className="challenge-invite-actions">
                  <button
                    type="button"
                    className="btn btn-sm btn-primary"
                    onClick={() => respond(invite, 'accept')}
                    disabled={Boolean(busy)}
                  >
                    接受
                  </button>
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={() => respond(invite, 'decline')}
                    disabled={Boolean(busy)}
                  >
                    拒绝
                  </button>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {myRoom ? (
        <section className={`challenge-room${isLive ? ' is-live' : ''}`}>
          <div className="challenge-room-top">
            <div>
              <div className="challenge-room-badges">
                <span className={`challenge-state${isLive ? ' is-live' : ''}`}>
                  {isLive ? '进行中' : '等待中'}
                </span>
                <span className="tag">{myRoom.mode}</span>
                <span className="tag">房间 #{myRoom.id}</span>
                {myRoom.map && (
                  <span className="tag">
                    <Icon name="map" size={11} /> {myRoom.map}
                  </span>
                )}
              </div>
              <h2>{myRoom.title}</h2>
              <p>
                房主 {playerLabel(myRoom.host)} · {myRoom.playerCount}/{myRoom.maxPlayers} 人 · 已准备{' '}
                {myRoom.readyCount}/{myRoom.playerCount}
                {myRoom.server ? ` · ${myRoom.server.name}` : ' · 不指定服务器'}
              </p>
            </div>
            <div className="challenge-room-tools">
              <button type="button" className="btn btn-sm btn-ghost" onClick={copyRoom}>
                <Icon name="copy" size={13} /> 复制房间信息
              </button>
              {myRoom.isHost ? (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost challenge-danger"
                  onClick={closeRoom}
                  disabled={Boolean(busy)}
                >
                  关闭房间
                </button>
              ) : (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost challenge-danger"
                  onClick={leaveRoom}
                  disabled={Boolean(busy)}
                >
                  离开房间
                </button>
              )}
            </div>
          </div>

          <div className="challenge-teams">
            {['a', 'b'].map((teamKey) => {
              const players = myRoom.teams?.[teamKey] || [];
              return (
                <div key={teamKey} className={`challenge-team challenge-team--${teamKey}`}>
                  <div className="challenge-team-head">
                    <span>{teamKey === 'a' ? 'A 队' : 'B 队'}</span>
                    <small>
                      {players.length}/{slots}
                    </small>
                  </div>
                  <div className="challenge-seats">
                    {Array.from({ length: slots }, (_, index) => (
                      <TeamSeat
                        key={players[index]?.id || `${teamKey}-${index}`}
                        player={players[index]}
                        hostId={myRoom.host?.id}
                        selfId={user?.id}
                        emptyLabel={`${teamKey === 'a' ? 'A' : 'B'} 队 ${index + 1} 号位`}
                      />
                    ))}
                  </div>
                </div>
              );
            })}
          </div>

          <div className="challenge-room-foot">
            <div className="challenge-invite-strip">
              <span className="challenge-invite-label">
                <Icon name="users" size={14} /> 房间邀请
              </span>
              {myRoom.pendingInvites?.length ? (
                myRoom.pendingInvites.map((invite) => (
                  <span key={invite.id} className="challenge-invited">
                    <Avatar user={invite.user} size="xs" />
                    {playerLabel(invite.user)}
                    <em>等待回应</em>
                  </span>
                ))
              ) : (
                <span className="challenge-muted">还没有待回应邀请</span>
              )}
              {!isLive && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => setInviteOpen(true)}
                  disabled={myRoom.full}
                >
                  <Icon name="plus" size={13} /> 邀请玩家
                </button>
              )}
            </div>

            <div className="challenge-room-actions">
              {isLive ? (
                <>
                  {myRoom.server && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={() => onJoinServer?.(myRoom.server)}
                    >
                      <Icon name="play" size={14} /> 进入服务器
                    </button>
                  )}
                  <span className="challenge-live-note">约战已开始，进服后由房主换图开局</span>
                </>
              ) : (
                <>
                  {!myRoom.isHost && (
                    <button
                      type="button"
                      className={`btn ${me?.ready ? 'btn-ghost' : 'btn-primary'}`}
                      onClick={toggleReady}
                      disabled={Boolean(busy)}
                    >
                      <Icon name="check" size={14} /> {me?.ready ? '取消准备' : '准备'}
                    </button>
                  )}
                  {myRoom.isHost && (
                    <button
                      type="button"
                      className="btn btn-primary"
                      onClick={startRoom}
                      disabled={Boolean(busy) || !myRoom.full || !myRoom.allReady}
                      title={!myRoom.full ? '人还没齐' : !myRoom.allReady ? '还有玩家没准备' : ''}
                    >
                      <Icon name="play" size={14} /> 开始约战
                    </button>
                  )}
                  <span className="challenge-muted">
                    {myRoom.full
                      ? myRoom.allReady
                        ? '全员就绪，可以开始'
                        : '等待其他玩家准备'
                      : `还差 ${myRoom.maxPlayers - myRoom.playerCount} 人`}
                  </span>
                </>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="challenge-create">
            <div className="challenge-create-copy">
              <span className="eyebrow">
                <Icon name="plus" size={12} /> NEW ROOM
              </span>
              <h2>开一间房</h2>
              <p>选好模式和地图，房间创建后把邀请发给队友。</p>
            </div>
            <div className="challenge-form">
              <div className="challenge-mode-switch" role="group" aria-label="约战模式">
                {Object.entries(MODE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    type="button"
                    className={form.mode === key ? 'is-active' : ''}
                    onClick={() => setForm((prev) => ({ ...prev, mode: key }))}
                  >
                    <b>{meta.label}</b>
                    <small>{meta.note}</small>
                  </button>
                ))}
              </div>
              <label className="challenge-field">
                <span>房间名（可选）</span>
                <input
                  type="text"
                  maxLength={48}
                  value={form.title}
                  placeholder="例如：周末 2v2 友谊赛"
                  onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                />
              </label>
              <label className="challenge-field">
                <span>地图（可选）</span>
                <input
                  type="text"
                  maxLength={64}
                  list="challenge-maps"
                  value={form.map}
                  placeholder="esf_cell_games2"
                  onChange={(event) => setForm((prev) => ({ ...prev, map: event.target.value }))}
                />
              </label>
              <label className="challenge-field">
                <span>服务器（可选）</span>
                <select
                  value={form.serverKey}
                  onChange={(event) => setForm((prev) => ({ ...prev, serverKey: event.target.value }))}
                >
                  <option value="">不指定，进房后再定</option>
                  {servers.map((server) => (
                    <option key={server.serverKey} value={server.serverKey}>
                      {server.name}
                      {server.online ? ` · ${server.players}/${server.maxPlayers}` : ' · 离线'}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                className="btn btn-primary challenge-create-btn"
                onClick={createRoom}
                disabled={Boolean(busy)}
              >
                {busy === 'create' ? <span className="spinner" /> : <Icon name="plus" size={15} />}
                创建约战房间
              </button>
            </div>
          </section>

          <section className="challenge-list-section">
            <div className="section-head">
              <h2>
                等待中的房间 <span className="pill">{state.rooms.length}</span>
              </h2>
              <span className="challenge-muted">3 秒自动刷新</span>
            </div>

            {loading && state.rooms.length === 0 ? (
              <div className="empty empty--inline">
                <span className="spinner" />
                <p>正在获取约战房间…</p>
              </div>
            ) : state.rooms.length === 0 ? (
              <div className="empty empty--inline">
                <Icon name="swords" size={22} />
                <p>还没有约战房间，开第一间等朋友来。</p>
              </div>
            ) : (
              <div className="challenge-grid">
                {state.rooms.map((room) => (
                  <article key={room.id} className="challenge-card">
                    <div className="challenge-card-top">
                      <span className="challenge-card-mode">{room.mode}</span>
                      <span className={`challenge-state${room.full ? ' is-full' : ''}`}>
                        {room.full ? '已满员' : '等待中'}
                      </span>
                      <span className="challenge-card-time">{timeLabel(room.createdAt)}</span>
                    </div>
                    <h3>{room.title}</h3>
                    <div className="challenge-card-host">
                      <Avatar user={room.host} size="xs" />
                      <span>{playerLabel(room.host)}</span>
                      <small>房主</small>
                    </div>
                    <div className="challenge-card-meta">
                      <span>
                        <Icon name="users" size={12} /> {room.playerCount}/{room.maxPlayers}
                      </span>
                      <span>
                        <Icon name="map" size={12} /> {room.map || '未指定地图'}
                      </span>
                      <span>
                        <Icon name="server" size={12} /> {room.server?.name || '未指定服务器'}
                      </span>
                    </div>
                    <div className="challenge-card-foot">
                      <div className="challenge-card-ready">
                        <span className="challenge-ready-dot is-ready" />
                        {room.readyCount}/{room.playerCount} 已准备
                      </div>
                      <button
                        type="button"
                        className="btn btn-sm btn-primary"
                        onClick={() => joinRoom(room)}
                        disabled={room.full || Boolean(busy)}
                      >
                        {busy === `join-${room.id}` ? '加入中…' : room.full ? '已满员' : '加入房间'}
                      </button>
                    </div>
                  </article>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {inviteOpen && (
        <div className="challenge-modal-backdrop" onClick={() => setInviteOpen(false)}>
          <div
            className="challenge-modal"
            role="dialog"
            aria-modal="true"
            aria-label="邀请玩家"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="challenge-modal-head">
              <div>
                <h3>邀请玩家</h3>
                <small>邀请会保留在对方的约战大厅，接受后自动入座。</small>
              </div>
              <button type="button" className="icon-btn" onClick={() => setInviteOpen(false)}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="search challenge-search">
              <Icon name="search" size={14} />
              <input
                type="text"
                value={memberQuery}
                autoFocus
                placeholder="搜索游戏名 / 账号"
                onChange={(event) => setMemberQuery(event.target.value)}
              />
            </div>
            <div className="challenge-member-list">
              {membersLoading ? (
                <p className="challenge-muted">正在读取成员…</p>
              ) : inviteCandidates.length === 0 ? (
                <p className="challenge-muted">没有可邀请的玩家。</p>
              ) : (
                inviteCandidates.map((member) => (
                  <div key={member.id} className="challenge-member">
                    <Avatar user={member} size="sm" />
                    <div className="challenge-member-text">
                      <b>{playerLabel(member)}</b>
                      <small>
                        {member.online ? '在线' : '离线'} · {member.state === 'ingame' ? '游戏中' : '大厅'}
                        {member.ranked ? ` · 排位${member.ranked.mode}` : ''}
                      </small>
                    </div>
                    <button
                      type="button"
                      className="btn btn-sm btn-ghost"
                      disabled={member.invited || Boolean(busy) || myRoom?.full}
                      onClick={() => invite(member)}
                    >
                      {member.invited ? '已邀请' : '邀请'}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
