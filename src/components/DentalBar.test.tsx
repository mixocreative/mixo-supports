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

  it('shows Next without Done in Step 2, then Done only in Step 3', () => {
    const ui = { mode: 'dental', dentalPreviewReady: true } as UiState;
    const area = { kind: 'dental-area', brush: { kind: 'allow', radius: 2 } } as Gesture & { kind: 'dental-area' };
    const areaHtml = renderToStaticMarkup(<DentalBar gesture={area} unitName="sample" ui={ui} send={() => {}} run={() => {}} tipCount={12} />);
    expect(areaHtml).toContain('Step 2');
    expect(areaHtml).toContain('12');
    expect(areaHtml).toContain('Next');
    expect(areaHtml).not.toContain('Done');
    const emptyHtml = renderToStaticMarkup(<DentalBar gesture={area} unitName="sample" ui={{ mode: 'dental' } as UiState} send={() => {}} run={() => {}} tipCount={0} previewStatus="ready" />);
    expect(emptyHtml).toContain('No safe support tips');
    expect(emptyHtml).not.toContain('>Done');

    const review = { kind: 'dental-review' } as Gesture & { kind: 'dental-review' };
    const reviewHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={ui} reviewReady send={() => {}} run={() => {}} />);
    expect(reviewHtml).toContain('Step 3');
    expect(reviewHtml).toContain('Back');
    expect(reviewHtml).toContain('Done');
    const buildingHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={ui} reviewReady={false} send={() => {}} run={() => {}} />);
    expect(buildingHtml).not.toContain('Done');
    expect(buildingHtml).toContain('Building supports');
  });
});
