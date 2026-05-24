// Per-environment broker config for the Pinpoint Live web viewer.
// Loaded as a regular script before live-viewer.js.
//
// Security note: viewer credentials below are visible to anyone who opens
// DevTools. This is intentional for v1 — the credential is sub-only via
// EMQX ACL (cannot publish, cannot harvest broker-wide on token brute-force
// alone because tokens are 16+ random bytes). Future hardening: replace with
// per-share JWT issued by a Cloud Function. See plan file.

(function (global) {
  const ENVS = {
    dev: {
      brokerUrl: "wss://w0b19066.ala.us-east-1.emqxsl.com:8084/mqtt",
      username: "pinpoint-viewer",
      password: "pv_dev_9005324c04fcedebf060077563f7cc65689e",
    },
    prod: {
      // TODO: confirm prod EMQX WSS port and that its TLS cert is browser-trusted.
      // The self-hosted EMQX at mqtt.pinpointapp.me currently uses a self-signed
      // cert that browsers will reject. Likely needs Let's Encrypt or a TLS-
      // terminating proxy (Cloudflare/Caddy/nginx) in front before this works.
      brokerUrl: "wss://mqtt.pinpointapp.me:8084/mqtt",
      username: "pinpoint-viewer",
      password: "pv_prod_dhdC1hpaNKZ0aNLsVPTylPYQ",
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
