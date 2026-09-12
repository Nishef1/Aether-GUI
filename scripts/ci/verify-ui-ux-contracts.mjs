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
requireContract(
  exitPreference.includes("grid-cols-1") && exitPreference.includes("min-[360px]:grid-cols-2"),
  "connection-goal cards can squeeze instead of stacking on narrow phones",
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
requireContract(
  quick.includes("<NativeSelect") && quick.includes('aria-label="H2 ClientHello MASK"'),
  "MASK/TLS controls regressed to unnormalized mobile selects",
);

const protocol = read("src/components/ProtocolSelect.tsx");
requireContract(
  protocol.includes("bg-transparent text-foreground") && protocol.includes('aria-label="Connection protocol"'),
  "selected protocol lost its primary-value affordance or accessible name",
);
requireContract(
  protocol.includes('position="popper"') && protocol.includes('align="start"'),
  "protocol menu can regress to item-aligned mobile positioning",
);

const nativeSelect = read("src/components/ui/native-select.tsx");
for (const marker of ["appearance-none", "min-w-0", "max-w-full", "ChevronDown"]) {
  requireContract(nativeSelect.includes(marker), `normalized native select lost mobile invariant: ${marker}`);
}

const radixSelect = read("src/components/ui/select.tsx");
for (const marker of [
  'position = "popper"',
  'align = "start"',
  "--radix-select-trigger-width",
  "collisionPadding={16}",
  "max-w-[calc(100vw-2rem)]",
]) {
  requireContract(radixSelect.includes(marker), `Radix select lost mobile popover constraint: ${marker}`);
}

const scanMode = read("src/components/ScanModeToggle.tsx");
requireContract(
  scanMode.includes("grid-cols-5") && !scanMode.includes("min-w-[30%]"),
  "five scan modes can wrap into uneven mobile rows",
);

const noize = read("src/components/NoizeProfileToggle.tsx");
for (const marker of ["MASQUE baseline", "WireGuard / WiW fallback", 'protocol === "auto"']) {
  requireContract(noize.includes(marker), `Automatic obfuscation UI lost fallback control: ${marker}`);
}
requireContract(
  noize.includes("grid-cols-3") && noize.includes("sm:grid-cols-6"),
  "obfuscation options can regress to unpredictable flex wrapping",
);

const ipVersion = read("src/components/IpVersionToggle.tsx");
requireContract(ipVersion.includes("grid-cols-3"), "IP version selector lost equal-width phone columns");

const masqueTransport = read("src/components/MasqueTransportToggle.tsx");
requireContract(
  masqueTransport.includes("grid-cols-2"),
  "MASQUE carrier selector lost equal-width phone columns",
);

const dns = read("src/components/DnsProtectionControl.tsx");
requireContract(dns.includes("<NativeSelect"), "DNS mode regressed to an unnormalized native select");

const coreAdvanced = read("src/components/CoreAdvancedSettings.tsx");
requireContract(
  coreAdvanced.includes('profile.protocol === "auto" || profile.protocol === "wireguard"'),
  "Automatic mode can no longer tune its WireGuard fallback reliability",
);
requireContract(
  coreAdvanced.includes("Unsafe diagnostic override") && coreAdvanced.includes("false-positive healthy connection"),
  "unsafe data-check override lost its explicit warning",
);
requireContract(
  coreAdvanced.includes("grid-cols-1") && coreAdvanced.includes("sm:grid-cols-2"),
  "expert numeric/text pairs can squeeze into two columns on narrow phones",
);
requireContract(
  coreAdvanced.includes("<NativeSelect") && coreAdvanced.includes("Performance profile"),
  "performance profile regressed to an unnormalized native select",
);

const tunnel = read("src/components/SystemTunnelToggle.tsx");
for (const marker of [
  'const ready = loaded && selection === "native" && !error',
  "Android device tunnel unavailable",
  "Preparing Android device tunnel",
  "Device-wide",
]) {
  requireContract(tunnel.includes(marker), `Android tunnel status UI drifted: ${marker}`);
}

const connectButton = read("src/components/ConnectButton.tsx");
for (const marker of [
  'const disconnecting = status.state === "Disconnecting"',
  'disconnecting ? "Disconnecting" : ARIA_LABEL[phase]',
  'aria-busy={phase === "connecting"}',
]) {
  requireContract(connectButton.includes(marker), `connect control state semantics drifted: ${marker}`);
}

const bindAddress = read("src/components/BindAddressField.tsx");
requireContract(
  bindAddress.includes("const toggleLan = (enabled: boolean) =>") &&
    bindAddress.includes("const nextPort = validPort(displayedPort, port)"),
  "LAN toggle can overwrite a valid unblurred SOCKS port draft",
);
requireContract(
  bindAddress.includes("const displayedPort = portDraft ?? port") &&
    !bindAddress.includes("useEffect("),
  "SOCKS port draft regressed to derived state synchronized through an effect",
);

const statusLine = read("src/components/ConnectionStatusLine.tsx");
for (const marker of ['role="progressbar"', 'aria-valuetext', 'className="sr-only"']) {
  requireContract(statusLine.includes(marker), `connection status lost accessible progress/status: ${marker}`);
}

const diagnostics = read("src/components/ConnectionDiagnostics.tsx");
for (const marker of ["Warp-in-Warp", 'label: "Healthy"', 'label: "Degraded"', 'label: "Failed"']) {
  requireContract(diagnostics.includes(marker), `live diagnostics presentation drifted: ${marker}`);
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
for (const marker of ['@media (pointer: coarse)', '[data-slot="select-content"]', '[data-slot="select-item"]']) {
  requireContract(css.includes(marker), `Radix portal controls lost coarse-pointer sizing: ${marker}`);
}
requireContract(css.includes('@import "tw-animate-css";'), "animation CSS import disappeared");

const packageJson = read("package.json");
requireContract(
  packageJson.includes('"tw-animate-css": "^1.4.0"'),
  "CSS imports tw-animate-css but package.json no longer declares it",
);

const html = read("index.html");
for (const marker of ["viewport-fit=cover", "interactive-widget=resizes-content"]) {
  requireContract(html.includes(marker), `mobile viewport contract drifted: ${marker}`);
}

const app = read("src/App.tsx");
requireContract(app.includes("safeCleanup"), "async listener initialization can reject without cleanup");
requireContract(
  app.includes("delayDuration={350}") && app.includes("skipDelayDuration={100}"),
  "desktop tooltips regressed to immediate hover noise",
);

console.log("[ui-ux-contracts] accessibility, interaction and imported UI dependencies are aligned");
