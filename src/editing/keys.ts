/** The part of a key event target the keyboard rules look at (an HTMLElement satisfies it). */
export interface KeyTarget {
  tagName: string;
  getAttribute(name: string): string | null;
  hasAttribute(name: string): boolean;
}

/**
 * Whether Enter on the focused element is that element's own action (press a button, follow a
 * link, open a summary, or a custom control: role="button" or any tabindex), so the editor must
 * not also take it as Done.
 */
export function enterActsOn(target: KeyTarget | null): boolean {
  // The document itself (no element focused) has no attributes.
  if (!target || typeof target.getAttribute !== 'function') return false;
  if (/^(BUTTON|A|SUMMARY)$/i.test(target.tagName)) return true;
  return target.getAttribute('role') === 'button' || target.hasAttribute('tabindex');
}
