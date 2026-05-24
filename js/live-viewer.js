// Pinpoint Live web viewer — connects to EMQX over WSS, subscribes to a
// single (uid, token) live share, renders the sharer's position on a
// Leaflet map. Pure browser code; no backend.
//
// URL: /live.html?u={uid}&t={token}[&env=dev]

(function () {
  "use strict";

  // ===== Constants
  const TOPIC_PREFIX = "pinpoint/live";
  const STALE_MS = 60_000;
  const RECONNECT_PERIOD_MS = 3_000;

  // ===== UI helpers
  const $ = (id) => document.getElementById(id);

  function showStatus(message, variant) {
    const el = $("status-banner");
    if (!el) return;
    el.className = "visible " + (variant || "");
    el.querySelector(".status-text").textContent = message;
  }
  function hideStatus() {
    const el = $("status-banner");
    if (el) el.className = "";
  }
  function showCard() {
    $("info-card").classList.add("visible");
  }
  function renderMeta(meta) {
    $("sharer-name").textContent = meta.sharerName || "Live Share";
    if (meta.sharerPhotoURL) {
      $("avatar-img").src = meta.sharerPhotoURL;
      $("avatar-img").style.display = "block";
      $("avatar-initial").style.display = "none";
    } else {
      $("avatar-img").style.display = "none";
      $("avatar-initial").textContent = (meta.sharerInitial || "?").toUpperCase();
      $("avatar-initial").style.display = "flex";
    }
    showCard();
  }
  let countdownTimer = null;
  function renderCountdown(expiresAtMs) {
    const el = $("countdown");
    function tick() {
      const remainMs = expiresAtMs - Date.now();
      if (remainMs <= 0) {
        el.textContent = "Expired";
        return;
      }
      const totalMin = Math.floor(remainMs / 60000);
      const h = Math.floor(totalMin / 60);
      const m = totalMin % 60;
      el.textContent = h > 0 ? `${h}h ${m}m left` : `${m}m left`;
    }
    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 30_000);
  }

  // ===== URL parsing
  const params = new URLSearchParams(window.location.search);
  const uid = (params.get("u") || "").trim();
  const token = (params.get("t") || "").trim();

  if (!uid || !token || uid.length > 128 || token.length > 128) {
    showStatus("Invalid share link", "error");
    return;
  }

  // ===== Open-in-app button
  $("open-in-app").href = `pinpointapp://live?u=${encodeURIComponent(uid)}&t=${encodeURIComponent(token)}`;

  // ===== Env + broker config
  const cfg = window.PinpointEnv.pick(params);
  console.log(`[live-viewer] env=${cfg.env} broker=${cfg.brokerUrl}`);

  // ===== Map (Leaflet)
  const map = L.map("map", {
    zoomControl: true,
    attributionControl: false,
  }).setView([39.5, -98.5], 4); // continental US default

  L.tileLayer("https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png", {
    subdomains: "abcd",
    maxZoom: 20,
  }).addTo(map);

  const pinIcon = L.divIcon({
    className: "live-pin",
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: '<div class="pin-core"></div>',
  });

  let marker = null;
  let lastLocationAt = 0;
  let staleTimer = null;
  let ended = false;

  function placeOrMoveMarker(lat, lng) {
    if (!marker) {
      marker = L.marker([lat, lng], {icon: pinIcon}).addTo(map);
      map.setView([lat, lng], 15);
    } else {
      marker.setLatLng([lat, lng]);
    }
    lastLocationAt = Date.now();
    const el = marker.getElement();
    if (el) el.classList.remove("stale");
    armStaleTimer();
  }

  function markStale() {
    if (ended) return;
    if (marker) {
      const el = marker.getElement();
      if (el) el.classList.add("stale");
    }
    showStatus("Last update was over a minute ago", "warning");
  }

  function markEnded() {
    ended = true;
    if (marker) {
      const el = marker.getElement();
      if (el) el.classList.add("ended");
    }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    const cdEl = $("countdown");
    if (cdEl) cdEl.textContent = "";
    showStatus("Share has ended", "success");
    try { client.end(true); } catch (_) {}
    // Give the user a few seconds to read the banner, then send them to
    // the Pinpoint landing page rather than leaving them on a dead viewer.
    setTimeout(() => { window.location.href = "https://pinpointing.me/"; }, 5000);
  }

  function armStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

  // ===== MQTT
  showStatus("Connecting…");
  const client = mqtt.connect(cfg.brokerUrl, {
    username: cfg.username,
    password: cfg.password,
    keepalive: 30,
    clean: true,
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: 15_000,
  });

  const topicFilter = `${TOPIC_PREFIX}/${uid}/${token}/+`;

  client.on("connect", () => {
    console.log("[live-viewer] connected");
    client.subscribe(topicFilter, {qos: 0}, (err) => {
      if (err) {
        console.error("[live-viewer] subscribe failed", err);
        showStatus("Couldn't open this share", "error");
      } else {
        showStatus("Live", "success");
      }
    });
  });

  client.on("error", (err) => {
    console.error("[live-viewer] error", err);
    showStatus("Connection error", "error");
  });

  client.on("close", () => {
    if (!ended) console.log("[live-viewer] connection closed");
  });

  client.on("message", (topic, payload) => {
    if (ended) return;
    const suffix = topic.split("/").pop();
    let data;
    try {
      data = payload.length ? JSON.parse(new TextDecoder().decode(payload)) : null;
    } catch (e) {
      console.warn("[live-viewer] non-JSON message on", topic);
      return;
    }
    if (suffix === "meta" && data) {
      console.log("[live-viewer] meta", data);
      if (data.status === "ended") {
        renderMeta(data);
        markEnded();
        return;
      }
      renderMeta(data);
      if (typeof data.expiresAt === "number") {
        renderCountdown(data.expiresAt * 1000);
      }
    } else if (suffix === "location" && data) {
      if (typeof data.lat === "number" && typeof data.lng === "number") {
        placeOrMoveMarker(data.lat, data.lng);
        hideStatus();
      }
    }
  });
})();
