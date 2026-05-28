// Pinpoint Live web viewer — connects to EMQX over WSS, subscribes to a
// single (uid, token) live share, renders the sharer's position on a
// Leaflet map. Pure browser code; no backend.
//
// URL: /live.html?u={uid}&t={token}[&env=dev]

(function () {
  'use strict';

  // ===== Constants
  var TOPIC_PREFIX = 'pinpoint/live';
  var STALE_MS = 60_000;
  var RECONNECT_PERIOD_MS = 3_000;
  var ENDED_DISMISS_MS = 5_000;

  // ===== Debug-gated logging. Production viewers must not print share data
  //       (shortcode, resolved uid/token, sharer name/photo/battery) to the
  //       console where anyone with DevTools open can read it. Logging is on
  //       only for dev builds or when ?debug=1 is explicitly passed.
  var DEBUG = false;
  try {
    var _dbgParams = new URLSearchParams(window.location.search);
    DEBUG = _dbgParams.get('debug') === '1' ||
            (_dbgParams.get('env') || '').toLowerCase() === 'dev';
  } catch (_) {}
  function dlog() { if (DEBUG) try { console.log.apply(console, arguments); } catch (_) {} }
  function dwarn() { if (DEBUG) try { console.warn.apply(console, arguments); } catch (_) {} }
  function derr() { if (DEBUG) try { console.error.apply(console, arguments); } catch (_) {} }

  // ===== Module-scope state shared between the freshness/countdown
  //       tickers (declared up here near the top of the IIFE) and the
  //       MQTT setup code inside startWithCredentials (which assigns to
  //       them). Hoisted because helpers like startFreshnessTicker()
  //       capture these via closure, and they'd be `undefined` inside
  //       the helper if declared only inside startWithCredentials.
  var marker = null;
  var lastLocationAt = 0;
  var staleTimer = null;
  var ended = false;
  var followSharer = true;
  var userPanned = false;
  var client = null; // MQTT client, assigned inside startWithCredentials

  // ===== Lifecycle helpers (live in outer scope so renderCountdown's tick —
  //       also outer-scope — can call markEnded() on self-enforced expiry).
  function markStale() {
    if (ended) return;
    if (marker) {
      var el = marker.getElement();
      if (el) el.classList.add('stale');
    }
    setStatus('Stale', 'stale');
  }

  function markEnded() {
    ended = true;
    if (marker) {
      var el = marker.getElement();
      if (el) el.classList.add('ended');
    }
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    if (freshnessTimer) { clearInterval(freshnessTimer); freshnessTimer = null; }
    var cd = $('countdown'); if (cd) cd.textContent = '';
    var fr = $('freshness-caption');
    if (fr) {
      fr.textContent = 'Share ended';
      fr.className = 'font-body text-xs text-gray-500 dark:text-gray-400 mt-0.5';
    }
    setStatus('Share ended', 'ended');
    try { if (client) client.end(true); } catch (_) {}
    setTimeout(function () { window.location.href = 'https://pinpointing.me/'; }, ENDED_DISMISS_MS);
  }

  function armStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

  // ===== DOM helpers
  function $(id) { return document.getElementById(id); }

  function setStatus(text, variant) {
    var el = $('status-banner');
    if (!el) return;
    el.classList.remove('hidden');
    el.classList.add('inline-flex');
    $('status-text').textContent = text;
    var dot = $('status-dot');
    dot.classList.remove('is-live', 'is-stale', 'is-ended', 'is-error');
    dot.classList.add('is-' + (variant || 'live'));
  }
  function hideStatus() {
    var el = $('status-banner');
    if (!el) return;
    el.classList.add('hidden');
    el.classList.remove('inline-flex');
  }
  function showCard() {
    var el = $('info-card');
    el.classList.remove('hidden');
    el.classList.add('flex');
  }
  function showInvalid() {
    var el = $('invalid-state');
    el.classList.remove('hidden');
    el.classList.add('flex');
  }

  // ===== Theme toggle (inline rather than separate file because live-viewer
  //       already includes a lot of UI wiring; keeps live.html script count low)
  function bindThemeToggle() {
    var btn = $('theme-toggle');
    if (!btn) return;
    btn.addEventListener('click', function () {
      var root = document.documentElement;
      var nowDark = !root.classList.contains('dark');
      root.classList.toggle('dark', nowDark);
      try { localStorage.setItem('pinpoint-theme', nowDark ? 'dark' : 'light'); } catch (_) {}
    });
  }

  // ===== Sharer card rendering
  function renderMeta(meta) {
    $('sharer-name').textContent = meta.sharerName || 'Live Share';

    var img = $('avatar-img');
    var initial = $('avatar-initial');
    if (meta.sharerPhotoURL) {
      img.src = meta.sharerPhotoURL;
      img.classList.remove('hidden');
      initial.classList.add('hidden');
      img.onerror = function () {
        // Photo URL broke (404, CORS) — fall back to the initial circle.
        img.classList.add('hidden');
        initial.classList.remove('hidden');
        initial.textContent = (meta.sharerInitial || '?').toUpperCase();
      };
    } else {
      img.classList.add('hidden');
      initial.classList.remove('hidden');
      initial.textContent = (meta.sharerInitial || '?').toUpperCase();
    }

    renderBattery(meta.battery, meta.batteryState);

    showCard();
  }

  function renderBattery(level, state) {
    var pill = $('battery-pill');
    var warn = $('battery-warning');
    if (typeof level !== 'number' || isNaN(level)) {
      pill.classList.add('hidden');
      warn.classList.add('hidden');
      return;
    }
    var pct = Math.round(level * 100);
    var isCharging = state === 'charging' || state === 'full';

    $('battery-percent').textContent = pct + '%';
    $('battery-icon').textContent = isCharging ? '⚡' : '🔋';

    // Traffic-light thresholds
    pill.classList.remove(
      'bg-brand-green/15', 'text-brand-green',
      'bg-brand-orange/15', 'text-brand-orange',
      'bg-brand-red/15', 'text-brand-red'
    );
    if (isCharging || pct >= 50) {
      pill.classList.add('bg-brand-green/15', 'text-brand-green');
      warn.classList.add('hidden');
    } else if (pct >= 20) {
      pill.classList.add('bg-brand-orange/15', 'text-brand-orange');
      warn.classList.add('hidden');
    } else {
      pill.classList.add('bg-brand-red/15', 'text-brand-red');
      warn.classList.remove('hidden');
    }

    pill.classList.remove('hidden');
  }

  // ===== Countdown (refreshed every 1s — tight loop so we catch expiry
  // and force-close the viewer without relying on an `ended` meta from
  // the sender. The sender may be suspended past expiry and unable to
  // publish the ended-meta, so we must self-enforce the agreed end time
  // here to avoid leaking location updates past it.)
  var countdownTimer = null;
  var expiresAtMs = 0;  // module-scope so the location handler can gate too
  function renderCountdown(newExpiresAtMs) {
    expiresAtMs = newExpiresAtMs;
    var el = $('countdown');
    function tick() {
      var remainMs = expiresAtMs - Date.now();
      if (remainMs <= 0) {
        el.textContent = 'Expired';
        // Client-side expiry enforcement: do not wait for the sender to
        // publish ended-meta — they may be suspended. Trigger the same
        // ended flow (unsubscribe, redirect) on our own clock.
        markEnded();
        return;
      }
      var totalMin = Math.floor(remainMs / 60000);
      var h = Math.floor(totalMin / 60);
      var m = totalMin % 60;
      el.textContent = h > 0 ? h + 'h ' + m + 'm left' : m + 'm left';
    }
    if (countdownTimer) clearInterval(countdownTimer);
    tick();
    countdownTimer = setInterval(tick, 1_000);
  }

  // ===== Freshness ticker (refreshed every 1s)
  var freshnessTimer = null;
  function startFreshnessTicker() {
    var el = $('freshness-caption');
    if (freshnessTimer) clearInterval(freshnessTimer);
    function tick() {
      if (ended) return;
      if (!lastLocationAt) {
        el.textContent = 'Connecting…';
        el.className = 'font-body text-xs text-gray-500 dark:text-gray-400 mt-0.5';
        return;
      }
      var elapsedSec = Math.max(0, Math.floor((Date.now() - lastLocationAt) / 1000));
      var text;
      if (elapsedSec < 5) {
        text = 'Live · just now';
      } else if (elapsedSec < 60) {
        text = 'Updated ' + elapsedSec + 's ago';
      } else {
        var min = Math.floor(elapsedSec / 60);
        text = 'Updated ' + min + 'm ago';
      }
      el.textContent = text;
      el.className = 'font-body text-xs mt-0.5 ' + (
        elapsedSec < 10 ? 'text-brand-green' :
        elapsedSec < STALE_MS / 1000 ? 'text-gray-500 dark:text-gray-400' :
        'text-brand-orange'
      );
    }
    tick();
    freshnessTimer = setInterval(tick, 1000);
  }

  // ===== URL parsing — accepts /l/<code> (via 404.html redirect) or
  //       live.html?c=<code> directly. The 6-char code resolves to
  //       (ownerUid, token) via Firestore live_share_codes/{code}.
  var params = new URLSearchParams(window.location.search);
  var code = (params.get('c') || '').trim();

  bindThemeToggle();

  if (!code || code.length > 32 || !/^[A-Za-z0-9]+$/.test(code)) {
    showInvalid();
    return;
  }

  // ===== Env + broker config (env=dev still accepted for dev builds)
  var cfg = window.PinpointEnv.pick(params);
  dlog('[live-viewer] env=' + cfg.env + ' broker=' + cfg.brokerUrl);

  // ===== Resolve the shortcode server-side. The resolveLiveShareCode Cloud
  //       Function reads Firestore, checks expiry, and returns the (uid,
  //       token) pair plus a short-lived MQTT JWT scoped subscribe-only to
  //       this one share's topic. No shared broker password ships to the
  //       browser, and live_share_codes is no longer client-readable.
  if (!cfg.resolveUrl) {
    derr('[live-viewer] missing resolveUrl in env config');
    showInvalid();
    return;
  }

  dlog('[live-viewer] resolving shortcode', code);
  fetch(cfg.resolveUrl, {
    method: 'POST',
    headers: {'Content-Type': 'application/json'},
    body: JSON.stringify({code: code}),
  })
    .then(function (resp) {
      if (!resp.ok) {
        dwarn('[live-viewer] resolve failed: HTTP ' + resp.status);
        showInvalid();
        return null;
      }
      return resp.json();
    })
    .then(function (data) {
      if (!data) return;
      var resolvedUid = (data.uid || '').toString().trim();
      var resolvedToken = (data.token || '').toString().trim();
      var jwt = (data.jwt || '').toString();
      if (!resolvedUid || !resolvedToken || !jwt ||
          resolvedUid.length > 128 || resolvedToken.length > 128) {
        dwarn('[live-viewer] resolve response missing fields');
        showInvalid();
        return;
      }
      startWithCredentials(resolvedUid, resolvedToken, jwt, cfg);
    })
    .catch(function (err) {
      derr('[live-viewer] shortcode resolve failed', err);
      showInvalid();
    });

  // The rest of the legacy setup is wrapped in startWithCredentials so it
  // runs only AFTER the shortcode resolves. Defining it inline below.
  function startWithCredentials(uid, token, jwt, cfg) {

  // ===== "Open in Pinpoint" — platform-aware.
  //  - iOS: try the app via the pinpointapp:// deep link. If the app doesn't
  //    take over within a moment (not installed), fall back to the App Store.
  //  - Desktop / non-iOS: no app is possible, so go straight to the App Store
  //    (new tab, leaving the live map open).
  var APP_STORE_URL = 'https://apps.apple.com/us/app/pinpoint-trip-tracker/id6749234913';
  var openBtn = $('open-in-app');
  var isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
              (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

  if (isIOS) {
    var deepLink = 'pinpointapp://live?c=' + encodeURIComponent(code);
    openBtn.href = deepLink;
    openBtn.addEventListener('click', function () {
      // The href fires the deep link. If the app opens, iOS backgrounds this
      // page (visibility hidden) and we cancel. If we're still visible after a
      // beat, the app isn't installed — send them to the App Store.
      var fallback = setTimeout(function () {
        if (!document.hidden) window.location.href = APP_STORE_URL;
      }, 1500);
      document.addEventListener('visibilitychange', function onHide() {
        if (document.hidden) {
          clearTimeout(fallback);
          document.removeEventListener('visibilitychange', onHide);
        }
      });
    });
  } else {
    openBtn.href = APP_STORE_URL;
    openBtn.target = '_blank';
    openBtn.rel = 'noopener';
  }

  // ===== Map (Leaflet)
  // zoomControl disabled — the buttons collided with the Pinpoint logo
  // header at top-left, and the bottom-right is already taken by the
  // recenter FAB. Pinch / scroll-wheel / double-click zoom still work.
  var map = L.map('map', { zoomControl: false, attributionControl: false }).setView([39.5, -98.5], 4);

  L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
    subdomains: 'abcd',
    maxZoom: 20,
  }).addTo(map);

  var pinIcon = L.divIcon({
    className: 'live-pin',
    iconSize: [36, 36],
    iconAnchor: [18, 18],
    html: '<div class="pin-core"></div>',
  });

  // marker / lastLocationAt / staleTimer / ended / followSharer / userPanned
  // are hoisted to the IIFE scope at the top of the file so the freshness
  // ticker (defined outside startWithCredentials) can read them. Reset
  // here to clean slate per share.
  marker = null;
  lastLocationAt = 0;
  staleTimer = null;
  ended = false;
  followSharer = true;
  userPanned = false;

  function placeOrMoveMarker(lat, lng) {
    if (!marker) {
      marker = L.marker([lat, lng], { icon: pinIcon }).addTo(map);
      map.setView([lat, lng], 15);
    } else {
      marker.setLatLng([lat, lng]);
      if (followSharer && !userPanned) {
        map.panTo([lat, lng], { animate: true, duration: 0.4 });
      }
    }
    lastLocationAt = Date.now();
    var el = marker.getElement();
    if (el) el.classList.remove('stale');
    armStaleTimer();
  }

  // markStale / markEnded / armStaleTimer are hoisted into the outer IIFE
  // scope below (right after the var declarations) so renderCountdown can
  // call markEnded() on client-side expiry — that ticker is defined
  // outside startWithCredentials and would otherwise see them as undefined.

  // ===== Recenter FAB
  var recenterFab = $('recenter-fab');
  map.on('dragstart', function () {
    userPanned = true;
    if (marker) {
      recenterFab.classList.remove('opacity-0', 'pointer-events-none');
      recenterFab.classList.add('opacity-100');
    }
  });
  recenterFab.addEventListener('click', function () {
    if (!marker) return;
    userPanned = false;
    map.setView(marker.getLatLng(), Math.max(15, map.getZoom()), { animate: true });
    recenterFab.classList.add('opacity-0', 'pointer-events-none');
    recenterFab.classList.remove('opacity-100');
  });

  // ===== MQTT
  setStatus('Connecting…', 'live');
  startFreshnessTicker();

  // Authenticate with the per-share JWT (MQTT password field). EMQX verifies
  // the HS256 signature + exp and enforces the token's acl claim, which allows
  // subscribing only to this share's topic. The username is informational.
  client = mqtt.connect(cfg.brokerUrl, {
    username: 'viewer-' + uid,
    password: jwt,
    keepalive: 30,
    clean: true,
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: 15_000,
  });

  var topicFilter = TOPIC_PREFIX + '/' + uid + '/' + token + '/+';

  client.on('connect', function () {
    dlog('[live-viewer] connected');
    client.subscribe(topicFilter, { qos: 0 }, function (err) {
      if (err) {
        derr('[live-viewer] subscribe failed', err);
        setStatus("Couldn't open this share", 'error');
      } else {
        setStatus('Live', 'live');
      }
    });
  });

  client.on('error', function (err) {
    derr('[live-viewer] error', err);
    setStatus('Connection error', 'error');
  });

  client.on('close', function () {
    if (!ended) dlog('[live-viewer] connection closed');
  });

  client.on('message', function (topic, payload) {
    if (ended) return;
    var suffix = topic.split('/').pop();
    var data;
    try {
      data = payload.length ? JSON.parse(new TextDecoder().decode(payload)) : null;
    } catch (e) {
      dwarn('[live-viewer] non-JSON message on', topic);
      return;
    }
    if (suffix === 'meta' && data) {
      dlog('[live-viewer] meta', data);
      if (data.status === 'ended') {
        renderMeta(data);
        markEnded();
        return;
      }
      renderMeta(data);
      if (typeof data.expiresAt === 'number') {
        renderCountdown(data.expiresAt * 1000);
      }
    } else if (suffix === 'location' && data) {
      // Hard-reject any location update arriving past the agreed expiry.
      // 5s grace absorbs clock skew between sharer/broker/viewer. This is
      // the second layer of defense behind the countdown's self-end above.
      if (expiresAtMs > 0 && Date.now() > expiresAtMs + 5_000) {
        markEnded();
        return;
      }
      if (typeof data.lat === 'number' && typeof data.lng === 'number') {
        placeOrMoveMarker(data.lat, data.lng);
        // Drop the "Connecting…" banner once we have real data — recipient
        // sees a clean map with the pin and a live status implied by the
        // freshness caption on the card.
        hideStatus();
      }
    }
  });

  } // end startWithCredentials
})();
