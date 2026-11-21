import { useEffect, useId, useRef, useState } from 'react';
import Icon from './Icon';

/**
 * 深色主题下的轻量下拉选择器。
 * 原生 select 在 Windows 上会弹出白底系统菜单，和平台主题冲突，这里用 listbox 实现。
 */
export default function SelectMenu({
  value,
  options,
  onChange,
  ariaLabel,
  className = '',
  buttonClassName = '',
  disabled = false,
  align = 'right',
}) {
  const [open, setOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const rootRef = useRef(null);
  const buttonRef = useRef(null);
  const listRef = useRef(null);
  const listId = useId();

  const selectedIndex = Math.max(
    0,
    options.findIndex((option) => option.value === value)
  );
  const selected = options[selectedIndex] || options[0];
  const firstEnabledIndex = Math.max(
    0,
    options.findIndex((option) => !option.disabled)
  );
  const lastEnabledIndex = Math.max(
    firstEnabledIndex,
    options.reduce((last, option, index) => (option.disabled ? last : index), firstEnabledIndex)
  );

  const nextEnabled = (from, step) => {
    if (options.length === 0) return 0;
    let index = from;
    for (let count = 0; count < options.length; count += 1) {
      index = (index + step + options.length) % options.length;
      if (!options[index]?.disabled) return index;
    }
    return from;
  };

  useEffect(() => {
    if (!open) return undefined;
    const focusTimer = window.setTimeout(() => listRef.current?.focus(), 0);

    const onDocumentMouseDown = (event) => {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener('mousedown', onDocumentMouseDown);
    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener('mousedown', onDocumentMouseDown);
    };
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const item = listRef.current?.querySelector(`[data-index="${activeIndex}"]`);
    item?.scrollIntoView({ block: 'nearest' });
  }, [activeIndex, open]);

  const close = (restoreFocus = true) => {
    setOpen(false);
    if (restoreFocus) buttonRef.current?.focus();
  };

  const commit = (index) => {
    const option = options[index];
    if (!option || option.disabled) return;
    onChange(option.value);
    close();
  };

  const openMenu = () => {
    if (disabled) return;
    setActiveIndex(options[selectedIndex]?.disabled ? firstEnabledIndex : selectedIndex);
    setOpen(true);
  };

  const onKeyDown = (event) => {
    if (disabled) return;

    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(event.key)) {
        event.preventDefault();
        openMenu();
      }
      return;
    }

    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close();
      return;
    }
    if (event.key === 'Tab') {
      close();
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((index) => nextEnabled(index, step));
      return;
    }
    if (event.key === 'Home') {
      event.preventDefault();
      setActiveIndex(firstEnabledIndex);
      return;
    }
    if (event.key === 'End') {
      event.preventDefault();
      setActiveIndex(lastEnabledIndex);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      commit(activeIndex);
    }
  };

  return (
    <div
      className={`select-menu ${className}`.trim()}
      ref={rootRef}
      onKeyDown={onKeyDown}
      onBlur={(event) => {
        if (!rootRef.current?.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <button
        ref={buttonRef}
        type="button"
        className={`select-menu-trigger ${buttonClassName}`.trim()}
        role="combobox"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        disabled={disabled}
        onClick={() => (open ? close() : openMenu())}
      >
        <span className="select-menu-value">{selected?.label}</span>
        <Icon name="chevron" size={12} />
      </button>

      {open ? (
        <div
          ref={listRef}
          id={listId}
          className={`select-menu-list select-menu-list--${align}`}
          role="listbox"
          tabIndex={-1}
          aria-label={ariaLabel}
          aria-activedescendant={`${listId}-option-${activeIndex}`}
        >
          {options.map((option, index) => (
            <button
              key={option.value}
              type="button"
              id={`${listId}-option-${index}`}
              data-index={index}
              className={`select-menu-option${index === activeIndex ? ' is-active' : ''}${
                option.value === value ? ' is-selected' : ''
              }${option.disabled ? ' is-disabled' : ''}`}
              role="option"
              aria-selected={option.value === value}
              aria-disabled={option.disabled || undefined}
              disabled={option.disabled}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => {
                if (!option.disabled) setActiveIndex(index);
              }}
              onClick={() => commit(index)}
            >
              {option.label}
              {option.value === value ? <Icon name="check" size={12} /> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
