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
    expect(areaHtml).toContain('Proposed support tips');
    expect(areaHtml).toContain('Final generation may exclude tips');
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
    const gapHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={ui} reviewReady
      rimGap={{ outerMm: 4.2, openingMm: 8 }} send={() => {}} run={() => {}} />);
    expect(gapHtml).toContain('8.0 mm');
    expect(gapHtml).toContain('Review the rim');
    const fallbackHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={ui} reviewReady
      structureFallback={['tree']} send={() => {}} run={() => {}} />);
    expect(fallbackHtml).toContain('Tree branches were omitted');
    const buildingHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={ui} reviewReady={false} send={() => {}} run={() => {}} />);
    expect(buildingHtml).not.toContain('Done');
    expect(buildingHtml).toContain('Building supports');
  });

  it('shows live strip width and density with rim position under advanced controls', () => {
    const area = { kind: 'dental-area', brush: { kind: 'allow', radius: 2 } } as Gesture & { kind: 'dental-area' };
    const html = renderToStaticMarkup(<DentalBar gesture={area} unitName="sample"
      ui={{ mode: 'dental', dentalPreviewReady: true } as UiState} send={() => {}} run={() => {}}
      tuning={{ setbackMm: 0.2, stripWidthMm: 1, density: 1 }} tuningBusy onTuningChange={() => {}} />);
    expect(html).toContain('Strip width');
    expect(html).toContain('Support density');
    expect(html).toContain('Rim setback');
    expect(html).toContain('Updating support area');
    expect(html).toContain('type="range"');
    expect(html).toContain('Tree branches');
    expect(html).toContain('Cross-braces');
    expect(html).toContain('type="checkbox"');
  });
});
