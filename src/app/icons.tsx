import type { SVGProps } from 'react';

type P = SVGProps<SVGSVGElement> & { size?: number };

function base({ size = 16, ...rest }: P) {
  return { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: 1.2, strokeLinecap: 'round' as const, strokeLinejoin: 'round' as const, ...rest };
}

export const IconMetric = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 13.5h12" />
    <path d="M3.5 11V7.5M6.5 11V4.5M9.5 11V8.5M12.5 11V3" />
    <path d="M2.5 5.5l3-2.5 3 3 4-4.5" opacity=".55" />
  </svg>
);

export const IconVisual = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 2v12M11 2v12" opacity=".5" />
    <rect x="2.5" y="5" width="3" height="5" />
    <rect x="9.5" y="3.5" width="3" height="6.5" />
    <path d="M7.5 8.5V11" opacity=".5" />
  </svg>
);

export const IconCalendar = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="3" width="12" height="11" />
    <path d="M2 6.5h12M5 1.5v3M11 1.5v3" />
    <path d="M4.5 9h2v2h-2zM9.5 9h2v2h-2z" fill="currentColor" stroke="none" opacity=".7" />
  </svg>
);

export const IconNote = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 2h7l3 3v9H3z" />
    <path d="M10 2v3h3" />
    <path d="M5 8h6M5 10.5h6M5 5.5h2" opacity=".7" />
  </svg>
);

export const IconAgent = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 1.5l5.5 3.25v6.5L8 14.5l-5.5-3.25v-6.5z" />
    <circle cx="8" cy="8" r="2" />
    <path d="M8 6V3.2M8 10v2.8M6.3 7l-2.6-1.5M9.7 7l2.6-1.5M6.3 9l-2.6 1.5M9.7 9l2.6 1.5" opacity=".55" />
  </svg>
);

export const IconBot = (p: P) => (
  <svg {...base(p)}>
    <rect x="3.5" y="3.5" width="9" height="9" />
    <rect x="6" y="6" width="4" height="4" opacity=".7" />
    <path d="M5.5 1v2.5M8 1v2.5M10.5 1v2.5M5.5 12.5V15M8 12.5V15M10.5 12.5V15M1 5.5h2.5M1 8h2.5M1 10.5h2.5M12.5 5.5H15M12.5 8H15M12.5 10.5H15" />
  </svg>
);

export const IconCopier = (p: P) => (
  <svg {...base(p)}>
    <rect x="2" y="2" width="8" height="8" />
    <path d="M6 12v2h8V6h-2" />
    <path d="M10 6h4" opacity=".5" />
    <path d="M6.5 6h-2m0 0l1-1m-1 1l1 1" opacity=".7" />
  </svg>
);

export const IconImport = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 2v8M5 7l3 3 3-3" />
    <path d="M2.5 11v2.5h11V11" />
  </svg>
);

export const IconExport = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 10V2M5 5l3-3 3 3" />
    <path d="M2.5 11v2.5h11V11" />
  </svg>
);

export const IconPlus = (p: P) => (
  <svg {...base(p)}>
    <path d="M8 3v10M3 8h10" />
  </svg>
);

export const IconTrash = (p: P) => (
  <svg {...base(p)}>
    <path d="M3 4h10M6 4V2.5h4V4M4 4l.7 9.5h6.6L12 4" />
  </svg>
);

export const IconClose = (p: P) => (
  <svg {...base(p)}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </svg>
);

export const IconChevron = (p: P) => (
  <svg {...base(p)}>
    <path d="M6 3l5 5-5 5" />
  </svg>
);

export const IconSearch = (p: P) => (
  <svg {...base(p)}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </svg>
);

export const IconLink = (p: P) => (
  <svg {...base(p)}>
    <path d="M6.5 9.5l3-3" />
    <path d="M7 4.5l1.2-1.2a2.5 2.5 0 013.5 3.5L10.5 8" />
    <path d="M9 11.5l-1.2 1.2a2.5 2.5 0 01-3.5-3.5L5.5 8" />
  </svg>
);

export const IconSettings = (p: P) => (
  <svg {...base(p)}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </svg>
);

export const IconSend = (p: P) => (
  <svg {...base(p)}>
    <path d="M2 8l12-6-4 12-2.5-4.5z" />
    <path d="M7.5 9.5L14 2" opacity=".6" />
  </svg>
);

export const IconPlay = (p: P) => (
  <svg {...base(p)}>
    <path d="M4.5 2.5v11l8-5.5z" />
  </svg>
);

export const IconGraph = (p: P) => (
  <svg {...base(p)}>
    <circle cx="4" cy="4" r="1.8" />
    <circle cx="12" cy="5" r="1.8" />
    <circle cx="8" cy="12" r="1.8" />
    <path d="M5.6 4.6l4.7.3M5 5.5l2.3 5M11 6.6l-2.2 3.8" opacity=".6" />
  </svg>
);
