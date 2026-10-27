import type { Gesture } from '../../editing/gesture';

/** Colours of the edit preview and check markers (the app's red, kraft, blue and an amber). */
export const PREVIEW = { add: '#b59f78', remove: '#7f0019', ring: '#3b3631', zone: '#1d3461', dental: '#2f6f5e', island: '#b3261e', overhang: '#d97706', outside: '#6b7280' };
/** Opacity of the no-support zone layer in zones mode (`full`) and in Support Edit Mode (`faint`). */
export const ZONE_OPACITY = { full: 0.7, faint: 0.3 } as const;
/** Opacity of a support body previewed (not yet selected) in red. */
export const SEE_THROUGH = 0.45;
/** Brush cursor over the active object: a brush icon (tip at the hot spot), crosshair where unsupported. */
const brushCursor = (tip: string) => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#1f1b17" stroke-width="1.6" stroke-linejoin="round"><path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" fill="#fbfaf7"/><path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="${tip}"/></svg>`)}") 3 21, crosshair`;
/** The brush icon with a grey tip and a "−" beside it: Unselect, told apart from Select by shape as well as colour. */
const unselectCursor = () => `url("data:image/svg+xml,${encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" width="32" height="24" viewBox="0 0 32 24" fill="none" stroke="#1f1b17" stroke-width="1.6" stroke-linejoin="round"><path d="M20.5 3.5 11 13l-1.9-1.9 9.5-9.5z" fill="#fbfaf7"/><path d="M9.1 11.1 11 13c0 3-2.4 5.6-7.5 7.5 0-4.6 1.8-8.6 5.6-9.4z" fill="${PREVIEW.ring}"/><path d="M23 19h7" stroke-width="2.4" stroke-linecap="round"/></svg>`)}") 3 21, crosshair`;
/** Drag over (red tip, with its circle: `useScreenBrush`; grey tip and minus for Unselect), Paint zones (blue) and Erase zones (grey). */
const BRUSH_CURSOR = { select: brushCursor(PREVIEW.remove), unselect: unselectCursor(), paint: brushCursor(PREVIEW.zone), erase: brushCursor(PREVIEW.ring) };

/** The canvas cursor: the brush icon while a brush is over the object, the arrow of Click, else crosshair in the edit modes (a hand over empty space in Drag over, where a drag orbits). */
export function canvasCursor(gesture: Gesture, overBrush: boolean): string {
  switch (gesture.kind) {
    case 'none': return '';
    case 'pick': return 'default';
    case 'add': return 'crosshair';
    case 'zones': return overBrush ? BRUSH_CURSOR[gesture.brush.kind] : 'crosshair';
    case 'dental-type': case 'dental-aligner': return 'default';
    case 'dental-review': return 'default';
    case 'dental-area': return overBrush ? BRUSH_CURSOR[gesture.brush.kind === 'allow' ? 'paint' : 'erase'] : 'crosshair';
    case 'drag': return overBrush ? BRUSH_CURSOR[gesture.brush.mode] : 'grab';
  }
}
