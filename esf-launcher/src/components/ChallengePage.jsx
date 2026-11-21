import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Icon from './Icon';
import Avatar from './Avatar';
import DragonHeroBackdrop from './DragonHeroBackdrop';
import SelectMenu from './SelectMenu';
import { DEFAULT_RANKS, rankFor } from '../lib/ranks';

const MODE_META = {
  '1v1': { label: '1v1', slots: 1, note: '单挑 · 2 人' },
  '2v2': { label: '2v2', slots: 2, note: '组队 · 4 人' },
};

const VICTORY_TYPE_OPTIONS = [
  { value: 'kills', label: '击杀数达到' },
  { value: 'deaths', label: '死亡数达到' },
];

const VICTORY_LIMIT_OPTIONS = [3, 5, 10].map((limit) => ({
  value: limit,
  label: String(limit),
}));

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

function TeamSeat({ player, hostId, selfId, emptyLabel, ranks = DEFAULT_RANKS, onInvite, canInvite = false }) {
  if (!player) {
    if (canInvite && onInvite) {
      return (
        <button
          type="button"
          className="challenge-seat challenge-seat--empty challenge-seat--action"
          onClick={onInvite}
          aria-label={emptyLabel + '，点击邀请玩家'}
        >
          <span className="challenge-seat-plus">+</span>
          <span className="challenge-seat-action-text">
            {emptyLabel}
            <small>点击邀请</small>
          </span>
        </button>
      );
    }
    return (
      <div className="challenge-seat challenge-seat--empty">
        <span className="challenge-seat-plus">+</span>
        <span>{emptyLabel}</span>
      </div>
    );
  }

  const rank = rankFor(ranks, player.combatLevel);

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
          <span
            className={`combat-level rank-badge${Number(player.combatLevel) === 0 ? ' rank-badge--unranked' : ''}`}
            style={{ color: rank.color, borderColor: `${rank.color}55`, background: `${rank.color}14` }}
          >
            {rank.name}
          </span>
          {player.ready ? ' · 已准备' : ' · 未准备'}
        </small>
      </div>
      <span className={`challenge-ready-dot${player.ready ? ' is-ready' : ''}`} />
    </div>
  );
}

