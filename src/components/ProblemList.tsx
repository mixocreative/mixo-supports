import type { SupportProblem } from '../core/analysis/supportCheck';
import { t } from '../i18n';
import { hint } from './hint';

/** How many findings the list shows; the rest are counted. */
const SHOWN = 12;

/** Support check findings: what and where, Show me (frame it) and Fix (open Support Edit Mode on its object). */
export function ProblemList<P extends SupportProblem & { unitId: string; inZone: boolean }>({ problems, unitName, onShow, onFix }: {
  problems: readonly P[];
  unitName: (unitId: string) => string;
  onShow: (problem: P) => void;
  onFix: (problem: P) => void;
}) {
  return <>
    {problems.length > 0 && <ul className="problems">
      {problems.slice(0, SHOWN).map((problem, index) => <li key={`${problem.unitId}-${index}`}>
        <span className={`problem-kind ${problem.kind}`} aria-hidden="true" />
        <span className="problem-text">
          {problem.kind === 'island' ? t('Island') : t('Uncovered overhang')}
          <small>{unitName(problem.unitId)}{problem.kind === 'overhang' ? ` · ${t('{n} mm²', { n: Math.round(problem.area) })}` : ''}{problem.inZone ? ` · ${t('in a no-support zone')}` : ''}</small>
        </span>
        <button onClick={() => onShow(problem)} {...hint('Frame the camera on this spot')}>{t('Show me')}</button>
        <button onClick={() => onFix(problem)} {...hint('Open Support Edit Mode on this object to add supports here')}>{t('Fix')}</button>
      </li>)}
    </ul>}
    {problems.length > SHOWN && <p className="help">{t('and {n} more', { n: problems.length - SHOWN })}</p>}
  </>;
}
