import { useEffect } from 'react';
import Icon from './Icon';

export default function Toast({ toast, onDone }) {
  useEffect(() => {
    if (!toast) return undefined;
    const timer = setTimeout(() => onDone?.(), toast.duration || 4200);
    return () => clearTimeout(timer);
  }, [toast, onDone]);

  if (!toast) return null;

  const iconName = toast.tone === 'error' ? 'alert' : toast.tone === 'loading' ? 'refresh' : 'check';

  return (
    <div className={`toast toast--${toast.tone || 'ok'}`} role="status">
      <span className="toast-icon">
        <Icon name={iconName} size={16} />
      </span>
      <span className="toast-text">{toast.message}</span>
    </div>
  );
}
