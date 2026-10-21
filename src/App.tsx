import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Object3D } from 'three';
import { labelForIndex } from './analysis/mesh';
import type { SupportProblem } from './analysis/supportCheck';
import type { SupportPoint } from './analysis/types';
import ProgressBar, { type ProgressTask } from './components/ProgressBar';
import { AnalysisClient } from './workers/analysisClient';
import { ImportClient } from './workers/importClient';
import { SupportMeshClient, type MeshProgress } from './workers/meshClient';
import type { MeshMode } from './workers/meshProtocol';
import ObjectViewport, { acceptModelFile, type EditMode, type EditTool, type GizmoMode, type ViewRequest } from './components/ObjectViewport';
import SettingsPanel from './components/SettingsPanel';
import { BrandLogo } from './components/BrandLogo';
import { createSceneHistory, redoScene, undoScene, withSceneCommand, type SceneHistory } from './state/history';
import { gltfRawMeshes, placeImportedUnits, type ImportedMesh } from './state/import';
import { emptyScene, type PrintScene, type PrintUnit, type SceneCommand, type SupportSettings } from './state/project';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformPoint, type ModelTransform } from './state/transform';
import { exportUnits, planExport, type ExportKind } from './supports/export';
import { meshBounds, type GeneratedSupportMesh, type Vector } from './supports/mesh';
import { problemInZone, type ZoneStamp } from './supports/zones';
import { contactsInBrush, deleteCommands, paintSelection, pruneSelection, toggleSelection, type BrushMode } from './supports/selection';
import { applyPreset, defaultSupportSettings, setRoofMode, toPlacementSettings, updateSetting, type LiveSupportSettings, type SettingKey } from './supports/settings';
import { resolveSettings, unitContacts, unitRemovedCount, unitSupportMesh } from './supports/unitSupports';
import { enterActsOn } from './editing/keys';
import { detectLanguage, LANGS, plural, setLanguage, t, translateMessage, type Lang, type Message } from './i18n';

type HistoryAction = { type: 'command'; command: SceneCommand } | { type: 'undo' } | { type: 'redo' };

function historyReducer(history: SceneHistory, action: HistoryAction): SceneHistory {
  if (action.type === 'undo') return undoScene(history);
  if (action.type === 'redo') return redoScene(history);
  return withSceneCommand(history, action.command);
}

/** Settings whose change moves contacts; units with supports regenerate automatically (Blender keeps them live). */
const PLACEMENT_KEYS: ReadonlySet<SettingKey> = new Set<SettingKey>([
  'scatterSpacing', 'scatterAngle', 'scatterFacingDown', 'scatterIslands', 'scatterRidgeAngle', 'reinforceOverhangEdges', 'liftHeight',
]);
const REGENERATE_DELAY_MS = 350;
/** Settings edits come in bursts (typing a value); a unit's preview rebuild waits this long. */
const BUILD_DELAY_MS = 120;

const NO_SELECTION: ReadonlySet<string> = new Set();

// Labels are i18n keys, translated where shown.
const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: 'active-printable', label: 'Active object with model' },
  { kind: 'active-supports', label: 'Active object, supports only' },
  { kind: 'separate-printable', label: 'Each object with model' },
  { kind: 'separate-supports', label: 'Each object, supports only' },
  { kind: 'whole-printable', label: 'Whole plate in one file' },
];

/** A support check finding, its position in the unit's local frame. */
export interface UnitProblem extends SupportProblem {
  unitId: string;
  /** The spot lies inside a no-support zone, which is why it has no support. */
  inZone: boolean;
}

/** Unit rotation without translation: the frame placement and checks analyse a unit in. */
function orientationOf(unit: PrintUnit): ModelTransform {
  return { position: [0, 0, 0], rotation: [...unit.transform.rotation] };
}

