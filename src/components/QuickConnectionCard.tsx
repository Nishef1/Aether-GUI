import { Gamepad2, Gauge } from "lucide-react";
import { DnsProtectionControl } from "@/components/DnsProtectionControl";
import { ExitPreferenceControl } from "@/components/ExitPreferenceControl";
import { ProtocolSelect } from "@/components/ProtocolSelect";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import { useConnectionStore } from "@/state/connectionStore";
import type { Protocol, ScanMode } from "@/types/connection";

const PROTOCOL_COPY: Record<Protocol, string> = {
  auto: "Starts with H2 and only tries fallback carriers when needed.",
  masque: "MASQUE only; choose H2/TCP or H3/QUIC below.",
  wireguard: "WireGuard only; best when its UDP path is reliable.",
  gool: "WARP-in-WARP; the heavier nested fallback.",
};

const SCAN_COPY: Record<ScanMode, string> = {
  turbo: "First healthy route with the smallest scan budget.",
  balanced: "More tolerance when Turbo misses a reliable route.",
  thorough: "Broader search with longer windows for difficult networks.",
  stealth: "Quieter discovery with fewer concurrent probes.",
  ironclad: "Verifies real traffic before accepting a candidate.",
};

export function QuickConnectionCard() {
  const status = useConnectionStore((state) => state.status);
  const profile = useConnectionStore((state) => state.profile);
  const setField = useConnectionStore((state) => state.setProfileField);
  const preference = useExitPolicyStore((state) => state.preference);
  const setPreference = useExitPolicyStore((state) => state.setPreference);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const masqueFamily = profile.protocol === "auto" || profile.protocol === "masque";
  const h2Mask = profile.masque_mask ?? (profile.fragment ? "legacy" : "off");
  const tlsProfile = profile.tls_profile ?? "automatic";
  const fastIranActive =
    profile.protocol === "auto" &&
    profile.scan_mode === "turbo" &&
    profile.ip_version === "v4" &&
    profile.quick_reconnect &&
    profile.masque_http2 &&
    profile.masque_noize === "firewall" &&
    h2Mask === "off" &&
    !profile.fragment &&
    tlsProfile === "automatic" &&
    profile.tls_groups.trim() === "" &&
    profile.ech.trim() === "" &&
    profile.peer.trim() === "" &&
    profile.h2_peer.trim() === "" &&
    !profile.no_data_check &&
    preference === "low-latency";

  const applyFastIranPreset = () => {
    if (locked) return;

    setField("protocol", "auto");
    setField("scan_mode", "turbo");
    setField("ip_version", "v4");
    setField("quick_reconnect", true);
    setField("masque_http2", true);
    setField("masque_noize", "firewall");
    setField("masque_mask", "off");
    setField("fragment", false);
    setField("tls_profile", "automatic");
    setField("tls_groups", "");
    setField("ech", "");
    setField("peer", "");
    setField("h2_peer", "");
    setField("no_data_check", false);
    setPreference("low-latency");
  };

  return (
    <section
      className="w-full min-w-0 rounded-3xl bg-surface-1/80 p-4 ring-1 ring-white/10 backdrop-blur-sm"
      aria-labelledby="connection-profile-title"
    >
      <div className="mb-3 flex min-w-0 items-center gap-2.5">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
          <Gauge size={17} aria-hidden="true" />
        </div>
        <h2 id="connection-profile-title" className="text-sm font-semibold text-foreground">
          Connection profile
        </h2>
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={applyFastIranPreset}
        className={`mb-3 flex min-h-12 w-full min-w-0 items-center justify-between gap-3 rounded-2xl px-3 text-left ring-1 outline-none transition focus-visible:ring-2 focus-visible:ring-primary disabled:cursor-not-allowed disabled:opacity-50 ${
          fastIranActive
            ? "bg-primary/12 text-foreground ring-primary/35"
            : "bg-black/15 text-foreground ring-white/10 hover:bg-white/5"
        }`}
        aria-pressed={fastIranActive}
        aria-label="Apply fast gaming connection preset"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Gamepad2 size={16} className="shrink-0 text-primary" aria-hidden="true" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">Fast / Gaming</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              H2 · Turbo · quick reconnect
            </span>
          </span>
        </span>
        <span className="shrink-0 text-[10px] font-medium text-primary">
          {fastIranActive ? "Active" : "Apply"}
        </span>
      </button>

      <div className="grid min-w-0 gap-3">
        <ExitPreferenceControl disabled={locked} />

        <div className="grid min-w-0 gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Protocol</span>
          <div className="min-w-0 rounded-xl bg-black/15 px-1 ring-1 ring-white/8">
            <ProtocolSelect />
          </div>
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">
            {PROTOCOL_COPY[profile.protocol]}
          </p>
        </div>

        <div className="grid min-w-0 gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Route discovery</span>
          <ScanModeToggle />
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">
            {SCAN_COPY[profile.scan_mode]}
          </p>
        </div>

        <DnsProtectionControl disabled={locked} />

        {masqueFamily && (
          <div className="grid min-w-0 gap-1.5">
            <span className="text-[11px] font-medium text-muted-foreground">MASQUE carrier</span>
            <MasqueTransportToggle />
          </div>
        )}
      </div>
    </section>
  );
}
