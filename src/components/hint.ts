import { t } from '../i18n';

/**
 * Hover hint and accessible description of a control, from an i18n key: `title` shows on hover,
 * `aria-description` is read by screen readers after the control's name.
 */
export function hint(key: string, vars?: Record<string, string | number>): { title: string; 'aria-description': string } {
  const text = t(key, vars);
  return { title: text, 'aria-description': text };
}
