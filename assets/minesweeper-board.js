/*
 * The Minesweeper page: drawing, input, sizing, and the result card.
 * assets/minesweeper.js owns the rules and never touches the DOM; this file
 * owns the pixels and never decides anything about the game.
 *
 * The only thing passing between them is a list of changed cells, each with a
 * `wave` number. That goes on the element as --ms-wave and the stylesheet turns
 * it into an animation delay, which is why the reveal ripples outward without a
 * single timer in here.
 *
 * ES5 in an IIFE, like the rest of assets/.
 */
(function (global) {
  "use strict";

  var MS = global.Minesweeper;
  var board = document.getElementById("ms-board");
  if (!MS || !board) return;

  var LEVELS = [
    { id: "beginner", name: "Beginner", rows: 9, cols: 9, mines: 10 },
    { id: "intermediate", name: "Intermediate", rows: 16, cols: 16, mines: 40 },
    { id: "expert", name: "Expert", rows: 16, cols: 30, mines: 99 }
  ];

  // Past this the stagger stops reading as a ripple and starts reading as a
  // wait, so distant cells all land together on the last beat.
  var MAX_WAVE = 22;

  var el = {
    stage: document.getElementById("ms-stage"),
    levels: document.getElementById("ms-levels"),
    newGame: document.getElementById("ms-new"),
    flagMode: document.getElementById("ms-flag-mode"),
    mines: document.getElementById("ms-mines"),
    time: document.getElementById("ms-time"),
    best: document.getElementById("ms-best"),
    overlay: document.getElementById("ms-overlay"),
    eyebrow: document.getElementById("ms-overlay-eyebrow"),
    title: document.getElementById("ms-overlay-title"),
    detail: document.getElementById("ms-overlay-detail"),
    again: document.getElementById("ms-again"),
    dismiss: document.getElementById("ms-dismiss"),
    live: document.getElementById("ms-live")
  };

  var reduced = global.matchMedia
    ? global.matchMedia("(prefers-reduced-motion: reduce)")
    : { matches: false };

  var level = LEVELS[0];
  var game = null;
  var cells = [];
  var focusIndex = 0;
  var flagMode = false;
  var ticker = 0;
  var lastTime = "";
  var pendingFit = 0;

  /* ---------- storage ---------- */

  // Private browsing throws on both of these, and a stored best time is never
  // worth breaking the game over.
  function store(key, value) {
    try {
      global.localStorage.setItem(key, value);
    } catch (err) {}
  }

  function load(key) {
    try {
      return global.localStorage.getItem(key);
    } catch (err) {
      return null;
    }
  }

  /* ---------- formatting ---------- */

  function formatTime(ms) {
    var total = Math.floor(ms / 1000);
    var minutes = Math.floor(total / 60);
    var seconds = total % 60;
    return minutes + ":" + (seconds < 10 ? "0" : "") + seconds;
  }

  function icon(name) {
    var svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    var use = document.createElementNS("http://www.w3.org/2000/svg", "use");
    // The xlink form is what keeps <use> working in older Safari; the plain
    // href is what every current browser reads.
    use.setAttributeNS("http://www.w3.org/1999/xlink", "href", "#ms-icon-" + name);
    use.setAttribute("href", "#ms-icon-" + name);
    svg.appendChild(use);
    return svg;
  }

  function announce(message) {
    el.live.textContent = message;
  }

  /* ---------- building the grid ---------- */

  function buildBoard() {
    board.innerHTML = "";
    cells = new Array(game.size);

    board.style.setProperty("--ms-cols", game.cols);
    board.setAttribute("aria-rowcount", String(game.rows));
    board.setAttribute("aria-colcount", String(game.cols));

    var frag = document.createDocumentFragment();
    var r, c, index, row, cell, value;

    for (r = 0; r < game.rows; r++) {
      // A grid needs rows to be navigable; `display: contents` in the
      // stylesheet keeps them out of the layout so the cells stay direct grid
      // items.
      row = document.createElement("div");
      row.className = "ms-row";
      row.setAttribute("role", "row");
      for (c = 0; c < game.cols; c++) {
        index = r * game.cols + c;
        cell = document.createElement("button");
        cell.type = "button";
        cell.className = "ms-cell";
        cell.setAttribute("data-index", String(index));
        cell.setAttribute("role", "gridcell");
        cell.tabIndex = -1;
        value = document.createElement("span");
        value.className = "ms-v";
        cell.appendChild(value);
        describe(cell, index);
        cells[index] = cell;
        row.appendChild(cell);
      }
      frag.appendChild(row);
    }
    board.appendChild(frag);

    focusIndex = 0;
    cells[0].tabIndex = 0;
    fit();
  }

  function describe(cell, index) {
    var row = Math.floor(index / game.cols) + 1;
    var col = (index % game.cols) + 1;
    var state;
    if (game.flagged[index]) state = "flagged";
    else if (!game.revealed[index]) state = "covered";
    else if (game.mine[index]) state = "mine";
    else if (game.adj[index] === 0) state = "empty";
    else state = game.adj[index] + (game.adj[index] === 1 ? " mine nearby" : " mines nearby");
    cell.setAttribute("aria-label", "Row " + row + ", column " + col + ", " + state);
  }

  function paintCell(index) {
    var cell = cells[index];
    var value = cell.firstChild;
    value.textContent = "";

    cell.classList.toggle("is-revealed", !!game.revealed[index]);
    cell.classList.toggle("is-flagged", !!game.flagged[index]);

    var wrongFlag = game.status === MS.LOST && game.flagged[index] && !game.mine[index];
    cell.classList.toggle("is-wrong", !!wrongFlag);

    if (game.flagged[index]) {
      value.appendChild(icon("flag"));
    } else if (game.revealed[index] && game.mine[index]) {
      cell.classList.add("is-mine");
      cell.classList.toggle("is-boom", index === game.explodedIndex);
      value.appendChild(icon("mine"));
    } else if (game.revealed[index] && game.adj[index] > 0) {
      cell.setAttribute("data-n", String(game.adj[index]));
      value.textContent = String(game.adj[index]);
    }

    describe(cell, index);
  }

  /* ---------- applying a move ---------- */

  function apply(result) {
    if (!result) return;
    var i, change, cell;

    if (result.type === "nudge") {
      for (i = 0; i < result.changed.length; i++) {
        nudge(cells[result.changed[i].index]);
      }
      return;
    }

    for (i = 0; i < result.changed.length; i++) {
      change = result.changed[i];
      cell = cells[change.index];
      cell.style.setProperty("--ms-wave", String(Math.min(change.wave, MAX_WAVE)));
      // paintCell is about to wipe the flag, so leave a copy behind to fade
      // out. With motion off there is nothing to fade, so nothing is added.
      if (result.type === "unflag" && !reduced.matches) ghost(cell);
      paintCell(change.index);
    }

    updateHud();

    if (result.type === "lost") finish(false, result.changed);
    else if (result.type === "won") finish(true, result.changed);
    else if (game.status === MS.PLAYING) startTicker();
  }

  function nudge(cell) {
    cell.classList.remove("is-nudge");
    // Reading a layout property restarts the animation on a repeated click.
    void cell.offsetWidth;
    cell.classList.add("is-nudge");
    global.setTimeout(function () {
      cell.classList.remove("is-nudge");
    }, 300);
  }

  function ghost(cell) {
    var copy = cell.firstChild.cloneNode(true);
    copy.className = "ms-ghost";
    cell.appendChild(copy);
    global.setTimeout(function () {
      if (copy.parentNode) copy.parentNode.removeChild(copy);
    }, 260);
  }

  function finish(won, changed) {
    stopTicker();
    updateTimer();
    board.classList.add(won ? "is-won" : "is-lost");

    var i;
    if (won) {
      // A diagonal sweep over the whole board, not only the cells that moved.
      for (i = 0; i < cells.length; i++) {
        var wave = Math.floor(i / game.cols) + (i % game.cols);
        cells[i].style.setProperty("--ms-wave", String(Math.min(wave, MAX_WAVE)));
      }
    }

    var elapsed = game.elapsed();
    var record = false;
    if (won) {
      var key = "ms:best:" + level.id;
      var previous = parseInt(load(key), 10);
      // isNaN, not falsy: a small board can be cleared inside a millisecond,
      // and a stored 0 is a real record rather than an absent one.
      if (isNaN(previous) || elapsed < previous) {
        store(key, String(elapsed));
        record = true;
      }
    }
    updateBest();

    var longest = 0;
    for (i = 0; i < changed.length; i++) {
      longest = Math.max(longest, Math.min(changed[i].wave, MAX_WAVE));
    }
    var delay = reduced.matches ? 0 : 380 + longest * 26;
    global.setTimeout(function () {
      showOverlay(won, elapsed, record);
    }, delay);

    announce(
      won
        ? "Cleared in " + formatTime(elapsed) + (record ? ". New best time." : "")
        : "Boom. Game over."
    );
  }

  /* ---------- the counters ---------- */

  function updateHud() {
    el.mines.textContent = String(game.minesLeft());
    el.mines.parentNode.classList.toggle("is-negative", game.minesLeft() < 0);
    updateTimer();
  }

  function updateTimer() {
    var text = formatTime(game.elapsed());
    if (text === lastTime) return; // no DOM write four times a second
    lastTime = text;
    el.time.textContent = text;
  }

  function startTicker() {
    if (ticker) return;
    ticker = global.setInterval(updateTimer, 250);
  }

  function stopTicker() {
    if (!ticker) return;
    global.clearInterval(ticker);
    ticker = 0;
  }

  function updateBest() {
    var stored = parseInt(load("ms:best:" + level.id), 10);
    el.best.textContent = isNaN(stored) ? "—" : formatTime(stored);
  }

  /* ---------- the result card ---------- */

  function showOverlay(won, elapsed, record) {
    el.overlay.hidden = false;
    el.overlay.classList.toggle("is-won", won);
    el.eyebrow.textContent = level.name;
    el.title.textContent = won ? "Board cleared" : "That one was live";
    el.detail.textContent = won
      ? (record ? "New best: " + formatTime(elapsed) : "Time " + formatTime(elapsed))
      : "Every square you opened was a guess worth making.";
    // Focus lands here so Enter starts another game, and so a screen reader
    // reaches the result rather than the board it can no longer play.
    el.again.focus();
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  /* ---------- input ---------- */

  function cellFrom(node) {
    while (node && node !== board) {
      if (node.getAttribute && node.getAttribute("data-index") !== null) return node;
      node = node.parentNode;
    }
    return null;
  }

  function indexFrom(event) {
    var cell = cellFrom(event.target);
    return cell ? parseInt(cell.getAttribute("data-index"), 10) : -1;
  }

  function primary(index) {
    if (game.isOver()) return;
    setFocus(index);
    if (flagMode && !game.revealed[index]) {
      apply(game.toggleFlag(index));
      return;
    }
    if (game.revealed[index]) {
      apply(game.chord(index));
      return;
    }
    apply(game.reveal(index));
  }

  function secondary(index) {
    if (game.isOver()) return;
    setFocus(index);
    if (game.revealed[index]) {
      apply(game.chord(index));
      return;
    }
    apply(game.toggleFlag(index));
    if (global.navigator.vibrate) global.navigator.vibrate(8);
  }

  var press = { index: -1, timer: 0, fired: false, x: 0, y: 0 };

  function clearPress() {
    if (press.timer) global.clearTimeout(press.timer);
    press.timer = 0;
    press.index = -1;
  }

  board.addEventListener("pointerdown", function (event) {
    var index = indexFrom(event);
    if (index < 0) return;

    if (event.button === 1) {
      event.preventDefault();
      secondary(index);
      return;
    }
    if (event.button === 2) {
      secondary(index);
      return;
    }
    if (event.button !== 0) return;

    press = { index: index, timer: 0, fired: false, x: event.clientX, y: event.clientY };
    if (event.pointerType === "mouse") return;
    // Touch has no right button, so a held finger plants the flag.
    press.timer = global.setTimeout(function () {
      press.fired = true;
      secondary(index);
    }, 420);
  });

  board.addEventListener("pointermove", function (event) {
    if (!press.timer) return;
    if (Math.abs(event.clientX - press.x) > 10 || Math.abs(event.clientY - press.y) > 10) {
      clearPress();
    }
  });

  board.addEventListener("pointerup", function (event) {
    if (event.button !== 0) return;
    var index = indexFrom(event);
    var wasPressed = press.index;
    var fired = press.fired;
    clearPress();
    if (fired || index < 0 || index !== wasPressed) return;
    primary(index);
  });

  board.addEventListener("pointercancel", clearPress);
  board.addEventListener("pointerleave", clearPress);

  board.addEventListener("contextmenu", function (event) {
    event.preventDefault();
  });

  // Activating a <button> from the keyboard fires click with no pointer behind
  // it; detail === 0 is how that is told apart from the pointerup path above.
  board.addEventListener("click", function (event) {
    if (event.detail !== 0) return;
    var index = indexFrom(event);
    if (index >= 0) primary(index);
  });

  function setFocus(index) {
    if (index === focusIndex) return;
    cells[focusIndex].tabIndex = -1;
    focusIndex = index;
    cells[index].tabIndex = 0;
  }

  function moveFocus(dr, dc) {
    var row = Math.min(game.rows - 1, Math.max(0, Math.floor(focusIndex / game.cols) + dr));
    var col = Math.min(game.cols - 1, Math.max(0, (focusIndex % game.cols) + dc));
    setFocus(row * game.cols + col);
    cells[focusIndex].focus();
  }

  board.addEventListener("keydown", function (event) {
    var key = event.key;
    if (key === "ArrowUp") { event.preventDefault(); moveFocus(-1, 0); return; }
    if (key === "ArrowDown") { event.preventDefault(); moveFocus(1, 0); return; }
    if (key === "ArrowLeft") { event.preventDefault(); moveFocus(0, -1); return; }
    if (key === "ArrowRight") { event.preventDefault(); moveFocus(0, 1); return; }
    if (key === "Home") {
      event.preventDefault();
      setFocus(focusIndex - (focusIndex % game.cols));
      cells[focusIndex].focus();
      return;
    }
    if (key === "End") {
      event.preventDefault();
      setFocus(Math.floor(focusIndex / game.cols) * game.cols + game.cols - 1);
      cells[focusIndex].focus();
      return;
    }
    if (key === "f" || key === "F") {
      event.preventDefault();
      secondary(focusIndex);
    }
  });

  board.addEventListener("focusin", function (event) {
    var index = indexFrom(event);
    if (index >= 0) setFocus(index);
  });

  /* ---------- sizing ---------- */

  // Small enough that expert fits a phone at all, big enough to still be worth
  // aiming at. Below this the board scrolls sideways instead of shrinking.
  var MIN_CELL = 16;
  var MAX_CELL = 44;
  // 62rem. Past this a board is only bigger, not better, and the page starts
  // looking like a spreadsheet.
  var MAX_WIDTH = 992;

  /* Cells are laid out in whole pixels rather than fractions so they stay
     square and land on pixel boundaries — a fractional cell is what makes the
     hairlines between them shimmer while the page scrolls.

     The board is also allowed out of the text column. Prose wants 38rem; a
     thirty-wide grid squeezed into that has smaller cells than the sixteen-wide
     one, which is how expert ended up looking smaller than intermediate. So the
     width comes from the page rather than from the column, and the board hangs
     out over both margins when it needs to. */
  function fit() {
    var column = el.stage.parentNode;
    var pagePad = 2 * parseFloat(global.getComputedStyle(document.body).paddingLeft);
    // clientWidth excludes the scrollbar, so this can never overflow sideways.
    var available = Math.min(document.documentElement.clientWidth - pagePad, MAX_WIDTH);
    // Whatever is left below the header and the controls, so a fresh board is
    // visible without scrolling to find its bottom row. Measured against the
    // document rather than the viewport so that scrolling the page does not
    // resize the board under the player. The floor matters on a short window,
    // where honouring this literally would leave a grid of specks.
    var top = el.stage.getBoundingClientRect().top + (global.pageYOffset || 0);
    var height = Math.max(320, global.innerHeight - top - 20);

    // Each cell carries the lattice in its own right and bottom border and the
    // board closes the top and left, so a board is exactly cols * cell + 1.
    var size = Math.floor(
      Math.min((available - 1) / game.cols, (height - 1) / game.rows)
    );
    size = Math.max(MIN_CELL, Math.min(MAX_CELL, size));
    board.style.setProperty("--ms-cell", size + "px");

    // The visible box is the board, or as much of it as fits. Anything wider
    // than that scrolls inside the box rather than pushing the page sideways.
    var boardWidth = game.cols * size + 1;
    var box = Math.min(boardWidth, available);
    var margin = Math.round((column.clientWidth - box) / 2);
    el.stage.style.width = box + "px";
    el.stage.style.marginLeft = margin + "px";
    el.stage.style.marginRight = margin + "px";
    // Panning is invisible until you try it, and a board with its right-hand
    // columns off-screen otherwise just looks broken.
    document.body.classList.toggle("ms-panning", boardWidth > box);
  }

  function scheduleFit() {
    if (pendingFit) return;
    pendingFit = global.requestAnimationFrame(function () {
      pendingFit = 0;
      if (game) fit();
    });
  }

  global.addEventListener("resize", scheduleFit);
  global.addEventListener("orientationchange", scheduleFit);

  /* ---------- games and levels ---------- */

  function newGame() {
    stopTicker();
    lastTime = "";
    hideOverlay();
    board.classList.remove("is-won");
    board.classList.remove("is-lost");
    game = new MS.Game(level.rows, level.cols, level.mines);
    buildBoard();
    el.time.textContent = "0:00";
    updateHud();
    updateBest();
  }

  function selectLevel(id) {
    var found = null;
    var i;
    for (i = 0; i < LEVELS.length; i++) {
      if (LEVELS[i].id === id) found = LEVELS[i];
    }
    if (!found) return;
    level = found;
    store("ms:level", id);

    var buttons = el.levels.getElementsByTagName("button");
    for (i = 0; i < buttons.length; i++) {
      buttons[i].setAttribute(
        "aria-checked",
        String(buttons[i].getAttribute("data-level") === id)
      );
    }
    newGame();
  }

  function buildLevels() {
    for (var i = 0; i < LEVELS.length; i++) {
      (function (item) {
        var button = document.createElement("button");
        button.type = "button";
        button.className = "ms-seg";
        button.setAttribute("data-level", item.id);
        button.setAttribute("role", "radio");
        button.setAttribute("aria-checked", "false");
        button.textContent = item.name;
        button.addEventListener("click", function () {
          selectLevel(item.id);
        });
        el.levels.appendChild(button);
      })(LEVELS[i]);
    }
  }

  /* ---------- wiring ---------- */

  function setFlagMode(on) {
    flagMode = on;
    el.flagMode.setAttribute("aria-pressed", String(on));
    document.body.classList.toggle("ms-flagging", on);
    announce(on ? "Flag mode on" : "Flag mode off");
  }

  el.flagMode.addEventListener("click", function () {
    setFlagMode(!flagMode);
  });

  el.newGame.addEventListener("click", function () {
    newGame();
    cells[focusIndex].focus();
  });

  el.again.addEventListener("click", function () {
    newGame();
    cells[0].focus();
  });

  el.dismiss.addEventListener("click", function () {
    hideOverlay();
    el.newGame.focus();
  });

  document.addEventListener("keydown", function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    var tag = document.activeElement ? document.activeElement.tagName : "";
    if (tag === "INPUT" || tag === "TEXTAREA") return;

    if (event.key === "Escape" && !el.overlay.hidden) {
      hideOverlay();
      el.newGame.focus();
      return;
    }
    if (event.key === "n" || event.key === "N") {
      newGame();
      return;
    }
    // F inside the board flags the focused cell instead, so it is only the
    // mode toggle out here.
    if ((event.key === "f" || event.key === "F") && !board.contains(document.activeElement)) {
      setFlagMode(!flagMode);
    }
  });

  // The tab can sit paused for minutes; catch the clock up on the way back.
  document.addEventListener("visibilitychange", function () {
    if (!document.hidden && game && game.status === MS.PLAYING) updateTimer();
  });

  buildLevels();
  selectLevel(load("ms:level") || "beginner");
})(window);
