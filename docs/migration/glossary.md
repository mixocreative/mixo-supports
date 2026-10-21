# Glossary (en / zh-Hant / ja)

One term per concept in each language. The data lives in `src/glossary.ts`; `src/glossary.test.ts`
checks that every translation in `src/i18n.ts` of a key naming a concept uses its term, that no
ruled-out synonym appears, that Paint / Erase / Brush only name the no-support zone tools, and that
this table lists every concept. Terms follow the Blender add-on (`mixo3d/i18n_dict.py`) where it has
one; the add-on's Japanese **オーバーハングの縁を補強** is the label for "Reinforce overhang edges".

| Concept | en | zh-Hant | ja | Not (synonyms ruled out) |
|---|---|---|---|---|
| Support | support | 支撐 | サポート (counted with 本) | ja 個のサポート |
| Contact (point) | contact | 接觸點 (接觸) | 接触点 (接触) | |
| Tip | tip | 支撐頭 (接觸頭 for the contact tip) | 先端 | zh 頂端 for a tip (僅頂端, 接觸頂端) |
| Pillar | pillar | 支撐柱 | 支柱 | |
| Bracing | bracing, brace | 加強桿 (加強) | 補強材 (補強) | zh 支撐架, ja ブレース |
| Raft | raft | 底筏 | ラフト | |
| Build plate | plate, build plate | 底板 | プレート | (not the plates of a Cross tip) |
| Overhang | overhang | 懸空 | オーバーハング | |
| Overhang edge | overhang edges | 懸空邊緣 | オーバーハングの縁 | ja エッジ |
| Island | island | 孤島 | アイランド | |
| No-support zone | no-support zone | 免支撐區 | サポート禁止エリア | |
| Object | object | 物件 | オブジェクト | |
| Model | model | 模型 | モデル | |
| Support Edit Mode | Support Edit Mode | 支撐編輯模式 | サポート編集モード | |
| Generate | generate, regenerate | 產生 | 生成 | |
| Import | import | 匯入 | 読み込み (読み込) | |
| Export | export | 匯出 | 書き出し (書き出) | zh 輸出, ja エクスポート |
| Delete | delete (exactly the selected) | 刪除 | 削除 | |
| Remove (supports) | remove (within Remove radius, or all supports) | 移除 | 削除 | |
| Paint (zones only) | paint | 塗刷 | 塗る (塗り, 塗装, 塗ります) | en: only for no-support zones |
| Erase (zones only) | erase | 擦除 | 消す (消し, 消去) | en: only for no-support zones |
| Undo | undo | 復原 | 元に戻す (元に戻) | |

Tool words (mixo-app-style): **Paint / Erase / Brush** mark no-support zones on the surface;
**Select / Drag over / Circle size** pick supports. The support setting formerly called "Erase radius"
is **Remove radius** in English (zh 移除半徑, ja 削除半径 already said remove).
