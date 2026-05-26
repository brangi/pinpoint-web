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

  // ===== URL parsing
  var params = new URLSearchParams(window.location.search);
  var uid = (params.get('u') || '').trim();
  var token = (params.get('t') || '').trim();

  bindThemeToggle();

  if (!uid || !token || uid.length > 128 || token.length > 128) {
    showInvalid();
    return;
  }

  // ===== Open-in-app deep link
  $('open-in-app').href = 'pinpointapp://live?u=' + encodeURIComponent(uid) + '&t=' + encodeURIComponent(token);

  // ===== Env + broker config
  var cfg = window.PinpointEnv.pick(params);
  console.log('[live-viewer] env=' + cfg.env + ' broker=' + cfg.brokerUrl);

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

  var marker = null;
  var lastLocationAt = 0;
  var staleTimer = null;
  var ended = false;
  var followSharer = true;  // when true, map auto-pans to new locations
  var userPanned = false;

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
    if (countdownTimer)   { clearInterval(countdownTimer);   countdownTimer = null; }
    if (freshnessTimer)   { clearInterval(freshnessTimer);   freshnessTimer = null; }
    $('countdown').textContent = '';
    $('freshness-caption').textContent = 'Share ended';
    $('freshness-caption').className = 'font-body text-xs text-gray-500 dark:text-gray-400 mt-0.5';
    setStatus('Share ended', 'ended');
    try { client.end(true); } catch (_) {}
    setTimeout(function () { window.location.href = 'https://pinpointing.me/'; }, ENDED_DISMISS_MS);
  }

  function armStaleTimer() {
    if (staleTimer) clearTimeout(staleTimer);
    staleTimer = setTimeout(markStale, STALE_MS);
  }

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

  var client = mqtt.connect(cfg.brokerUrl, {
    username: cfg.username,
    password: cfg.password,
    keepalive: 30,
    clean: true,
    reconnectPeriod: RECONNECT_PERIOD_MS,
    connectTimeout: 15_000,
  });

  var topicFilter = TOPIC_PREFIX + '/' + uid + '/' + token + '/+';

  client.on('connect', function () {
    console.log('[live-viewer] connected');
    client.subscribe(topicFilter, { qos: 0 }, function (err) {
      if (err) {
        console.error('[live-viewer] subscribe failed', err);
        setStatus("Couldn't open this share", 'error');
      } else {
        setStatus('Live', 'live');
      }
    });
  });

  client.on('error', function (err) {
    console.error('[live-viewer] error', err);
    setStatus('Connection error', 'error');
  });

  client.on('close', function () {
    if (!ended) console.log('[live-viewer] connection closed');
  });

  client.on('message', function (topic, payload) {
    if (ended) return;
    var suffix = topic.split('/').pop();
    var data;
    try {
      data = payload.length ? JSON.parse(new TextDecoder().decode(payload)) : null;
    } catch (e) {
      console.warn('[live-viewer] non-JSON message on', topic);
      return;
    }
    if (suffix === 'meta' && data) {
      console.log('[live-viewer] meta', data);
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
})();
