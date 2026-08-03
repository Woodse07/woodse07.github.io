/* Board rendering and input.
 *
 * The engine in game.js owns the truth; this file owns the pixels. Every
 * mutation comes back as a list of changed cells, and each of those gets a
 * `--wave` custom property that CSS turns into an animation delay. That is the
 * whole trick behind the rippling reveal: no JavaScript timing loops, one
 * number per cell.
 */
(function (global) {
  'use strict';

  const MS = global.MS;

  const LEVELS = [
    { id: 'beginner', name: 'Beginner', rows: 9, cols: 9, mines: 10 },
    { id: 'intermediate', name: 'Intermediate', rows: 16, cols: 16, mines: 40 },
    { id: 'expert', name: 'Expert', rows: 16, cols: 30, mines: 99 },
    { id: 'custom', name: 'Custom', rows: 12, cols: 18, mines: 30 }
  ];

  const LIMITS = { rows: [5, 24], cols: [5, 40], mines: [1, 999] };

  // Past this the stagger stops feeling like a ripple and starts feeling like
  // waiting, so distant cells all land together on the last beat.
  const MAX_WAVE = 22;

  const el = {
    board: document.getElementById('board'),
    boardWrap: document.getElementById('board-wrap'),
    mineCount: document.getElementById('mine-count'),
    timer: document.getElementById('timer'),
    best: document.getElementById('best'),
    levels: document.getElementById('levels'),
    custom: document.getElementById('custom'),
    customRows: document.getElementById('custom-rows'),
    customCols: document.getElementById('custom-cols'),
    customMines: document.getElementById('custom-mines'),
    customApply: document.getElementById('custom-apply'),
    newGame: document.getElementById('new-game'),
    flagMode: document.getElementById('flag-mode'),
    themes: document.getElementById('themes'),
    overlay: document.getElementById('overlay'),
    overlayEyebrow: document.getElementById('overlay-eyebrow'),
    overlayTitle: document.getElementById('overlay-title'),
    overlayDetail: document.getElementById('overlay-detail'),
    overlayAgain: document.getElementById('overlay-again'),
    overlayDismiss: document.getElementById('overlay-dismiss'),
    live: document.getElementById('live')
  };

  const reduceMotion = global.matchMedia
    ? global.matchMedia('(prefers-reduced-motion: reduce)')
    : { matches: false };

  let level = LEVELS[0];
  let game = null;
  let cells = [];
  let focusIndex = 0;
  let flagMode = false;
  let ticker = 0;
  let lastTimerText = '';
  let pendingFit = 0;

  /* ---------- storage ---------- */

  function store(key, value) {
    try { global.localStorage.setItem(key, value); } catch (err) { /* private mode */ }
  }

  function load(key) {
    try { return global.localStorage.getItem(key); } catch (err) { return null; }
  }

  function bestKey(config) {
    return 'ms:best:' + config.id + (config.id === 'custom'
      ? ':' + config.rows + 'x' + config.cols + ':' + config.mines
      : '');
  }

  /* ---------- formatting ---------- */

  function formatTime(ms) {
    const total = Math.floor(ms / 1000);
    const minutes = Math.floor(total / 60);
    const seconds = total % 60;
    return minutes + ':' + (seconds < 10 ? '0' : '') + seconds;
  }

  function icon(name) {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('aria-hidden', 'true');
    svg.setAttribute('focusable', 'false');
    const use = document.createElementNS('http://www.w3.org/2000/svg', 'use');
    // setAttributeNS with the xlink namespace is what keeps <use> working in
    // Safari when the sprite is inlined further up the document.
    use.setAttributeNS('http://www.w3.org/1999/xlink', 'href', '#icon-' + name);
    use.setAttribute('href', '#icon-' + name);
    svg.appendChild(use);
    return svg;
  }

  function announce(message) {
    el.live.textContent = message;
  }

  /* ---------- board construction ---------- */

  function buildBoard() {
    el.board.textContent = '';
    cells = new Array(game.size);

    el.board.style.setProperty('--cols', game.cols);
    el.board.style.setProperty('--rows', game.rows);
    el.board.setAttribute('aria-rowcount', String(game.rows));
    el.board.setAttribute('aria-colcount', String(game.cols));

    const frag = document.createDocumentFragment();
    for (let r = 0; r < game.rows; r++) {
      // A grid needs rows to be navigable; `display: contents` keeps them out
      // of the layout so the CSS grid still sees every cell directly.
      const row = document.createElement('div');
      row.className = 'row';
      row.setAttribute('role', 'row');
      for (let c = 0; c < game.cols; c++) {
        const index = r * game.cols + c;
        const cell = document.createElement('button');
        cell.type = 'button';
        cell.className = 'cell';
        cell.dataset.index = String(index);
        cell.setAttribute('role', 'gridcell');
        cell.tabIndex = -1;
        const value = document.createElement('span');
        value.className = 'v';
        cell.appendChild(value);
        describe(cell, index);
        cells[index] = cell;
        row.appendChild(cell);
      }
      frag.appendChild(row);
    }
    el.board.appendChild(frag);

    focusIndex = 0;
    cells[0].tabIndex = 0;
    fit();
  }

  function describe(cell, index) {
    const row = (index / game.cols | 0) + 1;
    const col = (index % game.cols) + 1;
    let state;
    if (game.flagged[index]) state = 'flagged';
    else if (!game.revealed[index]) state = 'covered';
    else if (game.mine[index]) state = 'mine';
    else if (game.adj[index] === 0) state = 'empty';
    else state = game.adj[index] + (game.adj[index] === 1 ? ' mine nearby' : ' mines nearby');
    cell.setAttribute('aria-label', 'Row ' + row + ', column ' + col + ', ' + state);
  }

  function paintCell(index) {
    const cell = cells[index];
    const value = cell.firstChild;
    value.textContent = '';

    cell.classList.toggle('is-revealed', !!game.revealed[index]);
    cell.classList.toggle('is-flagged', !!game.flagged[index]);

    const wrongFlag = game.status === MS.LOST && game.flagged[index] && !game.mine[index];
    cell.classList.toggle('is-wrong', !!wrongFlag);

    if (game.flagged[index]) {
      value.appendChild(icon('flag'));
    } else if (game.revealed[index] && game.mine[index]) {
      cell.classList.add('is-mine');
      cell.classList.toggle('is-boom', index === game.explodedIndex);
      value.appendChild(icon('mine'));
    } else if (game.revealed[index] && game.adj[index] > 0) {
      cell.dataset.n = String(game.adj[index]);
      value.textContent = String(game.adj[index]);
    }

    describe(cell, index);
  }

  /* ---------- applying a move ---------- */

  function apply(result) {
    if (!result) return;

    if (result.type === 'nudge') {
      result.changed.forEach(function (change) {
        const cell = cells[change.index];
        cell.classList.remove('is-nudge');
        void cell.offsetWidth; // restart the animation on a repeated click
        cell.classList.add('is-nudge');
        global.setTimeout(function () { cell.classList.remove('is-nudge'); }, 300);
      });
      return;
    }

    result.changed.forEach(function (change) {
      const cell = cells[change.index];
      cell.style.setProperty('--wave', String(Math.min(change.wave, MAX_WAVE)));
      // paintCell is about to wipe the flag, so leave a copy behind to fade
      // out. Nothing to fade when motion is off, so nothing is added.
      if (result.type === 'unflag' && !reduceMotion.matches) {
        const ghost = cell.firstChild.cloneNode(true);
        ghost.className = 'ghost';
        cell.appendChild(ghost);
        global.setTimeout(function () {
          if (ghost.parentNode) ghost.parentNode.removeChild(ghost);
        }, 260);
      }
      paintCell(change.index);
    });

    updateHud();

    if (result.type === 'lost') finish(false, result.changed);
    else if (result.type === 'won') finish(true, result.changed);
    else if (game.status === MS.PLAYING) startTicker();
  }

  function finish(won, changed) {
    stopTicker();
    updateTimer();
    el.board.classList.add(won ? 'is-won' : 'is-lost');

    if (won) {
      // A diagonal sweep across the whole board, not just the cells that moved.
      for (let i = 0; i < cells.length; i++) {
        const wave = (i / game.cols | 0) + (i % game.cols);
        cells[i].style.setProperty('--wave', String(Math.min(wave, MAX_WAVE)));
      }
    }

    const elapsed = game.elapsed();
    let record = false;
    if (won) {
      const key = bestKey(level);
      const previous = parseInt(load(key), 10);
      // isNaN, not falsy: a tiny board can be cleared inside a millisecond, and
      // a stored 0 is a real record rather than an absent one.
      if (isNaN(previous) || elapsed < previous) {
        store(key, String(elapsed));
        record = true;
      }
    }
    updateBest();

    let longest = 0;
    changed.forEach(function (change) { longest = Math.max(longest, Math.min(change.wave, MAX_WAVE)); });
    const delay = reduceMotion.matches ? 0 : 420 + longest * 26;
    global.setTimeout(function () { showOverlay(won, elapsed, record); }, delay);

    announce(won
      ? 'Cleared in ' + formatTime(elapsed) + (record ? '. New best time.' : '')
      : 'Boom. Game over.');
  }

  /* ---------- HUD ---------- */

  function updateHud() {
    el.mineCount.textContent = String(game.minesLeft);
    el.mineCount.parentNode.classList.toggle('is-negative', game.minesLeft < 0);
    updateTimer();
  }

  function updateTimer() {
    const text = formatTime(game.elapsed());
    if (text === lastTimerText) return; // avoid a DOM write four times a second
    lastTimerText = text;
    el.timer.textContent = text;
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
    const stored = parseInt(load(bestKey(level)), 10);
    el.best.textContent = isNaN(stored) ? '—' : formatTime(stored);
  }

  /* ---------- overlay ---------- */

  function showOverlay(won, elapsed, record) {
    el.overlay.hidden = false;
    el.overlay.classList.toggle('is-won', won);
    el.overlayEyebrow.textContent = level.name;
    el.overlayTitle.textContent = won ? 'Board cleared' : 'That one was live';
    el.overlayDetail.textContent = won
      ? (record ? 'New best: ' + formatTime(elapsed) : 'Time ' + formatTime(elapsed))
      : 'Every square you opened was a guess worth making.';
    // Moving focus here means Enter restarts, and a screen reader lands on the
    // result instead of the board it can no longer play.
    el.overlayAgain.focus();
  }

  function hideOverlay() {
    el.overlay.hidden = true;
  }

  /* ---------- input ---------- */

  function indexFromEvent(event) {
    const cell = event.target.closest ? event.target.closest('.cell') : null;
    if (!cell) return -1;
    return parseInt(cell.dataset.index, 10);
  }

  function primary(index) {
    if (game.over) return;
    setFocus(index);
    if (flagMode && !game.revealed[index]) return apply(game.toggleFlag(index));
    if (game.revealed[index]) return apply(game.chord(index));
    apply(game.reveal(index));
  }

  function secondary(index) {
    if (game.over) return;
    setFocus(index);
    if (game.revealed[index]) return apply(game.chord(index));
    apply(game.toggleFlag(index));
    if (global.navigator.vibrate) global.navigator.vibrate(8);
  }

  let press = { index: -1, timer: 0, fired: false, x: 0, y: 0 };

  function clearPress() {
    if (press.timer) global.clearTimeout(press.timer);
    press.timer = 0;
    press.index = -1;
  }

  el.board.addEventListener('pointerdown', function (event) {
    const index = indexFromEvent(event);
    if (index < 0) return;

    if (event.button === 1) { event.preventDefault(); secondary(index); return; }
    if (event.button === 2) { secondary(index); return; }
    if (event.button !== 0) return;

    press = { index: index, timer: 0, fired: false, x: event.clientX, y: event.clientY };
    if (event.pointerType === 'mouse') return;
    // Touch has no right button, so a held finger plants the flag.
    press.timer = global.setTimeout(function () {
      press.fired = true;
      secondary(index);
    }, 420);
  });

  el.board.addEventListener('pointermove', function (event) {
    if (!press.timer) return;
    if (Math.abs(event.clientX - press.x) > 10 || Math.abs(event.clientY - press.y) > 10) clearPress();
  });

  el.board.addEventListener('pointerup', function (event) {
    if (event.button !== 0) return;
    const index = indexFromEvent(event);
    const wasPressed = press.index;
    const fired = press.fired;
    clearPress();
    if (fired || index < 0 || index !== wasPressed) return;
    primary(index);
  });

  el.board.addEventListener('pointercancel', clearPress);
  el.board.addEventListener('pointerleave', clearPress);
  el.board.addEventListener('contextmenu', function (event) { event.preventDefault(); });

  // Keyboard activation of a <button> fires click with no pointer behind it;
  // detail === 0 is how we tell it apart from the pointerup path above.
  el.board.addEventListener('click', function (event) {
    if (event.detail !== 0) return;
    const index = indexFromEvent(event);
    if (index >= 0) primary(index);
  });

  function setFocus(index) {
    if (index === focusIndex) return;
    cells[focusIndex].tabIndex = -1;
    focusIndex = index;
    cells[index].tabIndex = 0;
  }

  function moveFocus(dr, dc) {
    const row = Math.min(game.rows - 1, Math.max(0, (focusIndex / game.cols | 0) + dr));
    const col = Math.min(game.cols - 1, Math.max(0, (focusIndex % game.cols) + dc));
    setFocus(row * game.cols + col);
    cells[focusIndex].focus();
  }

  el.board.addEventListener('keydown', function (event) {
    const moves = {
      ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1]
    };
    if (moves[event.key]) {
      event.preventDefault();
      moveFocus(moves[event.key][0], moves[event.key][1]);
      return;
    }
    if (event.key === 'Home') { event.preventDefault(); setFocus(focusIndex - focusIndex % game.cols); cells[focusIndex].focus(); return; }
    if (event.key === 'End') { event.preventDefault(); setFocus((focusIndex / game.cols | 0) * game.cols + game.cols - 1); cells[focusIndex].focus(); return; }
    if (event.key === 'f' || event.key === 'F') {
      event.preventDefault();
      secondary(focusIndex);
    }
  });

  el.board.addEventListener('focusin', function (event) {
    const index = indexFromEvent(event);
    if (index >= 0) setFocus(index);
  });

  /* ---------- sizing ---------- */

  /* The board is laid out in real pixels rather than fractions so that cells
   * stay square and land on whole pixels — a fractional cell size is what makes
   * the hairline gaps between tiles shimmer while scrolling. */
  function fit() {
    const wrap = el.boardWrap;
    const styles = global.getComputedStyle(wrap);
    const availableWidth = wrap.clientWidth
      - parseFloat(styles.paddingLeft) - parseFloat(styles.paddingRight);
    const top = wrap.getBoundingClientRect().top;
    // Leave the footer controls on screen; the board shrinks before they go.
    const availableHeight = global.innerHeight - top - 96;

    let size = Math.min(availableWidth / game.cols, availableHeight / game.rows);
    const gap = size >= 26 ? 3 : size >= 18 ? 2 : 1;
    size = Math.floor(Math.min(
      (availableWidth - gap * (game.cols - 1)) / game.cols,
      (availableHeight - gap * (game.rows - 1)) / game.rows
    ));
    size = Math.max(16, Math.min(48, size));

    el.board.style.setProperty('--cell', size + 'px');
    el.board.style.setProperty('--gap', gap + 'px');
  }

  function scheduleFit() {
    if (pendingFit) return;
    pendingFit = global.requestAnimationFrame(function () {
      pendingFit = 0;
      if (game) fit();
    });
  }

  global.addEventListener('resize', scheduleFit);
  global.addEventListener('orientationchange', scheduleFit);

  /* ---------- new game ---------- */

  function newGame() {
    stopTicker();
    lastTimerText = '';
    hideOverlay();
    el.board.classList.remove('is-won', 'is-lost');
    game = new MS.Game(level.rows, level.cols, level.mines);
    buildBoard();
    el.timer.textContent = '0:00';
    updateHud();
    updateBest();
  }

  function selectLevel(id, options) {
    const found = LEVELS.filter(function (item) { return item.id === id; })[0];
    if (!found) return;
    level = found;
    store('ms:level', id);
    Array.prototype.forEach.call(el.levels.querySelectorAll('.seg'), function (button) {
      button.setAttribute('aria-checked', String(button.dataset.level === id));
    });
    el.custom.hidden = id !== 'custom';
    if (!options || !options.keepBoard) newGame();
  }

  function buildLevels() {
    LEVELS.forEach(function (item) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'seg';
      button.dataset.level = item.id;
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', 'false');
      button.textContent = item.name;
      button.addEventListener('click', function () { selectLevel(item.id); });
      el.levels.appendChild(button);
    });
  }

  function clampInput(input, range) {
    const value = parseInt(input.value, 10);
    if (isNaN(value)) return range[0];
    return Math.max(range[0], Math.min(range[1], value));
  }

  function applyCustom() {
    const custom = LEVELS[3];
    custom.rows = clampInput(el.customRows, LIMITS.rows);
    custom.cols = clampInput(el.customCols, LIMITS.cols);
    // Nine cells are reserved for the safe opening, so that is the real ceiling.
    custom.mines = Math.max(1, Math.min(clampInput(el.customMines, LIMITS.mines), custom.rows * custom.cols - 9));
    el.customRows.value = custom.rows;
    el.customCols.value = custom.cols;
    el.customMines.value = custom.mines;
    store('ms:custom', custom.rows + ',' + custom.cols + ',' + custom.mines);
    newGame();
  }

  function restoreCustom() {
    const saved = (load('ms:custom') || '').split(',').map(Number);
    if (saved.length !== 3 || saved.some(isNaN)) return;
    const custom = LEVELS[3];
    custom.rows = saved[0];
    custom.cols = saved[1];
    custom.mines = saved[2];
  }

  /* ---------- wiring ---------- */

  function setFlagMode(on) {
    flagMode = on;
    el.flagMode.setAttribute('aria-pressed', String(on));
    document.body.classList.toggle('flag-mode', on);
    announce(on ? 'Flag mode on' : 'Flag mode off');
  }

  el.flagMode.addEventListener('click', function () { setFlagMode(!flagMode); });
  el.newGame.addEventListener('click', function () { newGame(); cells[focusIndex].focus(); });
  el.customApply.addEventListener('click', applyCustom);
  el.custom.addEventListener('submit', function (event) { event.preventDefault(); applyCustom(); });
  el.overlayAgain.addEventListener('click', function () { newGame(); cells[0].focus(); });
  el.overlayDismiss.addEventListener('click', function () { hideOverlay(); el.newGame.focus(); });

  document.addEventListener('keydown', function (event) {
    if (event.metaKey || event.ctrlKey || event.altKey) return;
    const tag = document.activeElement ? document.activeElement.tagName : '';
    if (tag === 'INPUT') return;

    if (event.key === 'Escape' && !el.overlay.hidden) { hideOverlay(); el.newGame.focus(); return; }
    if (event.key === 'n' || event.key === 'N') { newGame(); return; }
    // F on the board flags the focused cell instead, so only handle it here.
    if ((event.key === 'f' || event.key === 'F') && !el.board.contains(document.activeElement)) {
      setFlagMode(!flagMode);
    }
  });

  // The tab can sit paused for minutes; catch the clock up on the way back.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden && game && game.status === MS.PLAYING) updateTimer();
  });

  MS.Themes.build(el.themes);
  buildLevels();
  restoreCustom();
  el.customRows.value = LEVELS[3].rows;
  el.customCols.value = LEVELS[3].cols;
  el.customMines.value = LEVELS[3].mines;
  selectLevel(load('ms:level') || 'beginner');
})(window);
