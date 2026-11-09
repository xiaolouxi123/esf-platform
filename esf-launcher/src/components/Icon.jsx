const paths = {
  home: <path d="M4 10.6 12 4l8 6.6V19a1 1 0 0 1-1 1h-4.2v-5.6H9.2V20H5a1 1 0 0 1-1-1z" />,
  download: (
    <>
      <path d="M12 4v10" />
      <path d="m8 10 4 4 4-4" />
      <path d="M5 19h14" />
    </>
  ),
  server: (
    <>
      <rect x="3.5" y="4" width="17" height="6.2" rx="1.6" />
      <rect x="3.5" y="13.8" width="17" height="6.2" rx="1.6" />
      <path d="M7 7.1h.01M7 16.9h.01" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3.8v3.4M15 3.8v3.4" />
      <path d="M7 7.2h10v4.1a5 5 0 0 1-10 0z" />
      <path d="M12 16.3v3.8" />
    </>
  ),
  settings: (
    <>
      <circle cx="12" cy="12" r="3.1" />
      <path d="M12 3.2v2.1M12 18.7v2.1M4.8 7.9l1.8 1M17.4 15.1l1.8 1M19.2 7.9l-1.8 1M6.6 15.1l-1.8 1" />
    </>
  ),
  play: <path d="M8 5.4v13.2L19 12z" fill="currentColor" stroke="none" />,
  pause: (
    <>
      <rect x="7" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
      <rect x="13.6" y="5" width="3.4" height="14" rx="1" fill="currentColor" stroke="none" />
    </>
  ),
  refresh: (
    <>
      <path d="M20 11.5a8 8 0 1 0-2.3 5.9" />
      <path d="M20 5.5v6h-6" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="6.2" />
      <path d="m16 16 4 4" />
    </>
  ),
  star: <path d="m12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10l5.4-.8z" />,
  starFill: (
    <path
      d="m12 4.4 2.4 4.9 5.4.8-3.9 3.8.9 5.4-4.8-2.6-4.8 2.6.9-5.4L4.2 10l5.4-.8z"
      fill="currentColor"
      stroke="none"
    />
  ),
  users: (
    <>
      <circle cx="9" cy="8.4" r="3.3" />
      <path d="M3.4 20c.6-3.1 2.9-5 5.6-5s5 1.9 5.6 5" />
      <path d="M16 5.6a3.2 3.2 0 0 1 0 6M17.6 15.2c1.8.6 3 2.2 3.4 4.3" />
    </>
  ),
  trophy: (
    <>
      <path d="M7 4.5h10v4.2a5 5 0 0 1-10 0z" />
      <path d="M7 6H4.6v1.4A3.4 3.4 0 0 0 8 10.8M17 6h2.4v1.4a3.4 3.4 0 0 1-3.4 3.4" />
      <path d="M12 13.7V17M8.4 19.8h7.2" />
    </>
  ),
  gift: (
    <>
      <rect x="3.6" y="8.4" width="16.8" height="4" rx="1" />
      <path d="M5.2 12.4V19a1 1 0 0 0 1 1h11.6a1 1 0 0 0 1-1v-6.6M12 8.4V20" />
      <path d="M12 8.4c-1.2 0-4.4-.4-4.4-2.6a2 2 0 0 1 4-1c.2.9.4 2 .4 3.6zm0 0c1.2 0 4.4-.4 4.4-2.6a2 2 0 0 0-4-1c-.2.9-.4 2-.4 3.6z" />
    </>
  ),
  bell: (
    <>
      <path d="M18 9.5a6 6 0 1 0-12 0c0 4.2-1.3 5.4-1.3 5.4h14.6S18 13.7 18 9.5" />
      <path d="M10.3 18.4a1.9 1.9 0 0 0 3.4 0" />
    </>
  ),
  help: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M9.6 9.6a2.5 2.5 0 1 1 3.4 2.3c-.7.3-1 .9-1 1.6v.4M12 17.2h.01" />
    </>
  ),
  logout: (
    <>
      <path d="M14.5 4.5H18a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-3.5" />
      <path d="M10 8.2 13.8 12 10 15.8M13.8 12H4.4" />
    </>
  ),
  minimize: <path d="M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  chevron: <path d="m6 9.5 6 6 6-6" />,
  eye: (
    <>
      <path d="M2.5 12s3.6-6 9.5-6 9.5 6 9.5 6-3.6 6-9.5 6-9.5-6-9.5-6z" />
      <circle cx="12" cy="12" r="2.6" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4.5 20 20" />
      <path d="M9.9 6.3A9.6 9.6 0 0 1 12 6c5.9 0 9.5 6 9.5 6a17 17 0 0 1-3.3 4" />
      <path d="M6.3 7.8A17.6 17.6 0 0 0 2.5 12s3.6 6 9.5 6a9.4 9.4 0 0 0 3.4-.6" />
      <path d="M10.2 10.3a2.6 2.6 0 0 0 3.6 3.6" />
    </>
  ),
  chevronRight: <path d="m9.5 6 6 6-6 6" />,
  chevronLeft: <path d="m14.5 6-6 6 6 6" />,
  copy: (
    <>
      <rect x="9" y="9" width="10.5" height="10.5" rx="2" />
      <path d="M6.5 15H5.6A1.6 1.6 0 0 1 4 13.4V5.6A1.6 1.6 0 0 1 5.6 4h7.8A1.6 1.6 0 0 1 15 5.6v.9" />
    </>
  ),
  check: <path d="m5 12.5 4.6 4.5L19 7" />,
  alert: (
    <>
      <path d="M12 4.6 21 20H3z" />
      <path d="M12 10v4.2M12 17.3h.01" />
    </>
  ),
  map: (
    <>
      <path d="m3.6 7 5.4-2.4 6 2.4 5.4-2.4v12.4l-5.4 2.4-6-2.4L3.6 19.4z" />
      <path d="M9 4.6v12.4M15 7v12.4" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="8.2" />
      <path d="M12 7.4V12l3.2 2" />
    </>
  ),
  signal: <path d="M4.5 15.5v3M9.5 12v6.5M14.5 8.5v10M19.5 5v13.5" />,
  shield: (
    <>
      <path d="M12 3.6 19 6v6c0 4-3 7.4-7 8.4-4-1-7-4.4-7-8.4V6z" />
      <path d="m9 12 2.2 2.2L15.4 10" />
    </>
  ),
  user: (
    <>
      <circle cx="12" cy="8.2" r="3.6" />
      <path d="M5 20c.8-3.6 3.6-5.6 7-5.6s6.2 2 7 5.6" />
    </>
  ),
  folder: <path d="M3.6 7.2a1.6 1.6 0 0 1 1.6-1.6h4l2 2.4h6.2a1.6 1.6 0 0 1 1.6 1.6v8.2a1.6 1.6 0 0 1-1.6 1.6H5.2a1.6 1.6 0 0 1-1.6-1.6z" />,
  external: (
    <>
      <path d="M13.5 5H19v5.5" />
      <path d="M19 5l-8 8" />
      <path d="M18 14.5V18a1.5 1.5 0 0 1-1.5 1.5H6A1.5 1.5 0 0 1 4.5 18V7.5A1.5 1.5 0 0 1 6 6h3.5" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  spark: <path d="M12 3.5 13.9 9l5.6 1.9-5.6 1.9L12 18.4 10.1 12.8 4.5 10.9 10.1 9z" />,
  swords: (
    <>
      <path d="m14.5 3.5 6 6-9.5 9.5-3-3z" />
      <path d="m3.5 14.5 6 6M8 18l-2 2M16 6l2-2" />
    </>
  ),
  leaf: (
    <>
      <path d="M4 20c8 0 14-5 16-16C10 4 4 9 4 17z" />
      <path d="M4 20c2-6 6-9 11-11" />
    </>
  ),
  book: (
    <>
      <path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H19v15H6.5A2.5 2.5 0 0 0 4 20.5z" />
      <path d="M4 5.5v15M8 7.5h7M8 11h7" />
    </>
  ),
  wifi: (
    <>
      <path d="M4 9.5a12 12 0 0 1 16 0M7 13a8 8 0 0 1 10 0M10 16.4a3.4 3.4 0 0 1 4 0" />
    </>
  ),
  power: (
    <>
      <path d="M12 4v7" />
      <path d="M7.4 7a7.4 7.4 0 1 0 9.2 0" />
    </>
  ),
  dot: <circle cx="12" cy="12" r="3.4" fill="currentColor" stroke="none" />,
};

export default function Icon({ name, size = 18, className = '', title }) {
  const content = paths[name] || paths.dot;
  return (
    <svg
      className={`icon${className ? ` ${className}` : ''}`}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={title ? undefined : 'true'}
      role={title ? 'img' : undefined}
    >
      {title ? <title>{title}</title> : null}
      {content}
    </svg>
  );
}
