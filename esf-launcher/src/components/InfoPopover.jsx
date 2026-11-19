import { useEffect, useId, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Icon from './Icon';

const CARD_WIDTH = 300;

export default function InfoPopover({ title, label = '说明', text = '', children, className = '' }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState({ left: 0, top: 0, up: false });
  const triggerRef = useRef(null);
  const cardRef = useRef(null);
  const id = useId();

  const place = () => {
    const node = triggerRef.current;
    if (!node) return;
    const rect = node.getBoundingClientRect();
    const width = Math.min(CARD_WIDTH, window.innerWidth - 24);
    let left = rect.left;
    if (left + width > window.innerWidth - 12) left = window.innerWidth - width - 12;
    left = Math.max(12, left);
    const up = rect.bottom + 250 > window.innerHeight;
    setPos({ left, top: up ? rect.top - 8 : rect.bottom + 8, up });
  };

  const show = () => {
    place();
    setOpen(true);
  };

  const hide = () => setOpen(false);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (triggerRef.current?.contains(event.target)) return;
      if (cardRef.current?.contains(event.target)) return;
      setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === 'Escape') {
        setOpen(false);
        triggerRef.current?.focus();
      }
    };
    const onViewport = () => setOpen(false);
    document.addEventListener('pointerdown', onPointerDown, true);
    document.addEventListener('keydown', onKeyDown);
    window.addEventListener('resize', onViewport);
    window.addEventListener('scroll', onViewport, true);
    const focusTimer = window.setTimeout(() => cardRef.current?.focus(), 30);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('pointerdown', onPointerDown, true);
      document.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('resize', onViewport);
      window.removeEventListener('scroll', onViewport, true);
    };
  }, [open]);

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`info-pop-trigger${text ? ' has-text' : ''}${className ? ` ${className}` : ''}`}
        aria-label={text || label}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-controls={open ? id : undefined}
        onClick={() => (open ? hide() : show())}
      >
        <Icon name="help" size={13} />
        {text ? <span>{text}</span> : null}
      </button>
      {open &&
        createPortal(
          <div
            id={id}
            ref={cardRef}
            className={`info-pop-card${pos.up ? ' is-up' : ''}`}
            style={{ left: pos.left, top: pos.top, width: Math.min(CARD_WIDTH, window.innerWidth - 24) }}
            role="dialog"
            aria-label={title}
            tabIndex={-1}
          >
            <b>{title}</b>
            {children}
          </div>,
          document.body
        )}
    </>
  );
}
