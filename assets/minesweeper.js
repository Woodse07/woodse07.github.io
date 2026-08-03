/*
 * Minesweeper rules. Board state, flood fill, chording, win and loss — and no
 * DOM at all: this file could be run in Node and never notice. Everything the
 * page needs to draw comes back from the methods below.
 *
 * Each move returns { type, changed }, where changed is a list of
 * { index, wave }. `wave` is the ripple distance from whatever the player just
 * did, and minesweeper-board.js hands it straight to CSS as an animation delay.
 * That is the whole mechanism behind the staggered reveal: one integer per
 * cell, no timers on this side of the line.
 *
 * ES5 in an IIFE, like the rest of assets/ — this runs on every visitor's
 * browser and has no library underneath it to raise the floor.
 */
(function (global) {
  "use strict";

  var READY = "ready";
  var PLAYING = "playing";
  var WON = "won";
  var LOST = "lost";

  function filled(size) {
    var out = new Array(size);
    for (var i = 0; i < size; i++) out[i] = 0;
    return out;
  }

  function Game(rows, cols, mines) {
    this.rows = rows;
    this.cols = cols;
    this.size = rows * cols;
    // The first click clears a 3x3 pocket, so that many cells can never hold a
    // mine. Clamping here means a silly board degrades instead of spinning
    // forever in the placement loop.
    this.mines = Math.max(1, Math.min(mines, this.size - 9));

    this.mine = filled(this.size);
    this.adj = filled(this.size);
    this.revealed = filled(this.size);
    this.flagged = filled(this.size);

    this.status = READY;
    this.revealedCount = 0;
    this.flagCount = 0;
    this.explodedIndex = -1;
    this.startedAt = 0;
    this.endedAt = 0;
  }

  Game.prototype.isOver = function () {
    return this.status === WON || this.status === LOST;
  };

  Game.prototype.minesLeft = function () {
    return this.mines - this.flagCount;
  };

  /* Milliseconds since the first reveal, frozen once the game ends. */
  Game.prototype.elapsed = function () {
    if (this.status === READY) return 0;
    return (this.endedAt || Date.now()) - this.startedAt;
  };

  Game.prototype.rowOf = function (index) {
    return Math.floor(index / this.cols);
  };

  Game.prototype.colOf = function (index) {
    return index % this.cols;
  };

  Game.prototype.neighbours = function (index) {
    var row = this.rowOf(index);
    var col = this.colOf(index);
    var out = [];
    var dr, dc, r, c;
    for (dr = -1; dr <= 1; dr++) {
      r = row + dr;
      if (r < 0 || r >= this.rows) continue;
      for (dc = -1; dc <= 1; dc++) {
        if (dr === 0 && dc === 0) continue;
        c = col + dc;
        if (c < 0 || c >= this.cols) continue;
        out.push(r * this.cols + c);
      }
    }
    return out;
  };

  /* Mines are laid after the first click, never before: that is what makes the
     opening move safe and guarantees it opens into a pocket rather than a lone
     "1" with nothing to go on. */
  Game.prototype.placeMines = function (safeIndex) {
    var banned = {};
    var around = this.neighbours(safeIndex);
    var i, n, pick, tmp;

    banned[safeIndex] = true;
    for (n = 0; n < around.length; n++) banned[around[n]] = true;

    var pool = [];
    for (i = 0; i < this.size; i++) {
      if (!banned[i]) pool.push(i);
    }

    // Partial Fisher-Yates: only shuffle as far as we need to draw.
    for (n = 0; n < this.mines; n++) {
      pick = n + Math.floor(Math.random() * (pool.length - n));
      tmp = pool[n];
      pool[n] = pool[pick];
      pool[pick] = tmp;
      this.mine[pool[n]] = 1;
    }

    for (i = 0; i < this.size; i++) {
      if (this.mine[i]) continue;
      var count = 0;
      var ring = this.neighbours(i);
      for (n = 0; n < ring.length; n++) {
        if (this.mine[ring[n]]) count++;
      }
      this.adj[i] = count;
    }
  };

  Game.prototype.reveal = function (index) {
    if (this.isOver() || this.revealed[index] || this.flagged[index]) return null;

    if (this.status === READY) {
      this.placeMines(index);
      this.status = PLAYING;
      this.startedAt = Date.now();
    }

    if (this.mine[index]) return this.explode(index);

    var changed = this.flood(index);
    var win = this.checkWin();
    if (win) {
      win.changed = changed.concat(win.changed);
      return win;
    }
    return { type: "reveal", changed: changed };
  };

  /* Breadth-first, so `wave` comes out as the ring number: cell 0 is the one
     clicked, then each expanding ring. Empty cells open their neighbours;
     numbered cells are the wall the flood stops at. */
  Game.prototype.flood = function (origin) {
    var changed = [];
    var seen = filled(this.size);
    var frontier = [origin];
    var wave = 0;
    var i, n, index, ring, nb, next;

    seen[origin] = 1;

    while (frontier.length) {
      next = [];
      for (i = 0; i < frontier.length; i++) {
        index = frontier[i];
        if (this.revealed[index]) continue;
        this.revealed[index] = 1;
        this.revealedCount++;
        // A flag left on a cell we just opened would leave the counter lying.
        if (this.flagged[index]) {
          this.flagged[index] = 0;
          this.flagCount--;
        }
        changed.push({ index: index, wave: wave });

        if (this.adj[index] !== 0) continue;
        ring = this.neighbours(index);
        for (n = 0; n < ring.length; n++) {
          nb = ring[n];
          if (seen[nb] || this.revealed[nb] || this.mine[nb]) continue;
          seen[nb] = 1;
          next.push(nb);
        }
      }
      frontier = next;
      wave++;
    }
    return changed;
  };

  Game.prototype.toggleFlag = function (index) {
    if (this.isOver() || this.revealed[index]) return null;
    if (this.flagged[index]) {
      this.flagged[index] = 0;
      this.flagCount--;
      return { type: "unflag", changed: [{ index: index, wave: 0 }] };
    }
    this.flagged[index] = 1;
    this.flagCount++;
    return { type: "flag", changed: [{ index: index, wave: 0 }] };
  };

  /* Clicking a satisfied number opens everything around it. When the flags do
     not add up we return a `nudge` rather than doing nothing, so the page can
     say "not yet" with a wobble instead of swallowing the click. */
  Game.prototype.chord = function (index) {
    if (this.isOver() || !this.revealed[index] || this.adj[index] === 0) return null;

    var ring = this.neighbours(index);
    var flags = 0;
    var targets = [];
    var n, nb;

    for (n = 0; n < ring.length; n++) {
      nb = ring[n];
      if (this.flagged[nb]) flags++;
      else if (!this.revealed[nb]) targets.push(nb);
    }

    if (flags !== this.adj[index]) {
      var wobble = [];
      for (n = 0; n < ring.length; n++) {
        if (!this.revealed[ring[n]]) wobble.push({ index: ring[n], wave: 0 });
      }
      return { type: "nudge", changed: wobble };
    }
    if (!targets.length) return null;

    var changed = [];
    for (n = 0; n < targets.length; n++) {
      var target = targets[n];
      if (this.mine[target]) {
        var boom = this.explode(target);
        boom.changed = changed.concat(boom.changed);
        return boom;
      }
      if (!this.revealed[target]) changed = changed.concat(this.flood(target));
    }

    var win = this.checkWin();
    if (win) {
      win.changed = changed.concat(win.changed);
      return win;
    }
    return { type: "reveal", changed: changed };
  };

  Game.prototype.checkWin = function () {
    if (this.revealedCount !== this.size - this.mines) return null;

    this.status = WON;
    this.endedAt = Date.now();

    // Plant the last flags for the player: a won board should read as solved.
    var changed = [];
    for (var i = 0; i < this.size; i++) {
      if (this.mine[i] && !this.flagged[i]) {
        this.flagged[i] = 1;
        this.flagCount++;
        changed.push({ index: i, wave: 0 });
      }
    }
    return { type: "won", changed: changed };
  };

  Game.prototype.explode = function (index) {
    this.status = LOST;
    this.endedAt = Date.now();
    this.explodedIndex = index;

    // Ripple outward from the mine that went off. Chebyshev distance is the
    // right metric here because a cell's eight neighbours are all one step away.
    var originRow = this.rowOf(index);
    var originCol = this.colOf(index);
    var changed = [];
    for (var i = 0; i < this.size; i++) {
      var wrongFlag = this.flagged[i] && !this.mine[i];
      if (!this.mine[i] && !wrongFlag) continue;
      if (this.mine[i] && this.flagged[i]) continue; // correctly flagged, leave it be
      if (this.mine[i]) this.revealed[i] = 1;
      var wave = Math.max(
        Math.abs(this.rowOf(i) - originRow),
        Math.abs(this.colOf(i) - originCol)
      );
      changed.push({ index: i, wave: i === index ? 0 : wave });
    }
    return { type: "lost", changed: changed };
  };

  global.Minesweeper = {
    Game: Game,
    READY: READY,
    PLAYING: PLAYING,
    WON: WON,
    LOST: LOST
  };
})(window);