export default function App() {
  const [history, dispatchHistory] = useReducer(historyReducer, emptyScene, createSceneHistory);
  const scene = history.present;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const dispatch = useCallback((command: SceneCommand) => dispatchHistory({ type: 'command', command }), []);

  const [lang, setLang] = useState<Lang>(detectLanguage);
  setLanguage(lang);
  const chooseLanguage = (next: Lang) => {
    setLanguage(next, true);
    setLang(next);
  };
  const [status, setStatusMessage] = useState<Message>({ key: 'Drop STL, GLB or glTF files to begin. Every mesh becomes an object.' });
  const setStatus = useCallback((key: string, vars?: Message['vars'], other?: string) => setStatusMessage({ key, ...(vars ? { vars } : {}), ...(other ? { other } : {}) }), []);
  const [editMode, setEditMode] = useState<EditMode>('off');
  const editModeRef = useRef(editMode);
  editModeRef.current = editMode;
  // Like Blender's Support Edit Mode, undo inside the mode stops at the scene it was entered with.
  const historyRef = useRef(history);
  historyRef.current = history;
  const undoFloor = useRef(0);
  const canUndo = history.past.length > (editMode === 'off' ? 0 : undoFloor.current);
  const undo = useCallback(() => {
    const floor = editModeRef.current === 'off' ? 0 : undoFloor.current;
    if (historyRef.current.past.length > floor) dispatchHistory({ type: 'undo' });
  }, []);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  // Support Edit Mode tool and selection: view state of the active object, never in history.
  const [editTool, setEditTool] = useState<EditTool>('add');
  const [selectStyle, setSelectStyle] = useState<'click' | 'brush'>('click');
  const [brushMode, setBrushMode] = useState<BrushMode>('select');
  /** Drag-over reach in mm: a view setting, so the object's Erase radius stays untouched. */
  const [brushRadius, setBrushRadius] = useState(2);
  const [selection, setSelection] = useState<ReadonlySet<string>>(NO_SELECTION);
  // No-support zones mode: brush view state, and the mode Done goes back to.
  const [zoneKind, setZoneKind] = useState<'paint' | 'erase'>('paint');
  const [zoneRadius, setZoneRadius] = useState(2);
  const [zonesReturn, setZonesReturn] = useState<'off' | 'edit'>('off');
  const [focus, setFocus] = useState<{ point: [number, number, number]; seq: number }>();
  const [viewRequest, setViewRequest] = useState<ViewRequest>();
  const requestView = (kind: ViewRequest['kind']) => setViewRequest((current) => ({ kind, seq: (current?.seq ?? 0) + 1 }));
  // Contact tips view (Blender: Only Tip + Ctrl+Numpad 7): view only, settings and export untouched.
  const [tipsOnly, setTipsOnly] = useState(false);
  const [belowPlate, setBelowPlate] = useState(false);
  /** Unit to open in Support Edit Mode once it is the active unit ("Fix" on a check finding). */
  const [editTarget, setEditTarget] = useState<string>();
  const [modelVisible, setModelVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const activeUnit = scene.units.find((unit) => unit.id === scene.activeUnitId);
  const activeIndex = activeUnit ? scene.units.indexOf(activeUnit) : -1;
  // Support Edit Mode belongs to the active unit: it ends when that unit goes (delete, undo).
  useEffect(() => {
    if (editMode !== 'off' && !activeUnit) setEditMode('off');
  }, [activeUnit, editMode]);
  // The selection empties on leaving Edit Mode or changing the active object; ids that no
  // longer exist (undo, regeneration) drop out.
  useEffect(() => setSelection(NO_SELECTION), [editMode, scene.activeUnitId]);
  const activeContacts = useMemo(() => (activeUnit ? unitContacts(activeUnit) : []), [activeUnit]);
  useEffect(() => setSelection((current) => pruneSelection(current, activeContacts)), [activeContacts]);
  const activeSettings = useMemo(() => resolveSettings(activeUnit?.settings), [activeUnit?.settings]);
  const targets = useCallback((current: PrintScene) => {
    const selected = current.units.filter((unit) => current.selectedUnitIds.includes(unit.id));
    return selected.length > 0 ? selected : current.units;
  }, []);

  // ---- Progress ------------------------------------------------------------------------
  // Long jobs run in workers; each reports progress here so the viewport can show it.
  const [tasks, setTasks] = useState<ReadonlyMap<string, ProgressTask>>(new Map());
  const setTask = useCallback((key: string, task: ProgressTask | undefined) => setTasks((current) => {
    const next = new Map(current);
    if (task) next.set(key, task); else next.delete(key);
    return next;
  }), []);
  const unitName = useCallback((unitId: string) => {
    const index = sceneRef.current.units.findIndex((unit) => unit.id === unitId);
    const unit = sceneRef.current.units[index];
    return unit ? `${resolveSettings(unit.settings).labelText || labelForIndex(index)} ${unit.name}` : 'unit';
  }, []);

  // ---- Background work -----------------------------------------------------------------
  // Heavy work runs in workers by role: preview supports, export (full-resolution supports and
  // STL files), placement and checks (a small pool, one model per worker) and imports. Every
  // job reports progress to the bar over the viewport; stale jobs are dropped or stopped.
  const workers = useRef<{ preview?: SupportMeshClient; export?: SupportMeshClient; analysis?: AnalysisClient; importer?: ImportClient }>({});
  const meshProgress = useCallback((progress: MeshProgress) => setTask(`mesh:${progress.mode}:${progress.unitId}`, {
    label: { key: 'Building supports for {name}', vars: { name: unitName(progress.unitId) } },
    stage: progress.stage,
    fraction: progress.fraction,
  }), [setTask, unitName]);
  const meshIdle = useCallback((mode: MeshMode, unitId: string) => setTask(`mesh:${mode}:${unitId}`, undefined), [setTask]);
  const preview = useCallback(() => (workers.current.preview ??= new SupportMeshClient(meshProgress, meshIdle)), [meshIdle, meshProgress]);
  const exporter = useCallback(() => (workers.current.export ??= new SupportMeshClient(meshProgress, meshIdle)), [meshIdle, meshProgress]);
  const analysis = useCallback(() => (workers.current.analysis ??= new AnalysisClient((key, fraction, stage) => {
    const [kind, unitId] = key.split(':') as [string, string];
    setTask(key, { label: { key: kind === 'place' ? 'Placing contacts on {name}' : 'Checking supports on {name}', vars: { name: unitName(unitId) } }, stage, fraction });
  })), [setTask, unitName]);
  const importer = useCallback(() => (workers.current.importer ??= new ImportClient()), []);
  useEffect(() => () => {
    const { preview: p, export: e, analysis: a, importer: i } = workers.current;
    p?.dispose(); e?.dispose(); a?.dispose(); i?.dispose();
  }, []);

  // ---- Support meshes ------------------------------------------------------------------
  // Built in the preview worker from scene state; a unit keeps showing its previous mesh until
  // the new one arrives, and units that did not change are not rebuilt.
  const [supportMeshes, setSupportMeshes] = useState<ReadonlyMap<string, GeneratedSupportMesh>>(new Map());
  const requested = useRef(new Map<string, { unit: PrintUnit; index: number }>());
  const buildTimers = useRef(new Map<string, number>());
  const placing = useRef(new Set<string>());
  const [problems, setProblems] = useState<ReadonlyMap<string, { unit: PrintUnit; items: UnitProblem[] }>>(new Map());

  /** A unit left the scene: stop its work and free what the workers hold for it. */
  const forgetUnit = useCallback((unitId: string) => {
    window.clearTimeout(buildTimers.current.get(unitId));
    buildTimers.current.delete(unitId);
    workers.current.preview?.forget(unitId);
    workers.current.export?.forget(unitId);
    workers.current.analysis?.cancel(`place:${unitId}`);
    workers.current.analysis?.cancel(`check:${unitId}`);
    for (const key of [`mesh:preview:${unitId}`, `place:${unitId}`, `check:${unitId}`]) setTask(key, undefined);
    if (placing.current.delete(unitId)) setPendingCount(placing.current.size);
    setProblems((current) => {
      if (!current.has(unitId)) return current;
      const next = new Map(current);
      next.delete(unitId);
      return next;
    });
  }, [setTask]);

  useEffect(() => {
    const ids = new Set(scene.units.map((unit) => unit.id));
    for (const id of [...requested.current.keys()]) {
      if (ids.has(id)) continue;
      requested.current.delete(id);
      forgetUnit(id);
    }
    setSupportMeshes((current) => {
      const kept = new Map([...current].filter(([id]) => ids.has(id)));
      return kept.size === current.size ? current : kept;
    });
    scene.units.forEach((unit, index) => {
      const previous = requested.current.get(unit.id);
      if (previous && previous.unit === unit && previous.index === index) return;
      requested.current.set(unit.id, { unit, index });
      window.clearTimeout(buildTimers.current.get(unit.id));
      if (unit.supports === undefined) {
        const empty = unitSupportMesh(unit, index);
        setSupportMeshes((current) => new Map(current).set(unit.id, empty));
        return;
      }
      const queued: ProgressTask = { label: { key: 'Building supports for {name}', vars: { name: unitName(unit.id) } }, stage: 'Queued', fraction: 0 };
      setTask(`mesh:preview:${unit.id}`, queued);
      buildTimers.current.set(unit.id, window.setTimeout(() => {
        buildTimers.current.delete(unit.id);
        if (requested.current.get(unit.id)?.unit !== unit) return;
        setTask(`mesh:preview:${unit.id}`, queued);
        preview().build(unit, index, 'preview').then((mesh) => {
          if (!mesh || requested.current.get(unit.id)?.unit !== unit) return;
          setSupportMeshes((current) => new Map(current).set(unit.id, mesh));
        }, (error: Error) => setStatus('Support building failed: {error}', { error: error.message }));
      }, BUILD_DELAY_MS));
    });
  }, [scene.units, forgetUnit, preview, setStatus, setTask, unitName]);

  // ---- Placement -----------------------------------------------------------------------
  const generate = useCallback((unitIds?: readonly string[]) => {
    const current = sceneRef.current;
    const units = unitIds ? current.units.filter((unit) => unitIds.includes(unit.id)) : targets(current);
    if (units.length === 0) return setStatus('Import a model before generating supports.');
    for (const unit of units) {
      const settings = resolveSettings(unit.settings);
      // The lowest model point sits Lift Height above the plate (y = 0) where the supports stand.
      const lowest = meshBounds(applyTransform(unit.source, unit.transform)).min[1];
      const transform: ModelTransform = {
        position: [unit.transform.position[0], unit.transform.position[1] + settings.liftHeight - lowest, unit.transform.position[2]],
        rotation: [...unit.transform.rotation],
      };
      // Placement runs on the rotated but untranslated model so moving a unit never
      // shifts the sampling lattice; automatic IDs (and suppressions) stay stable.
      const orientation = orientationOf(unit);
      const key = `place:${unit.id}`;
      setTask(key, { label: { key: 'Placing contacts on {name}', vars: { name: unitName(unit.id) } }, stage: 'Queued', fraction: 0 });
      placing.current.add(unit.id);
      analysis().place(key, applyTransform(unit.source, orientation), toPlacementSettings(settings)).then((result) => {
        if (!result) return; // replaced by a newer request for this unit
        placing.current.delete(unit.id);
        setPendingCount(placing.current.size);
        setTask(key, undefined);
        if (!sceneRef.current.units.some((candidate) => candidate.id === unit.id)) return;
        const toLocal = (point: SupportPoint): SupportPoint => ({
          ...point,
          position: inverseTransformPoint(orientation, point.position),
          normal: inverseTransformDirection(orientation, point.normal),
        });
        const points = result.points.map(toLocal);
        dispatch({ type: 'batch', commands: [
          { type: 'transform/set', unitId: unit.id, transform },
          {
            type: 'supports/set',
            unitId: unit.id,
            placement: {
              points,
              regions: result.regions,
              contactPositions: new Float32Array(points.flatMap((point) => point.position)),
              contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
            },
            supports: { kind: 'live', data: { transform: { position: [...transform.position], rotation: [...transform.rotation] } } },
          },
        ] });
        setStatus('{name}: {n} automatic contacts generated.', { name: unit.name, n: points.length });
      }, () => {
        placing.current.delete(unit.id);
        setPendingCount(placing.current.size);
        setTask(key, undefined);
        setStatus('Support analysis failed; adjust the model or settings and generate again.');
      });
    }
    setPendingCount(placing.current.size);
    setStatus('Analysing overhangs for 1 object.', { n: units.length }, 'Analysing overhangs for {n} objects.');
  }, [analysis, dispatch, setStatus, setTask, targets, unitName]);

  // ---- Support check -------------------------------------------------------------------
  /** Checks the units' current contacts; resolves with the spots found outside and inside no-support zones. */
  const runCheck = useCallback(async (units: readonly PrintUnit[]): Promise<{ spots: number; inZone: number }> => {
    const checked = await Promise.all(units.filter((unit) => unit.supports).map(async (unit) => {
      const settings = resolveSettings(unit.settings);
      const orientation = orientationOf(unit);
      const key = `check:${unit.id}`;
      setTask(key, { label: { key: 'Checking supports on {name}', vars: { name: unitName(unit.id) } }, stage: 'Queued', fraction: 0 });
      try {
        const found = await analysis().check(
          key,
          applyTransform(unit.source, orientation),
          unitContacts(unit).map((contact) => transformPoint(orientation, contact.position)),
          { overhangAngleDegrees: settings.scatterAngle, spacing: settings.scatterSpacing },
        );
        if (!found) return { spots: 0, inZone: 0 };
        // Spots face down on the plate: plate down in unit-local space keeps a zone on the far side of a thin floor out.
        const down = inverseTransformDirection(orientation, [0, -1, 0]);
        const items = found.map((problem) => ({ ...problem, unitId: unit.id, position: inverseTransformPoint(orientation, problem.position) }))
          .map((problem) => ({ ...problem, inZone: problemInZone(unit.zones, problem.position, down) }));
        setProblems((current) => new Map(current).set(unit.id, { unit, items }));
        const inZone = items.filter((problem) => problem.inZone).length;
        return { spots: items.length - inZone, inZone };
      } finally {
        setTask(key, undefined);
      }
    }));
    return checked.reduce((sum, count) => ({ spots: sum.spots + count.spots, inZone: sum.inZone + count.inZone }), { spots: 0, inZone: 0 });
  }, [analysis, setTask, unitName]);

  /** Findings for units unchanged since their check (an edited unit is re-checked shortly). */
  const currentProblems = useMemo(() => scene.units.flatMap((unit) => {
    const entry = problems.get(unit.id);
    return entry && entry.unit === unit ? entry.items : [];
  }), [problems, scene.units]);
  const recheckTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const stale = scene.units.filter((unit) => unit.supports && problems.has(unit.id) && problems.get(unit.id)!.unit !== unit);
    if (stale.length === 0) return;
    window.clearTimeout(recheckTimer.current);
    recheckTimer.current = window.setTimeout(() => void runCheck(stale).catch(() => 0), 600);
  }, [problems, runCheck, scene.units]);

  const showProblem = useCallback((problem: UnitProblem) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === problem.unitId);
    if (unit) setFocus((current) => ({ point: transformPoint(unit.transform, problem.position), seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const checkSupports = useCallback(() => {
    const units = targets(sceneRef.current).filter((unit) => unit.supports);
    if (units.length === 0) return setStatus('Generate supports before checking them.');
    setStatus('Checking supports on 1 object.', { n: units.length }, 'Checking supports on {n} objects.');
    runCheck(units).then(
      ({ spots, inZone }) => (spots + inZone === 0 ? setStatus('No unsupported spots found.') : setStatus('1 spot may print unsupported: see Check supports.', { n: spots + inZone }, '{n} spots may print unsupported: see Check supports.')),
      (error: Error) => setStatus('Support check failed: {error}', { error: error.message }),
    );
  }, [runCheck, setStatus, targets]);

  const regenerateTimer = useRef<number | undefined>(undefined);
  const regenerateQueue = useRef(new Set<string>());
  const scheduleRegenerate = useCallback((unitIds: string[]) => {
    unitIds.forEach((id) => regenerateQueue.current.add(id));
    window.clearTimeout(regenerateTimer.current);
    regenerateTimer.current = window.setTimeout(() => {
      const ids = [...regenerateQueue.current].filter((id) => sceneRef.current.units.find((unit) => unit.id === id)?.supports);
      regenerateQueue.current.clear();
      if (ids.length > 0) generate(ids);
    }, REGENERATE_DELAY_MS);
  }, [generate]);

  // ---- Import --------------------------------------------------------------------------
  const importFiles = useCallback(async (files: readonly File[]) => {
    const accepted = files.filter(acceptModelFile);
    if (accepted.length === 0) return setStatus('Import error: choose STL, GLB or glTF files.');
    setEditMode('off');
    try {
      const imported: ImportedMesh[][] = [];
      for (const [k, file] of accepted.entries()) {
        const report = (fraction: number, stage: string) => setTask('import', {
          label: { key: 'Importing {name}', vars: { name: file.name } },
          stage,
          fraction: (k + fraction) / accepted.length,
        });
        report(0, 'Reading file');
        const data = await file.arrayBuffer();
        if (/\.stl$/i.test(file.name)) imported.push(await importer().parseStl(file.name, data, report));
        else {
          report(0.05, 'Parsing glTF');
          const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
          const raw = gltfRawMeshes(gltf, file.name);
          if (raw.length === 0) throw new Error(`${file.name} contains no mesh`);
          imported.push(await importer().weld(raw, report));
        }
      }
      let units = [...sceneRef.current.units];
      const added: PrintUnit[] = [];
      for (const group of imported) {
        const placed = placeImportedUnits(group, units, { lift: defaultSupportSettings.liftHeight, createId: () => `unit-${crypto.randomUUID()}` });
        units = [...units, ...placed];
        added.push(...placed);
      }
      dispatch({ type: 'batch', commands: [
        ...added.map((unit) => ({ type: 'unit/add' as const, unit })),
        { type: 'selection/set', unitIds: added.map((unit) => unit.id), activeUnitId: added[0]!.id },
      ] });
      setStatus('Imported 1 object. Generate to place supports.', { n: added.length }, 'Imported {n} objects. Generate to place supports.');
    } catch (error) {
      setStatus('Import error: {error}', { error: error instanceof Error ? error.message : t('unsupported model') });
    } finally {
      setTask('import', undefined);
    }
  }, [dispatch, importer, setStatus, setTask]);

  // ---- Commands ------------------------------------------------------------------------
  const forTargets = useCallback((make: (unit: PrintUnit) => SceneCommand | undefined) => {
    const commands = targets(sceneRef.current).map(make).filter((command): command is SceneCommand => command !== undefined);
    if (commands.length > 0) dispatch({ type: 'batch', commands });
    return commands.length;
  }, [dispatch, targets]);

  const changeSettings = useCallback((change: (settings: LiveSupportSettings) => LiveSupportSettings, regenerate: boolean) => {
    const units = targets(sceneRef.current);
    forTargets((unit) => ({ type: 'settings/set', unitId: unit.id, settings: change(resolveSettings(unit.settings)) as SupportSettings }));
    if (regenerate) scheduleRegenerate(units.filter((unit) => unit.supports).map((unit) => unit.id));
  }, [forTargets, scheduleRegenerate, targets]);

  const onSettingChange = useCallback(<K extends SettingKey>(key: K, value: LiveSupportSettings[K]) => {
    changeSettings((settings) => updateSetting(settings, key, value), PLACEMENT_KEYS.has(key));
  }, [changeSettings]);

  const removeSupports = () => {
    setEditMode('off');
    const count = forTargets((unit) => (unit.supports ? { type: 'supports/remove', unitId: unit.id } : undefined));
    if (count) setStatus('Removed supports from 1 object; models untouched, manual edits kept for regeneration.', { n: count }, 'Removed supports from {n} objects; models untouched, manual edits kept for regeneration.');
    else setStatus('No supports to remove.');
  };
  const clearManual = () => {
    const count = forTargets((unit) => (unit.manual.length || unit.suppressed.length || unit.deleted.length ? { type: 'supports/clear-manual', unitId: unit.id } : undefined));
    setStatus(count ? 'Manual edits cleared; automatic contacts restored.' : 'No manual edits to clear.');
  };
  const deleteUnits = useCallback(() => {
    const ids = sceneRef.current.selectedUnitIds;
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: ids.map((unitId) => ({ type: 'unit/remove' as const, unitId })) });
    setStatus('Deleted 1 object (undo restores).', { n: ids.length }, 'Deleted {n} objects (undo restores).');
  }, [dispatch]);
  const toggleEditMode = useCallback(() => {
    if (editModeRef.current === 'zones') return; // zones mode leaves through Done or Esc
    if (editModeRef.current !== 'off') {
      setEditMode('off');
      return setStatus('Support edits kept.');
    }
    if (!sceneRef.current.activeUnitId) return setStatus('Select an object to edit its supports.');
    undoFloor.current = historyRef.current.past.length;
    setEditMode('edit'); // the status line follows from the tool, below
  }, []);
  // Entering Edit Mode or switching tool says what a click or drag now does.
  const editToolStatus = editTool === 'add'
    ? 'Support Edit Mode: click the model to add, right-click a support to remove.'
    : selectStyle === 'click'
      ? 'Support Edit Mode: click supports to select them, right-click a support to remove.'
      : 'Support Edit Mode: drag over supports to select them, starting on the model.';
  useEffect(() => {
    if (editMode === 'edit') setStatus(editToolStatus);
  }, [editMode, editToolStatus, setStatus]);

  /** Enters zones mode for the active object; Done returns to `from`. */
  const openZones = useCallback((from: 'off' | 'edit') => {
    if (!sceneRef.current.activeUnitId) return setStatus('Select an object first.');
    // From Edit Mode the floor it set stays: undo still stops where editing began.
    if (editModeRef.current === 'off') undoFloor.current = historyRef.current.past.length;
    setZonesReturn(from);
    setEditMode('zones');
    setStatus('Paint where supports must not grow; drag on the model.');
  }, [setStatus]);
  const closeZones = useCallback(() => {
    setEditMode(zonesReturn); // back in Edit Mode, its tool sets the status line
    if (zonesReturn === 'off') setStatus('No-support zones kept.');
  }, [setStatus, zonesReturn]);
  /** One stroke is one undo step, on the active object only. */
  const onZoneStroke = useCallback((unitId: string, stamps: ZoneStamp[]) => {
    if (editModeRef.current !== 'zones' || unitId !== sceneRef.current.activeUnitId || stamps.length === 0) return;
    dispatch({ type: 'zones/add', unitId, stamps });
    setStatus(stamps[stamps.length - 1]!.kind === 'paint' ? 'Zone painted: automatic supports inside are hidden.' : 'Zone erased.');
  }, [dispatch, setStatus]);
  const clearZones = useCallback((unitId: string) => {
    if (!sceneRef.current.units.find((unit) => unit.id === unitId)?.zones.length) return;
    dispatch({ type: 'zones/clear', unitId });
    setStatus('No-support zones cleared.');
  }, [dispatch, setStatus]);

  const fixProblem = useCallback((problem: UnitProblem) => {
    showProblem(problem);
    if (editModeRef.current === 'zones') return setStatus('Finish painting zones first: press Esc or Done.');
    if (editModeRef.current !== 'off' && sceneRef.current.activeUnitId === problem.unitId) return;
    setEditMode('off');
    dispatch({ type: 'selection/set', unitIds: [problem.unitId], activeUnitId: problem.unitId });
    setEditTarget(problem.unitId);
  }, [dispatch, setStatus, showProblem]);
  useEffect(() => {
    if (!editTarget || scene.activeUnitId !== editTarget) return;
    setEditTarget(undefined);
    toggleEditMode();
  }, [editTarget, scene.activeUnitId, toggleEditMode]);

  const onSelect = useCallback((unitId: string | null, additive: boolean) => {
    const current = sceneRef.current;
    if (editModeRef.current !== 'off') {
      if (unitId !== current.activeUnitId) setStatus(editModeRef.current === 'zones' ? 'Finish painting zones first: press Esc or Done.' : 'Finish editing supports first: press Esc or Done.');
      return;
    }
    if (unitId === null) return dispatch({ type: 'selection/set', unitIds: [] });
    const ids = additive
      ? (current.selectedUnitIds.includes(unitId) ? current.selectedUnitIds.filter((id) => id !== unitId) : [...current.selectedUnitIds, unitId])
      : [unitId];
    const active = ids.includes(unitId) ? unitId : ids[ids.length - 1];
    if (ids.join() === current.selectedUnitIds.join() && active === current.activeUnitId) return;
    dispatch({ type: 'selection/set', unitIds: ids, ...(active ? { activeUnitId: active } : {}) });
  }, [dispatch]);

  const onTransform = useCallback((unitId: string, transform: ModelTransform) => {
    dispatch({ type: 'transform/set', unitId, transform });
    setStatus('Object moved with its supports. Regenerate to re-plant supports after a rotation.');
  }, [dispatch]);

  const onAddContact = useCallback((unitId: string, point: [number, number, number], normal: [number, number, number]) => {
    if (editModeRef.current === 'zones') return; // supports take no edits while painting zones
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    const contact: SupportPoint = {
      id: `manual-${crypto.randomUUID()}`,
      regionId: -1,
      position: inverseTransformPoint(unit.transform, point),
      normal: inverseTransformDirection(unit.transform, normal),
      source: 'interior',
    };
    const commands: SceneCommand[] = unit.supports ? [] : [{
      type: 'supports/set', unitId, supports: { kind: 'live', data: { transform: { position: [...unit.transform.position], rotation: [...unit.transform.rotation] } } },
    }];
    dispatch({ type: 'batch', commands: [...commands, { type: 'manual/add', unitId, point: contact }] });
    setStatus(normal[1] > 0 ? 'Support added on a top face: it grows from below.' : 'Support added.');
  }, [dispatch]);

  const removeContact = useCallback((unit: PrintUnit, contactId: string): SceneCommand => (
    unit.manual.some((point) => point.id === contactId)
      ? { type: 'manual/remove', unitId: unit.id, pointId: contactId }
      : { type: 'suppression/add', unitId: unit.id, pointId: contactId }
  ), []);

  // Like Blender's remove_manual_near: every contact within Erase Radius of the pick goes.
  const eraseNear = useCallback((unit: PrintUnit, local: [number, number, number]) => {
    const radius = resolveSettings(unit.settings).eraseRadius;
    const hits = unitContacts(unit).filter((contact) => Math.hypot(...contact.position.map((value, axis) => value - local[axis]!)) <= radius);
    if (hits.length === 0) return setStatus('No support here: right-click a support, or the model within {radius} mm of one.', { radius });
    dispatch({ type: 'batch', commands: hits.map((contact) => removeContact(unit, contact.id)) });
    setStatus('Removed 1 support; removals persist through regeneration.', { n: hits.length }, 'Removed {n} supports; removals persist through regeneration.');
  }, [dispatch, removeContact]);

  const onRemoveContact = useCallback((unitId: string, contactId: string) => {
    if (editModeRef.current === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    const contact = unit && unitContacts(unit).find((candidate) => candidate.id === contactId);
    if (unit && contact) eraseNear(unit, [...contact.position]);
  }, [eraseNear]);

  const onEditMiss = useCallback(() => {
    if (editModeRef.current === 'zones') return;
    if (editTool === 'add') setStatus('Nothing under the cursor: click the model to add, right-click a support to remove.');
    else if (selectStyle === 'click') setStatus('No support here: click a support to select it.');
    else setStatus('Nothing under the cursor: start the drag on the model.');
  }, [editTool, selectStyle, setStatus]);

  const onErase = useCallback((unitId: string, point: [number, number, number]) => {
    if (editModeRef.current === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (unit) eraseNear(unit, inverseTransformPoint(unit.transform, point));
  }, [eraseNear]);

  const onToggleContact = useCallback((unitId: string, contactId: string) => {
    if (editModeRef.current !== 'edit' || unitId !== sceneRef.current.activeUnitId) return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    // A support deleted a moment ago can still be under the cursor until the mesh rebuilds.
    if (!unit || !unitContacts(unit).some((contact) => contact.id === contactId)) return;
    setSelection((current) => toggleSelection(current, contactId));
  }, []);

  const onPaint = useCallback((unitId: string, center: Vector, facing: Vector, mode: BrushMode) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (editModeRef.current !== 'edit' || !unit || unit.id !== sceneRef.current.activeUnitId) return;
    const ids = contactsInBrush(unitContacts(unit), center, brushRadius, facing);
    setSelection((current) => paintSelection(current, ids, mode));
  }, [brushRadius]);

  // Exactly the selected supports go, in one undo step; the tool stays as it was.
  const deleteSelected = useCallback(() => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    if (!unit) return;
    const alive = new Set(unitContacts(unit).map((contact) => contact.id));
    const ids = [...selection].filter((id) => alive.has(id));
    setSelection(NO_SELECTION);
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: deleteCommands(unit, ids) });
    setStatus('Deleted 1 support.', { n: ids.length }, 'Deleted {n} supports.');
  }, [dispatch, selection, setStatus]);

  const [exporting, setExporting] = useState(false);
  const runExport = async (kind: ExportKind) => {
    const current = sceneRef.current;
    const files = planExport(current, kind);
    if (files.length === 0) return setStatus(kind.startsWith('active') && !current.activeUnitId ? 'Select an object to export.' : 'Nothing to export for this mode.');
    const used = new Set(files.flatMap((file) => file.parts.map((part) => part.unitId)));
    const units = exportUnits(current, kind).filter(([unit]) => used.has(unit.id));
    setExporting(true);
    setStatus('Preparing export at full resolution.');
    // The check runs alongside, on the analysis workers, so the export can warn about gaps.
    const checking = runCheck(units.map(([unit]) => unit)).catch(() => ({ spots: 0, inZone: 0 }));
    const label = { key: files.length === 1 ? 'Exporting {name}' : 'Exporting {n} files', vars: { name: files[0]!.fileName, n: files.length } };
    try {
      const written = await exporter().exportFiles(units, files, (fraction, stage) => setTask('export', { label, stage, fraction }));
      for (const file of written) {
        const url = URL.createObjectURL(new Blob([file.buffer], { type: 'model/stl' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.fileName;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const names = written.map((file) => file.fileName).join(', ');
      // Spots inside no-support zones are left unsupported on purpose: not counted, only mentioned.
      const { spots, inZone } = await checking;
      if (spots > 0 && inZone > 0) setStatus('Exported {files}. 1 spot may print unsupported ({m} more inside no-support zones): see Check supports.', { files: names, n: spots, m: inZone }, 'Exported {files}. {n} spots may print unsupported ({m} more inside no-support zones): see Check supports.');
      else if (spots > 0) setStatus('Exported {files}. 1 spot may print unsupported: see Check supports.', { files: names, n: spots }, 'Exported {files}. {n} spots may print unsupported: see Check supports.');
      else if (inZone > 0) setStatus('Exported {files}. 1 unsupported spot is inside a no-support zone.', { files: names, n: inZone }, 'Exported {files}. {n} unsupported spots are inside no-support zones.');
      else setStatus('Exported {files}.', { files: names });
    } catch (error) {
      setStatus('Export failed: {error}', { error: error instanceof Error ? error.message : t('support building error') });
    } finally {
      setExporting(false);
      setTask('export', undefined);
    }
  };

  // ---- Keyboard ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        if (event.shiftKey) dispatchHistory({ type: 'redo' });
        else undo();
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatchHistory({ type: 'redo' });
      } else if (event.key === 'Tab') {
        event.preventDefault();
        if (editMode !== 'zones') toggleEditMode();
      } else if (editMode === 'zones' && (event.key === 'Escape' || (event.key === 'Enter' && !enterActsOn(target)))) {
        event.preventDefault();
        closeZones();
      } else if (editMode === 'edit' && selection.size > 0 && (event.key === 'Delete' || event.key === 'Backspace')) {
        event.preventDefault();
        deleteSelected();
      } else if (editMode === 'edit' && selection.size > 0 && event.key === 'Escape') {
        event.preventDefault();
        setSelection(NO_SELECTION);
      } else if (editMode === 'edit' && (event.key === 'Escape' || (event.key === 'Enter' && !enterActsOn(target)))) {
        event.preventDefault();
        toggleEditMode();
      } else if (event.key === 'Delete' && editMode === 'off') {
        deleteUnits();
      } else if (editMode === 'off' && event.key.toLowerCase() === 'g') {
        setGizmoMode('translate');
      } else if (editMode === 'off' && event.key.toLowerCase() === 'r') {
        setGizmoMode('rotate');
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [closeZones, deleteSelected, deleteUnits, editMode, selection, toggleEditMode, undo]);

  const dropImport = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    void importFiles([...event.dataTransfer.files]);
  };

  const contactCounts = activeUnit ? {
    auto: unitContacts(activeUnit).filter((contact) => !contact.id.startsWith('manual-')).length,
    manual: activeUnit.manual.length,
    removed: unitRemovedCount(activeUnit),
  } : undefined;
  const selectedCount = scene.selectedUnitIds.length;
  const scopeLabel = selectedCount > 0 ? t('{n} selected', { n: selectedCount }) : t('all {n}', { n: scene.units.length });
  // Once every unit in scope has supports, the one generate action becomes Regenerate.
  const scopeUnits = targets(scene);
  const scopeGenerated = scopeUnits.length > 0 && scopeUnits.every((unit) => unit.supports);

  return <main>
    <header>
      <div className="brand"><h1><BrandLogo /></h1><small>{t('Resin Support Studio')}</small></div>
      <div className="header-actions">
        <div className="segmented lang" role="group" aria-label={t('Language')}>
          {LANGS.map((entry) => <button key={entry.lang} lang={entry.lang} className={lang === entry.lang ? 'active' : ''} aria-pressed={lang === entry.lang} onClick={() => chooseLanguage(entry.lang)}>{entry.label}</button>)}
        </div>
        <div className="toolbar-group">
          <button onClick={undo} disabled={!canUndo} title={t('Undo (Ctrl+Z)')}>{t('Undo')}</button>
          <button onClick={() => dispatchHistory({ type: 'redo' })} disabled={history.future.length === 0} title={t('Redo (Ctrl+Shift+Z)')}>{t('Redo')}</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => setModelVisible((visible) => !visible)}>{modelVisible ? t('Hide models') : t('Show models')}</button>
          <button onClick={() => setWireframe((value) => !value)}>{wireframe ? t('Solid') : t('Wireframe')}</button>
        </div>
        <button className={scopeGenerated ? 'primary regen' : 'primary'} onClick={() => generate()} disabled={scene.units.length === 0}>{pendingCount > 0 ? t('Generating supports') : t(scopeGenerated ? 'Regenerate supports for {scope}' : 'Generate supports for {scope}', { scope: scopeLabel })}</button>
      </div>
    </header>
    <section className="workspace">
      <aside className="panel left">
        <label className="drop">
          <input type="file" multiple accept=".stl,.glb,.gltf" onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          <strong>{t('Import models')}</strong>
          <small>{t('STL, GLB or glTF. Files stay on this device.')}</small>
        </label>
        <section>
          <h3>{t('Objects')}{scene.units.length > 0 && <small className="count">{scene.units.length}</small>}</h3>
          {scene.units.length === 0 ? <p className="help">{t('Each STL, and each mesh inside a glTF, becomes its own object.')}</p> : <ul className="units">
            {scene.units.map((unit, index) => {
              const selected = scene.selectedUnitIds.includes(unit.id);
              return <li key={unit.id}>
                <button className={`unit${selected ? ' selected' : ''}${unit.id === scene.activeUnitId ? ' active' : ''}`} onClick={(event) => onSelect(unit.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                  <b>{resolveSettings(unit.settings).labelText || labelForIndex(index)}</b>
                  <span title={unit.name}>{unit.name}</span>
                  {/* Compact row: the support count alone, spelled out on hover. */}
                  <small title={unit.supports ? plural(unitContacts(unit).length, '1 support', '{n} supports') : t('No supports yet')}>{unit.supports ? unitContacts(unit).length : '–'}</small>
                </button>
              </li>;
            })}
          </ul>}
          <div className="row">
            <button onClick={() => dispatch({ type: 'selection/set', unitIds: scene.units.map((unit) => unit.id), ...(scene.units[0] ? { activeUnitId: scene.activeUnitId ?? scene.units[0].id } : {}) })} disabled={scene.units.length === 0}>{t('Select all')}</button>
            <button onClick={deleteUnits} disabled={selectedCount === 0}>{t('Delete')}</button>
          </div>
        </section>
        <section>
          <h3>{t('Transform')}</h3>
          <div className="segmented">
            {(['none', 'translate', 'rotate'] as const).map((mode) => <button key={mode} className={gizmoMode === mode ? 'active' : ''} aria-pressed={gizmoMode === mode} onClick={() => setGizmoMode(mode)} disabled={editMode !== 'off'}>{t(mode === 'none' ? 'Select' : mode === 'translate' ? 'Move' : 'Rotate')}</button>)}
          </div>
        </section>
        <section>
          <h3>{t('Edit supports')}</h3>
          <button className={editMode === 'edit' ? 'primary' : ''} aria-pressed={editMode === 'edit'} onClick={toggleEditMode} disabled={editMode === 'zones' || (editMode === 'off' && !activeUnit)}>
            {editMode === 'edit' ? t('Done editing') : t('Enter Support Edit Mode')}
          </button>
          <p className="help">{activeUnit ? t('Add or remove supports by clicking the model. Tab toggles.') : t('Select an object first.')}</p>
        </section>
        <section>
          <h3>{t('No-support zones')}{activeUnit && <small className="count">{activeUnit.zones.length ? t('Painted') : t('None')}</small>}</h3>
          <div className="row">
            <button onClick={() => openZones(editMode === 'edit' ? 'edit' : 'off')} disabled={!activeUnit || editMode === 'zones'}>{t('Paint zones')}</button>
            <button className="danger" aria-label={t('Clear all zones')} onClick={() => activeUnit && clearZones(activeUnit.id)} disabled={!activeUnit?.zones.length}>{t('Clear')}</button>
          </div>
          <p className="help">{t('Paint where supports must not grow. Manual supports stay.')}</p>
        </section>
        <section>
          <h3>{t('Supports for {scope}', { scope: scopeLabel })}</h3>
          <button className={scopeGenerated ? 'primary regen' : 'primary'} onClick={() => generate()} disabled={scene.units.length === 0}>{t(scopeGenerated ? 'Regenerate' : 'Generate supports')}</button>
          <button onClick={clearManual} disabled={scene.units.length === 0}>{t('Clear manual edits')}</button>
          <button onClick={removeSupports} disabled={scene.units.length === 0}>{t('Remove supports')}</button>
        </section>
        <section className="support-check">
          <h3>{t('Check supports')}</h3>
          <button onClick={checkSupports} disabled={!scene.units.some((unit) => unit.supports)}>{t('Check for unsupported spots')}</button>
          {currentProblems.length > 0 && <ul className="problems">
            {currentProblems.slice(0, 12).map((problem, index) => <li key={`${problem.unitId}-${index}`}>
              <span className={`problem-kind ${problem.kind}`} aria-hidden="true" />
              <span className="problem-text">
                {problem.kind === 'island' ? t('Island') : t('Uncovered overhang')}
                <small>{unitName(problem.unitId)}{problem.kind === 'overhang' ? ` · ${t('{n} mm²', { n: Math.round(problem.area) })}` : ''}{problem.inZone ? ` · ${t('in a no-support zone')}` : ''}</small>
              </span>
              <button onClick={() => showProblem(problem)}>{t('Show')}</button>
              <button className="primary" onClick={() => fixProblem(problem)}>{t('Fix')}</button>
            </li>)}
          </ul>}
          {currentProblems.length > 12 && <p className="help">{t('and {n} more', { n: currentProblems.length - 12 })}</p>}
          <p className="help">{t('Finds islands and overhangs no contact reaches, before you print.')}</p>
        </section>
      </aside>
      <section
        className={`viewport${isDraggingOver ? ' viewport--dropping' : ''}${editMode === 'off' ? '' : ' viewport--editing'}${editMode === 'zones' ? ' viewport--zones' : ''}`}
        onDragOver={(event) => { event.preventDefault(); setIsDraggingOver(true); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingOver(false); }}
        onDrop={dropImport}
      >
        <ObjectViewport
          scene={scene}
          supportMeshes={supportMeshes}
          editMode={editMode}
          gizmoMode={gizmoMode}
          modelVisible={modelVisible}
          wireframe={wireframe}
          onSelect={onSelect}
          onTransform={onTransform}
          onAddContact={onAddContact}
          onRemoveContact={onRemoveContact}
          onErase={onErase}
          onEditMiss={onEditMiss}
          editTool={editTool}
          {...(editMode === 'edit' && editTool === 'select' && selectStyle === 'brush' ? { brush: { radius: brushRadius, mode: brushMode } } : {})}
          selection={selection}
          onToggleContact={onToggleContact}
          onPaint={onPaint}
          {...(editMode === 'zones' ? { zoneBrush: { radius: zoneRadius, kind: zoneKind } } : {})}
          showZones={editMode === 'zones' ? 'full' : editMode === 'edit' ? 'faint' : 'off'}
          onZoneStroke={onZoneStroke}
          problems={currentProblems}
          {...(focus ? { focus } : {})}
          {...(viewRequest ? { viewRequest } : {})}
          tipsOnly={tipsOnly}
          onBelowPlate={setBelowPlate}
        />
        <div className="viewport-view" role="group" aria-label={t('View')}>
          <button
            className={tipsOnly || belowPlate ? 'active' : ''}
            aria-pressed={tipsOnly || belowPlate}
            onClick={() => setTipsOnly((value) => !value)}
            disabled={belowPlate}
            title={t(belowPlate ? 'Below the plate: only contact tips show. Orbit above it for full supports.' : 'Show only the contact tips: no pillars, braces or raft. Export stays full.')}
          >{t('Tips only')}</button>
          <button onClick={() => requestView('fit')} disabled={scene.units.length === 0} title={t('Frame the selection from the current angle')}>{t('Fit view')}</button>
          <button onClick={() => requestView('bottom')} disabled={scene.units.length === 0} title={t('Look straight up at the selection to check contact points')}>{t('Bottom view')}</button>
        </div>
        {isDraggingOver && <div className="viewport-drop-overlay">{t('Drop to import')}</div>}
        <ProgressBar tasks={[...tasks.values()]} />
        {editMode === 'off' ? <>
          <div className="viewport-object-status">{activeUnit ? activeUnit.name : t('Nothing selected')}</div>
          <button className="viewport-edit-toggle" onClick={toggleEditMode} disabled={!activeUnit} title={activeUnit ? t('Add or remove supports by clicking (Tab)') : t('Select an object first.')}>
            {t('Edit supports')}
          </button>
          <div className="viewport-note">{t('Millimetres. Build plate at zero.')}</div>
        </> : editMode === 'zones' ? <>
          <div className="edit-frame" aria-hidden="true" />
          <div className="edit-badge" role="status">
            {t('Painting no-support zones')}<span>{activeUnit?.name}</span>
          </div>
          <div className="edit-bar">
            <div className="edit-row">
              <div className="segmented" role="group" aria-label={t('Zone brush')}>
                <button aria-pressed={zoneKind === 'paint'} onClick={() => setZoneKind('paint')}>{t('Paint')}</button>
                <button aria-pressed={zoneKind === 'erase'} onClick={() => setZoneKind('erase')}>{t('Erase')}</button>
              </div>
              <label className="edit-size">
                {t('Brush size')}
                <input type="range" min={0.5} max={10} step={0.5} value={zoneRadius} onChange={(event) => setZoneRadius(Number(event.target.value))} />
                <output>{t('{n} mm', { n: zoneRadius })}</output>
              </label>
              <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
            </div>
            <div className="edit-row">
              <button className="danger" onClick={() => activeUnit && clearZones(activeUnit.id)} disabled={!activeUnit?.zones.length}>{t('Clear all zones')}</button>
              <button className="primary edit-done" onClick={closeZones}>{t('Done')} <kbd>Esc</kbd></button>
            </div>
          </div>
        </> : <>
          <div className="edit-frame" aria-hidden="true" />
          <div className="edit-badge" role="status">
            {t('Support Edit Mode')}<span>{activeUnit?.name}</span>
            <b>{t(editTool === 'add' ? 'Click the model to add supports' : selectStyle === 'brush' ? 'Drag over supports to select' : 'Click supports to select')}</b>
          </div>
          <div className="edit-bar">
            <div className="edit-row">
              <div className="segmented" role="group" aria-label={t('Edit tool')}>
                <button aria-pressed={editTool === 'add'} onClick={() => setEditTool('add')}>{t('Add supports')}</button>
                <button aria-pressed={editTool === 'select'} onClick={() => setEditTool('select')}>{t('Select supports')}</button>
              </div>
              {editTool === 'select' && <div className="segmented" role="group" aria-label={t('How to select')}>
                <button aria-pressed={selectStyle === 'click'} onClick={() => setSelectStyle('click')}>{t('Click')}</button>
                <button aria-pressed={selectStyle === 'brush'} onClick={() => setSelectStyle('brush')}>{t('Drag over')}</button>
              </div>}
              {editTool === 'select' && selectStyle === 'brush' && <>
                <div className="segmented" role="group" aria-label={t('Dragging over supports')}>
                  <button aria-pressed={brushMode === 'select'} onClick={() => setBrushMode('select')}>{t('Select')}</button>
                  <button aria-pressed={brushMode === 'unselect'} onClick={() => setBrushMode('unselect')}>{t('Unselect')}</button>
                </div>
                <label className="edit-size">
                  {t('Size')}
                  <input type="range" min={0.5} max={10} step={0.5} value={brushRadius} onChange={(event) => setBrushRadius(Number(event.target.value))} />
                  <output>{t('{n} mm', { n: brushRadius })}</output>
                </label>
              </>}
              {/* Selecting: Ctrl+click selects like a plain click, so only right-click removes. */}
              <span className="edit-hint"><kbd>{t('Right-click')}</kbd>{editTool === 'add' && <> / <kbd>Ctrl</kbd>+<kbd>{t('Click')}</kbd></>} {t('remove')}</span>
              <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
            </div>
            <div className="edit-row">
              <button onClick={() => openZones('edit')}>{t('Edit no-support zones →')}</button>
              {selection.size > 0 && <>
                <span className="edit-count">{t('{n} selected', { n: selection.size })}</span>
                <button className="danger" onClick={deleteSelected}>{t('Delete')}</button>
                <button onClick={() => setSelection(NO_SELECTION)}>{t('Clear selection')}</button>
              </>}
              <button className="primary edit-done" onClick={toggleEditMode}>{t('Done')} <kbd>Esc</kbd></button>
            </div>
          </div>
        </>}
      </section>
      <aside className="panel right">
        <h2>{t('Support settings')}{activeUnit ? <small>{activeUnit.name}{selectedCount > 1 ? ` ${t('and {n} more', { n: selectedCount - 1 })}` : ''}</small> : null}</h2>
        {!activeUnit && <p className="help">{t('Select an object to edit its settings. Changes apply to every selected object.')}</p>}
        <SettingsPanel
          settings={activeSettings}
          autoLabel={activeIndex >= 0 ? labelForIndex(activeIndex) : 'A'}
          disabled={!activeUnit}
          onChange={onSettingChange}
          onPreset={(preset) => changeSettings((settings) => applyPreset(preset, settings), false)}
          onRoofMode={(mode) => changeSettings((settings) => setRoofMode(settings, mode), false)}
        />
        <section className="export">
          <h3>{t('Export STL')}</h3>
          {EXPORTS.map((entry) => <button key={entry.kind} onClick={() => void runExport(entry.kind)} disabled={scene.units.length === 0 || exporting}>{t(entry.label)}</button>)}
          <p className="help">{t('Exports match the viewport at full resolution. Source models are never changed.')}</p>
        </section>
      </aside>
    </section>
    <footer>
      <span>{plural(scene.units.length, '1 object', '{n} objects')}</span>
      {activeUnit && <span>{t('{n} triangles', { n: (activeUnit.source.indices.length / 3).toLocaleString() })}</span>}
      {contactCounts && <span>{t('{auto} automatic, {manual} manual, {removed} removed', contactCounts)}</span>}
      <strong>{translateMessage(status)}</strong>
    </footer>
  </main>;
}
