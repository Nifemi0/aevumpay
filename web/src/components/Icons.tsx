import type { SVGProps } from "react";

type P = SVGProps<SVGSVGElement> & { size?: number };

function Svg({ size = 18, children, ...rest }: P) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      {...rest}
    >
      {children}
    </svg>
  );
}

export const SendIcon = (p: P) => <Svg {...p}><path d="M7 17L17 7M9 7h8v8" strokeWidth={2.2} /></Svg>;
export const RequestIcon = (p: P) => <Svg {...p}><path d="M17 7L7 17M15 17H7V9" strokeWidth={2.2} /></Svg>;
export const StoreIcon = (p: P) => <Svg {...p}><path d="M4 9l1.5-5h13L20 9M4 9h16M4 9v11h16V9M9 20v-6h6v6" /></Svg>;
export const HomeIcon = (p: P) => <Svg {...p}><path d="M4 11l8-7 8 7v9h-5v-6H9v6H4z" /></Svg>;
export const ActivityIcon = (p: P) => <Svg {...p}><path d="M5 19V11M12 19V5M19 19v-6" strokeWidth={2.2} /></Svg>;
export const UserIcon = (p: P) => <Svg {...p}><circle cx="12" cy="8" r="4" /><path d="M4 20c1.5-4 4.5-6 8-6s6.5 2 8 6" /></Svg>;
export const BackIcon = (p: P) => <Svg {...p}><path d="M15 6l-6 6 6 6" strokeWidth={2.2} /></Svg>;
export const CopyIcon = (p: P) => <Svg {...p}><rect x="8" y="8" width="12" height="12" rx="3" /><path d="M16 8V6a2 2 0 00-2-2H6a2 2 0 00-2 2v8a2 2 0 002 2h2" /></Svg>;
export const CheckIcon = (p: P) => <Svg {...p}><path d="M5 12.5l4.5 4.5L19 7.5" strokeWidth={2.6} /></Svg>;
export const ExternalIcon = (p: P) => <Svg {...p}><path d="M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 01-1 1H5a1 1 0 01-1-1V7a1 1 0 011-1h5" /></Svg>;
export const BagIcon = (p: P) => <Svg {...p}><path d="M5 8h14l-1 12H6zM9 8a3 3 0 016 0" /></Svg>;
export const PlusIcon = (p: P) => <Svg {...p}><path d="M12 5v14M5 12h14" strokeWidth={2.4} /></Svg>;
export const KeyIcon = (p: P) => <Svg {...p}><circle cx="8" cy="15" r="4" /><path d="M11 12l8-8M16 7l2 2" /></Svg>;
export const DropIcon = (p: P) => <Svg {...p}><path d="M12 3s6 6.5 6 11a6 6 0 01-12 0c0-4.5 6-11 6-11z" /></Svg>;
export const ShareIcon = (p: P) => <Svg {...p}><path d="M12 15V4M8 8l4-4 4 4M5 13v6a1 1 0 001 1h12a1 1 0 001-1v-6" /></Svg>;
export const LogoutIcon = (p: P) => <Svg {...p}><path d="M15 4h3a2 2 0 012 2v12a2 2 0 01-2 2h-3M10 16l-4-4 4-4M6 12h10" /></Svg>;

export function LogoMark({ size = 18 }: { size?: number }) {
  // The AevumPay mark: an eternity loop ("aevum" is Latin for an age, eternity): money that keeps
  // moving. Same path as brand/logo-mark.svg, app/icon.svg and the loading loop (<Spinner>).
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.6} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={LOOP_PATH} />
    </svg>
  );
}

/** The eternity loop, drawn once as a single closed stroke. */
export const LOOP_PATH = "M12 12c-3.2-4.2-9.4-4.2-9.4 0s6.2 4.2 9.4 0 9.4-4.2 9.4 0-6.2 4.2-9.4 0z";
