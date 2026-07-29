/*
 * Live train map — pan, zoom and inspect.
 *
 * Draws the island from assets/ireland.js and plots one dot per moving train
 * using the same projection the outline was generated with.
 *
 * Positions come from the self-hosted service, which proxies Irish Rail's
 * realtime feed. Expected shape:
 *
 *   {
 *     "as_of": "19:42:11",
 *     "trains": [
 *       { "code": "A226", "lat": 53.1, "lon": -7.3,
 *         "status": "R", "direction": "To Cork", "message": "..." }
 *     ]
 *   }
 *
 * Everything beyond code/lat/lon is optional. Origin, destination, lateness and
 * next stop are parsed out of `message` when present, so the map gets richer if
 * the service passes the feed's PublicMessage through untouched.
 *
 * Zoom and pan are plain viewBox arithmetic — no mapping library, no tiles.
 *
 * Unlike the departure board on the home page, this page IS the map, so a
 * failure states itself rather than hiding: the outline still draws and the
 * status line says positions are unavailable.
 */

(function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ENDPOINT = "https://trains.oods.dev/positions";
  var TIMEOUT_MS = 6000;
  var REFRESH_MS = 60000;
  var MIN_SPAN = 40; // most zoomed in, in projected units
  var DOT_R = 4.5; // radius at 1x, counter-scaled to stay constant on screen
  var GRAVITY_PX = 18; // how far a click may miss a train and still select it

  var svg = document.getElementById("train-map");
  var outline = document.getElementById("ireland");
  var rails = document.getElementById("railways");
  var layer = document.getElementById("train-layer");
  var status = document.getElementById("map-status");
  var detail = document.getElementById("train-detail");
  if (!svg || !outline || !layer || typeof IRELAND === "undefined") return;

  outline.setAttribute("d", IRELAND.path);
  // Optional: the map still works without the rail overlay.
  if (rails && typeof RAILWAYS !== "undefined") rails.setAttribute("d", RAILWAYS);

  var home = { x: 0, y: 0, w: IRELAND.width, h: IRELAND.height };
  var view = { x: home.x, y: home.y, w: home.w, h: home.h };
  var trains = [];
  var selectedCode = null;

  /* ---------- view ---------- */

  var applyView = function () {
    svg.setAttribute(
      "viewBox",
      view.x.toFixed(2) + " " + view.y.toFixed(2) + " " + view.w.toFixed(2) + " " + view.h.toFixed(2)
    );
    // Counter-scale the dots so zooming in separates them rather than just
    // drawing bigger markers.
    var r = (DOT_R * view.w) / home.w;
    var nodes = layer.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (nodes[i].setAttribute) nodes[i].setAttribute("r", r.toFixed(2));
    }
  };

  var clampView = function () {
    view.w = Math.min(Math.max(view.w, MIN_SPAN), home.w);
    view.h = (view.w * home.h) / home.w;
    view.x = Math.min(Math.max(view.x, home.x), home.x + home.w - view.w);
    view.y = Math.min(Math.max(view.y, home.y), home.y + home.h - view.h);
  };

  // Client point to SVG user space, so zoom can keep the point under the
  // cursor fixed instead of always zooming to the middle.
  var toUserSpace = function (clientX, clientY) {
    var rect = svg.getBoundingClientRect();
    return {
      x: view.x + ((clientX - rect.left) / rect.width) * view.w,
      y: view.y + ((clientY - rect.top) / rect.height) * view.h,
    };
  };

  var zoomAt = function (factor, clientX, clientY) {
    var anchor = toUserSpace(clientX, clientY);
    var before = view.w;
    view.w = view.w * factor;
    clampView();
    var actual = view.w / before; // clamping may have shortened the step
    view.x = anchor.x - (anchor.x - view.x) * actual;
    view.y = anchor.y - (anchor.y - view.y) * actual;
    clampView();
    applyView();
  };

  var zoomCentre = function (factor) {
    var rect = svg.getBoundingClientRect();
    zoomAt(factor, rect.left + rect.width / 2, rect.top + rect.height / 2);
  };

  var resetView = function () {
    view = { x: home.x, y: home.y, w: home.w, h: home.h };
    applyView();
  };

  /* ---------- parsing ---------- */

  // PublicMessage is one of:
  //   "E945\nBray to Howth\nExpected Departure 19:55"
  //   "A224\n18:00 - Dublin Heuston to Cork (-2 mins late)\nArrived LJ896 next stop Mallow"
  // The newlines arrive as literal backslash-n, so both forms are split on.
  var parseMessage = function (message) {
    var lines = String(message || "").split(/\\n|\n/);
    var route = (lines[1] || "").trim();
    var out = {
      origin: null,
      destination: null,
      departs: null,
      lateMins: null,
      note: (lines[2] || "").trim(),
    };

    var timed = route.match(/^(\d{1,2}:\d{2})\s*-\s*(.*)$/);
    if (timed) {
      out.departs = timed[1];
      route = timed[2];
    }

    var late = route.match(/\(([-+]?\d+)\s*mins?\s*late\)/i);
    if (late) {
      out.lateMins = parseInt(late[1], 10);
      route = route.replace(late[0], "").trim();
    }

    var parts = route.split(/\s+to\s+/);
    if (parts.length >= 2) {
      out.origin = parts[0].trim();
      out.destination = parts.slice(1).join(" to ").trim();
    }
    return out;
  };

  var describe = function (train) {
    var parsed = parseMessage(train.message);
    var route =
      parsed.origin && parsed.destination
        ? parsed.origin + " → " + parsed.destination
        : train.direction || "Route unknown";
    return { parsed: parsed, route: route };
  };

  /* ---------- detail panel ---------- */

  var row = function (dl, term, value) {
    if (value === null || value === undefined || value === "") return;
    var dt = document.createElement("dt");
    dt.textContent = term;
    var dd = document.createElement("dd");
    dd.textContent = value;
    dl.appendChild(dt);
    dl.appendChild(dd);
  };

  var renderDetail = function () {
    if (!detail) return;
    while (detail.firstChild) detail.removeChild(detail.firstChild);

    var train = null;
    for (var i = 0; i < trains.length; i++) {
      if (trains[i].code === selectedCode) train = trains[i];
    }

    if (!train) {
      detail.hidden = true;
      return;
    }

    var info = describe(train);
    var heading = document.createElement("h2");
    heading.textContent = info.route;
    detail.appendChild(heading);

    var dl = document.createElement("dl");
    row(dl, "Train", train.code);
    row(dl, "Departs", info.parsed.departs);
    if (info.parsed.lateMins !== null) {
      row(
        dl,
        "Running",
        info.parsed.lateMins > 0
          ? info.parsed.lateMins + " min late"
          : info.parsed.lateMins < 0
          ? Math.abs(info.parsed.lateMins) + " min early"
          : "on time"
      );
    }
    row(dl, "Position", info.parsed.note);
    row(dl, "Heading", train.direction);
    row(dl, "Coordinates", Number(train.lat).toFixed(4) + ", " + Number(train.lon).toFixed(4));
    detail.appendChild(dl);
    detail.hidden = false;
  };

  var select = function (code) {
    selectedCode = code;
    var nodes = layer.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      if (!nodes[i].setAttribute) continue;
      var isSelected = code !== null && nodes[i].getAttribute("data-code") === code;
      nodes[i].setAttribute("class", isSelected ? "train train-selected" : "train");
      nodes[i].setAttribute("aria-pressed", String(isSelected));
    }
    renderDetail();
  };

  /* ---------- drawing ---------- */

  var draw = function () {
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    var plotted = 0;
    trains.forEach(function (train) {
      var lat = Number(train.lat);
      var lon = Number(train.lon);
      // The feed includes trains with no fix yet; skip rather than stack them
      // all in one corner of the map.
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return;

      var p = projectPoint(lon, lat);
      var info = describe(train);

      var dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", p.x.toFixed(1));
      dot.setAttribute("cy", p.y.toFixed(1));
      dot.setAttribute("data-code", train.code || "");
      dot.setAttribute("class", "train");
      dot.setAttribute("tabindex", "0");
      dot.setAttribute("role", "button");
      dot.setAttribute("aria-pressed", "false");
      dot.setAttribute("aria-label", (train.code || "Train") + ", " + info.route);

      var label = document.createElementNS(SVG_NS, "title");
      label.textContent = (train.code || "Train") + " · " + info.route;
      dot.appendChild(label);

      layer.appendChild(dot);
      plotted += 1;
    });

    applyView();
    return plotted;
  };

  /* ---------- interaction ---------- */

  var dragging = false;
  var moved = false;
  var last = null;
  var pointers = {};
  var pinchStart = null;

  svg.addEventListener("pointerdown", function (event) {
    pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    var ids = Object.keys(pointers);

    if (ids.length === 2) {
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      pinchStart = { dist: Math.hypot(a.x - b.x, a.y - b.y), w: view.w };
      dragging = false;
      return;
    }

    dragging = true;
    moved = false;
    last = { x: event.clientX, y: event.clientY };
    if (svg.setPointerCapture) svg.setPointerCapture(event.pointerId);
  });

  svg.addEventListener("pointermove", function (event) {
    if (pointers[event.pointerId]) {
      pointers[event.pointerId] = { x: event.clientX, y: event.clientY };
    }

    var ids = Object.keys(pointers);
    if (ids.length === 2 && pinchStart) {
      var a = pointers[ids[0]];
      var b = pointers[ids[1]];
      var dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (dist > 0) {
        var target = (pinchStart.w * pinchStart.dist) / dist;
        zoomAt(target / view.w, (a.x + b.x) / 2, (a.y + b.y) / 2);
      }
      return;
    }

    if (!dragging || !last) return;
    var rect = svg.getBoundingClientRect();
    var dx = ((event.clientX - last.x) / rect.width) * view.w;
    var dy = ((event.clientY - last.y) / rect.height) * view.h;
    if (Math.abs(event.clientX - last.x) > 2 || Math.abs(event.clientY - last.y) > 2) moved = true;
    view.x -= dx;
    view.y -= dy;
    clampView();
    applyView();
    last = { x: event.clientX, y: event.clientY };
  });

  var endPointer = function (event) {
    delete pointers[event.pointerId];
    if (Object.keys(pointers).length < 2) pinchStart = null;
    dragging = false;
    last = null;
  };
  svg.addEventListener("pointerup", endPointer);
  svg.addEventListener("pointercancel", endPointer);

  svg.addEventListener(
    "wheel",
    function (event) {
      event.preventDefault();
      zoomAt(event.deltaY > 0 ? 1.15 : 1 / 1.15, event.clientX, event.clientY);
    },
    { passive: false }
  );

  // Clicking a 5px dot is unpleasant, especially on touch and especially in the
  // Dublin cluster. A click that misses still selects the closest train within
  // GRAVITY_PX of the pointer — measured in screen pixels, so the forgiveness
  // stays the same however far in you have zoomed.
  var nearestTrain = function (clientX, clientY) {
    var rect = svg.getBoundingClientRect();
    if (!rect.width) return null;
    var point = toUserSpace(clientX, clientY);
    var limit = GRAVITY_PX * (view.w / rect.width);
    var best = null;
    var bestDist = Infinity;

    var nodes = layer.childNodes;
    for (var i = 0; i < nodes.length; i++) {
      var node = nodes[i];
      if (!node.getAttribute) continue;
      var dx = parseFloat(node.getAttribute("cx")) - point.x;
      var dy = parseFloat(node.getAttribute("cy")) - point.y;
      var dist = Math.hypot(dx, dy);
      if (dist < bestDist && dist <= limit) {
        bestDist = dist;
        best = node.getAttribute("data-code");
      }
    }
    return best;
  };

  svg.addEventListener("click", function (event) {
    // A drag that happens to finish over a dot should not also select it.
    var wasDrag = moved;
    moved = false; // consume it, so the flag can never outlive its gesture
    if (wasDrag) return;
    var code = event.target && event.target.getAttribute && event.target.getAttribute("data-code");
    select(code || nearestTrain(event.clientX, event.clientY));
  });

  svg.addEventListener("keydown", function (event) {
    if (event.key !== "Enter" && event.key !== " ") return;
    var code = event.target && event.target.getAttribute && event.target.getAttribute("data-code");
    if (!code) return;
    event.preventDefault();
    select(code);
  });

  var wire = function (id, handler) {
    var el = document.getElementById(id);
    if (el) el.addEventListener("click", handler);
  };
  wire("zoom-in", function () {
    zoomCentre(1 / 1.4);
  });
  wire("zoom-out", function () {
    zoomCentre(1.4);
  });
  wire("zoom-reset", function () {
    resetView();
  });

  /* ---------- loading ---------- */

  var clockNow = function () {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false });
  };

  var setStatus = function (text) {
    if (status) status.textContent = text;
  };

  var load = function () {
    var controller = new AbortController();
    var timer = setTimeout(function () {
      controller.abort();
    }, TIMEOUT_MS);

    fetch(ENDPOINT, { signal: controller.signal })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(function (data) {
        clearTimeout(timer);
        trains = (data && data.trains) || [];
        var plotted = draw();
        // A refresh must not throw away where the reader zoomed to, or what
        // they were reading about.
        if (selectedCode) select(selectedCode);
        setStatus(
          plotted === 0
            ? "No trains reporting a position right now."
            : plotted + (plotted === 1 ? " train" : " trains") + " moving · fetched " + clockNow()
        );
      })
      .catch(function () {
        clearTimeout(timer);
        setStatus("Live positions unavailable right now.");
      });
  };

  applyView();
  load();

  var interval = setInterval(function () {
    if (!document.hidden) load();
  }, REFRESH_MS);

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) load();
  });

  window.addEventListener("pagehide", function () {
    clearInterval(interval);
  });
})();
