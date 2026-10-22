import { t } from '../i18n';

/**
 * Hover hint and accessible description of a control, from an i18n key: `title` shows on hover,
 * `aria-description` is read by screen readers after the control's name. `shortcut` is a registry
 * command's key, added in parentheses.
 */
export function hint(key: string, vars?: Record<string, string | number>, shortcut?: string): { title: string; 'aria-description': string } {
  const text = shortcut ? `${t(key, vars)} (${shortcut})` : t(key, vars);
  return { title: text, 'aria-description': text };
}
