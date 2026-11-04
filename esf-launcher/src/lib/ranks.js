export const DEFAULT_RANKS = [
  { level: 0, name: '未定级', color: '#7C879E', sortOrder: 0 },
  { level: 1, name: 'D', color: '#9AA7BD', sortOrder: 1 },
  { level: 2, name: 'C', color: '#64D8A2', sortOrder: 2 },
  { level: 3, name: 'B', color: '#5DBBFF', sortOrder: 3 },
  { level: 4, name: 'A', color: '#B18CFF', sortOrder: 4 },
  { level: 5, name: 'X', color: '#FF8A5B', sortOrder: 5 },
  { level: 6, name: 'S', color: '#FFD166', sortOrder: 6 },
];

export function normalizeRanks(ranks) {
  if (!Array.isArray(ranks) || ranks.length === 0) return DEFAULT_RANKS;
  return ranks
    .map((rank, index) => ({
      level: Number(rank.level ?? index),
      name: String(rank.name || `Lv.${rank.level ?? index}`),
      color: String(rank.color || '#94A0B8'),
      sortOrder: Number(rank.sortOrder ?? rank.sort_order ?? rank.level ?? index),
    }))
    .sort((a, b) => a.sortOrder - b.sortOrder || a.level - b.level);
}

export function rankMap(ranks) {
  return new Map(normalizeRanks(ranks).map((rank) => [rank.level, rank]));
}

export function rankFor(ranks, level) {
  return rankMap(ranks).get(Number(level)) || DEFAULT_RANKS[0];
}

export function rankLabel(ranks, level) {
  const rank = rankFor(ranks, level);
  return rank.level === 0 ? rank.name || '未定级' : rank.name;
}
