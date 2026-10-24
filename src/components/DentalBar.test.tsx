import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DentalBar } from './DentalBar';
import type { Gesture } from '../editing/gesture';
import type { UiState } from '../editing/commands';

describe('DentalBar', () => {
  it('shows only Auto orientation and Next as Step 1 workflow actions', () => {
    const gesture = {
      kind: 'dental-orientation',
      proposal: { kind: 'proposal', diagnostics: { confidence: 0.9 } },
    } as Gesture & { kind: 'dental-orientation' };
    const html = renderToStaticMarkup(<DentalBar gesture={gesture} unitName="sample" ui={{ mode: 'dental' } as UiState} send={() => {}} run={() => {}} />);
    expect(html).toContain('Step 1');
    expect(html).toContain('Auto orientation');
    expect(html).toContain('Next');
    expect(html).not.toContain('Done');
  });
});
