/*
 * Shared random-walk sketch, used both as the page background and as the
 * standalone piece on the sketches page. Ported from the react-p5 version in
 * the old My-Website repo; the walk logic is unchanged, the React wrapper is
 * gone so no build step is needed.
 *
 * createWalkSketch(el, config) -> p5 instance with .restart()
 */

const WALK_DIRECTIONS = [
  { x: 0, y: -1 },
  { x: 0, y: 1 },
  { x: -1, y: 0 },
  { x: 1, y: 0 },
];

function createWalkSketch(el, config) {
  const cfg = Object.assign(
    {
      spacing: 30,
      frameRate: 30,
      seedSteps: 0,
      dotDivisor: 3, // dot diameter = spacing / dotDivisor
      trailHue: 20,
      trailSat: 60,
      trailLight: 60,
      gain: 14, // alpha added per visit
      cap: 90, // maximum trail alpha
      headHue: null, // null cycles through hues
      headSat: 200,
      headLight: 160,
      autoStart: true,
    },
    config
  );

  return new p5((p) => {
    let grid;
    // Array index the walk starts from — must be a whole cell.
    let startX;
    let startY;
    // Geometric midpoint of the cells, used only for drawing. Half-integer when
    // the column/row count is even, which is why it can't reuse the index above:
    // rounding it there would shift the whole grid half a cell off centre.
    let midX;
    let midY;
    let pos = { x: 0, y: 0 };
    let hue = 0;

    const build = () => {
      const cols = Math.max(1, Math.floor(p.width / cfg.spacing));
      const rows = Math.max(1, Math.floor(p.height / cfg.spacing));
      grid = Array.from({ length: cols }, () => new Array(rows).fill(0));
      startX = Math.floor(cols / 2);
      startY = Math.floor(rows / 2);
      midX = (cols - 1) / 2;
      midY = (rows - 1) / 2;
      pos = { x: 0, y: 0 };
      hue = 0;
    };

    const inBounds = (x, y) =>
      x >= 0 && y >= 0 && x <= grid.length - 1 && y <= grid[0].length - 1;

    // Advance the walk by one move, recording the visit.
    const step = () => {
      grid[pos.x + startX][pos.y + startY] += 1;

      let next;
      do {
        next = WALK_DIRECTIONS[Math.floor(Math.random() * WALK_DIRECTIONS.length)];
      } while (!inBounds(pos.x + next.x + startX, pos.y + next.y + startY));

      pos = { x: pos.x + next.x, y: pos.y + next.y };
    };

    const render = () => {
      const d = cfg.spacing / cfg.dotDivisor;
      p.clear();
      p.noStroke();

      // Trail first, so the walker is never painted over by its own cell.
      for (let i = 0; i < grid.length; i++) {
        for (let j = 0; j < grid[0].length; j++) {
          if (grid[i][j] > 0) {
            p.fill(
              cfg.trailHue,
              cfg.trailSat,
              cfg.trailLight,
              Math.min(grid[i][j] * cfg.gain, cfg.cap)
            );
            p.ellipse((i - midX) * cfg.spacing, (j - midY) * cfg.spacing, d);
          }
        }
      }

      // pos is relative to the start index, so shift into the same space.
      p.fill(cfg.headHue === null ? hue : cfg.headHue, cfg.headSat, cfg.headLight);
      p.ellipse(
        (pos.x + startX - midX) * cfg.spacing,
        (pos.y + startY - midY) * cfg.spacing,
        d * 1.7
      );
    };

    p.setup = () => {
      p.createCanvas(el.clientWidth, el.clientHeight, p.WEBGL).parent(el);
      p.colorMode(p.HSL, 255);
      p.frameRate(cfg.frameRate);
      build();

      for (let i = 0; i < cfg.seedSteps; i++) step();
      render();

      if (!cfg.autoStart) p.noLoop();
    };

    p.draw = () => {
      hue = hue < 255 ? hue + 1 : 0;
      step();
      render();
    };

    p.windowResized = () => {
      p.resizeCanvas(el.clientWidth, el.clientHeight);
      build(); // grid dimensions change, so the walk restarts
      for (let i = 0; i < cfg.seedSteps; i++) step();
      render();
    };

    p.restart = () => {
      build();
      render();
    };
  });
}

// Pausing a hidden tab keeps the background off the CPU when it can't be seen.
function pauseWhenHidden(instance, isRunning) {
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) instance.noLoop();
    else if (isRunning()) instance.loop();
  });
}
