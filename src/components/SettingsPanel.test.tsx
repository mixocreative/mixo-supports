import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { resolveSettings } from '../supports/unitSupports';
import { READY } from '../editing/uiFixture';
import { shapeView } from '../editing/shapeEdit';
import SettingsPanel from './SettingsPanel';

const settings = resolveSettings({});
const render = (selected: string[], band?: string) => renderToStaticMarkup(<SettingsPanel
  settings={settings}
  shape={{ selected: selected.length, view: shapeView(settings, {}, selected), rep: settings, onChange: () => {}, run: () => {}, band: band ? <div className="shape-band">{band}</div> : undefined }}
  ui={{ ...READY, mode: 'edit', selection: selected.length }}
  autoLabel="A" scope="Part" disabled={false} onChange={() => {}} onPreset={() => {}} onRoofMode={() => {}}
/>);

describe('the right panel', () => {
  it('puts the count band under the Support shape header, not above the Object region', () => {
    const html = render([], 'BAND');
    expect(html.indexOf('Object: Part')).toBeLessThan(html.indexOf('Support shape'));
    expect(html.indexOf('Support shape')).toBeLessThan(html.indexOf('BAND'));
    expect(html.indexOf('BAND')).toBeLessThan(html.indexOf('Contact tip'));
  });
});
