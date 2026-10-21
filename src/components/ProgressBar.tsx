import { t, translateMessage, type Message } from '../i18n';

export interface ProgressTask {
  /** What is running, e.g. "Building supports for {name}". */
  label: Message;
  /** Current step as an i18n key, e.g. "Sampling surface normals". */
  stage: string;
  /** 0 to 1. */
  fraction: number;
}

/**
 * Background work indicator over the viewport: a hairline bar with the overall progress and a
 * caption naming the running job, so long builds read as working rather than frozen.
 */
export default function ProgressBar({ tasks }: { tasks: readonly ProgressTask[] }) {
  if (tasks.length === 0) return null;
  const overall = tasks.reduce((sum, task) => sum + Math.min(1, Math.max(0, task.fraction)), 0) / tasks.length;
  const percent = Math.round(overall * 100);
  const [first] = tasks;
  const label = translateMessage(first!.label);
  const caption = tasks.length > 1 ? t('{label} (and {n} more)', { label, n: tasks.length - 1 }) : label;
  return <div className="progress" role="status" aria-live="polite">
    <div className="progress-track" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-label={label}>
      <div className="progress-fill" style={{ width: `${Math.max(percent, 2)}%` }} />
    </div>
    <p className="progress-caption">
      <span>{caption}</span>
      <span className="progress-stage">{t(first!.stage)}</span>
      <span className="progress-percent">{percent}%</span>
    </p>
  </div>;
}
