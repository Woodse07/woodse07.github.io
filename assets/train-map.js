/*
 * Live train map.
 *
 * Draws the island from assets/ireland.js, then plots one dot per moving train
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
 * Unlike the departure board on the home page, this page IS the map, so a
 * failure states itself rather than hiding — the outline still renders and the
 * status line says positions are unavailable.
 */

(function () {
  var SVG_NS = "http://www.w3.org/2000/svg";
  var ENDPOINT = "https://trains.oods.dev/positions";
  var TIMEOUT_MS = 6000;
  var REFRESH_MS = 60000;

  var svg = document.getElementById("train-map");
  var outline = document.getElementById("ireland");
  var layer = document.getElementById("train-layer");
  var status = document.getElementById("map-status");
  if (!svg || !outline || !layer || typeof IRELAND === "undefined") return;

  svg.setAttribute("viewBox", IRELAND.viewBox);
  outline.setAttribute("d", IRELAND.path);

  var setStatus = function (text) {
    if (status) status.textContent = text;
  };

  var clockNow = function () {
    return new Date().toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
    });
  };

  var draw = function (trains) {
    while (layer.firstChild) layer.removeChild(layer.firstChild);

    var plotted = 0;
    trains.forEach(function (train) {
      var lat = Number(train.lat);
      var lon = Number(train.lon);
      // The feed includes trains with no fix yet; skip rather than stack them
      // all on one corner of the map.
      if (!isFinite(lat) || !isFinite(lon) || (lat === 0 && lon === 0)) return;

      var p = projectPoint(lon, lat);
      var dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("cx", p.x.toFixed(1));
      dot.setAttribute("cy", p.y.toFixed(1));
      dot.setAttribute("r", "4.5");
      dot.setAttribute("class", "train");

      var label = document.createElementNS(SVG_NS, "title");
      label.textContent =
        (train.code || "Train") + (train.direction ? " · " + train.direction : "");
      dot.appendChild(label);

      layer.appendChild(dot);
      plotted += 1;
    });
    return plotted;
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
        var plotted = draw((data && data.trains) || []);
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

  load();

  // Refresh while the page is actually being looked at.
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
