// Heatmap of every outdoor bike ride, drawn from window.RIDE_DATA.
//
// There is no basemap: the tracks are the map. That keeps the page free of a
// tile server, an API key and a mapping library, the same way the train map is
// built, and means opening this page sends nothing to a third party.
//
// Heat comes from compositing rather than from counting. Each track is stroked
// in translucent accent with "multiply", so paper that one ride crossed stays
// pale and paper that two hundred rides crossed drives down to a deep burnt
// red. Because the stroke is a constant width in screen pixels, zooming in
// separates tracks that overlapped when zoomed out, which is what makes a road
// ridden weekly read differently from a road ridden once.
(() => {
  const data = window.RIDE_DATA;
  const canvas = document.getElementById("ride-map");
  const status = document.getElementById("map-status");
  if (!data || !canvas) return;

  // Left transparent deliberately. Setting the canvas width clears it, and a
  // cleared opaque canvas is black, which is what would be on screen if the
  // page were resized while in a background tab: no frame runs until it is
  // looked at again, so the pane would show a black rectangle in the meantime.
  // Transparent means an undrawn canvas shows the stage's paper instead.
  const ctx = canvas.getContext("2d");

  const PAPER = "#f6f3ec";
  const TRACK = "154, 74, 36";     // --accent, as multiply ink
  const TRACK_ALPHA = 0.2;
  const LINE_WIDTH = 1.1;          // CSS px, held constant across zoom
  const COAST = "rgba(117, 106, 92, 0.62)";  // --ink-faint, kept well back
  const COAST_WIDTH = 1;
  const ZOOM_STEP = 1.6;
  const MAX_K = 400000;            // px per degree of latitude: street level
  const PAD = 0.06;                // fraction of the stage left as margin

  // --- data ----------------------------------------------------------------

  // Google encoded polyline, precision 5.
  const decode = (str) => {
    const pts = [];
    let i = 0, lat = 0, lng = 0;
    while (i < str.length) {
      let shift = 0, result = 0, b;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lat += result & 1 ? ~(result >> 1) : result >> 1;

      shift = 0;
      result = 0;
      do {
        b = str.charCodeAt(i++) - 63;
        result |= (b & 0x1f) << shift;
        shift += 5;
      } while (b >= 0x20);
      lng += result & 1 ? ~(result >> 1) : result >> 1;

      pts.push(lat * 1e-5, lng * 1e-5);
    }
    return pts;
  };

  // Flat [lat, lng, ...] arrays plus a bounding box each, so lines that fall
  // outside the viewport can be skipped without walking their points.
  const prepare = (encodedLines, into) => {
    encodedLines.forEach((encoded) => {
      const pts = decode(encoded);
      let minLat = Infinity, minLng = Infinity;
      let maxLat = -Infinity, maxLng = -Infinity;
      for (let i = 0; i < pts.length; i += 2) {
        if (pts[i] < minLat) minLat = pts[i];
        if (pts[i] > maxLat) maxLat = pts[i];
        if (pts[i + 1] < minLng) minLng = pts[i + 1];
        if (pts[i + 1] > maxLng) maxLng = pts[i + 1];
      }
      into.push({ pts, minLat, minLng, maxLat, maxLng });
    });
    return into;
  };

  const lines = [];
  data.regions.forEach((region) => prepare(region.lines, lines));

  // Coast is held in one list rather than per region, so panning from one area
  // towards another still finds the shoreline on the way.
  const coast = [];
  const coastData = window.COAST_DATA;
  if (coastData) {
    Object.keys(coastData).forEach((key) => prepare(coastData[key], coast));
  }

  // --- projection ----------------------------------------------------------

  // Equirectangular, longitudes squeezed by the cosine of the view latitude.
  // Over a single city or island the distortion is invisible and it costs no
  // dependency. cos is taken from the view centre and refreshed on every pan,
  // so it stays correct whether you are looking at Dublin or Mallorca.
  const view = { lat: 0, lng: 0, k: 1000 };
  let width = 0, height = 0, dpr = 1;

  const cosLat = () => Math.cos((view.lat * Math.PI) / 180);
  const toX = (lng) => (lng - view.lng) * cosLat() * view.k + width / 2;
  const toY = (lat) => (view.lat - lat) * view.k + height / 2;

  const fit = (bounds) => {
    const [minLat, minLng, maxLat, maxLng] = bounds;
    view.lat = (minLat + maxLat) / 2;
    view.lng = (minLng + maxLng) / 2;

    const spanLat = Math.max(maxLat - minLat, 1e-4);
    const spanLng = Math.max((maxLng - minLng) * cosLat(), 1e-4);
    view.k = Math.min(
      (height * (1 - 2 * PAD)) / spanLat,
      (width * (1 - 2 * PAD)) / spanLng
    );
  };

  // --- drawing -------------------------------------------------------------

  let frame = null;
  const draw = () => {
    // Drops any frame already queued, so calling draw() directly does not leave
    // a second full redraw of every track waiting behind it.
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.globalCompositeOperation = "source-over";
    ctx.fillStyle = PAPER;
    ctx.fillRect(0, 0, width, height);

    // Viewport in degrees, with a margin so a line crossing the edge still
    // draws the segment that enters the view.
    const halfLat = height / 2 / view.k;
    const halfLng = width / 2 / view.k / cosLat();
    const minLat = view.lat - halfLat * 1.1;
    const maxLat = view.lat + halfLat * 1.1;
    const minLng = view.lng - halfLng * 1.1;
    const maxLng = view.lng + halfLng * 1.1;

    const visible = (line) =>
      !(line.maxLat < minLat || line.minLat > maxLat ||
        line.maxLng < minLng || line.minLng > maxLng);

    const trace = (line) => {
      const pts = line.pts;
      ctx.moveTo(toX(pts[1]), toY(pts[0]));
      for (let i = 2; i < pts.length; i += 2) {
        ctx.lineTo(toX(pts[i + 1]), toY(pts[i]));
      }
    };

    // Coast first and in one path, under everything. It is context, not data:
    // a single flat line with no heat to accumulate, so unlike the tracks it
    // has no reason to be stroked one at a time.
    ctx.strokeStyle = COAST;
    ctx.lineWidth = COAST_WIDTH;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";
    ctx.beginPath();
    for (let n = 0; n < coast.length; n++) {
      if (visible(coast[n])) trace(coast[n]);
    }
    ctx.stroke();

    // Multiply is what turns overlap into heat: each stroke darkens what is
    // already there instead of replacing it.
    ctx.globalCompositeOperation = "multiply";
    ctx.strokeStyle = `rgba(${TRACK}, ${TRACK_ALPHA})`;
    ctx.lineWidth = LINE_WIDTH;
    ctx.lineJoin = "round";
    ctx.lineCap = "round";

    // One stroke per track, deliberately. Everything inside a single path is
    // rasterised together and composited once, so batching the tracks into one
    // path would make a road ridden two hundred times exactly as pale as a road
    // ridden once. The heat only exists because each track composites against
    // what the previous ones already laid down.
    for (let n = 0; n < lines.length; n++) {
      if (!visible(lines[n])) continue;
      ctx.beginPath();
      trace(lines[n]);
      ctx.stroke();
    }
  };

  const render = () => {
    if (frame === null) frame = requestAnimationFrame(draw);
  };

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    width = rect.width;
    height = rect.height;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    render();
  };

  // --- interaction ---------------------------------------------------------

  const zoomAbout = (factor, px, py) => {
    const next = Math.max(minZoom(), Math.min(MAX_K, view.k * factor));
    if (next === view.k) return;

    // Hold the point under the cursor still: convert it to a coordinate, apply
    // the zoom, then shift the centre so it lands back where it started.
    const lngAt = view.lng + (px - width / 2) / view.k / cosLat();
    const latAt = view.lat - (py - height / 2) / view.k;
    view.k = next;
    view.lng = lngAt - (px - width / 2) / view.k / cosLat();
    view.lat = latAt + (py - height / 2) / view.k;
    render();
  };

  // Never let the map zoom out past roughly the whole world; there is no
  // basemap to give a sense of scale, so a fully zoomed-out view is just a
  // scatter of specks.
  const minZoom = () => Math.min(height / 170, width / 360);

  let dragging = false;
  let lastX = 0, lastY = 0, moved = 0;
  const pointers = new Map();
  let pinchDist = 0;

  canvas.addEventListener("pointerdown", (e) => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      dragging = true;
      moved = 0;
      lastX = e.clientX;
      lastY = e.clientY;
      canvas.setPointerCapture(e.pointerId);
    } else if (pointers.size === 2) {
      dragging = false;
      const [a, b] = [...pointers.values()];
      pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
    }
  });

  canvas.addEventListener("pointermove", (e) => {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });

    if (pointers.size === 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (pinchDist > 0) {
        const rect = canvas.getBoundingClientRect();
        zoomAbout(
          dist / pinchDist,
          (a.x + b.x) / 2 - rect.left,
          (a.y + b.y) / 2 - rect.top
        );
      }
      pinchDist = dist;
      return;
    }

    if (!dragging) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    moved += Math.abs(dx) + Math.abs(dy);
    lastX = e.clientX;
    lastY = e.clientY;
    view.lng -= dx / view.k / cosLat();
    view.lat += dy / view.k;
    render();
  });

  const release = (e) => {
    pointers.delete(e.pointerId);
    if (pointers.size < 2) pinchDist = 0;
    if (pointers.size === 0) dragging = false;
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  canvas.addEventListener(
    "wheel",
    (e) => {
      e.preventDefault();
      const rect = canvas.getBoundingClientRect();
      zoomAbout(
        Math.pow(ZOOM_STEP, -e.deltaY / 300),
        e.clientX - rect.left,
        e.clientY - rect.top
      );
    },
    { passive: false }
  );

  // Keyboard equivalents, so the map is not mouse-only.
  canvas.addEventListener("keydown", (e) => {
    const step = 60;
    const keys = {
      ArrowLeft: () => (view.lng -= step / view.k / cosLat()),
      ArrowRight: () => (view.lng += step / view.k / cosLat()),
      ArrowUp: () => (view.lat += step / view.k),
      ArrowDown: () => (view.lat -= step / view.k),
    };
    if (keys[e.key]) {
      e.preventDefault();
      keys[e.key]();
      render();
    } else if (e.key === "+" || e.key === "=") {
      e.preventDefault();
      zoomAbout(ZOOM_STEP, width / 2, height / 2);
    } else if (e.key === "-") {
      e.preventDefault();
      zoomAbout(1 / ZOOM_STEP, width / 2, height / 2);
    }
  });

  // --- controls ------------------------------------------------------------

  const home = data.regions[0];

  document.getElementById("zoom-in").addEventListener("click", () => {
    zoomAbout(ZOOM_STEP, width / 2, height / 2);
  });
  document.getElementById("zoom-out").addEventListener("click", () => {
    zoomAbout(1 / ZOOM_STEP, width / 2, height / 2);
  });
  document.getElementById("zoom-reset").addEventListener("click", () => {
    fit(home.view);
    render();
    setRegion(home);
  });

  const regionList = document.getElementById("regions");
  const regionNote = document.getElementById("region-note");

  const setRegion = (region) => {
    regionList.querySelectorAll("button").forEach((b) => {
      b.setAttribute("aria-pressed", String(b.dataset.name === region.name));
    });
    regionNote.textContent =
      `${region.name}: ${region.rides} ${region.rides === 1 ? "ride" : "rides"}, ` +
      `${region.km.toLocaleString()} km, ${dateRange(region)}.`;
  };

  const dateRange = (region) => {
    const fmt = (iso) =>
      new Date(iso + "T00:00:00").toLocaleDateString("en-IE", {
        month: "long",
        year: "numeric",
      });
    return region.first === region.last || fmt(region.first) === fmt(region.last)
      ? fmt(region.first)
      : `${fmt(region.first)} to ${fmt(region.last)}`;
  };

  data.regions.forEach((region) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = region.name;
    button.dataset.name = region.name;
    button.setAttribute("aria-pressed", "false");
    button.addEventListener("click", () => {
      fit(region.view);
      render();
      setRegion(region);
    });
    regionList.append(button);
  });

  // --- start ---------------------------------------------------------------

  // The view survives a resize rather than refitting, so turning a phone
  // sideways keeps you where you had panned to instead of snapping home.
  if ("ResizeObserver" in window) {
    new ResizeObserver(resize).observe(canvas);
  } else {
    window.addEventListener("resize", resize);
  }

  resize();
  fit(home.view);
  // Drawn straight away rather than through render(). requestAnimationFrame
  // does not run in a background tab, so "open in new tab" would otherwise
  // leave the map blank until it was first looked at.
  draw();
  setRegion(home);

  const t = data.totals;
  status.textContent =
    `${t.rides} rides · ${t.km.toLocaleString()} km · ` +
    `${t.elevation.toLocaleString()} m climbed`;

  // Keeps the figures quoted in the prose tied to the data rather than to
  // whatever they happened to be when the paragraph was written.
  document.querySelectorAll("[data-ride-stat]").forEach((el) => {
    const value = t[el.dataset.rideStat];
    if (value !== undefined) el.textContent = value.toLocaleString();
  });
})();
