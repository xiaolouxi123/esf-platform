import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import RankMedal from './RankMedal';
import { RANK_TIERS, rankOf, STARS_PER_TIER } from '../lib/rankLadder';

// 悬停/聚焦奖杯时展开的天梯说明卡：左边是当前悬停段位的动态徽章与介绍，
// 右边是全部段位列表，鼠标扫过任意一行即切换预览。
const CARD_WIDTH = 384;

export default function RankTip({ index = 0, stars = 1, rating = 0, children }) {
  const [open, setOpen] = useState(false);
  const [hover, setHover] = useState(index);
  const [pos, setPos] = useState(null);
  const anchorRef = useRef(null);
  const cardRef = useRef(null);
  const closeTimer = useRef(null);
  const current = rankOf(rating);

  const show = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const openFromTrigger = () => {
    setHover(index);
    show();
  };
  const hide = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setOpen(false), 140);
  };

  useLayoutEffect(() => {
    if (!open || !anchorRef.current) return;
    const rect = anchorRef.current.getBoundingClientRect();
    const cardHeight = cardRef.current?.offsetHeight || 392;
    const left = Math.min(Math.max(12, rect.left + rect.width / 2 - CARD_WIDTH / 2), window.innerWidth - CARD_WIDTH - 12);
    const below = rect.bottom + 12;
    const top = below + cardHeight < window.innerHeight - 8
      ? below
      : Math.max(12, rect.top - cardHeight - 12);
    setPos({ top, left });
  }, [open]);

  useEffect(() => {
    if (!open) return undefined;
    const onKey = (event) => {
      if (event.key !== 'Escape') return;
      event.stopPropagation();
      setOpen(false);
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);

  const hovered = RANK_TIERS[hover];
  const hoveredNext = RANK_TIERS[hover + 1] || null;
  const starCount = hover === index ? Math.max(1, Math.min(STARS_PER_TIER, stars)) : STARS_PER_TIER;

  return (
    <span
      className="rank-tip"
      ref={anchorRef}
      onMouseEnter={openFromTrigger}
      onMouseLeave={hide}
    >
      <span
        className="rank-tip-trigger"
        role="button"
        tabIndex={0}
        aria-label={`${current.name} ${stars} 星，悬停查看全部 ${RANK_TIERS.length} 个段位`}
        onFocus={openFromTrigger}
        onClick={() => { setHover(index); setOpen((value) => !value); }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            setOpen((value) => !value);
          }
        }}
      >
        {children}
      </span>

      {open && pos && createPortal(
        <div
          className="rank-tip-card"
          ref={cardRef}
          style={{ top: pos.top, left: pos.left, width: CARD_WIDTH }}
          onMouseEnter={show}
          onMouseLeave={hide}
          role="dialog"
          aria-label="天梯段位说明"
        >
          <div className="rank-tip-head">
            <b>天梯段位</b>
            <span>
              {RANK_TIERS.length} 段 × {STARS_PER_TIER} 星 · 每 50 分一颗
            </span>
          </div>

          <div className="rank-tip-focus">
            <RankMedal tier={hover} stars={starCount} size={96} />
            <div className="rank-tip-focus-meta">
              <b style={{ color: hovered.color }}>{hovered.name}</b>
              <span className="rank-tip-stars">
                {Array.from({ length: STARS_PER_TIER }).map((_, i) => (
                  <i key={i} className={i < starCount ? 'is-on' : ''} />
                ))}
              </span>
              <p>{hovered.intro}</p>
              <small>
                {hoveredNext
                  ? `${hovered.floor} 分起 · 升到 ${hoveredNext.name} 需要 ${hoveredNext.floor - hovered.floor} 分`
                  : `${hovered.floor} 分起 · 已是最高的段位`}
              </small>
            </div>
          </div>

          <div className="rank-tip-rows">
            {RANK_TIERS.map((tier, i) => (
              <button
                key={tier.key}
                type="button"
                className={`rank-tip-row${i === hover ? ' is-hover' : ''}${i === current.index ? ' is-current' : ''}`}
                onMouseEnter={() => setHover(i)}
                onFocus={() => setHover(i)}
                onClick={() => setHover(i)}
              >
                <i style={{ background: tier.color }} />
                <b style={i === current.index ? { color: tier.color } : undefined}>{tier.name}</b>
                <small>{tier.floor} 分</small>
                {i === current.index && <em>当前</em>}
              </button>
            ))}
          </div>

          <div className="rank-tip-foot">
            <span>
              你现在：<b style={{ color: current.color }}>{current.name}</b> · {current.value} 分
            </span>
            <span>{current.next ? `距 ${current.next.name} 还差 ${current.toNext} 分` : '已达最高段位'}</span>
          </div>
        </div>,
        document.body,
      )}
    </span>
  );
}