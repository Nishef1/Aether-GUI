import { Gamepad2, Gauge, LockKeyhole } from "lucide-react";
import { ExitPreferenceControl } from "@/components/ExitPreferenceControl";
import { ProtocolSelect } from "@/components/ProtocolSelect";
import { ScanModeToggle } from "@/components/ScanModeToggle";
import { MasqueTransportToggle } from "@/components/MasqueTransportToggle";
import { useExitPolicyStore } from "@/state/exitPolicyStore";
import { useConnectionStore } from "@/state/connectionStore";
import type { H2MaskMode, ScanMode, TlsProfileMode } from "@/types/connection";

const SCAN_COPY: Record<ScanMode, string> = {
  turbo: "Fast pass: find the first healthy route quickly, then let Automatic fall back only if it has to.",
  balanced: "Broader discovery with more time per route when Turbo cannot find a reliable path.",
  thorough: "Searches more candidates when normal discovery cannot find a usable route.",
  stealth: "Reduces concurrent probing for networks that react to aggressive scans.",
  ironclad: "Validates real traffic through each candidate before accepting a gateway.",
};

const selectClass =
  "min-h-11 w-full rounded-xl bg-black/20 px-3 text-xs text-foreground ring-1 ring-white/10 outline-none transition focus:ring-primary disabled:opacity-50";

export function QuickConnectionCard() {
  const status = useConnectionStore((state) => state.status);
  const profile = useConnectionStore((state) => state.profile);
  const setField = useConnectionStore((state) => state.setProfileField);
  const preference = useExitPolicyStore((state) => state.preference);
  const setPreference = useExitPolicyStore((state) => state.setPreference);
  const locked = status.state !== "Idle" && status.state !== "Error";
  const masqueFamily = profile.protocol === "auto" || profile.protocol === "masque";
  const h2Mask: H2MaskMode = profile.masque_mask ?? (profile.fragment ? "legacy" : "off");
  const tlsProfile: TlsProfileMode = profile.tls_profile ?? "automatic";
  const fastIranActive =
    profile.protocol === "auto" &&
    profile.scan_mode === "turbo" &&
    profile.ip_version === "v4" &&
    profile.quick_reconnect &&
    profile.masque_http2 &&
    h2Mask === "off" &&
    tlsProfile === "automatic" &&
    preference === "low-latency";

  const setH2Mask = (mode: H2MaskMode) => {
    setField("masque_mask", mode);
    setField("fragment", mode === "legacy");
  };

  const applyFastIranPreset = () => {
    if (locked) return;

    // Reachability first: H2/TCP avoids depending on QUIC/UDP, Turbo keeps the
    // first pass short, and quick reconnect re-tests a known-good route before
    // scanning again. Country is deliberately not part of acceptance.
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
    <section className="w-full rounded-3xl bg-surface-1/80 p-4 ring-1 ring-white/10 backdrop-blur-sm">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
            <Gauge size={17} />
          </div>
          <div className="min-w-0">
            <h2 className="text-sm font-semibold text-foreground">Connection profile</h2>
            <p className="text-[11px] leading-4 text-muted-foreground">
              Fast controls stay here; deep tuning remains under More settings.
            </p>
          </div>
        </div>
        {locked && (
          <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-white/5 px-2 py-1 text-[10px] text-muted-foreground ring-1 ring-white/10">
            <LockKeyhole size={10} /> Live
          </span>
        )}
      </div>

      <button
        type="button"
        disabled={locked}
        onClick={applyFastIranPreset}
        className={`mb-3 flex min-h-12 w-full items-center justify-between gap-3 rounded-2xl px-3 text-left ring-1 transition disabled:cursor-not-allowed disabled:opacity-50 ${
          fastIranActive
            ? "bg-primary/12 text-foreground ring-primary/35"
            : "bg-black/15 text-foreground ring-white/10 hover:bg-white/5"
        }`}
        aria-pressed={fastIranActive}
        aria-label="Apply Iran fast gaming connection preset"
      >
        <span className="flex min-w-0 items-center gap-2.5">
          <Gamepad2 size={16} className="shrink-0 text-primary" />
          <span className="min-w-0">
            <span className="block text-xs font-semibold">Fast / Gaming — Iran</span>
            <span className="mt-0.5 block text-[10px] leading-4 text-muted-foreground">
              H2 + Turbo + quick reconnect; first healthy route wins, regardless of country.
            </span>
          </span>
        </span>
        <span className="shrink-0 text-[10px] font-medium text-primary">
          {fastIranActive ? "Active" : "Apply"}
        </span>
      </button>

      <div className="grid gap-3">
        <ExitPreferenceControl disabled={locked} />

        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Protocol</span>
          <div className="rounded-xl bg-black/15 px-1 ring-1 ring-white/8">
            <ProtocolSelect />
          </div>
        </div>

        <div className="grid gap-1.5">
          <span className="text-[11px] font-medium text-muted-foreground">Route discovery</span>
          <ScanModeToggle />
          <p className="px-1 text-[10px] leading-4 text-muted-foreground">
            {SCAN_COPY[profile.scan_mode]}
          </p>
        </div>

        {masqueFamily && (
          <>
            <div className="grid gap-1.5">
              <span className="text-[11px] font-medium text-muted-foreground">MASQUE carrier</span>
              <MasqueTransportToggle />
            </div>

            <div className="grid gap-1.5">
              <div className="flex items-end justify-between gap-2 px-1">
                <span className="text-[11px] font-medium text-muted-foreground">MASK & TLS</span>
                <span className="text-[10px] text-muted-foreground">
                  Manual compatibility controls
                </span>
              </div>
              <div className="grid gap-2 sm:grid-cols-2">
                <label className="grid gap-1 text-[10px] text-muted-foreground">
                  <span>H2 ClientHello MASK</span>
                  <select
                    value={h2Mask}
                    disabled={locked || !profile.masque_http2}
                    onChange={(event) => setH2Mask(event.target.value as H2MaskMode)}
                    className={selectClass}
                    aria-label="H2 ClientHello MASK"
                  >
                    <option value="off">Off — baseline first</option>
                    <option value="clienthello">ClientHello split</option>
                    <option value="patterniha">Patterniha MASK (experimental)</option>
                    <option value="legacy">Legacy random fragment</option>
                  </select>
                </label>

                <label className="grid gap-1 text-[10px] text-muted-foreground">
                  <span>TLS profile</span>
                  <select
                    value={tlsProfile}
                    disabled={locked}
                    onChange={(event) =>
                      setField("tls_profile", event.target.value as TlsProfileMode)
                    }
                    className={selectClass}
                    aria-label="TLS profile"
                  >
                    <option value="automatic">Automatic</option>
                    <option value="current">Current BoringSSL</option>
                    <option value="compatibility">Compatibility</option>
                    <option value="native-minimal">Native-Minimal</option>
                    <option value="experimental">Experimental</option>
                  </select>
                </label>
              </div>
              <p className="px-1 text-[10px] leading-4 text-muted-foreground">
                Start with H2 + MASK Off + TLS Automatic. If H2 reaches TLS but is blocked, try
                ClientHello or Patterniha manually; Automatic only reuses Patterniha after it has
                proven reliable on that network.
              </p>
            </div>
          </>
        )}
      </div>
    </section>
  );
}
