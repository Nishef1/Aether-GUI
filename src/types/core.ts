export type CoreKind = "aether" | "singbox";

export interface CoreRelease {
  version: string;
  prerelease: boolean;
  installed: boolean;
  active: boolean;
}

export interface CoreStatus {
  kind: CoreKind;
  active_version: string | null;
  bundled_version: string | null;
  installed_versions: string[];
}
