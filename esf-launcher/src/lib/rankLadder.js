// 天梯段位阶梯：10 段 × 5 星，每段 250 分，每星 50 分。
// 徽章造型参考 DOTA2 赛季奖章的信息层级（外翼 / 徽章主体 / 宝珠 / 星数 / 高段位光环），
// 但图形与命名都是 ESF 自己的龙珠体系，不复制任何官方素材。
export const STARS_PER_TIER = 5;
export const POINTS_PER_TIER = 250;
export const POINTS_PER_STAR = POINTS_PER_TIER / STARS_PER_TIER;

export const RANK_TIERS = [
  {
    key: 'villager',
    name: '村民',
    short: '村民',
    floor: 0,
    color: '#a3b58f',
    metal: ['#e6eedb', '#7c9169'],
    intro: '刚下山的普通人，先学会站稳。',
  },
  {
    key: 'apprentice',
    name: '武道学徒',
    short: '学徒',
    floor: 250,
    color: '#c98f5a',
    metal: ['#f3d8b0', '#96602f'],
    intro: '招式成形，开始理解距离与节奏。',
  },
  {
    key: 'fighter',
    name: '武者',
    short: '武者',
    floor: 500,
    color: '#6fd3a3',
    metal: ['#d3f7e6', '#2f8f66'],
    intro: '能读对手起手，能把优势兑现成分数。',
  },
  {
    key: 'champion',
    name: '天下拳王',
    short: '拳王',
    floor: 750,
    color: '#46c7ff',
    metal: ['#c8ecff', '#1f8fc4'],
    intro: '擂台上开始有人记住你的名字。',
  },
  {
    key: 'turtle',
    name: '龟仙弟子',
    short: '龟仙',
    floor: 1000,
    color: '#a78bfa',
    metal: ['#e2d8ff', '#6d4fd0'],
    intro: '气开始外放，攻防转换有了自己的节拍。',
  },
  {
    key: 'crane',
    name: '鹤仙传人',
    short: '鹤仙',
    floor: 1250,
    color: '#ffd166',
    metal: ['#fff2c6', '#c99a1c'],
    intro: '身法与出手都快半拍，对手开始被你牵着走。',
  },
  {
    key: 'super',
    name: '超级赛亚人',
    short: '超赛',
    floor: 1500,
    color: '#ff9f1a',
    metal: ['#ffe0ae', '#d9700f'],
    intro: '全场都能感到你的气场，逆风也能翻。',
  },
  {
    key: 'divine',
    name: '神之境',
    short: '神境',
    floor: 1750,
    color: '#ff4d8d',
    metal: ['#ffd3e2', '#c01f5c'],
    intro: '服务器里的天花板，名字本身就是压力。',
  },
  {
    key: 'kaio',
    name: '界王神',
    short: '界王',
    floor: 2000,
    color: '#67e8f9',
    metal: ['#e8feff', '#0e7490'],
    intro: '能改写战场节奏，别人只能跟着你的判断走。',
  },
  {
    key: 'destroyer',
    name: '破坏神',
    short: '破坏',
    floor: 2250,
    color: '#b45cff',
    metal: ['#efdcff', '#5b21b6'],
    intro: '站在服务器顶点，输赢在你出手前就已经算好。',
  },
];

export function rankOf(rating) {
  const value = Number.isFinite(Number(rating)) ? Math.max(0, Number(rating)) : 0;
  let index = 0;
  RANK_TIERS.forEach((tier, i) => {
    if (value >= tier.floor) index = i;
  });
  const tier = RANK_TIERS[index];
  const next = RANK_TIERS[index + 1] || null;
  const delta = value - tier.floor;
  const stars = Math.min(STARS_PER_TIER, 1 + Math.floor(delta / POINTS_PER_STAR));
  const percent = next
    ? Math.min(100, Math.max(0, (delta / POINTS_PER_TIER) * 100))
    : 100;

  return {
    value,
    index,
    tier,
    name: tier.name,
    short: tier.short,
    color: tier.color,
    metal: tier.metal,
    stars,
    starsMax: STARS_PER_TIER,
    next,
    toNext: next ? Math.max(0, next.floor - value) : 0,
    percent,
    isMax: !next,
  };
}
