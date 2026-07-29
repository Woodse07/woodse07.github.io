/*
 * Page controller for the standalone Random Walk sketch. The walk itself lives
 * in assets/walk.js, shared with the background on the home page.
 */

const prefersReducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// Steps pre-computed before the first frame when motion is reduced, so the
// canvas shows a formed walk instead of a single dot.
const SEEDED_STEPS = 600;

const instance = createWalkSketch(document.getElementById("sketch-stage"), {
  spacing: 30,
  frameRate: 60,
  seedSteps: prefersReducedMotion ? SEEDED_STEPS : 0,
  dotDivisor: 2.5,
  trailHue: 20,
  trailSat: 70,
  trailLight: 45,
  gain: 40,
  cap: 200,
  headHue: null, // cycles, so the walker stays visible against the trail
  // Muted and darker than the default: bright pastels wash out on cream.
  headSat: 150,
  headLight: 105,
  autoStart: !prefersReducedMotion,
});

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

pauseWhenHidden(instance, () => running);
