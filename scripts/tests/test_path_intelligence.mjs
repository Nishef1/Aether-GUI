import test from "node:test";
import assert from "node:assert/strict";

import {
  createObservedPath,
  pathIdForProfile,
  rankPaths,
  recordPathFailure,
  recordPathSuccess,
  scorePath,
} from "../../src/lib/pathIntelligence.ts";

const BASE_PROFILE = {
  protocol: "masque",
  masque_http2: false,
  peer: "",
  h2_peer: "",
  wg_peer: "",
  wiw_outer: "",
  wiw_inner: "",
  masque_mask: "off",
  fragment: false,
  fragment_size: "16-32",
  fragment_delay: "2-10",
  ech: "",
  tls_profile: "automatic",
  tls_groups: "",
  wg_noize: "balanced",
  masque_noize: "firewall",
  ip_version: "v4",
  scan_mode: "balanced",
};

function profile(overrides = {}) {
  return { ...BASE_PROFILE, ...overrides };
}

test("transport-specific stale fields do not change unrelated path identities", () => {
  const masque = pathIdForProfile(profile({ peer: "masque.example:443" }));
  const masqueWithStaleGool = pathIdForProfile(
    profile({
      peer: "masque.example:443",
      wg_peer: "wg.example:51820",
      wiw_outer: "outer.example:443",
      wiw_inner: "inner.example:443",
    }),
  );
  assert.equal(masqueWithStaleGool, masque);

  const wireguard = pathIdForProfile(
    profile({ protocol: "wireguard", peer: "wg.example:51820" }),
  );
  const wireguardWithStaleMasque = pathIdForProfile(
    profile({
      protocol: "wireguard",
      peer: "wg.example:51820",
      masque_http2: true,
      h2_peer: "h2.example:443",
      ech: "ech.example",
      tls_groups: "X25519:P-256",
      fragment: true,
    }),
  );
  assert.equal(wireguardWithStaleMasque, wireguard);
});

test("success resets failure state and cooldown", () => {
  const initial = createObservedPath(profile(), 1_000);
  const failedOnce = recordPathFailure(initial, { now: 2_000 });
  const failedTwice = recordPathFailure(failedOnce, { now: 3_000 });
  const failedThrice = recordPathFailure(failedTwice, { now: 4_000 });

  assert.equal(failedThrice.failures, 3);
  assert.equal(failedThrice.consecutiveFailures, 3);
  assert.equal(failedThrice.health, "failed");
  assert.ok((failedThrice.cooldownUntil ?? 0) > 4_000);

  const recovered = recordPathSuccess(failedThrice, {
    latencyMs: 80,
    jitterMs: 6,
    qualityScore: 90,
    qualityConfidence: 75,
    countryCode: "us",
    now: 5_000,
  });

  assert.equal(recovered.successes, 1);
  assert.equal(recovered.consecutiveFailures, 0);
  assert.equal(recovered.health, "healthy");
  assert.equal(recovered.cooldownUntil, null);
  assert.equal(recovered.countryCode, "US");
});

test("cooldown paths do not outrank healthy usable paths", () => {
  const healthy = recordPathSuccess(createObservedPath(profile({ peer: "good:443" }), 1_000), {
    latencyMs: 60,
    countryCode: "US",
    now: 2_000,
  });
  let cooling = createObservedPath(profile({ peer: "bad:443" }), 1_000);
  cooling = recordPathFailure(cooling, { now: 2_000 });
  cooling = recordPathFailure(cooling, { now: 3_000 });

  assert.equal(scorePath(cooling, 4_000), 0);
  assert.equal(rankPaths([cooling, healthy], 4_000)[0]?.id, healthy.id);
});
