import type { JSX } from 'solid-js';

type IconProps = { size?: number; class?: string };

const base = (props: IconProps): JSX.SvgSVGAttributes<SVGSVGElement> => ({
  viewBox: '0 0 24 24',
  width: props.size ?? 16,
  height: props.size ?? 16,
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': 1.8,
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
  class: props.class ?? 'bai-icon',
  'aria-hidden': 'true',
});

export const IconBot = (props: IconProps) => (
  <svg {...base({ ...props, size: props.size ?? 18 })}>
    <path d="M7 8.5 12 5.5l5 3v5l-5 3-5-3z" />
    <circle cx="12" cy="11" r="1.6" fill="currentColor" stroke="none" />
    <path d="M12 2.5V5.5" />
  </svg>
);

export const IconSend = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M22 2 11 13" />
    <path d="M22 2l-7 20-4-9-9-4 20-7z" />
  </svg>
);

export const IconStop = (props: IconProps) => (
  <svg {...base(props)}>
    <rect x="6" y="6" width="12" height="12" rx="2" fill="currentColor" stroke="none" />
  </svg>
);

export const IconSettings = (props: IconProps) => (
  <svg {...base(props)}>
    <circle cx="12" cy="12" r="3" />
    <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.7 1.7 0 0 0-1.87-.34 1.7 1.7 0 0 0-1.03 1.56V21a2 2 0 1 1-4 0v-.11A1.7 1.7 0 0 0 8.9 19.3a1.7 1.7 0 0 0-1.87.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.7 15a1.7 1.7 0 0 0-1.56-1.03H3a2 2 0 1 1 0-4h.11A1.7 1.7 0 0 0 4.7 8.9a1.7 1.7 0 0 0-.34-1.87l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06A1.7 1.7 0 0 0 9 4.7a1.7 1.7 0 0 0 1.03-1.56V3a2 2 0 1 1 4 0v.11A1.7 1.7 0 0 0 15 4.7a1.7 1.7 0 0 0 1.87-.34l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06A1.7 1.7 0 0 0 19.3 9v.03A1.7 1.7 0 0 0 20.86 10H21a2 2 0 1 1 0 4h-.11A1.7 1.7 0 0 0 19.4 15z" />
  </svg>
);

export const IconPlus = (props: IconProps) => (
  <svg {...base(props)}>
    <path d="M12 5v14M5 12h14" />
  </svg>
);

export const IconChevron = (props: IconProps) => (
  <svg {...base({ ...props, size: props.size ?? 12 })}>
    <path d="M6 9l6 6 6-6" />
  </svg>
);

export const IconTrash = (props: IconProps) => (
  <svg {...base({ ...props, size: props.size ?? 14 })}>
    <path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14" />
  </svg>
);

export const IconCheck = (props: IconProps) => (
  <svg {...base({ ...props, size: props.size ?? 12 })}>
    <path d="M20 6 9 17l-5-5" />
  </svg>
);

export const IconAlert = (props: IconProps) => (
  <svg {...base({ ...props, size: props.size ?? 12 })}>
    <path d="M12 8v5M12 17h.01" />
    <circle cx="12" cy="12" r="9" />
  </svg>
);
