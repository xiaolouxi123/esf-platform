/** 用用户名算一个稳定的色相，保证同一个人头像颜色不变 */
function hueOf(text) {
  let hash = 0;
  for (const ch of String(text || '?')) {
    hash = (hash * 31 + ch.codePointAt(0)) % 360;
  }
  return hash;
}

/**
 * 统一头像：上传图 > 自定义 emoji > 默认灰色人轮廓。
 * 没有上传头像、也没有自定义 emoji 的玩家，统一使用中性轮廓，不再用首字彩色块。
 */
export default function Avatar({ user, size = 'md', className = '' }) {
  const image = String(user?.avatarUrl || '').trim();
  const custom = String(user?.avatar || '').trim();
  const hue = hueOf(user?.username || user?.gameName);
  const hasVisual = Boolean(image || custom);
  const style = hasVisual
    ? { background: `linear-gradient(135deg, hsl(${hue} 68% 58%), hsl(${(hue + 44) % 360} 70% 42%))` }
    : undefined;
  const classes = [
    'avatar',
    `avatar--${size}`,
    image ? 'avatar--image' : '',
    !hasVisual ? 'avatar--silhouette' : '',
    className || '',
  ].filter(Boolean).join(' ');

  return (
    <span
      className={classes}
      style={style}
      title={user?.gameName || user?.username || ''}
    >
      {image ? (
        <img src={image} alt="" />
      ) : custom ? (
        custom
      ) : (
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <circle cx="12" cy="8" r="4" fill="currentColor" />
          <path d="M4.2 20.2c.4-4 3.5-6.6 7.8-6.6s7.4 2.6 7.8 6.6" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" />
        </svg>
      )}
    </span>
  );
}
