# Minesweeper

A modern, themeable Minesweeper. Hand-written HTML, CSS and JavaScript — no
framework, no bundler, no dependencies. What is in the repo is what runs.

## Running it

Open `index.html`. That is genuinely all — there is no build step and nothing is
fetched from a network. If you would rather serve it:

```bash
python -m http.server 4173     # then open http://localhost:4173
```

Deploying is a file copy: any static host, GitHub Pages included.

## Playing

| Action | Mouse | Touch | Keyboard |
| --- | --- | --- | --- |
| Open a cell | Left click | Tap | Arrows to move, Enter or Space |
| Flag a cell | Right click | Hold ~0.4s | `F` |
| Clear around a number | Click the number | Tap the number | Enter on the number |
| Flag mode (every tap flags) | Toggle button | Toggle button | `F` off the board |
| New game | Button | Button | `N` |

The first click is always safe and always opens into a pocket — mines are laid
*after* it lands, avoiding the clicked cell and its eight neighbours.

Clicking a number whose flags do not add up wobbles the neighbours instead of
doing nothing, so a mistaken count is visible rather than silent.

Best times are kept per difficulty in `localStorage`, custom boards keyed by
their own dimensions.

## Themes

Six: Slate, Midnight, Sakura, Forest, Sunset, Carbon. The picker sits in the
top right, the choice is remembered, and a first visit follows the system's
`prefers-color-scheme`. Switching crossfades through the View Transitions API
where the browser has it, and switches instantly where it does not.

A theme is a `data-theme` block of custom properties in `style.css` plus an
entry in `js/themes.js` — nothing else in the codebase knows a colour name.

## Layout

```
index.html      Markup, plus the inline SVG sprite for the flag/mine/clock icons
style.css       Tokens, the six themes, layout, and every keyframe
js/game.js      The engine: board state, flood fill, chording, win and loss
js/themes.js    Theme registry, persistence, and the picker
js/ui.js        Rendering, input, sizing, the HUD and the result card
favicon.svg
```

`game.js` never touches the DOM. Each move returns the list of cells that
changed along with a `wave` number — the ripple distance from whatever the
player did — and `ui.js` hands that straight to CSS as a per-cell animation
delay. That is the entire mechanism behind the staggered reveal: no timers, no
animation loop, one integer per cell.

## Animation

Reveals ripple outward from the click, flags land with a spring, a struck mine
throws a shockwave and shakes the board, and a cleared board runs a diagonal
sweep. Every one of those rules pairs its animation with a static end state, so
`prefers-reduced-motion: reduce` collapses the timing without leaving anything
invisible or half-drawn.

## Accessibility

The board is a real `role="grid"` of buttons with a roving tabindex, so it is
fully playable from the keyboard, and each cell's label names its row, column
and state. The live region announces the result of a game and the flag-mode
toggle — and nothing else, because a running commentary on every reveal would
be unbearable. Number colours are picked to clear WCAG AA against the open-cell
background in all six themes.
