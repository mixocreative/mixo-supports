import type { ReactNode } from 'react';
import type { CommandId, ResolvedCommand } from '../editing/commands';
import { t } from '../i18n';
import { hint } from './hint';

/**
 * A button that shows one registry command (editing/commands): its label, its hint (or why it is
 * off) and its enabled state come from the row, and a press runs the command the row names.
 * `pressed`: the button is a two-state mode button (aria-pressed from the row). A destructive row
 * reads as `.danger`.
 */
export function CommandButton({ command, run, className, pressed = false, locked = false, children }: {
  command: ResolvedCommand;
  run: (id: CommandId) => void;
  className?: string;
  pressed?: boolean;
  /** The control sits in a locked region: inert, so a click falls through to the panel's lock note. */
  locked?: boolean;
  children?: ReactNode;
}) {
  const reason = command.enabled ? undefined : command.disabledReason;
  const classes = [command.role === 'destructive' ? 'danger' : undefined, className].filter(Boolean).join(' ');
  return <button
    {...(classes ? { className: classes } : {})}
    {...(locked ? { inert: '' } : {})}
    {...(pressed ? { 'aria-pressed': command.pressed } : {})}
    onClick={() => run(command.runs)}
    disabled={!command.enabled}
    {...hint(reason?.key ?? command.hint ?? command.label ?? '', reason?.vars)}
  >{command.label ? t(command.label) : null}{children}</button>;
}
