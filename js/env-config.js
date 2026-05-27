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
      // Firebase Web SDK config for the dev project (pinpoint-44cf4).
      // Used to resolve /l/<code> shortcodes against the dev Firestore
      // before opening the MQTT subscription. Web API key is OK to ship
      // client-side — Firestore security rules + the live_share_codes
      // expiry-gated read rule are the actual access controls.
      firebase: {
        apiKey: "AIzaSyCoWsMFF5HIJ0vO8S0NzE1ZjP4kefkVo5E",
        authDomain: "pinpoint-44cf4.firebaseapp.com",
        projectId: "pinpoint-44cf4",
      },
    },
    prod: {
      // TODO: confirm prod EMQX WSS port and that its TLS cert is browser-trusted.
      // The self-hosted EMQX at mqtt.pinpointapp.me currently uses a self-signed
      // cert that browsers will reject. Likely needs Let's Encrypt or a TLS-
      // terminating proxy (Cloudflare/Caddy/nginx) in front before this works.
      brokerUrl: "wss://mqtt.pinpointapp.me:8084/mqtt",
      username: "pinpoint-viewer",
      password: "pv_prod_dhdC1hpaNKZ0aNLsVPTylPYQ",
      // TODO(v2.1): fill in the prod Firebase Web config from
      // pinpoint-ios-prod once shortcodes are wired on that project.
      firebase: {
        apiKey: "",
        authDomain: "pinpoint-ios-prod.firebaseapp.com",
        projectId: "pinpoint-ios-prod",
      },
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
