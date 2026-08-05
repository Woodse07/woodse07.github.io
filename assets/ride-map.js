// Heatmap of every outdoor bike ride, drawn from window.RIDE_DATA.
//
// One continuous map, not five. Every track and every piece of land is drawn in
// the same coordinate space, and the region buttons only move the camera: they
// set a centre and a zoom and nothing else. Nothing is fetched at page load, so
// the page stays free of a tile server, an API key and a mapping library, the
// same way the train map is, and opening it sends nothing to a third party.
//
// Land is a fill, not an outline, for the same reason the train map fills its
// island: a stroked coastline is a line, and the tracks are lines too, so the
// two read as the same kind of mark and a shoreline running beside a coast road
// is indistinguishable from a ride. A flat change of colour says "this is sea"
// without putting a single competing stroke on the map.
//
// Heat comes from compositing rather than from counting. Each track is stroked
// in translucent accent with "multiply", so ground that one ride crossed stays
// pale and ground that two hundred rides crossed drives down to a deep burnt
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

  const SEA = "#f6f3ec";           // --paper, the page's own ground
  // The train map's landmass colour, so the two maps of the same island agree.
  // Barely a step off the sea: enough to read a coastline, not enough to turn
  // the ground under the tracks into a second colour to look at.
  const LAND = "#ece5d6";
  const TRACK = "154, 74, 36";     // --accent, as multiply ink
  const TRACK_ALPHA = 0.2;
  const LINE_WIDTH = 1.1;          // CSS px, held constant across zoom
  const ZOOM_STEP = 1.6;
  // Px per degree of longitude, which is what k counts. Around 30 cm a pixel
  // at the latitudes here, so the closest zoom is a street either way.
  const MAX_K = 240000;
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

  // Land comes in two layers. "world" is coarse and global: it is what puts a
  // whole country on screen when you zoom out, instead of the rectangle of
  // coast that happened to be near the riding. "detail" is real coastline
  // around each ride area, each piece with the box it was cut from, drawn over
  // the world layer and clipped to that box. See assets/land.js.
  const landData = window.LAND_DATA || { world: [], detail: [] };
  const world = prepare(landData.world, []);
  const detail = landData.detail.map((piece) => ({
    box: piece.box,
    rings: prepare(piece.rings, []),
  }));

  // --- projection ----------------------------------------------------------

  // Web Mercator. This was equirectangular with longitudes squeezed by the
  // cosine of the view centre's latitude, which is right for one city and
  // wrong for a map you can drag across the world: the squeeze was recomputed
  // from wherever the centre had got to, so dragging north or south rescaled
  // every longitude on screen and the land stretched and squashed under the
  // cursor. Mercator is conformal — at any point the scale is the same in both
  // directions — so a shape keeps its shape however far you pan. The price is
  // that the far north comes out too big, which is the bargain every slippy
  // map makes and nothing here is anywhere near the pole.
  //
  // x is degrees of longitude and y is the Mercator ordinate in those same
  // units, which leaves k a single number: pixels per degree of longitude.
  const view = { lat: 0, lng: 0, k: 1000 };
  let width = 0, height = 0, dpr = 1;

  const DEG = 180 / Math.PI;
  const mercY = (lat) =>
    DEG * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI) / 360));
  const mercLat = (y) => 2 * DEG * Math.atan(Math.exp(y / DEG)) - 90;

  const toX = (lng) => (lng - view.lng) * view.k + width / 2;
  const toY = (lat) => (mercY(view.lat) - mercY(lat)) * view.k + height / 2;

  // The only thing a region button does. It sets a centre and a zoom, and the
  // map redraws from the one set of tracks and the one set of land it always
  // had — there is no per-region layer to switch to. The zoom is worked out
  // from the bounds and the stage rather than stored, so a region frames the
  // same on a phone as on a desktop.
  const fit = (bounds) => {
    const [minLat, minLng, maxLat, maxLng] = bounds;
    // Centred in projected space, not in latitude: half way up a region on
    // screen is not half way up it in degrees.
    const y0 = mercY(minLat);
    const y1 = mercY(maxLat);
    view.lat = mercLat((y0 + y1) / 2);
    view.lng = (minLng + maxLng) / 2;

    const spanY = Math.max(y1 - y0, 1e-4);
    const spanX = Math.max(maxLng - minLng, 1e-4);
    view.k = Math.min(
      (height * (1 - 2 * PAD)) / spanY,
      (width * (1 - 2 * PAD)) / spanX
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
    ctx.fillStyle = SEA;
    ctx.fillRect(0, 0, width, height);

    // Viewport in degrees, with a margin so a line crossing the edge still
    // draws the segment that enters the view.
    const halfY = height / 2 / view.k;
    const halfLng = width / 2 / view.k;
    const centreY = mercY(view.lat);
    const minLat = mercLat(centreY - halfY * 1.1);
    const maxLat = mercLat(centreY + halfY * 1.1);
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

    // All the rings of a layer go into one path and are filled nonzero, so
    // which way a ring is wound is what says land or water: counter-clockwise
    // encloses land, clockwise cuts a lake out of it. land.js does that when
    // it is generated so nothing here has to know what encloses what.
    //
    // Even-odd would not need the winding and was what this did first. It
    // cannot be used: the source coastline arrives cut into a grid of pieces
    // that meet along shared edges, and even-odd cancels the antialiasing
    // along a shared edge instead of adding it, which drew a pale hairline
    // right across the map at every whole degree of latitude.
    const fillRings = (rings) => {
      ctx.beginPath();
      for (let n = 0; n < rings.length; n++) {
        if (!visible(rings[n])) continue;
        trace(rings[n]);
        ctx.closePath();
      }
      ctx.fill();
    };

    // Land, under everything. Skip the world layer when a detail box already
    // covers the whole view, which is the case at any zoom close enough to see
    // a street: it would be painted over anyway, and tracing a ring the size of
    // Eurasia at street scale is not free on a drag.
    const covered = detail.some((piece) =>
      piece.box[0] <= minLat && piece.box[1] <= minLng &&
      piece.box[2] >= maxLat && piece.box[3] >= maxLng);

    ctx.fillStyle = LAND;
    if (!covered) fillRings(world);

    // Each detail box replaces the world layer inside itself rather than
    // adding to it. Clipping to the box and laying the sea down again first
    // means the coarse coastline is gone before the accurate one is drawn, so
    // the two never show as a double edge.
    for (let d = 0; d < detail.length; d++) {
      const box = detail[d].box;
      if (box[2] < minLat || box[0] > maxLat ||
          box[3] < minLng || box[1] > maxLng) continue;
      // Clamped to the canvas: a box seen from street level is millions of
      // pixels across, and there is no reason to hand those numbers to a path.
      const x0 = Math.max(0, toX(box[1]));
      const x1 = Math.min(width, toX(box[3]));
      const y0 = Math.max(0, toY(box[2]));
      const y1 = Math.min(height, toY(box[0]));
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, y0, x1 - x0, y1 - y0);
      ctx.clip();
      ctx.fillStyle = SEA;
      ctx.fillRect(x0, y0, x1 - x0, y1 - y0);
      ctx.fillStyle = LAND;
      fillRings(detail[d].rings);
      ctx.restore();
    }

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
    const lngAt = view.lng + (px - width / 2) / view.k;
    const yAt = mercY(view.lat) - (py - height / 2) / view.k;
    view.k = next;
    view.lng = lngAt - (px - width / 2) / view.k;
    view.lat = mercLat(yAt + (py - height / 2) / view.k);
    render();
  };

  // Never let the map zoom out past roughly the whole world. It used to be
  // that there was no reason to go anywhere near this far, since a zoomed-out
  // view was a scatter of specks on blank paper; with land under them the
  // specks are somewhere, and the whole of it is worth arriving at.
  //
  // 360 in both directions: the world is 360 degrees of longitude across, and
  // in Mercator's units it is about the same tall by the time it reaches the
  // latitudes where the projection gives up.
  const minZoom = () => Math.min(height, width) / 360;

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
    view.lng -= dx / view.k;
    view.lat = mercLat(mercY(view.lat) + dy / view.k);
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
      ArrowLeft: () => (view.lng -= step / view.k),
      ArrowRight: () => (view.lng += step / view.k),
      ArrowUp: () => (view.lat = mercLat(mercY(view.lat) + step / view.k)),
      ArrowDown: () => (view.lat = mercLat(mercY(view.lat) - step / view.k)),
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
