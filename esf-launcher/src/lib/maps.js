/**
 * 地图元数据：中文名 + 模式分类。
 *
 * 设计稿的核心批评是「地图库全是原始文件名，像文件夹目录」，
 * 所以这里给每张图配上中文名与模式（对战 / 生存 / 剧情 / 其他）。
 * 新增地图没登记时会自动从代号生成可读名，不会出现空白。
 */

export const MAP_CATEGORIES = [
  { key: 'all', label: '全部' },
  { key: 'versus', label: '对战' },
  { key: 'survival', label: '生存' },
  { key: 'story', label: '剧情' },
  { key: 'fav', label: '收藏' },
];

const CATEGORY_META = {
  versus: { label: '对战', icon: 'swords', tone: 'versus' },
  survival: { label: '生存', icon: 'leaf', tone: 'survival' },
  story: { label: '剧情', icon: 'book', tone: 'story' },
  other: { label: '其他', icon: 'spark', tone: 'other' },
};

const MAPS = {
  // ── 对战 ────────────────────────────────────────────────
  esf_cell_day: ['沙鲁竞技场·昼', 'versus'],
  esf_cell_night: ['沙鲁竞技场·夜', 'versus'],
  esf_cell_games: ['沙鲁游戏场', 'versus'],
  esf_cell_games_new: ['沙鲁游戏场·新', 'versus'],
  esf_cell_games_new_night: ['沙鲁游戏场·新夜', 'versus'],
  esf_cell_games_night: ['沙鲁游戏场·夜', 'versus'],
  esf_cell_games_v3: ['沙鲁游戏场 V3', 'versus'],
  esf_cell_games_v4: ['沙鲁游戏场 V4', 'versus'],
  esf_cell_games2: ['沙鲁游戏场 II', 'versus'],
  fcx_cellgames: ['沙鲁游戏场·FCX', 'versus'],
  fcx_cellgames_new: ['沙鲁游戏场·新 FCX', 'versus'],
  fcx_cellgames_new_night: ['沙鲁游戏场·新夜 FCX', 'versus'],
  fcx_cellgames_new_night2: ['沙鲁游戏场·新夜 II', 'versus'],
  fcx_cellgames_new2: ['沙鲁游戏场·新 II', 'versus'],
  fcx_cellgames_night: ['沙鲁游戏场·夜 FCX', 'versus'],
  'UM-wFs_cellgames': ['沙鲁游戏场·WF', 'versus'],
  esf_neotournament: ['新天下第一武道会', 'versus'],
  esf_city: ['西部街区', 'versus'],
  esf_city_black: ['西部废墟', 'versus'],
  fcx_city_black: ['西部废墟·FCX', 'versus'],
  esf_moderncity: ['现代都市', 'versus'],
  esf_northhighway: ['北方公路', 'versus'],
  esf_riverside: ['河畔战场', 'versus'],
  z_spike_v5: ['尖刺竞技场 V5', 'versus'],

  // ── 生存 ────────────────────────────────────────────────
  ape_foreshadow: ['猿影森林', 'survival'],
  ape_ocean: ['碧海岛', 'survival'],
  esf_giant_forest: ['巨木森林', 'survival'],
  esf_hildegarn: ['希尔德加恩巢穴', 'survival'],
  esf_hildegarn_day: ['希尔德加恩巢穴·昼', 'survival'],
  fcx_hildegarn: ['希尔德加恩·FCX', 'survival'],
  fcx_hildegarn_day: ['希尔德加恩·昼 FCX', 'survival'],
  esf_lavapit: ['熔岩深渊', 'survival'],
  fcx_desert: ['荒漠', 'survival'],
  fcx_desert_night: ['荒漠·夜', 'survival'],
  fcx_iceland: ['冰原', 'survival'],
  'UM-wFs_greenlands': ['翠绿平原', 'survival'],
  'UM-wFs_jungle': ['丛林', 'survival'],

  // ── 剧情 ────────────────────────────────────────────────
  SelectBoss: ['首领会战', 'story'],
  fcx_anilaza: ['阿尼拉扎', 'story'],
  fcx_champa_arena: ['第六宇宙竞技场', 'story'],
  fcx_kaioplanet: ['界王星', 'story'],
  fcx_namek_destroyed: ['那美克星废墟', 'story'],
  esf_new_vegeta: ['新贝吉塔行星', 'story'],
  esf_lookout: ['神殿瞭望台', 'story'],

  // ── 其他 / 未登记 ───────────────────────────────────────
  pkwlz_2: ['未知战场 I', 'other'],
  pkwlz_4: ['未知战场 II', 'other'],
  pkwlz_6: ['未知战场 III', 'other'],
  pkwlz_wxx2: ['未知战场 IV', 'other'],
  pkylz_2: ['未知战场 V', 'other'],
};

function prettify(code) {
  return String(code)
    .replace(/^(esf|fcx|ape)_/i, '')
    .replace(/[_-]+/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

/** 单张地图的展示信息 */
export function mapMeta(code) {
  const entry = MAPS[code];
  const [name, category] = entry || [prettify(code), 'other'];
  const meta = CATEGORY_META[category] || CATEGORY_META.other;

  return {
    code,
    name,
    category,
    categoryLabel: meta.label,
    icon: meta.icon,
    tone: meta.tone,
  };
}

/** 数组形式，方便一次 map 完 */
export function mapCatalog(codes) {
  return (codes || []).map(mapMeta);
}
