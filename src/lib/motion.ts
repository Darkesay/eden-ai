/**
 * Shared motion system — BOTANIX / EDENS AI greenhouse console.
 *
 * One curve, three durations. Entrances rise, exits fade. Nothing bounces,
 * nothing springs, nothing reflows layout. GPU-friendly properties only
 * (opacity + transform). Reduce-motion is honored two ways: MotionConfig
 * (reducedMotion="user") strips transform/layout movement from every
 * `motion` component in the tree, and index.css collapses CSS animation and
 * transition durations to near-zero.
 */

/** Decisive expo-out — the single easing curve used across the app. */
export const EASE_STANDARD: [number, number, number, number] = [0.22, 1, 0.36, 1];

/** Micro-interactions: hovers, toggles, presses. */
export const DUR_FAST = 0.14;
/** Default entrance duration for pages, cards, overlays. */
export const DUR_ENTER = 0.24;
/** Slow reveals — onboarding, empty states. */
export const DUR_SLOW = 0.36;

/** Page content entrance on route change — fade + gentle rise. */
export const pageEnter = {
  initial: { opacity: 0, y: 6 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR_ENTER, ease: EASE_STANDARD }
} as const;

/** Standard fade + rise for sections, cards, and panels. */
export const fadeUp = {
  initial: { opacity: 0, y: 10 },
  animate: { opacity: 1, y: 0 },
  transition: { duration: DUR_ENTER, ease: EASE_STANDARD }
} as const;

/** Quiet fade for overlays and backdrops. */
export const fadeIn = {
  initial: { opacity: 0 },
  animate: { opacity: 1 },
  transition: { duration: DUR_FAST, ease: EASE_STANDARD }
} as const;

/** Modal entrance — scale from 0.96 + fade. */
export const scaleIn = {
  initial: { opacity: 0, scale: 0.96 },
  animate: { opacity: 1, scale: 1 },
  transition: { duration: DUR_ENTER, ease: EASE_STANDARD }
} as const;
