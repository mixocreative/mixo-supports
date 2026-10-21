/**
 * Support Edit Mode (Blender `mixo.support_place`): click the model to add a contact;
 * right-click or Ctrl+click a support, or the model near one, to remove it.
 * `zones` paints no-support zones on the active object's surface instead.
 */
export type EditMode = 'off' | 'edit' | 'zones';
/** Support Edit Mode tool: Add supports clicks the model to add; Select supports picks supports to act on. */
export type EditTool = 'add' | 'select';
/** Select supports: Click picks one support at a time; Drag over (the brush) paints a selection. */
export type SelectStyle = 'click' | 'brush';
/** Drag over adds supports to the selection or takes them out of it. */
export type BrushMode = 'select' | 'unselect';
/** The zone brush paints no-support zones or erases them. */
export type ZoneKind = 'paint' | 'erase';
/** The mode Done in zones mode goes back to. */
export type ZonesReturn = 'off' | 'edit';

/**
 * A status line as an i18n key and its values, so the host translates it (and re-translates it
 * when the language changes); `other` is the plural key picked when `vars.n` is not 1.
 */
export interface StatusMessage {
  key: string;
  vars?: Record<string, string | number>;
  other?: string;
}
