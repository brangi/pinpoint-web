// Pinpoint static trip viewer — decodes a Google-encoded polyline from
// ?route= and renders it as a Leaflet polyline + start/end pins.
// Empty / invalid params fall back to the empty-state hero.

(function () {
  'use strict';

  function $(id) { return document.getElementById(id); }

  // ===== Google polyline decoder
  function decodePolyline(encoded) {
    var index = 0, len = encoded.length, coordinates = [];
    var lat = 0, lng = 0;
    while (index < len) {
      var b, shift = 0, result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lat += (result & 1) ? ~(result >> 1) : (result >> 1);
      shift = 0; result = 0;
      do { b = encoded.charCodeAt(index++) - 63; result |= (b & 0x1f) << shift; shift += 5; } while (b >= 0x20);
      lng += (result & 1) ? ~(result >> 1) : (result >> 1);
      coordinates.push([lat * 1e-5, lng * 1e-5]);
    }
    return coordinates;
  }

  // ===== Distance via Haversine, sum across leg pairs
  function totalDistanceMeters(coords) {
    var R = 6371e3;
    var d = 0;
    for (var i = 1; i < coords.length; i++) {
      var lat1 = coords[i - 1][0] * Math.PI / 180;
      var lat2 = coords[i][0] * Math.PI / 180;
      var dLat = (coords[i][0] - coords[i - 1][0]) * Math.PI / 180;
      var dLng = (coords[i][1] - coords[i - 1][1]) * Math.PI / 180;
      var a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
              Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
      d += 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }
    return d;
  }

  // ===== Empty / error state
  function showEmpty(title, message) {
    $('map-container').classList.add('hidden');
    $('trip-card').classList.add('hidden');
    $('trip-card').classList.remove('flex');
    var es = $('empty-state');
    es.classList.remove('hidden');
    if (title)   $('empty-title').textContent = title;
    if (message) $('empty-message').innerHTML  = message;
  }

  function showMap() {
    $('empty-state').classList.add('hidden');
    $('map-container').classList.remove('hidden');
    $('trip-card').classList.remove('hidden');
    $('trip-card').classList.add('flex');
  }

  // ===== Entry
  function main() {
    var params = new URLSearchParams(window.location.search);
    var routeParam = params.get('route');

    if (!routeParam) {
      // Default empty state is already visible from initial HTML; no-op.
      return;
    }

    var coordinates;
    try {
      coordinates = decodePolyline(routeParam);
      if (!coordinates.length) throw new Error('No valid coordinates');
    } catch (err) {
      console.error('[route-viewer] decode failed', err);
      showEmpty('This trip link is invalid', "We couldn't read the route data in this link. Try opening the share again from Pinpoint.");
      return;
    }

    showMap();

    var map = L.map('map', { zoomControl: false, attributionControl: false });
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    L.tileLayer('https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', {
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    // Polyline — brand blue with subtle outer halo for legibility on light tiles
    L.polyline(coordinates, {
      color: '#FFFFFF', weight: 9, opacity: 0.55,
    }).addTo(map);
    var routeLine = L.polyline(coordinates, {
      color: '#3B82F6', weight: 5, opacity: 0.95, lineJoin: 'round', lineCap: 'round',
    }).addTo(map);

    // Start pin: arrow glyph
    var startIcon = L.divIcon({
      className: '',
      html: '<div class="route-pin"><div class="pin-body"></div><div class="pin-content"><svg width="20" height="20" viewBox="0 0 24 24"><path fill="white" d="M12 4l-1.41 1.41L16.17 11H4v2h12.17l-5.58 5.59L12 20l8-8z" transform="rotate(270 12 12)"/></svg></div></div>',
      iconSize: [38, 50],
      iconAnchor: [19, 50],
    });
    // End pin: dot glyph
    var endIcon = L.divIcon({
      className: '',
      html: '<div class="route-pin"><div class="pin-body"></div><div class="pin-content"><div class="pin-content-inner-dot"></div></div></div>',
      iconSize: [38, 50],
      iconAnchor: [19, 50],
    });

    L.marker(coordinates[0], { icon: startIcon }).addTo(map)
      .bindTooltip('Start', { permanent: true, direction: 'right', offset: [15, -25], className: 'map-label' });
    L.marker(coordinates[coordinates.length - 1], { icon: endIcon }).addTo(map)
      .bindTooltip('End', { permanent: true, direction: 'right', offset: [15, -25], className: 'map-label' });

    map.fitBounds(routeLine.getBounds(), { padding: [60, 60] });

    var meters = totalDistanceMeters(coordinates);
    var miles = (meters / 1609.344).toFixed(1);
    var km    = (meters / 1000).toFixed(1);
    $('trip-distance').textContent = miles + ' mi · ' + km + ' km';
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', main);
  } else {
    main();
  }
})();
