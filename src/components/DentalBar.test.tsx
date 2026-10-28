import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { DentalBar } from './DentalBar';
import { profileData } from '../dental/alignerProfiles';
import type { DentalReview } from './DentalSupports';
import { defaultSupportSettings } from '../core/supports/settings';
import type { Gesture } from '../editing/gesture';
import type { UiState } from '../editing/commands';

describe('DentalBar', () => {
  it('Step 0 shows one card per profile, with its art, name and description', () => {
    const gesture = { kind: 'dental-type', profile: 'reference-aligner' } as Gesture & { kind: 'dental-type' };
    const html = renderToStaticMarkup(<DentalBar gesture={gesture} unitName={undefined} ui={{ mode: 'dental', dentalStage: 'type' } as UiState} send={() => {}} run={() => {}} />);
    expect(html).toContain('Step 0');
    expect(html).toContain('Reference aligner');
    expect(html).toContain('<svg');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('Exit');
    expect(html).not.toContain('>Back<');
    const taiwan = renderToStaticMarkup(<DentalBar gesture={gesture} lang="zh-Hant" unitName={undefined} ui={{ mode: 'dental', dentalStage: 'type' } as UiState} send={() => {}} run={() => {}} />);
    expect(taiwan).toContain('標準牙套');
  });

  it('Step 1 asks for the file, then reads it, and shows a bad-file message in place', () => {
    const prompt = { kind: 'dental-aligner', phase: 'prompt', proposal: undefined, notices: [], profile: 'reference-aligner' } as Gesture & { kind: 'dental-aligner' };
    const ui = { mode: 'dental', dentalStage: 'aligner' } as UiState;
    const html = renderToStaticMarkup(<DentalBar gesture={prompt} unitName={undefined} ui={ui} send={() => {}} run={() => {}} />);
    expect(html).toContain('Step 1');
    expect(html).toContain('Drop the aligner STL here');
    expect(html).toContain('Choose STL file');
    expect(html).not.toContain('Use the selected model');
    expect(renderToStaticMarkup(<DentalBar gesture={prompt} selectedName="x" unitName="x" ui={ui} send={() => {}} run={() => {}} />)).toContain('Use the selected model');
    const bad = { ...prompt, notices: [{ kind: 'bad-file', message: { key: 'Not an STL file' } }] } as Gesture & { kind: 'dental-aligner' };
    expect(renderToStaticMarkup(<DentalBar gesture={bad} unitName={undefined} ui={ui} send={() => {}} run={() => {}} />)).toContain('role="alert"');
    const loading = { ...prompt, phase: 'loading' } as Gesture & { kind: 'dental-aligner' };
    const loadingHtml = renderToStaticMarkup(<DentalBar gesture={loading} unitName={undefined} ui={ui} send={() => {}} run={() => {}} />);
    expect(loadingHtml).toContain('aria-busy="true"');
    expect(loadingHtml).not.toContain('Drop the aligner STL here');
  });

  it('Step 1 after orientation offers Auto orientation, Back, Exit and Next, plus its notices', () => {
    const ready = { kind: 'dental-aligner', phase: 'ready', profile: 'reference-aligner',
      proposal: { kind: 'proposal', diagnostics: { confidence: 0.9 } }, notices: [{ kind: 'mismatch' }, { kind: 'holes' }, { kind: 'uncertain' }] } as unknown as Gesture & { kind: 'dental-aligner' };
    const ui = { mode: 'dental', dentalStage: 'aligner', dentalAlignerReady: true, dentalProposed: true } as UiState;
    const html = renderToStaticMarkup(<DentalBar gesture={ready} unitName="sample" ui={ui} send={() => {}} run={() => {}} />);
    for (const word of ['Auto orientation', 'Back', 'Exit', 'Next', 'Keep Reference aligner', 'holes or non-manifold', 'different aligner type']) expect(html).toContain(word);
    expect(html).not.toContain('Done');
  });

  it('Step 2 without an area says so', () => {
    const area = { kind: 'dental-area', brush: { kind: 'allow', radius: 2 }, edit: undefined, notices: [{ kind: 'no-area' }] } as Gesture & { kind: 'dental-area' };
    const html = renderToStaticMarkup(<DentalBar gesture={area} unitName="sample" ui={{ mode: 'dental', dentalStage: 'area' } as UiState} send={() => {}} run={() => {}} tipCount={0} previewStatus="idle" />);
    expect(html).toContain('No support area was detected');
    expect(html).toContain('>Back<');
    expect(html).toContain('>Exit<');
  });

  it('shows Next without Done in Step 2, then Done only in Step 3', () => {
    const ui = { mode: 'dental', dentalPreviewReady: true } as UiState;
    const area = { kind: 'dental-area', brush: { kind: 'allow', radius: 2 }, edit: undefined, notices: [] } as Gesture & { kind: 'dental-area' };
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

    const review = { kind: 'dental-review', edit: { kind: 'pick' } } as Gesture & { kind: 'dental-review' };
    const stepUi = { mode: 'dental', dentalStage: 'review', dentalReviewReady: true, selection: 0, customisedActive: 0, addAction: 'add', tool: 'select', method: 'click', dragAction: 'select', canUndo: false, active: true, supported: true } as unknown as UiState;
    const base = {
      settings: defaultSupportSettings, onSetting: () => {},
      structure: { treeEnabled: true, bracesEnabled: true }, onStructure: () => {}, clickReach: { value: 1, onChange: () => {} },
      verdictPending: false, rimGap: undefined, structureFallback: undefined, problems: [], outOfDate: false, rechecking: () => false, unitName: () => 'sample',
      onShow: () => {}, onFix: () => {}, onShowRim: () => {}, finishedCount: 0, backAsk: undefined, onBackConfirm: () => {}, onBackCancel: () => {},
    } satisfies DentalReview;
    const reviewHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={stepUi} reviewReady review={base} send={() => {}} run={() => {}} />);
    expect(reviewHtml).toContain('Step 3');
    // Density, Paint and Erase live in Step 2 only (D5).
    for (const word of ['Support density', 'Paint', 'Erase']) expect(reviewHtml).not.toContain(word);
    for (const word of ['Tip size', 'Lift height', 'Raft', 'Tree branches', 'Cross-braces', 'Add supports', 'Label', '>OK<', 'Add another aligner', 'Back', 'Exit']) expect(reviewHtml).toContain(word);
    const gapHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={stepUi} reviewReady
      review={{ ...base, rimGap: { outerMm: 4.2, openingMm: 8 } }} send={() => {}} run={() => {}} />);
    expect(gapHtml).toContain('8.0 mm');
    expect(gapHtml).toContain('Review the rim');
    expect(gapHtml).toContain('Show me');
    const fallbackHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={stepUi} reviewReady
      review={{ ...base, structureFallback: ['tree'] }} send={() => {}} run={() => {}} />);
    expect(fallbackHtml).toContain('Tree branches were omitted');
    const prunedHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={stepUi} reviewReady
      review={{ ...base, structureFallback: ['brace-pruned'] }} send={() => {}} run={() => {}} />);
    expect(prunedHtml).toContain('Some cross-braces were left out where they crossed the model');
    expect(prunedHtml).not.toContain('Cross-braces were omitted');
    const buildingHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={{ ...stepUi, dentalReviewReady: false } as UiState} reviewReady={false} review={base} send={() => {}} run={() => {}} />);
    expect(buildingHtml).toContain('Building supports');
    expect(buildingHtml).toMatch(/<button[^>]*disabled[^>]*>OK</);
    const askHtml = renderToStaticMarkup(<DentalBar gesture={review} unitName="sample" ui={stepUi} reviewReady
      review={{ ...base, backAsk: { added: 2, removed: 1, customised: 0 } }} send={() => {}} run={() => {}} />);
    expect(askHtml).toContain('2 added, 1 removed');
    expect(askHtml).toContain('Discard and go back');
  });

  it('shows live area width, area position and density, and Paint / Erase anywhere', () => {
    const area = { kind: 'dental-area', brush: { kind: 'allow', radius: 2 }, edit: undefined, notices: [] } as Gesture & { kind: 'dental-area' };
    const html = renderToStaticMarkup(<DentalBar gesture={area} unitName="sample"
      ui={{ mode: 'dental', dentalPreviewReady: true } as UiState} send={() => {}} run={() => {}}
      tuning={{ positionMm: 0.7, stripWidthMm: 1, density: 1 }} tuningLimits={profileData('reference-aligner').defaults} tuningBusy onTuningChange={() => {}} />);
    expect(html).toContain('Area width');
    expect(html).toContain('Area position');
    expect(html).toContain('Support density');
    expect(html).not.toContain('Rim setback');
    expect(html).not.toContain('<details');
    // The position may cross the edge: its slider starts below zero (the profile's limit).
    expect(html).toContain('min="-0.4"');
    expect(html).toContain('Paint');
    expect(html).toContain('Erase');
    expect(html).toContain('Updating support area');
    expect(html).toContain('type="range"');
    // Tree and Brace moved to Step 3.
    expect(html).not.toContain('Tree branches');
  });
});
