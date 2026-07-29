/*
 * Random Walk — ported from the react-p5 version in the old My-Website repo.
 * The walk logic is unchanged; the React wrapper is replaced by p5 instance
 * mode so the page needs no build step.
 */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Steps pre-computed before the first frame when motion is reduced, so the
// canvas shows a formed walk instead of a single dot.
const SEEDED_STEPS = 600;

const create2DArray = (sizeX, sizeY) => {
  let x = new Array(sizeX);
  for (let i = 0; i < x.length; i++) {
    x[i] = new Array(sizeY).fill(0);
  }
  return x;
};

const isValidDirection = (x, y, grid) => {
  if (x < 0) return false;
  if (y < 0) return false;
  if (x > grid.length - 1) return false;
  if (y > grid[0].length - 1) return false;
  return true;
};

const getDirection = (currPos, possibleDirections, centerX, centerY, grid) => {
  const getRandomDir = () => {
    return possibleDirections[
      Object.keys(possibleDirections)[
        Math.floor(Math.random() * Object.keys(possibleDirections).length)
      ]
    ];
  };

  let nextDirection = getRandomDir();

  while (
    !isValidDirection(
      currPos.x + nextDirection.x + centerX,
      currPos.y + nextDirection.y + centerY,
      grid
    )
  ) {
    nextDirection = getRandomDir();
  }

  return nextDirection;
};

const sketch = (p) => {
  const spacing = 30;
  const diameter = spacing / 2.5;
  const possibleDirections = {
    up: { x: 0, y: -1 },
    down: { x: 0, y: 1 },
    left: { x: -1, y: 0 },
    right: { x: 1, y: 0 },
  };

  const stage = document.getElementById("sketch-stage");

  let grid;
  let centerXIndex;
  let centerYIndex;
  let currPos = { x: 0, y: 0 };
  let hue = 0; // the original left this undefined, making the first frame NaN

  const reset = () => {
    const cols = Math.max(1, Math.floor(p.width / spacing));
    const rows = Math.max(1, Math.floor(p.height / spacing));
    grid = create2DArray(cols, rows);
    centerXIndex = Math.floor(cols / 2);
    centerYIndex = Math.floor(rows / 2);
    currPos = { x: 0, y: 0 };
    hue = 0;
  };

  // Advance the walk by one move, recording the visit.
  const step = () => {
    grid[currPos.x + centerXIndex][currPos.y + centerYIndex] += 1;

    const nextDirection = getDirection(
      currPos,
      possibleDirections,
      centerXIndex,
      centerYIndex,
      grid
    );

    currPos.x += nextDirection.x;
    currPos.y += nextDirection.y;
  };

  const render = () => {
    p.clear();
    p.noStroke();

    // Trail first, so the walker is never painted over by its own cell.
    for (let i = 0; i < grid.length; i++) {
      for (let j = 0; j < grid[0].length; j++) {
        if (grid[i][j] > 0) {
          p.fill(255, 255, 255, grid[i][j] * 50);
          p.ellipse(
            (i - centerXIndex) * spacing,
            (j - centerYIndex) * spacing,
            diameter
          );
        }
      }
    }

    p.fill(hue, 200, 150);
    p.ellipse(currPos.x * spacing, currPos.y * spacing, diameter * 1.5);
  };

  p.setup = () => {
    const canvas = p.createCanvas(stage.clientWidth, stage.clientHeight, p.WEBGL);
    canvas.parent(stage);
    p.colorMode(p.HSL, 255);
    p.frameRate(stage.clientWidth < 850 ? 30 : 120);
    reset();

    if (prefersReducedMotion) {
      for (let i = 0; i < SEEDED_STEPS; i++) step();
      render();
      p.noLoop();
    }
  };

  p.draw = () => {
    hue = hue < 255 ? hue + 1 : 0;
    step();
    render();
  };

  p.windowResized = () => {
    p.resizeCanvas(stage.clientWidth, stage.clientHeight);
    reset(); // grid dimensions change, so the walk restarts
  };

  // Exposed for the page controls.
  p.restart = () => {
    reset();
    render();
  };
};

const instance = new p5(sketch);

const toggleButton = document.getElementById("toggle");
const resetButton = document.getElementById("reset");
const motionNote = document.getElementById("motion-note");

let running = !prefersReducedMotion;

const syncToggle = () => {
  toggleButton.textContent = running ? "Pause" : "Play";
  toggleButton.setAttribute("aria-pressed", String(!running));
};

if (prefersReducedMotion) {
  motionNote.hidden = false;
}
syncToggle();

toggleButton.addEventListener("click", () => {
  running = !running;
  running ? instance.loop() : instance.noLoop();
  syncToggle();
});

resetButton.addEventListener("click", () => {
  instance.restart();
});
