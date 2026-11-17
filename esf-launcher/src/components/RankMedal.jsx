import { useId } from 'react';
import { RANK_TIERS } from '../lib/rankLadder';

// 段位徽章：外翼 + 盾形框 + 龙珠宝珠 + 星数 + 高段位光环/闪电/王冠。
// 纯 SVG，随段位换配色与装饰层级，星数直接对应当前段位内的 1-5 星。
const STAR_LAYOUT = {
  1: [[60, 63, 3.6]],
  2: [[54, 60, 3.1], [66, 67, 3.1]],
  3: [[60, 55, 3], [53, 68, 3], [67, 68, 3]],
  4: [[54, 58, 2.9], [66, 58, 2.9], [54, 70, 2.9], [66, 70, 2.9]],
  5: [[60, 55, 2.7], [52, 62, 2.7], [68, 62, 2.7], [55, 72, 2.7], [65, 72, 2.7]],
};

function starPoints(cx, cy, r) {
  const pts = [];
  for (let i = 0; i < 10; i += 1) {
    const radius = i % 2 === 0 ? r : r * 0.44;
    const angle = (Math.PI / 5) * i - Math.PI / 2;
    pts.push(`${(cx + Math.cos(angle) * radius).toFixed(2)},${(cy + Math.sin(angle) * radius).toFixed(2)}`);
  }
  return pts.join(' ');
}

export default function RankMedal({ tier = 0, stars = 1, size = 96, className = '' }) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const index = Math.max(0, Math.min(RANK_TIERS.length - 1, Number(tier) || 0));
  const meta = RANK_TIERS[index];
  const safeStars = Math.max(1, Math.min(5, Number(stars) || 1));
  const layout = STAR_LAYOUT[safeStars] || STAR_LAYOUT[1];
  const bigWings = index >= 2;
  const halo = index >= 4;
  const bolts = index >= 6;
  const crown = index >= 7;
  const apex = index >= 8;
  const divine = index >= 9;

  return (
    <svg
      className={`rank-medal ${className}`.trim()}
      width={size}
      height={size}
      viewBox="0 0 120 120"
      role="img"
      aria-label={`${meta.name} ${safeStars} 星`}
    >
      <defs>
        <linearGradient id={`${uid}-metal`} x1="0" y1="0" x2="0.4" y2="1">
          <stop offset="0%" stopColor={meta.metal[0]} />
          <stop offset="55%" stopColor={meta.metal[1]} />
          <stop offset="100%" stopColor={meta.metal[0]} stopOpacity="0.82" />
        </linearGradient>
        <linearGradient id={`${uid}-wing`} x1="0" y1="0.2" x2="1" y2="1">
          <stop offset="0%" stopColor={meta.metal[0]} stopOpacity="0.95" />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0.35" />
        </linearGradient>
        <radialGradient id={`${uid}-aura`}>
          <stop offset="0%" stopColor={meta.color} stopOpacity="0.55" />
          <stop offset="60%" stopColor={meta.color} stopOpacity="0.18" />
          <stop offset="100%" stopColor={meta.color} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={`${uid}-orb`} cx="0.35" cy="0.3" r="0.85">
          <stop offset="0%" stopColor="#fff3bf" />
          <stop offset="45%" stopColor="#ffc447" />
          <stop offset="100%" stopColor="#e2680f" />
        </radialGradient>
        <clipPath id={`${uid}-orbclip`}>
          <circle cx="60" cy="63" r="15.5" />
        </clipPath>
      </defs>

      <circle className="rm-aura" cx="60" cy="62" r="47" fill={`url(#${uid}-aura)`} />
      <circle
        className="rm-aura-ring"
        cx="60"
        cy="62"
        r="43"
        fill="none"
        stroke={meta.color}
        strokeOpacity="0.42"
        strokeWidth="1.4"
        strokeDasharray="5 19"
      />

      {apex && (
        <g className="rm-apex" opacity="0.95">
          <circle cx="60" cy="62" r="51" fill="none" stroke={meta.color} strokeOpacity="0.45" strokeWidth="1" strokeDasharray="2 8" />
          {[[60, 9], [113, 62], [60, 115], [7, 62]].map(([x, y], i) => (
            <rect
              key={i}
              x={x - 2.6}
              y={y - 2.6}
              width="5.2"
              height="5.2"
              transform={`rotate(45 ${x} ${y})`}
              fill={meta.color}
              opacity="0.85"
            />
          ))}
        </g>
      )}

      {divine && (
        <g className="rm-apex-flame" stroke={meta.color} strokeWidth="1.4" fill="none" strokeLinecap="round" opacity="0.7">
          <path d="M60 2 C55 11 50 16 50 22 C50 29 55 33 60 33 C65 33 70 29 70 22 C70 16 65 11 60 2 Z" />
        </g>
      )}

      <g className="rm-wings" fill={`url(#${uid}-wing)`}>
        <path
          d={
            bigWings
              ? 'M55 58 C41 39 22 39 9 52 C24 49 34 58 44 77 C48 68 52 62 55 58 Z'
              : 'M53 58 C44 50 33 51 24 60 C34 58 42 63 48 73 Z'
          }
        />
        <path
          transform="translate(120 0) scale(-1 1)"
          d={
            bigWings
              ? 'M55 58 C41 39 22 39 9 52 C24 49 34 58 44 77 C48 68 52 62 55 58 Z'
              : 'M53 58 C44 50 33 51 24 60 C34 58 42 63 48 73 Z'
          }
        />
      </g>

      {halo && <circle className="rm-halo" cx="60" cy="62" r="36" fill="none" stroke={meta.color} strokeOpacity="0.5" strokeWidth="1.5" />}

      <path
        d="M60 28 L92 43 L92 68 L60 95 L28 68 L28 43 Z"
        fill={`url(#${uid}-metal)`}
        stroke="rgba(255,255,255,0.42)"
        strokeWidth="1.1"
      />
      <path d="M60 36 L84 47 L84 65 L60 85 L36 65 L36 47 Z" fill="#0a1018" fillOpacity="0.62" />

      {crown && (
        <path className="rm-crown" d="M42 24 L49 11 L56 20 L60 7 L64 20 L71 11 L78 24 Z" fill={`url(#${uid}-metal)`} stroke="rgba(255,255,255,0.5)" strokeWidth="0.8" />
      )}

      {bolts && (
        <g className="rm-bolts" stroke={meta.color} strokeWidth="1.6" fill="none" strokeLinecap="round" opacity="0.85">
          <path d="M21 46 L26 52 L21 58 L27 64" />
          <path d="M99 46 L94 52 L99 58 L93 64" />
        </g>
      )}

      <g className="rm-orb">
        <circle cx="60" cy="63" r="17" fill="#3b1a05" opacity="0.5" />
        <circle cx="60" cy="63" r="15.5" fill={`url(#${uid}-orb)`} />
        <ellipse cx="54" cy="57" rx="5.4" ry="3.4" fill="#fffbe6" opacity="0.55" transform="rotate(-26 54 57)" />
        {layout.map(([cx, cy, r], i) => (
          <polygon
            key={i}
            className="rm-star"
            points={starPoints(cx, cy, r)}
            fill="#8a3103"
            style={{ animationDelay: `${i * 0.28}s` }}
          />
        ))}
        <g clipPath={`url(#${uid}-orbclip)`}>
          <rect className="rm-shine" x="34" y="34" width="16" height="60" fill="#fff" opacity="0.3" transform="rotate(24 60 63)" />
        </g>
      </g>
    </svg>
  );
}