export default function ChallengePage({
  user,
  toast,
  servers = [],
  maps = [],
  ranks = DEFAULT_RANKS,
  onJoinServer,
}) {
  const [state, setState] = useState({ myRoom: null, rooms: [], invites: [], lastResult: null });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [now, setNow] = useState(0);
  const [pollError, setPollError] = useState('');
  const [lastUpdated, setLastUpdated] = useState(0);
  const refreshSeq = useRef(0);
  const inviteDialogRef = useRef(null);
  const inviteReturnRef = useRef(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
  const [inviteOpen, setInviteOpen] = useState(false);
  const [roomFilter, setRoomFilter] = useState('all');
  const [roomKeyword, setRoomKeyword] = useState('');
  const [members, setMembers] = useState([]);
  const [memberQuery, setMemberQuery] = useState('');
  const [membersLoading, setMembersLoading] = useState(false);
  const [form, setForm] = useState({
    mode: '1v1',
    title: '',
    map: '',
    serverKey: '',
    victoryType: 'kills',
    victoryLimit: 10,
    bestOf: 3,
  });

  const refresh = useCallback(
    async ({ silent = false } = {}) => {
      const seq = ++refreshSeq.current;
      if (!silent) setLoading(true);
      try {
        const data = await window.electronAPI.challenges.state();
        if (seq !== refreshSeq.current) return;
        setState({
          myRoom: data?.myRoom || null,
          rooms: Array.isArray(data?.rooms) ? data.rooms : [],
          invites: Array.isArray(data?.invites) ? data.invites : [],
          lastResult: data?.lastResult || null,
        });
        setPollError('');
        setLastUpdated(Date.now());
      } catch (err) {
        if (seq !== refreshSeq.current) return;
        setPollError(err?.message || '约战数据刷新失败');
        if (!silent) toast(err.message, 'error');
      } finally {
        if (seq === refreshSeq.current && !silent) setLoading(false);
      }
    },
    [toast]
  );

  useEffect(() => {
    // 首屏和轮询都是异步请求；状态在 await 后落地。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    refresh();
    const tick = () => {
      if (document.visibilityState === 'visible') refresh({ silent: true });
    };
    const timer = setInterval(tick, 3000);
    const onVisibility = () => {
      if (document.visibilityState === 'visible') refresh({ silent: true });
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisibility);
      refreshSeq.current += 1;
    };
  }, [refresh]);

  const openInvite = useCallback((event) => {
    inviteReturnRef.current = event?.currentTarget || document.activeElement;
    setInviteOpen(true);
  }, []);

  const closeInvite = useCallback(() => {
    setInviteOpen(false);
  }, []);

  useEffect(() => {
    if (!inviteOpen) return undefined;
    const bodyOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeInvite();
        return;
      }
      if (event.key !== 'Tab') return;
      const focusable = inviteDialogRef.current?.querySelectorAll(
        'button:not([disabled]), input:not([disabled]), [href], [tabindex]:not([tabindex="-1"])'
      );
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = bodyOverflow;
      const target = inviteReturnRef.current;
      inviteReturnRef.current = null;
      window.setTimeout(() => target?.focus?.(), 0);
    };
  }, [inviteOpen, closeInvite]);

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
      window.dispatchEvent(new Event('esf:presence'));
      if (success) toast(success, 'ok');
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      setBusy('');
    }
  };

  const createRoom = () => {
    if (!selectedServerKey) {
      toast('当前没有在线的约战服务器，等服务器上线后再开房', 'error');
      return;
    }
    return act(
      'create',
      () =>
        window.electronAPI.challenges.create({
          mode: form.mode,
          title: form.title.trim() || undefined,
          map: form.map.trim() || undefined,
          serverKey: selectedServerKey,
          victoryType: form.victoryType,
          victoryLimit: Number(form.victoryLimit) || 10,
          bestOf: form.bestOf,
        }),
      '约战房间已创建，去邀请玩家吧'
    );
  };

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

  const switchTeam = () =>
    act(
      'team',
      () => window.electronAPI.challenges.team(myRoom.id, otherTeamKey),
      `已换到 ${otherTeamKey === 'a' ? 'A' : 'B'} 队`
    );

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
    const text = `【ESF 约战】${myRoom.title} · ${myRoom.mode} · 房间 #${myRoom.displayNo ?? myRoom.id}${
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
  const myTeamKey = myRoom?.teams?.a?.some((member) => Number(member.id) === Number(user?.id)) ? 'a' : 'b';
  const otherTeamKey = myTeamKey === 'a' ? 'b' : 'a';
  const otherTeamCount = myRoom?.teams?.[otherTeamKey]?.length || 0;
  const canSwitchTeam = Boolean(myRoom && myRoom.mode === '2v2' && !isLive && otherTeamCount < slots);
  const remainSec = useMemo(() => {
    if (!myRoom?.endsAt || !now) return null;
    return Math.max(0, Math.ceil((new Date(myRoom.endsAt).getTime() - now) / 1000));
  }, [myRoom, now]);
  const remainText =
    remainSec === null
      ? '--:--'
      : String(Math.floor(remainSec / 60)).padStart(2, '0') + ':' + String(remainSec % 60).padStart(2, '0');
  const livePercent =
    remainSec === null
      ? 100
      : Math.max(0, Math.min(100, (remainSec / Number(myRoom?.timeLimitSec || 900)) * 100));
  const readyRemain = useMemo(() => {
    if (!myRoom?.updatedAt) return null;
    if (myRoom.playerCount < myRoom.maxPlayers) return null;
    if (myRoom.readyCount >= myRoom.playerCount) return null;
    const start = new Date(myRoom.updatedAt).getTime();
    if (!Number.isFinite(start)) return null;
    return Math.max(0, Math.ceil((start + 120000 - now) / 1000));
  }, [myRoom, now]);
  const challengeServers = useMemo(
    () =>
      servers
        .filter((server) => server.isChallenge)
        .sort((a, b) => Number(b.online) - Number(a.online) || Number(a.ping) - Number(b.ping)),
    [servers]
  );
  const onlineChallengeServers = useMemo(
    () => challengeServers.filter((server) => server.online),
    [challengeServers]
  );
  const selectedServer =
    challengeServers.find((server) => server.serverKey === form.serverKey && server.online) ||
    onlineChallengeServers[0] ||
    null;
  const selectedServerKey = selectedServer?.serverKey || '';
  const serverOptions = useMemo(() => {
    const rows = challengeServers.map((server) => ({
      value: server.serverKey,
      label: server.online
        ? `${server.name} · ${server.players ?? 0}/${server.maxPlayers ?? '—'}`
        : `${server.name} · 离线`,
      disabled: !server.online,
    }));
    if (onlineChallengeServers.length === 0) {
      return [{ value: '', label: '暂无在线约战服', disabled: true }, ...rows];
    }
    return rows;
  }, [challengeServers, onlineChallengeServers.length]);

  const createRef = useRef(null);
  const openRooms = state.rooms.length;
  const waitingRooms = state.rooms.filter((room) => !room.full).length;
  const roomStats = useMemo(
    () => ({
      all: state.rooms.length,
      open: state.rooms.filter((room) => !room.full).length,
      full: state.rooms.filter((room) => room.full).length,
    }),
    [state.rooms]
  );
  const roomsView = useMemo(() => {
    const keyword = roomKeyword.trim().toLowerCase();
    const filtered = state.rooms.filter((room) => {
      const byFilter =
        roomFilter === 'open' ? !room.full : roomFilter === 'full' ? room.full : true;
      if (!byFilter) return false;
      if (!keyword) return true;
      const host = room.host || {};
      return [room.title, room.map, room.server?.name, host.gameName, host.username]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword));
    });
    return filtered
      .slice()
      .sort(
        (a, b) =>
          Number(a.full) - Number(b.full) ||
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
      );
  }, [state.rooms, roomFilter, roomKeyword]);

  const focusCreate = () => {
    createRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    createRef.current?.querySelector('input')?.focus({ preventScroll: true });
  };

  return (
    <div className="challenge-page">
      <datalist id="challenge-maps">
        {maps.slice(0, 300).map((map) => (
          <option key={map} value={map} />
        ))}
      </datalist>

      <header className="hero challenge-hero hero--dragon">
        <DragonHeroBackdrop />
        <div className="hero-content">
          <span className="eyebrow">
            <Icon name="swords" size={13} />
            <b>PLAYER CHALLENGE</b>
            <span className={`eyebrow-status${isLive ? ' is-live' : ''}`}>
              {myRoom ? (isLive ? '进行中' : '等待中') : '开放中'}
            </span>
            <span className="eyebrow-note">邀请好友进房 · 开赛锁服 · 不计排位分</span>
          </span>
          <h1 className="hero-title">约战大厅</h1>
          <div className="hero-tags">
            <span className="tag tag--code">custom</span>
            <span className="tag">不限段位</span>
            <span className="tag tag--mode tag--challenge">
              <i />
              {myRoom ? `${myRoom.mode} 约战` : '自由约战'}
            </span>
            <span className="tag">3 秒刷新</span>
          </div>
        </div>
        <div className="hero-foot">
          <div className="hud">
            <div className="hud-cell hud-cell--rooms">
              <span>房间总数</span>
              <b>{openRooms}</b>
            </div>
            <div className="hud-cell hud-cell--players">
              <span>可加入</span>
              <b>{waitingRooms}</b>
            </div>
            <div className="hud-cell hud-cell--state hud-cell--text">
              <span>我的状态</span>
              <b>{myRoom ? (isLive ? '进行中' : '等待中') : '未进房'}</b>
            </div>
          </div>
          <div className="hero-actions">
            <button
              type="button"
              className="btn btn-ghost btn-lg challenge-refresh"
              onClick={() => refresh()}
              disabled={loading}
            >
              <Icon name="refresh" size={15} />
              刷新
            </button>
            {!myRoom && <button type="button" className="btn btn-ghost btn-lg hero-cta" onClick={focusCreate}>
              <Icon name="plus" size={15} />
              去开房
            </button>}
          </div>
        </div>
      </header>

      {pollError && (
        <div className="challenge-alert" role="alert">
          <Icon name="alert" size={14} />
          <span>刷新失败：{pollError}。当前显示的是上次数据。</span>
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => refresh()}>
            重试
          </button>
        </div>
      )}

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
        <section className={'challenge-room' + (isLive ? ' is-live' : '')}>
          <div className="challenge-room-top">
            <div>
              <div className="challenge-room-badges">
                <span className={'challenge-state' + (isLive ? ' is-live' : '')}>
                  {isLive ? '进行中' : '等待中'}
                </span>
                <span className="tag">{myRoom.mode}</span>
                <span className="tag">{myRoom.victoryLabel || '击杀 ' + myRoom.victoryLimit + ' 次'}</span>
                <span className="tag">{Number(myRoom.bestOf) === 1 ? 'BO1' : 'BO3'}</span>
                <span className="tag">房间 #{myRoom.displayNo ?? myRoom.id}</span>
                {myRoom.series && (
                  <span className="tag tag-series">
                    第 {myRoom.roundNo || 1} 局 · A {myRoom.series.winsA}:{myRoom.series.winsB} B
                  </span>
                )}
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
                {myRoom.server ? ' · ' + myRoom.server.name : ' · 不指定服务器'}
                {myRoom.pendingInvites?.length > 0
                  ? ` · 邀请 ${myRoom.pendingInvites.length} 人待接受`
                  : ''}
              </p>
            </div>
            <div className="challenge-room-tools">
              <button type="button" className="btn btn-sm btn-ghost" onClick={copyRoom}>
                <Icon name="copy" size={13} /> 复制房间信息
              </button>
              {myRoom.mode === '2v2' && !isLive && (
                <button
                  type="button"
                  className="btn btn-sm btn-ghost challenge-team-switch"
                  onClick={switchTeam}
                  disabled={Boolean(busy) || !canSwitchTeam}
                  title={canSwitchTeam ? `换到 ${otherTeamKey === 'a' ? 'A' : 'B'} 队` : '对面队伍已经满了'}
                >
                  换到 {otherTeamKey === 'a' ? 'A' : 'B'} 队
                </button>
              )}
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

          <div className="challenge-room-body">
            <div className="challenge-room-main">
              {myRoom.result && (
                <div className={'challenge-result challenge-result--' + myRoom.result.winner}>
                  <div className="challenge-result-main">
                    <span className="eyebrow">MATCH RESULT</span>
                    <b>
                      {myRoom.result.winner === 'a' ? 'A 队' : 'B 队'}获胜 · {myRoom.result.scoreA}:
                      {myRoom.result.scoreB}
                    </b>
                    <small>本场不计排位分，关闭房间后可再开一间</small>
                  </div>
                  <span className="challenge-result-badge">
                    <Icon name="trophy" size={16} /> 已结算
                  </span>
                </div>
              )}

              <div className="challenge-teams">
                {['a', 'b'].map((teamKey) => {
                  const players = myRoom.teams?.[teamKey] || [];
                  return (
                    <div key={teamKey} className={'challenge-team challenge-team--' + teamKey}>
                      <div className="challenge-team-head">
                        <span>{teamKey === 'a' ? 'A 队' : 'B 队'}</span>
                        <small>
                          {players.length}/{slots}
                        </small>
                      </div>
                      <div className="challenge-seats">
                        {Array.from({ length: slots }, (_, index) => (
                          <TeamSeat
                            key={players[index]?.id || teamKey + '-' + index}
                            player={players[index]}
                            hostId={myRoom.host?.id}
                            selfId={user?.id}
                            ranks={ranks}
                            onInvite={openInvite}
                            canInvite={Boolean(myRoom.isHost && !myRoom.full && !isLive)}
                            emptyLabel={(teamKey === 'a' ? 'A' : 'B') + ' 队 ' + (index + 1) + ' 号位'}
                          />
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>

              {myRoom.series?.rounds?.length > 0 && (
                <div className="challenge-rounds">
                  {myRoom.series.rounds.map((round) => (
                    <span key={round.roundNo} className={'challenge-round is-' + round.winner}>
                      <em>第 {round.roundNo} 局</em>
                      <b>
                        {round.scoreA}:{round.scoreB}
                      </b>
                    </span>
                  ))}
                </div>
              )}

              {!isLive && (
                <div className="challenge-room-steps">
                  <span>
                    <b>01</b>
                    邀请队友
                    <i>复制房间信息发到群里</i>
                  </span>
                  <span>
                    <b>02</b>
                    全员准备
                    <i>坐满后开始 2 分钟倒计时</i>
                  </span>
                  <span>
                    <b>03</b>
                    房主开局
                    <i>进服后由房主换图开打</i>
                  </span>
                </div>
              )}

              {isLive && (
                <div className="challenge-live-strip">
                  <b className="challenge-live-clock">{remainText}</b>
                  <span className="challenge-live-bar">
                    <i style={{ width: livePercent + '%' }} />
                  </span>
                  <span className="challenge-live-hint">
                    第 {myRoom.roundNo || 1} 局剩余时间 · 进服后由房主换图开局
                  </span>
                </div>
              )}
            </div>

            <aside className="challenge-side">
              <div className="challenge-side-card">
                <h3>房间信息</h3>
                <dl className="challenge-info-list">
                  <div>
                    <dt>模式</dt>
                    <dd>{myRoom.mode} · {myRoom.maxPlayers} 人</dd>
                  </div>
                  <div>
                    <dt>地图</dt>
                    <dd>{myRoom.map || '未指定'}</dd>
                  </div>
                  <div>
                    <dt>服务器</dt>
                    <dd>{myRoom.server ? myRoom.server.name : '不指定'}</dd>
                  </div>
                  <div>
                    <dt>胜利条件</dt>
                    <dd>{myRoom.victoryLabel || '击杀 ' + myRoom.victoryLimit + ' 次'}</dd>
                  </div>
                  <div>
                    <dt>限时</dt>
                    <dd>{Math.round((myRoom.timeLimitSec || 900) / 60)} 分钟</dd>
                  </div>
                  <div>
                    <dt>准备</dt>
                    <dd>
                      {myRoom.readyCount}/{myRoom.playerCount} 人
                      {readyRemain !== null ? ' · ' + readyRemain + ' 秒后自动解散' : ''}
                    </dd>
                  </div>
                </dl>
              </div>

              <div className="challenge-side-card challenge-side-invite">
                <h3>
                  邀请 <span className="pill">{myRoom.pendingInvites?.length || 0}</span>
                </h3>
                <div className="challenge-side-invites">
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
                </div>
                {!isLive && (
                  <button
                    type="button"
                    className="btn btn-sm btn-ghost"
                    onClick={openInvite}
                    disabled={myRoom.full}
                    title={myRoom.full ? '房间已满' : '邀请在线成员加入'}
                  >
                    <Icon name="plus" size={13} /> 邀请玩家
                  </button>
                )}
              </div>

              <p className="challenge-side-note">
                自定义地图与人数，达到条件即结算；<b>不计排位分</b>，<span className="challenge-nowrap">开赛锁服</span>，仅参赛/观战可进。
              </p>
            </aside>
          </div>

          <div className="challenge-room-foot">
            <div className="challenge-room-actions">
              {isLive ? (
                <>
                  {myRoom.server && (
                    <button type="button" className="btn btn-primary" onClick={() => onJoinServer?.(myRoom.server)}>
                      <Icon name="play" size={14} /> 进入服务器
                    </button>
                  )}
                  <span className="challenge-muted">约战已开始，进服后由房主换图开局</span>
                </>
              ) : (
                <>
                  {!myRoom.isHost && (
                    <button
                      type="button"
                      className={me?.ready ? 'btn btn-ghost' : 'btn btn-primary'}
                      onClick={toggleReady}
                      disabled={Boolean(busy)}
                    >
                      <Icon name="check" size={14} /> {me?.ready ? '取消准备' : '准备'}
                    </button>
                  )}
                  {myRoom.isHost && (
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={openInvite}
                      disabled={myRoom.full}
                      title={myRoom.full ? '房间已满' : '邀请在线成员加入'}
                    >
                      <Icon name="plus" size={14} /> 邀请玩家
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
                        ? '全员就绪，可以开始 · 开赛锁服'
                        : '等待其他玩家准备 · 开赛锁服'
                      : '还差 ' + (myRoom.maxPlayers - myRoom.playerCount) + ' 人 · 开赛锁服'}
                  </span>
                </>
              )}
            </div>
            <span className="challenge-room-code">
              房间 #{myRoom.displayNo ?? myRoom.id} · {myRoom.mode} · {myRoom.playerCount}/{myRoom.maxPlayers} 人
            </span>
          </div>
        </section>
      ) : (
        <>
          <section className="challenge-create" ref={createRef}>
            <div className="challenge-create-head">
              <h2>开一间房</h2>
              <span className="tag">NEW ROOM</span>
              <div className="challenge-mode-switch is-compact" role="group" aria-label="约战模式">
                {Object.entries(MODE_META).map(([key, meta]) => (
                  <button
                    key={key}
                    type="button"
                    data-mode={key}
                    className={form.mode === key ? 'is-active' : ''}
                    onClick={() => setForm((prev) => ({ ...prev, mode: key }))}
                  >
                    <b>{meta.label}</b>
                    <small>{meta.note}</small>
                  </button>
                ))}
              </div>
              <span className="challenge-create-note">选好模式和地图，创建后把邀请发给队友</span>
            </div>

            <div className="challenge-quick">
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
              <div className="challenge-field">
                <span>比赛服务器</span>
                <div className="challenge-select">
                  <SelectMenu
                    value={selectedServerKey}
                    options={serverOptions}
                    onChange={(value) => setForm((prev) => ({ ...prev, serverKey: value }))}
                    ariaLabel="比赛服务器"
                  />
                </div>
              </div>
              <button
                type="button"
                className="btn btn-primary challenge-create-btn"
                onClick={createRoom}
                disabled={Boolean(busy) || !selectedServerKey}
                title={!selectedServerKey ? '当前没有在线的约战服务器' : ''}
              >
                {busy === 'create' ? <span className="spinner" /> : <Icon name="plus" size={15} />}
                创建约战房间
              </button>
            </div>

            <div className="challenge-quick-foot">
              <span className="challenge-bestof">
                <b>赛制</b>
                <span className="challenge-bestof-switch" role="group" aria-label="赛制">
                  {[1, 3].map((value) => (
                    <button
                      key={value}
                      type="button"
                      className={form.bestOf === value ? 'is-active' : ''}
                      onClick={() => setForm((prev) => ({ ...prev, bestOf: value }))}
                    >
                      BO{value}
                    </button>
                  ))}
                </span>
                <small>{form.bestOf === 1 ? '一局定胜负' : '三局两胜'}</small>
              </span>
              <span className="challenge-victory-inline">
                <Icon name="swords" size={13} />
                <b>胜利条件</b>
                <div className="challenge-select challenge-select--victory">
                  <SelectMenu
                    value={form.victoryType}
                    options={VICTORY_TYPE_OPTIONS}
                    onChange={(value) => setForm((prev) => ({ ...prev, victoryType: value }))}
                    ariaLabel="胜利条件"
                  />
                </div>
                <div className="challenge-select challenge-select--limit">
                  <SelectMenu
                    value={form.victoryLimit}
                    options={VICTORY_LIMIT_OPTIONS}
                    onChange={(value) => setForm((prev) => ({ ...prev, victoryLimit: Number(value) }))}
                    ariaLabel="胜利次数"
                  />
                </div>
                <em>次</em>
              </span>
              <span className="challenge-victory-hint">
                达到条件即结束 · 不结算排位分 · 结束后 5 秒自动退出
              </span>
            </div>
          </section>

          <section className="challenge-list-section">
            <div className="section-head">
              <h2>
                等待中的房间{' '}
                <span className="pill">
                  {roomKeyword.trim() || roomFilter !== 'all'
                    ? `${roomsView.length} / ${state.rooms.length}`
                    : state.rooms.length}
                </span>
              </h2>
              <label className="challenge-room-search">
                <Icon name="search" size={13} />
                <input
                  type="search"
                  value={roomKeyword}
                  placeholder="搜索房间 / 地图 / 房主"
                  aria-label="搜索约战房间"
                  onChange={(event) => setRoomKeyword(event.target.value)}
                />
                {roomKeyword && (
                  <button
                    type="button"
                    className="challenge-room-search-clear"
                    onClick={() => setRoomKeyword('')}
                    aria-label="清除房间搜索"
                  >
                    ×
                  </button>
                )}
              </label>
              <div className="challenge-list-filters">
                <button
                  type="button"
                  className={roomFilter === 'all' ? 'is-active' : ''}
                  onClick={() => setRoomFilter('all')}
                >
                  全部<em>{roomStats.all}</em>
                </button>
                <button
                  type="button"
                  className={roomFilter === 'open' ? 'is-active' : ''}
                  onClick={() => setRoomFilter('open')}
                >
                  可加入<em>{roomStats.open}</em>
                </button>
                <button
                  type="button"
                  className={roomFilter === 'full' ? 'is-active' : ''}
                  onClick={() => setRoomFilter('full')}
                >
                  已满<em>{roomStats.full}</em>
                </button>
              </div>
              <span className="challenge-muted challenge-updated">
                {lastUpdated
                  ? `更新于 ${new Date(lastUpdated).toLocaleTimeString('zh-CN', {
                      hour12: false,
                      hour: '2-digit',
                      minute: '2-digit',
                    })} · 3 秒自动刷新`
                  : '3 秒自动刷新'}
              </span>
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
                <button type="button" className="btn btn-sm btn-ghost" onClick={focusCreate}>
                  <Icon name="plus" size={13} /> 开第一间
                </button>
              </div>
            ) : roomsView.length === 0 ? (
              <div className="empty empty--inline">
                <Icon name="swords" size={22} />
                <p>没有匹配的房间，换个关键词或筛选试试。</p>
                <button
                  type="button"
                  className="btn btn-sm btn-ghost"
                  onClick={() => {
                    setRoomFilter('all');
                    setRoomKeyword('');
                  }}
                >
                  清除筛选
                </button>
              </div>
            ) : (
              <div className="challenge-table">
                <div className="challenge-table-head">
                  <span>模式</span>
                  <span>房间</span>
                  <span>人数</span>
                  <span>准备</span>
                  <span>房主</span>
                  <span />
                </div>
                {roomsView.map((room) => (
                  <div key={room.id} className={'challenge-row' + (room.full ? ' is-full' : '')}>
                    <span className={'challenge-row-mode challenge-row-mode--' + room.mode.replace('v', '')}>
                      {room.mode}
                    </span>
                    <span className="challenge-row-title">
                      <b>{room.title}</b>
                      <small>
                        {timeLabel(room.createdAt)} · {room.map || '未指定地图'} ·{' '}
                        {room.server?.name || '未指定服务器'}
                      </small>
                    </span>
                    <span className="challenge-row-count">
                      {room.playerCount}
                      <em>/{room.maxPlayers}</em>
                    </span>
                    <span className="challenge-row-ready">
                      <span className={'challenge-ready-dot' + (room.readyCount > 0 ? ' is-ready' : '')} />
                      {room.readyCount}/{room.playerCount}
                    </span>
                    <span className="challenge-row-host">
                      <Avatar user={room.host} size="xs" />
                      {playerLabel(room.host)}
                    </span>
                    <span className="challenge-row-ops">
                      <button
                        type="button"
                        className="btn btn-sm btn-ghost challenge-join"
                        onClick={() => joinRoom(room)}
                        disabled={room.full || Boolean(busy)}
                      >
                        {busy === 'join-' + room.id ? '加入中…' : room.full ? '已满员' : '加入'}
                      </button>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}

      {inviteOpen && (
        <div className="challenge-modal-backdrop" onClick={closeInvite}>
          <div
            ref={inviteDialogRef}
            className="challenge-modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby="challenge-invite-title"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="challenge-modal-head">
              <div>
                <h3 id="challenge-invite-title">邀请玩家</h3>
                <small>邀请会保留在对方的约战大厅，接受后自动入座。</small>
              </div>
              <button
                type="button"
                className="icon-btn"
                onClick={closeInvite}
                aria-label="关闭邀请面板"
              >
                <Icon name="close" size={15} />
              </button>
            </div>
            <div className="search challenge-search">
              <Icon name="search" size={14} />
              <input
                type="text"
                value={memberQuery}
                autoFocus
                aria-label="搜索要邀请的成员"
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
                      title={myRoom?.full ? '房间已满' : ''}
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
