/**
 * One term per concept in each language (docs/migration/glossary.md is the readable copy;
 * glossary.test.ts keeps both, and every translation in src/i18n.ts, in line). Terms follow the
 * Blender add-on (S:\ai\mixo3dtool, mixo3d/i18n_dict.py) where it has one.
 */
export interface GlossaryEntry {
  concept: string;
  /** How the English UI text names it (matched as a word, any case). */
  en: RegExp;
  /** The term: a translation of a key naming the concept contains one of these. */
  zh: readonly string[];
  ja: readonly string[];
  /** Synonyms that must not appear in any translation. */
  avoid?: { zh?: readonly string[]; ja?: readonly string[] };
  /** Keys where the English word means something else. */
  except?: readonly string[];
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { concept: 'Support', en: /\bsupports?\b/i, zh: ['支撐'], ja: ['サポート'], avoid: { ja: ['個のサポート', 'サポートを 1 個'] } },
  { concept: 'Contact (point)', en: /\bcontacts?\b/i, zh: ['接觸'], ja: ['接触'] },
  { concept: 'Tip', en: /\btips?\b/i, zh: ['支撐頭', '接觸頭'], ja: ['先端'], avoid: { zh: ['僅頂端', '接觸頂端'] } },
  { concept: 'Pillar', en: /\bpillars?\b/i, zh: ['支撐柱'], ja: ['支柱'] },
  { concept: 'Bracing', en: /\bbrac(e|es|ing)\b/i, zh: ['加強'], ja: ['補強'], avoid: { zh: ['支撐架'], ja: ['ブレース'] } },
  { concept: 'Raft', en: /\braft\b/i, zh: ['底筏'], ja: ['ラフト'] },
  { concept: 'Build plate', en: /\bplate\b/i, zh: ['底板'], ja: ['プレート'], except: ['Plate width', 'Width of each plate of a Cross tip, in % of the tip Ø'] },
  { concept: 'Overhang', en: /\boverhangs?\b/i, zh: ['懸空'], ja: ['オーバーハング'] },
  { concept: 'Overhang edge', en: /\boverhang edges\b/i, zh: ['懸空邊緣'], ja: ['オーバーハングの縁'], avoid: { ja: ['エッジ'] } },
  { concept: 'Island', en: /\bislands?\b/i, zh: ['孤島'], ja: ['アイランド'] },
  { concept: 'No-support zone', en: /\bno-support zones?\b/i, zh: ['免支撐區'], ja: ['サポート禁止エリア'] },
  { concept: 'Object', en: /\bobjects?\b/i, zh: ['物件'], ja: ['オブジェクト'] },
  { concept: 'Model', en: /\bmodels?\b/i, zh: ['模型'], ja: ['モデル'] },
  { concept: 'Support Edit Mode', en: /\bsupport edit mode\b/i, zh: ['支撐編輯模式'], ja: ['サポート編集モード'] },
  { concept: 'Generate', en: /\b(re)?generat/i, zh: ['產生'], ja: ['生成'] },
  { concept: 'Import', en: /\bimport/i, zh: ['匯入'], ja: ['読み込'] },
  { concept: 'Export', en: /\bexport/i, zh: ['匯出'], ja: ['書き出'], avoid: { zh: ['輸出'], ja: ['エクスポート'] } },
  { concept: 'Delete', en: /\bdelet/i, zh: ['刪除'], ja: ['削除'] },
  { concept: 'Remove (supports)', en: /\bremov/i, zh: ['移除'], ja: ['削除'] },
  { concept: 'Paint (zones only)', en: /\bpaint/i, zh: ['塗刷'], ja: ['塗る', '塗り', '塗装', '塗ります'] },
  { concept: 'Erase (zones only)', en: /\berase/i, zh: ['擦除'], ja: ['消す', '消し', '消去'] },
  { concept: 'Undo', en: /\bundo\b/i, zh: ['復原'], ja: ['元に戻'] },
];

/**
 * English words reserved for one tool (mixo-app-style: different gestures get different words):
 * Paint / Erase / Brush only for marking no-support zones on the surface.
 */
export const ZONE_ONLY_WORDS = /\b(paint\w*|erase\w*|brush\w*)\b/i;
/** Zone texts that do not say "zone" themselves (the zones bar and its status lines). */
export const ZONE_TEXTS: readonly string[] = [
  'Paint', 'Erase', 'Brush size', 'Painted',
  'Paint where supports must not grow. Manual supports stay.',
  'Paint where supports must not grow; drag on the model.',
  'Paint areas of the model where automatic supports must not grow',
  'Supports attach underneath: turn the view (Bottom view) to paint where they are.',
];
