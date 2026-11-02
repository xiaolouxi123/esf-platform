import { initials } from '../lib/format';

/** 用用户名算一个稳定的色相，保证同一个人头像颜色不变 */
function hueOf(text) {
  let hash = 0;
  for (const ch of String(text || '?')) {
    hash = (hash * 31 + ch.codePointAt(0)) % 360;
  }
  return hash;
}

/**
 * 统一头像：优先用玩家自定义的 emoji，否则用昵称首字。
 * 背景色由用户名决定，所以不需要额外存颜色。
 */
export default function Avatar({ user, size = 'md', className = '' }) {
  const image = String(user?.avatarUrl || '').trim();
  const label = String(user?.avatar || '').trim() || initials(user?.gameName || user?.username);
  const hue = hueOf(user?.username || user?.gameName);
  const style = {
    background: `linear-gradient(135deg, hsl(${hue} 68% 58%), hsl(${(hue + 44) % 360} 70% 42%))`,
  };

  return (
    <span
      className={`avatar avatar--${size}${image ? ' avatar--image' : ''}${className ? ` ${className}` : ''}`}
      style={style}
      title={user?.gameName || user?.username || ''}
    >
      {image ? <img src={image} alt="" /> : label}
    </span>
  );
}
