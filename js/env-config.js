// Per-environment config for the Pinpoint Live web viewer.
// Loaded as a regular script before live-viewer.js.
//
// No secrets here anymore. Shortcodes are resolved server-side by the
// resolveLiveShareCode Cloud Function, which also mints a short-lived,
// per-share MQTT JWT scoped subscribe-only to that one share's topic. The
// viewer fetches that JWT and uses it as its broker password — nothing
// reusable is exposed to the browser.

(function (global) {
  const ENVS = {
    dev: {
      brokerUrl: "wss://w0b19066.ala.us-east-1.emqxsl.com:8084/mqtt",
      resolveUrl: "https://us-central1-pinpoint-44cf4.cloudfunctions.net/resolveLiveShareCode",
    },
    prod: {
      // TLS: Let's Encrypt cert on mqtt.pinpointapp.me (valid through
      // 2026-08-25, auto-renewing). Browser-trusted WSS on 8084.
      brokerUrl: "wss://mqtt.pinpointapp.me:8084/mqtt",
      resolveUrl: "https://us-central1-pinpoint-ios-prod.cloudfunctions.net/resolveLiveShareCode",
    },
  };

  function pickEnv(searchParams) {
    const flag = (searchParams.get("env") || "").toLowerCase();
    return flag === "dev" ? "dev" : "prod";
  }

  global.PinpointEnv = {
    pick(searchParams) {
      const env = pickEnv(searchParams);
      return Object.assign({env}, ENVS[env]);
    },
  };
})(window);
