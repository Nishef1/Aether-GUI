import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const read = (relative) => fs.readFileSync(path.join(root, relative), "utf8");

function requireContract(condition, message) {
  if (!condition) throw new Error(`[ui-ux-contracts] ${message}`);
}

const accessPrompt = read("src/components/AccessCodePrompt.tsx");
for (const marker of [
  "DialogPrimitive.Content",
  "onOpenAutoFocus",
  "onInteractOutside",
  'role="alert"',
  "Cancel",
]) {
  requireContract(accessPrompt.includes(marker), `Access-code dialog lost accessibility behavior: ${marker}`);
}

const exitPreference = read("src/components/ExitPreferenceControl.tsx");
for (const marker of ['type="radio"', 'name="connection-goal"', "<fieldset", "<legend"]) {
  requireContract(
    exitPreference.includes(marker),
    `connection-goal selector lost native radio semantics: ${marker}`,
  );
}
requireContract(
  !exitPreference.includes('role="radio"'),
  "connection-goal selector regressed to hand-rolled radio semantics",
);

const quick = read("src/components/QuickConnectionCard.tsx");
for (const marker of [
  'profile.masque_noize === "firewall"',
  'profile.tls_groups.trim() === ""',
  'profile.ech.trim() === ""',
  'profile.peer.trim() === ""',
  'profile.h2_peer.trim() === ""',
  "!profile.no_data_check",
]) {
  requireContract(quick.includes(marker), `Fast / Gaming Active state ignores preset-owned field: ${marker}`);
}
requireContract(
  quick.includes("H2/TCP, then falls back to WireGuard, H3/QUIC and finally WARP-in-WARP"),
  "Automatic fallback order is no longer explained in primary UI",
);

const noize = read("src/components/NoizeProfileToggle.tsx");
for (const marker of ["MASQUE baseline", "WireGuard / WiW fallback", 'protocol === "auto"']) {
  requireContract(noize.includes(marker), `Automatic obfuscation UI lost fallback control: ${marker}`);
}

const coreAdvanced = read("src/components/CoreAdvancedSettings.tsx");
requireContract(
  coreAdvanced.includes('profile.protocol === "auto" || profile.protocol === "wireguard"'),
  "Automatic mode can no longer tune its WireGuard fallback reliability",
);
requireContract(
  coreAdvanced.includes("Unsafe diagnostic override") && coreAdvanced.includes("false-positive healthy connection"),
  "unsafe data-check override lost its explicit warning",
);

const tunnel = read("src/components/SystemTunnelToggle.tsx");
for (const marker of [
  "const ready = loaded && !error",
  "Android device tunnel unavailable",
  "Preparing Android device tunnel",
  "Device-wide",
]) {
  requireContract(tunnel.includes(marker), `Android tunnel status UI drifted: ${marker}`);
}

const statusLine = read("src/components/ConnectionStatusLine.tsx");
for (const marker of ['role="progressbar"', 'aria-valuetext', 'className="sr-only"']) {
  requireContract(statusLine.includes(marker), `connection status lost accessible progress/status: ${marker}`);
}

const routing = read("src/components/RoutingSettings.tsx");
requireContract(!routing.includes("setDns("), "Routing settings became a second owner for DNS state");
requireContract(
  routing.includes('aria-describedby={hasDirectExposure ? "direct-routing-warning" : undefined}'),
  "routing fields can reference a warning element that does not exist",
);

const advanced = read("src/components/AdvancedPanel.tsx");
requireContract(advanced.includes('role="log"'), "diagnostic log viewer lost log semantics");
requireContract(advanced.includes('aria-live="off"'), "live logs can spam screen-reader announcements");

const css = read("src/index.css");
requireContract(css.includes("textarea,"), "Android textareas lost the touch-target floor");
requireContract(
  css.includes('input:not([type="radio"]):not([type="checkbox"])'),
  "Android touch-target CSS can expand visually-hidden native radios/checkboxes",
);
requireContract(
  css.includes(".platform-android textarea") && css.includes("font-size: 16px"),
  "Android multiline form text lost its readable mobile size",
);

const app = read("src/App.tsx");
requireContract(app.includes("safeCleanup"), "async listener initialization can reject without cleanup");
requireContract(
  app.includes("delayDuration={350}") && app.includes("skipDelayDuration={100}"),
  "desktop tooltips regressed to immediate hover noise",
);

console.log("[ui-ux-contracts] accessibility and interaction invariants are aligned");
