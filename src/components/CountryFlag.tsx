import type { ReactNode } from "react";

type CountryFlagProps = {
  code: string;
  className?: string;
};

function Frame({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <svg
      viewBox="0 0 24 18"
      aria-hidden="true"
      className={`overflow-hidden rounded-[3px] shadow-[0_0_0_1px_rgba(255,255,255,0.16)] ${className}`}
    >
      {children}
    </svg>
  );
}

function VerticalTricolor({ colors, className }: { colors: [string, string, string]; className: string }) {
  return (
    <Frame className={className}>
      <rect width="8" height="18" fill={colors[0]} />
      <rect x="8" width="8" height="18" fill={colors[1]} />
      <rect x="16" width="8" height="18" fill={colors[2]} />
    </Frame>
  );
}

function HorizontalTricolor({ colors, className }: { colors: [string, string, string]; className: string }) {
  return (
    <Frame className={className}>
      <rect width="24" height="6" fill={colors[0]} />
      <rect y="6" width="24" height="6" fill={colors[1]} />
      <rect y="12" width="24" height="6" fill={colors[2]} />
    </Frame>
  );
}

export function CountryFlag({ code, className = "size-[18px]" }: CountryFlagProps) {
  const normalized = code.trim().toUpperCase();
  const fallback = (
    <span
      aria-hidden="true"
      className={`inline-grid place-items-center rounded-[3px] bg-white/8 font-mono text-[8px] font-semibold text-foreground ring-1 ring-white/15 ${className}`}
    >
      {normalized.slice(0, 2) || "??"}
    </span>
  );

  switch (normalized) {
    case "IR":
      return <HorizontalTricolor className={className} colors={["#239f40", "#fff", "#da0000"]} />;
    case "DE":
      return <HorizontalTricolor className={className} colors={["#111", "#dd0000", "#ffce00"]} />;
    case "NL":
      return <HorizontalTricolor className={className} colors={["#ae1c28", "#fff", "#21468b"]} />;
    case "FR":
      return <VerticalTricolor className={className} colors={["#0055a4", "#fff", "#ef4135"]} />;
    case "AT":
      return <HorizontalTricolor className={className} colors={["#ed2939", "#fff", "#ed2939"]} />;
    case "IE":
      return <VerticalTricolor className={className} colors={["#169b62", "#fff", "#ff883e"]} />;
    case "BE":
      return <VerticalTricolor className={className} colors={["#111", "#fdda24", "#ef3340"]} />;
    case "LU":
      return <HorizontalTricolor className={className} colors={["#ed2939", "#fff", "#00a1de"]} />;
    case "RU":
      return <HorizontalTricolor className={className} colors={["#fff", "#0039a6", "#d52b1e"]} />;
    case "FI":
      return <Frame className={className}><rect width="24" height="18" fill="#fff"/><rect x="7" width="4" height="18" fill="#003580"/><rect y="7" width="24" height="4" fill="#003580"/></Frame>;
    case "SE":
      return <Frame className={className}><rect width="24" height="18" fill="#006aa7"/><rect x="7" width="4" height="18" fill="#fecc00"/><rect y="7" width="24" height="4" fill="#fecc00"/></Frame>;
    case "DK":
      return <Frame className={className}><rect width="24" height="18" fill="#c60c30"/><rect x="7" width="3" height="18" fill="#fff"/><rect y="7" width="24" height="3" fill="#fff"/></Frame>;
    case "NO":
      return <Frame className={className}><rect width="24" height="18" fill="#ba0c2f"/><rect x="7" width="5" height="18" fill="#fff"/><rect y="6" width="24" height="5" fill="#fff"/><rect x="8" width="3" height="18" fill="#00205b"/><rect y="7" width="24" height="3" fill="#00205b"/></Frame>;
    case "IS":
      return <Frame className={className}><rect width="24" height="18" fill="#02529c"/><rect x="7" width="5" height="18" fill="#fff"/><rect y="6" width="24" height="5" fill="#fff"/><rect x="8" width="3" height="18" fill="#dc1e35"/><rect y="7" width="24" height="3" fill="#dc1e35"/></Frame>;
    case "CH":
      return <Frame className={className}><rect width="24" height="18" fill="#d52b1e"/><rect x="10" y="4" width="4" height="10" fill="#fff"/><rect x="7" y="7" width="10" height="4" fill="#fff"/></Frame>;
    case "JP":
      return <Frame className={className}><rect width="24" height="18" fill="#fff"/><circle cx="12" cy="9" r="4.3" fill="#bc002d"/></Frame>;
    case "SG":
      return <Frame className={className}><rect width="24" height="9" fill="#ef3340"/><rect y="9" width="24" height="9" fill="#fff"/><circle cx="6" cy="4.5" r="3" fill="#fff"/><circle cx="7.2" cy="4.5" r="2.5" fill="#ef3340"/></Frame>;
    case "CA":
      return <Frame className={className}><rect width="6" height="18" fill="#d80621"/><rect x="6" width="12" height="18" fill="#fff"/><rect x="18" width="6" height="18" fill="#d80621"/><path d="M12 4l1 2 2-1-1 2 2 1-2 1 .5 2-2-1-.5 3-1-3-2 1 .5-2-2-1 2-1-1-2 2 1z" fill="#d80621"/></Frame>;
    case "US":
      return <Frame className={className}><rect width="24" height="18" fill="#fff"/>{[0,4,8,12,16].map((y)=><rect key={y} y={y} width="24" height="2" fill="#b22234"/>)}<rect width="10" height="9" fill="#3c3b6e"/><circle cx="2" cy="2" r=".6" fill="#fff"/><circle cx="5" cy="2" r=".6" fill="#fff"/><circle cx="8" cy="2" r=".6" fill="#fff"/><circle cx="3.5" cy="5" r=".6" fill="#fff"/><circle cx="6.5" cy="5" r=".6" fill="#fff"/></Frame>;
    case "GB":
      return <Frame className={className}><rect width="24" height="18" fill="#012169"/><path d="M0 0l24 18M24 0L0 18" stroke="#fff" strokeWidth="4"/><path d="M0 0l24 18M24 0L0 18" stroke="#c8102e" strokeWidth="2"/><rect x="9" width="6" height="18" fill="#fff"/><rect y="6" width="24" height="6" fill="#fff"/><rect x="10.5" width="3" height="18" fill="#c8102e"/><rect y="7.5" width="24" height="3" fill="#c8102e"/></Frame>;
    case "ES":
      return <Frame className={className}><rect width="24" height="18" fill="#aa151b"/><rect y="4.5" width="24" height="9" fill="#f1bf00"/><rect y="13.5" width="24" height="4.5" fill="#aa151b"/></Frame>;
    case "PT":
      return <Frame className={className}><rect width="9.5" height="18" fill="#046a38"/><rect x="9.5" width="14.5" height="18" fill="#da291c"/><circle cx="9.5" cy="9" r="2.2" fill="#ffcd00"/></Frame>;
    case "AU":
    case "NZ":
      return <Frame className={className}><rect width="24" height="18" fill="#012169"/><path d="M0 0l10 7M10 0L0 7" stroke="#fff" strokeWidth="2"/><rect x="4" width="2" height="7" fill="#fff"/><rect y="2.5" width="10" height="2" fill="#fff"/><circle cx="17" cy="5" r="1" fill="#fff"/><circle cx="20" cy="10" r="1" fill="#fff"/><circle cx="15" cy="13" r="1" fill="#fff"/></Frame>;
    case "CN":
      return <Frame className={className}><rect width="24" height="18" fill="#de2910"/><path d="M5 3l.6 1.5 1.6.1-1.2 1 .4 1.6L5 6.3 3.6 7.2 4 5.6 2.8 4.6l1.6-.1z" fill="#ffde00"/></Frame>;
    default:
      return fallback;
  }
}
