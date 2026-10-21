/**
 * Tool icons drawn for this app (no icon library): 24 × 24, stroke in the current colour, so a
 * pressed (ink-filled) button turns them paper. The brush matches the Drag over canvas cursor.
 */

/** Select supports → Click: an arrow pointer. */
export function PointerIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" strokeLinecap="round" aria-hidden="true">
    <path d="M5 3.5 18.5 10l-5.6 1.9L10.6 18z" />
    <path d="m12.9 11.9 5.3 5.3" />
  </svg>;
}

/** Select supports → Drag over: the brush of the Drag over cursor. */
export function BrushIcon() {
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" aria-hidden="true">
    <path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" />
    <path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="currentColor" />
  </svg>;
}
