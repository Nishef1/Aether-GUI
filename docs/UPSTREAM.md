# Upstream synchronization

This repository is a fork of `MatinSenPai/Aether-GUI` and should continue to benefit from upstream improvements without treating upstream as an automatic runtime dependency.

## Git remotes

Configure once:

```sh
git remote -v
git remote add upstream https://github.com/MatinSenPai/Aether-GUI.git
git fetch upstream
```

If `upstream` already exists, do not add it again.

## Review before integration

Always inspect upstream changes before applying them:

```sh
git fetch upstream
git log --oneline --decorate HEAD..upstream/main
git diff --stat HEAD...upstream/main
git diff HEAD...upstream/main
```

Classify changes into:

- UI/product improvements that can be integrated directly;
- Aether-core assumptions that must be adapted to the shared Core Registry;
- TUN/network changes that require leak and routing review;
- legacy or unsafe behavior that should not be reintroduced.

Examples of behavior that must not be blindly restored include LAN-wide unauthenticated SOCKS exposure, hard-pinning the GUI to one Aether version, or parallel per-core updater implementations.

## Integration strategy

Prefer the smallest correct Git operation for the change:

- cherry-pick a self-contained upstream commit when it is independent;
- merge upstream when a coherent series of upstream changes should be preserved together;
- manually reimplement only when architectural divergence makes the upstream patch structurally incompatible.

Do not create application code that automatically merges another Git repository at runtime.

After resolving conflicts, remove obsolete local/upstream implementations instead of keeping both code paths for backward compatibility.

## Validation after upstream integration

At minimum run:

```sh
pnpm typecheck
pnpm lint
pnpm check:rust
pnpm test:rust
pnpm clippy:rust
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
```

For changes involving connection or TUN behavior also validate:

- proxy-only connect/disconnect/reconnect;
- TUN elevation flow;
- IPv4 and IPv6 egress verification;
- DNS behavior;
- disconnect during TUN startup;
- repeated connect/disconnect cycles for process/thread/resource growth;
- orphan cleanup after forced termination;
- version upgrade and downgrade for both managed cores.

## Upstream Aether core

`CluvexStudio/Aether` is a different upstream concern from `MatinSenPai/Aether-GUI`.

- Aether core releases are managed at runtime by the Core Registry.
- MatinSenPai GUI changes are integrated through Git review.

Do not couple the GUI Git revision to a fixed Aether-core release.
