export const isAndroid =
  import.meta.env.VITE_AETHER_PLATFORM === "android" ||
  (typeof navigator !== "undefined" && /Android/i.test(navigator.userAgent));
