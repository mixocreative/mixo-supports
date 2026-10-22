import { useEffect, useState } from 'react';
import type { Gesture } from '../../editing/gesture';

/** How long the circle stays after its slider is let go (ms). */
const LINGER_MS = 800;

/**
 * Drag over → Circle size: the circle at the centre of the view while its slider is held or moved,
 * and for a moment after, so the size reads against the model before the first stroke.
 */
export function CirclePreview({ gesture }: { gesture: Gesture }) {
  const sizing = gesture.kind === 'drag' && gesture.sizing;
  const [wasSizing, setWasSizing] = useState(sizing);
  const [lingering, setLingering] = useState(false);
  // Set while rendering, not in an effect: the circle must not blink off for a frame on release.
  if (sizing !== wasSizing) {
    setWasSizing(sizing);
    if (!sizing) setLingering(true);
  }
  useEffect(() => {
    if (sizing || !lingering) return;
    const timer = setTimeout(() => setLingering(false), LINGER_MS);
    return () => clearTimeout(timer);
  }, [sizing, lingering]);
  if (gesture.kind !== 'drag' || !(sizing || lingering)) return null;
  const { radius, mode } = gesture.brush;
  return <div className="brush-circle brush-circle--preview" data-mode={mode} style={{ width: radius * 2, height: radius * 2 }} aria-hidden="true" />;
}
