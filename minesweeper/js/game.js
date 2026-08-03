/* Minesweeper engine.
 *
 * Pure state — it never touches the DOM. Every mutating method returns a list
 * of `{ index, wave }` changes so the UI can animate exactly the cells that
 * moved instead of repainting the whole board. `wave` is the ripple distance
 * from whatever the player did, which is what staggers the reveal animation.
 */
(function (global) {
  'use strict';

  const READY = 'ready';
  const PLAYING = 'playing';
  const WON = 'won';
  const LOST = 'lost';

  class Game {
    constructor(rows, cols, mines) {
      this.rows = rows;
      this.cols = cols;
      this.size = rows * cols;
      // The first click clears a 3x3 pocket, so that many cells can never hold
      // a mine. Clamping here means a silly custom setup degrades instead of
      // hanging forever in the placement loop.
      this.mines = Math.max(1, Math.min(mines, this.size - 9));

      this.mine = new Uint8Array(this.size);
      this.adj = new Uint8Array(this.size);
      this.revealed = new Uint8Array(this.size);
      this.flagged = new Uint8Array(this.size);

      this.status = READY;
      this.revealedCount = 0;
      this.flagCount = 0;
      this.explodedIndex = -1;
      this.startedAt = 0;
      this.endedAt = 0;
    }

    get over() {
      return this.status === WON || this.status === LOST;
    }

    get minesLeft() {
      return this.mines - this.flagCount;
    }

    /* Milliseconds since the first reveal, frozen once the game ends. */
    elapsed() {
      if (this.status === READY) return 0;
      return (this.endedAt || Date.now()) - this.startedAt;
    }

    rowOf(index) {
      return (index / this.cols) | 0;
    }

    colOf(index) {
      return index % this.cols;
    }

    neighbours(index) {
      const row = this.rowOf(index);
      const col = this.colOf(index);
      const out = [];
      for (let dr = -1; dr <= 1; dr++) {
        const r = row + dr;
        if (r < 0 || r >= this.rows) continue;
        for (let dc = -1; dc <= 1; dc++) {
          if (dr === 0 && dc === 0) continue;
          const c = col + dc;
          if (c < 0 || c >= this.cols) continue;
          out.push(r * this.cols + c);
        }
      }
      return out;
    }

    /* Mines are laid after the first click, never before: that is what makes
     * the opening move safe and guarantees it opens into a pocket rather than
     * a lone "1". */
    placeMines(safeIndex) {
      const banned = new Set(this.neighbours(safeIndex));
      banned.add(safeIndex);

      const pool = [];
      for (let i = 0; i < this.size; i++) {
        if (!banned.has(i)) pool.push(i);
      }

      // Partial Fisher-Yates: only shuffle as far as we need to draw.
      for (let n = 0; n < this.mines; n++) {
        const pick = n + Math.floor(Math.random() * (pool.length - n));
        const tmp = pool[n];
        pool[n] = pool[pick];
        pool[pick] = tmp;
        this.mine[pool[n]] = 1;
      }

      for (let i = 0; i < this.size; i++) {
        if (this.mine[i]) continue;
        let count = 0;
        const around = this.neighbours(i);
        for (let n = 0; n < around.length; n++) {
          if (this.mine[around[n]]) count++;
        }
        this.adj[i] = count;
      }
    }

    reveal(index) {
      if (this.over || this.revealed[index] || this.flagged[index]) return null;

      if (this.status === READY) {
        this.placeMines(index);
        this.status = PLAYING;
        this.startedAt = Date.now();
      }

      if (this.mine[index]) return this.explode(index);

      const changed = this.flood(index);
      const win = this.checkWin();
      if (win) {
        win.changed = changed.concat(win.changed);
        return win;
      }
      return { type: 'reveal', changed: changed };
    }

    /* Breadth-first so `wave` comes out as the ring number — cell 0 is the one
     * clicked, then each expanding ring. Empty cells open their neighbours;
     * numbered cells are the wall the flood stops at. */
    flood(origin) {
      const changed = [];
      const seen = new Uint8Array(this.size);
      let frontier = [origin];
      let wave = 0;
      seen[origin] = 1;

      while (frontier.length) {
        const next = [];
        for (let i = 0; i < frontier.length; i++) {
          const index = frontier[i];
          if (this.revealed[index]) continue;
          this.revealed[index] = 1;
          this.revealedCount++;
          // A flag on a cell we just opened would leave the counter lying.
          if (this.flagged[index]) {
            this.flagged[index] = 0;
            this.flagCount--;
          }
          changed.push({ index: index, wave: wave });

          if (this.adj[index] !== 0) continue;
          const around = this.neighbours(index);
          for (let n = 0; n < around.length; n++) {
            const nb = around[n];
            if (seen[nb] || this.revealed[nb] || this.mine[nb]) continue;
            seen[nb] = 1;
            next.push(nb);
          }
        }
        frontier = next;
        wave++;
      }
      return changed;
    }

    toggleFlag(index) {
      if (this.over || this.revealed[index]) return null;
      if (this.flagged[index]) {
        this.flagged[index] = 0;
        this.flagCount--;
        return { type: 'unflag', changed: [{ index: index, wave: 0 }] };
      }
      this.flagged[index] = 1;
      this.flagCount++;
      return { type: 'flag', changed: [{ index: index, wave: 0 }] };
    }

    /* Clicking a satisfied number opens everything around it. When the flags
     * do not add up we return a `nudge` instead of doing nothing, so the UI can
     * say "not yet" with a wobble rather than swallowing the click. */
    chord(index) {
      if (this.over || !this.revealed[index] || this.adj[index] === 0) return null;

      const around = this.neighbours(index);
      let flags = 0;
      const targets = [];
      for (let n = 0; n < around.length; n++) {
        const nb = around[n];
        if (this.flagged[nb]) flags++;
        else if (!this.revealed[nb]) targets.push(nb);
      }

      if (flags !== this.adj[index]) {
        const wobble = [];
        for (let n = 0; n < around.length; n++) {
          if (!this.revealed[around[n]]) wobble.push({ index: around[n], wave: 0 });
        }
        return { type: 'nudge', changed: wobble };
      }
      if (!targets.length) return null;

      let changed = [];
      for (let n = 0; n < targets.length; n++) {
        const target = targets[n];
        if (this.mine[target]) {
          const boom = this.explode(target);
          boom.changed = changed.concat(boom.changed);
          return boom;
        }
        if (!this.revealed[target]) changed = changed.concat(this.flood(target));
      }

      const win = this.checkWin();
      if (win) {
        win.changed = changed.concat(win.changed);
        return win;
      }
      return { type: 'reveal', changed: changed };
    }

    checkWin() {
      if (this.revealedCount !== this.size - this.mines) return null;

      this.status = WON;
      this.endedAt = Date.now();

      // Plant the last flags for the player: a won board should read as solved.
      const changed = [];
      for (let i = 0; i < this.size; i++) {
        if (this.mine[i] && !this.flagged[i]) {
          this.flagged[i] = 1;
          this.flagCount++;
          changed.push({ index: i, wave: 0 });
        }
      }
      return { type: 'won', changed: changed };
    }

    explode(index) {
      this.status = LOST;
      this.endedAt = Date.now();
      this.explodedIndex = index;

      // Ripple outwards from the mine that went off: Chebyshev distance is the
      // right metric because a cell's neighbours are all one step away.
      const originRow = this.rowOf(index);
      const originCol = this.colOf(index);
      const changed = [];
      for (let i = 0; i < this.size; i++) {
        const isWrongFlag = this.flagged[i] && !this.mine[i];
        if (!this.mine[i] && !isWrongFlag) continue;
        if (this.mine[i] && this.flagged[i]) continue; // correctly flagged, leave it be
        if (this.mine[i]) this.revealed[i] = 1;
        const wave = Math.max(
          Math.abs(this.rowOf(i) - originRow),
          Math.abs(this.colOf(i) - originCol)
        );
        changed.push({ index: i, wave: i === index ? 0 : wave });
      }
      return { type: 'lost', changed: changed };
    }
  }

  global.MS = global.MS || {};
  global.MS.Game = Game;
  global.MS.READY = READY;
  global.MS.PLAYING = PLAYING;
  global.MS.WON = WON;
  global.MS.LOST = LOST;
})(window);
