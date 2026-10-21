import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Object3D } from 'three';
import { labelForIndex } from './core/analysis/mesh';
import type { SupportProblem } from './core/analysis/supportCheck';
import type { SupportPoint } from './core/analysis/types';
import JobActivityPanel from './components/JobActivity';
import { AnalysisClient } from './workers/analysisClient';
import { ImportClient } from './workers/importClient';
import { createAnalysisWorker, createImportWorker, createMeshWorker } from './workers/factories';
import { SupportMeshClient } from './workers/meshClient';
import type { PreparedMesh } from './workers/importProtocol';
import { codedJobError } from './workers/jobErrors';
import ObjectViewport, { acceptModelFile, type GizmoMode, type ViewRequest } from './components/ObjectViewport';
import SettingsPanel from './components/SettingsPanel';
import { BrandLogo } from './components/BrandLogo';
import { hint } from './components/hint';
import { editModeButton, zonesButton, type ModeButton } from './editing/modeButtons';
import { canUndo as historyCanUndo, createSceneHistory, redoScene, undoScene, withSceneCommand, type SceneHistory } from './state/history';
import { gltfRawMeshes, placeImportedUnits } from './state/import';
import { setDisplayMesh, setPrebuiltBvh } from './state/meshExtras';
import { detectRuntime, memoryInfo } from './state/runtime';
import { assertGenerateMemory, assertMemoryCapacity, assertPlateCapacity, assertTriangleCapacity, memoryCapBytes, meshTier, refusalLimit, TRIANGLE_BUDGET } from './core/budget';
import { TriangleGate } from './core/jobGate';
import { PlateLedger, type PlateScene } from './core/plateLedger';
import { estimateTriangles, ESTIMATE_HEAD_BYTES } from './core/import/estimate';
import { emptyScene, type PrintScene, type PrintUnit, type SceneCommand, type SupportSettings } from './state/project';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformPoint, type ModelTransform } from './state/transform';
import { exportUnits, planExport, type ExportKind } from './supports/export';
import { meshBounds, type GeneratedSupportMesh } from './core/supports/mesh';
import type { Vector } from './core/vec3';
import { problemInZone, type ZoneStamp } from './core/supports/zones';
import { deleteCommands } from './supports/selection';
import { TIPS_START, tipsCamera, tipsShown, tipsToggle } from './editing/view';
import { applyPreset, defaultSupportSettings, setRoofMode, updateSetting, type LiveSupportSettings, type SettingKey } from './core/supports/settings';
import { checkJobOf, orientationOf, placementCommands, placementJobOf, resolveSettings, supportJobOf, unitContacts, unitRemovedCount, unitSupportMesh } from './supports/unitSupports';
import { keyAction } from './editing/keys';
import { initialSession, reduceSession, startsEditing, type SessionEvent } from './editing/session';
import { busyStatus, missStatus, sessionStatus } from './editing/status';
import { CodedError, errorStatus } from './editing/errors';
import { checkStatus, exportStatus, joinRun, tallyChecks, type CheckTally } from './editing/check';
import { toastAlive, undoToast, type UndoAction, type UndoToast as UndoToastState } from './editing/toast';
import UndoToast from './components/UndoToast';
import { BrushIcon, PointerIcon } from './components/ToolIcons';
import type { BrushMode, ZonesReturn } from './editing/types';
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

// Labels are i18n keys, translated where shown.
const EXPORTS: { kind: ExportKind; label: string; hint: string }[] = [
  { kind: 'active-printable', label: 'Active object with model', hint: 'One STL file: the active object and its supports' },
  { kind: 'active-supports', label: 'Active object, supports only', hint: 'One STL file: only the supports of the active object' },
  { kind: 'separate-printable', label: 'Each object with model', hint: 'One STL file per object, each with its supports' },
  { kind: 'separate-supports', label: 'Each object, supports only', hint: 'One STL file per object, supports only' },
  { kind: 'whole-printable', label: 'Whole plate in one file', hint: 'One STL file: every object and its supports, as placed on the plate' },
];

/** A support check finding, its position in the unit's local frame. */
export interface UnitProblem extends SupportProblem {
  unitId: string;
  /** The spot lies inside a no-support zone, which is why it has no support. */
  inZone: boolean;
}

/** Runtime tier for the triangle budgets (web, or an Electron-like desktop shell). */
const RUNTIME = detectRuntime();
/** A .gltf (JSON) up to this size is read whole for its pre-parse triangle count. */
const GLTF_ESTIMATE_BYTES = 16 * 1024 * 1024;

const triangleCount = (unit: PrintUnit) => unit.source.indices.length / 3;
/** Heavy-job admission for the whole app: placements, preview builds and exports share it. */
const HEAVY_JOBS = new TriangleGate(refusalLimit(RUNTIME));
/** The plate guard across imports that run at once: each holds what it adds while it reads. */
const PLATE = new PlateLedger();
/** A .glb's JSON chunk up to this size is read for its pre-parse triangle count. */
const GLB_JSON_ESTIMATE_BYTES = 64 * 1024 * 1024;

/** How much of a file the pre-parse estimate reads: a whole small .gltf, a .glb's JSON chunk, else the head. */
async function estimateHeadBytes(file: File): Promise<number> {
  if (/\.gltf$/i.test(file.name) && file.size <= GLTF_ESTIMATE_BYTES) return file.size;
  if (/\.glb$/i.test(file.name) && file.size >= 20) {
    const json = new DataView(await file.slice(0, 20).arrayBuffer()).getUint32(12, true);
    if (20 + json <= GLB_JSON_ESTIMATE_BYTES) return Math.min(file.size, 20 + json);
  }
  return ESTIMATE_HEAD_BYTES;
}

const isAbort = (error: unknown) => error instanceof Error && error.name === 'AbortError';
/** Why a heavy object cannot be edited by hand, and what still works. */
const HEAVY_EDIT = 'Too detailed to edit by hand ({n} triangles). Generate and export still use the full model.';
const isHeavy = (unit: PrintUnit | undefined) => unit !== undefined && meshTier(triangleCount(unit), RUNTIME) === 'heavy';


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
  // Support Edit Mode / zones mode, tools and selection (src/editing/session): view state of the
  // active object, never in history. `send` steps it and says what changed on the status line.
  const [session, setSession] = useState(initialSession);
  const sessionRef = useRef(session);
  const { mode: editMode, tool: editTool, selectStyle, brushMode, brushRadius, selection, zoneKind, zoneRadius } = session;
  /** The tool as it is now, for canvas clicks (the canvas renders a step behind the DOM). */
  const liveTool = useCallback(() => sessionRef.current, []);
  // Like Blender's Support Edit Mode, undo inside the mode stops at the scene it was entered with.
  const historyRef = useRef(history);
  historyRef.current = history;
  /** The scene the mode was entered with (a snapshot, so it survives the history cap). */
  const undoFloor = useRef<PrintScene | undefined>(undefined);
  const send = useCallback((event: SessionEvent) => {
    const previous = sessionRef.current;
    const next = reduceSession(previous, event);
    if (next === previous) {
      const refusal = sessionStatus(previous, next, event);
      if (refusal) setStatusMessage(refusal);
      return;
    }
    if (startsEditing(previous, next)) undoFloor.current = historyRef.current.present;
    sessionRef.current = next;
    setSession(next);
    const message = sessionStatus(previous, next, event);
    if (message) setStatusMessage(message);
  }, []);
  const canUndo = historyCanUndo(history, editMode === 'off' ? undefined : undoFloor.current);
  /** Steps back unless the mode's floor stops it; false when nothing was undone. */
  const undo = useCallback((): boolean => {
    if (!historyCanUndo(historyRef.current, sessionRef.current.mode === 'off' ? undefined : undoFloor.current)) return false;
    dispatchHistory({ type: 'undo' });
    return true;
  }, []);
  // Destructive actions run at once and offer Undo on a toast (editing/toast) instead of asking first.
  const [toast, setToast] = useState<UndoToastState>();
  const toastSeq = useRef(0);
  const offerUndo = useCallback((action: UndoAction) => setToast(undoToast(++toastSeq.current, action)), []);
  const closeToast = useCallback(() => setToast(undefined), []);
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [focus, setFocus] = useState<{ point: [number, number, number]; area: number; seq: number }>();
  const [viewRequest, setViewRequest] = useState<ViewRequest>();
  const requestView = useCallback((kind: ViewRequest['kind']) => setViewRequest((current) => ({ kind, seq: (current?.seq ?? 0) + 1 })), []);
  // Contact tips view (Blender: Only Tip + Ctrl+Numpad 7): view only, settings and export untouched.
  /** Drag over → Circle size: the circle shows in the view while its slider moves, and 800 ms after. */
  const [circlePreview, setCirclePreview] = useState(false);
  const circleTimer = useRef<ReturnType<typeof setTimeout>>();
  const previewCircle = useCallback((moving: boolean) => {
    clearTimeout(circleTimer.current);
    if (moving) setCirclePreview(true);
    else circleTimer.current = setTimeout(() => setCirclePreview(false), 800);
  }, []);
  useEffect(() => () => clearTimeout(circleTimer.current), []);
  /** Tips only: the user's choice, else on by itself below the plate (editing/view). */
  const [tips, setTips] = useState(TIPS_START);
  const onBelowPlate = useCallback((below: boolean) => setTips((state) => tipsCamera(state, below)), []);
  /** Unit to open in Support Edit Mode once it is the active unit ("Fix" on a check finding). */
  const [editTarget, setEditTarget] = useState<string>();
  const [modelVisible, setModelVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const activeUnit = scene.units.find((unit) => unit.id === scene.activeUnitId);
  const activeIndex = activeUnit ? scene.units.indexOf(activeUnit) : -1;
  /** A heavy active object takes no hand edits (Edit Mode, zones); generation and export still run. */
  const activeHeavy = isHeavy(activeUnit);
  const heavyHint = activeHeavy ? t(HEAVY_EDIT, { n: triangleCount(activeUnit!).toLocaleString() }) : undefined;
  /** A large model on the plate keeps the tips view on above the plate too (to stay smooth), until switched off. */
  const largeTips = useMemo(() => scene.units.some((unit) => meshTier(triangleCount(unit), RUNTIME) === 'large'), [scene.units]);
  // Painting zones shows the tips at both ends of every support over the blue layer (editing/view).
  const tipsOn = tipsShown(tips, largeTips, editMode === 'zones');
  // Support Edit Mode belongs to the active unit: it ends when that unit goes (delete, undo).
  // The selection empties on leaving a mode or changing the active object; ids that no longer
  // exist (undo, regeneration) drop out.
  useEffect(() => send({ type: 'activeUnitChanged', id: activeUnit?.id }), [activeUnit?.id, send]);
  const activeContacts = useMemo(() => (activeUnit ? unitContacts(activeUnit) : []), [activeUnit]);
  useEffect(() => send({ type: 'contactsChanged', contacts: activeContacts }), [activeContacts, send]);
  const activeSettings = useMemo(() => resolveSettings(activeUnit?.settings), [activeUnit?.settings]);
  const targets = useCallback((current: PrintScene) => {
    const selected = current.units.filter((unit) => current.selectedUnitIds.includes(unit.id));
    return selected.length > 0 ? selected : current.units;
  }, []);

  // ---- Progress ------------------------------------------------------------------------
  // Every worker job reports to the job activity list (workers/jobActivity) by itself.
  const unitName = useCallback((unitId: string) => {
    const index = sceneRef.current.units.findIndex((unit) => unit.id === unitId);
    const unit = sceneRef.current.units[index];
    return unit ? `${resolveSettings(unit.settings).labelText || labelForIndex(index)} ${unit.name}` : 'unit';
  }, []);

  // ---- Background work -----------------------------------------------------------------
  // Heavy work runs in workers by role: preview supports, export (full-resolution supports and
  // STL files), placement and checks (a small pool, one model per worker) and imports. Every
  // job reports to the job activity list; stale jobs are dropped or stopped.
  const workers = useRef<{ preview?: SupportMeshClient; export?: SupportMeshClient; analysis?: AnalysisClient; importer?: ImportClient }>({});
  const preview = useCallback(() => (workers.current.preview ??= new SupportMeshClient({ create: createMeshWorker, gate: HEAVY_JOBS })), []);
  const exporter = useCallback(() => (workers.current.export ??= new SupportMeshClient({ create: createMeshWorker, mode: 'per-job', gate: HEAVY_JOBS })), []);
  const analysis = useCallback(() => (workers.current.analysis ??= new AnalysisClient(createAnalysisWorker, undefined, undefined, HEAVY_JOBS)), []);
  const importer = useCallback(() => (workers.current.importer ??= new ImportClient(createImportWorker)), []);
  useEffect(() => () => {
    // An import worker lives only while its import runs.
    const { preview: p, export: e, analysis: a } = workers.current;
    p?.dispose(); e?.dispose(); a?.dispose();
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
    if (placing.current.delete(unitId)) setPendingCount(placing.current.size);
    setProblems((current) => {
      if (!current.has(unitId)) return current;
      const next = new Map(current);
      next.delete(unitId);
      return next;
    });
  }, []);

  useEffect(() => {
    const ids = new Set(scene.units.map((unit) => unit.id));
    // Imported units the scene now shows are counted by the scene, no longer held by their import.
    PLATE.settle(ids);
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
      buildTimers.current.set(unit.id, window.setTimeout(() => {
        buildTimers.current.delete(unit.id);
        if (requested.current.get(unit.id)?.unit !== unit) return;
        preview().build(unit.id, supportJobOf(unit, index, 'preview'), { key: 'Building supports for {name}', vars: { name: unitName(unit.id) } }).then((mesh) => {
          if (!mesh || requested.current.get(unit.id)?.unit !== unit) return;
          setSupportMeshes((current) => new Map(current).set(unit.id, mesh));
        }, (error: unknown) => setStatusMessage(errorStatus('build', codedJobError(error), { name: unit.name })));
      }, BUILD_DELAY_MS));
    });
  }, [scene.units, forgetUnit, preview, setStatus, unitName]);

  // ---- Placement -----------------------------------------------------------------------
  const generate = useCallback((unitIds?: readonly string[]) => {
    const current = sceneRef.current;
    const units = unitIds ? current.units.filter((unit) => unitIds.includes(unit.id)) : targets(current);
    if (units.length === 0) return setStatus('Import a model before generating supports.');
    // The job gate runs at most the refusal limit's triangles at once; refuse when even that
    // could not fit in half the memory a small device reports (deviceMemory under 8; 8 is clamped).
    const generating = units.reduce((sum, unit) => sum + triangleCount(unit), 0);
    try {
      assertGenerateMemory(Math.min(generating, refusalLimit(RUNTIME)), RUNTIME, memoryInfo().deviceMemoryGb);
    } catch (error) {
      return setStatusMessage(errorStatus('place', codedJobError(error)));
    }
    for (const unit of units) {
      const settings = resolveSettings(unit.settings);
      // Placement runs on the rotated but untranslated model (placementJobOf) so moving a unit
      // never shifts the sampling lattice; automatic IDs (and suppressions) stay stable.
      const orientation = orientationOf(unit);
      const key = `place:${unit.id}`;
      placing.current.add(unit.id);
      analysis().place(key, placementJobOf(unit), { key: 'Placing contacts on {name}', vars: { name: unitName(unit.id) } }).then((result) => {
        if (!result) return; // replaced by a newer request for this unit
        placing.current.delete(unit.id);
        setPendingCount(placing.current.size);
        const now = sceneRef.current.units.find((candidate) => candidate.id === unit.id);
        if (!now) return;
        // Applied to the unit as it is now: a move made meanwhile stays, and the lowest model point
        // sits Lift Height above the plate (y = 0) where the supports stand. A rotation made
        // meanwhile turned the contacts away: place again for the new orientation.
        const commands = placementCommands(now, orientation, result, settings.liftHeight);
        if (!commands) {
          generate([unit.id]);
          setStatus('{name} was rotated while its contacts were placed: placing them again.', { name: unit.name });
          return;
        }
        dispatch({ type: 'batch', commands });
        setStatus('{name}: {n} automatic contacts generated.', { name: unit.name, n: result.points.length });
      }, (error: unknown) => {
        placing.current.delete(unit.id);
        setPendingCount(placing.current.size);
        if (isAbort(error)) setStatus('Support placement cancelled; existing supports kept.');
        else setStatusMessage(errorStatus('place', codedJobError(error), { name: unit.name }));
      });
    }
    setPendingCount(placing.current.size);
    setStatus('Analysing overhangs for 1 object.', { n: units.length }, 'Analysing overhangs for {n} objects.');
  }, [analysis, dispatch, setStatus, targets, unitName]);

  // ---- Support check -------------------------------------------------------------------
  /** Running checks by unit id, with the unit version they check (a second caller joins, editing/check). */
  const checksRunning = useRef(new Map<string, { token: object; promise: Promise<SupportProblem[] | undefined> }>());
  /**
   * Checks the units' current contacts; resolves with the spots found outside and inside no-support
   * zones, and how many units' checks did not finish (replaced by a newer check of a changed unit).
   */
  const runCheck = useCallback(async (units: readonly PrintUnit[]): Promise<CheckTally> => {
    const checked = await Promise.all(units.filter((unit) => unit.supports).map(async (unit) => {
      const orientation = orientationOf(unit);
      const key = `check:${unit.id}`;
      {
        const found = await joinRun(checksRunning.current, unit.id, unit, () => analysis().check(key, checkJobOf(unit), { key: 'Checking supports on {name}', vars: { name: unitName(unit.id) } }));
        if (!found) return undefined;
        // Spots face down on the plate: plate down in unit-local space keeps a zone on the far side of a thin floor out.
        const down = inverseTransformDirection(orientation, [0, -1, 0]);
        const items = found.map((problem) => {
          const position = inverseTransformPoint(orientation, problem.position);
          return { ...problem, unitId: unit.id, position, inZone: problemInZone(unit.zones, position, down) };
        });
        setProblems((current) => new Map(current).set(unit.id, { unit, items }));
        const inZone = items.filter((problem) => problem.inZone).length;
        return { spots: items.length - inZone, inZone };
      }
    }));
    return tallyChecks(checked);
  }, [analysis, unitName]);

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
    // A recheck replaced by a newer one says nothing (the newer one runs); a failure or a cancel is
    // said, since the edited unit's findings stay hidden until a check finishes.
    recheckTimer.current = window.setTimeout(() => void runCheck(stale).catch((error: unknown) => (
      isAbort(error) ? setStatus('Support check cancelled.') : setStatusMessage(errorStatus('check', codedJobError(error)))
    )), 600);
  }, [problems, runCheck, scene.units, setStatus]);

  const showProblem = useCallback((problem: UnitProblem) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === problem.unitId);
    if (unit) setFocus((current) => ({ point: transformPoint(unit.transform, problem.position), area: problem.area, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const checkSupports = useCallback(() => {
    const units = targets(sceneRef.current).filter((unit) => unit.supports);
    if (units.length === 0) return setStatus('Generate supports before checking them.');
    setStatus('Checking supports on 1 object.', { n: units.length }, 'Checking supports on {n} objects.');
    runCheck(units).then(
      (tally) => setStatusMessage(checkStatus(tally)),
      (error: unknown) => (isAbort(error) ? setStatus('Support check cancelled.') : setStatusMessage(errorStatus('check', codedJobError(error)))),
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
    if (accepted.length === 0) return setStatusMessage(errorStatus('import', new CodedError('file-type', 'file-type')));
    /** The file being read, named in an error. */
    let reading = accepted[0]!.name;
    // One controller for the whole drop: Cancel (in the activity list) stops it and nothing is added.
    const controller = new AbortController();
    // What this drop adds is held on the plate while it reads, so an import started meanwhile counts
    // it too; a failure or cancel releases it (core/plateLedger).
    const reservation = PLATE.open();
    const plateNow = (): PlateScene => ({ ids: new Set(sceneRef.current.units.map((unit) => unit.id)), triangles: sceneRef.current.units.reduce((sum, unit) => sum + triangleCount(unit), 0) });
    try {
      const imported: PreparedMesh[][] = [];
      const memoryCap = memoryCapBytes(memoryInfo());
      // The triangles this drop adds, with each file as it is read.
      let adding = 0;
      for (const file of accepted) {
        reading = file.name;
        // Refused before anything is parsed or copied, whenever the file says how big it is.
        const estimate = estimateTriangles(new Uint8Array(await file.slice(0, await estimateHeadBytes(file)).arrayBuffer()), file.size, file.name);
        if (estimate) {
          assertTriangleCapacity(file.name, estimate.triangles, RUNTIME, estimate.exact);
          assertMemoryCapacity(file.name, estimate.triangles, RUNTIME, memoryCap);
          if (estimate.exact) reservation.hold(adding + estimate.triangles, plateNow(), (plate) => assertPlateCapacity(file.name, plate, RUNTIME));
        }
        const label = { key: 'Importing {name}', vars: { name: file.name } };
        if (/\.stl$/i.test(file.name)) {
          // The worker reads the file itself, slice by slice.
          imported.push(await importer().readStl(file, file.name, RUNTIME, label, controller.signal));
        } else {
          const data = await file.arrayBuffer();
          const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
          const raw = gltfRawMeshes(gltf, file.name);
          if (raw.length === 0) throw new CodedError('no-mesh', `${file.name} contains no mesh`);
          // Backstop for a glTF the estimate could not read: counted before welding.
          assertTriangleCapacity(file.name, raw.reduce((sum, mesh) => sum + (mesh.indices ? mesh.indices.length : mesh.positions.length / 3) / 3, 0), RUNTIME, true);
          imported.push(await importer().weld(raw, RUNTIME, label, controller.signal));
        }
        // Counted again from what was read (an estimate may have been short).
        adding += imported[imported.length - 1]!.reduce((sum, item) => sum + item.mesh.indices.length / 3, 0);
        reservation.hold(adding, plateNow(), (plate) => assertPlateCapacity(file.name, plate, RUNTIME));
      }
      for (const item of imported.flat()) {
        setPrebuiltBvh(item.display ?? item.mesh, item.bvh);
        if (item.display) setDisplayMesh(item.mesh, item.display);
      }
      let units = [...sceneRef.current.units];
      const added: PrintUnit[] = [];
      for (const group of imported) {
        const placed = placeImportedUnits(group, units, { lift: defaultSupportSettings.liftHeight, createId: () => `unit-${crypto.randomUUID()}` });
        units = [...units, ...placed];
        added.push(...placed);
      }
      // Only an import that adds something ends Support Edit Mode or zones; a refused one leaves them.
      send({ type: 'leave' });
      dispatch({ type: 'batch', commands: [
        // Handed over: the worker's fresh arrays, also the keys of their display copy and pick index.
        ...added.map((unit) => ({ type: 'unit/add' as const, unit, owned: true })),
        { type: 'selection/set', unitIds: added.map((unit) => unit.id), activeUnitId: added[0]!.id },
      ] });
      reservation.commit(added.map((unit) => unit.id));
      // Big models: say what the editor does differently, once, at import.
      const heaviest = added.reduce((most, unit) => (triangleCount(unit) > triangleCount(most) ? unit : most));
      const tier = meshTier(triangleCount(heaviest), RUNTIME);
      const plate = units.reduce((sum, unit) => sum + triangleCount(unit), 0);
      const vars = { name: heaviest.name, n: triangleCount(heaviest).toLocaleString(), budget: TRIANGLE_BUDGET[RUNTIME].toLocaleString() };
      if (tier === 'heavy') {
        setStatus('{name} is a heavy model ({n} triangles, over {budget}): the view shows a simplified copy and hand editing is off. Generate and export use the full model.', vars);
      } else if (plate > TRIANGLE_BUDGET[RUNTIME]) {
        // The plate warning wins over the large-model note (Tips only still turns on: see largeTips).
        setStatus('The plate now holds {n} triangles, more than the {budget} this app is tuned for; it may slow down.', { n: plate.toLocaleString(), budget: TRIANGLE_BUDGET[RUNTIME].toLocaleString() });
      } else if (tier === 'large') {
        setStatus('{name} is a large model ({n} triangles): the view shows contact tips only to stay smooth. Turn off Tips only to see whole supports.', vars);
      } else {
        setStatus('Imported 1 object. Generate to place supports.', { n: added.length }, 'Imported {n} objects. Generate to place supports.');
      }
    } catch (error) {
      reservation.release();
      if (isAbort(error)) setStatus('Import cancelled; nothing was added.');
      else setStatusMessage(errorStatus('import', codedJobError(error), { name: reading }));
    }
  }, [dispatch, importer, send, setStatus]);

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
    send({ type: 'leave' });
    const count = forTargets((unit) => (unit.supports ? { type: 'supports/remove', unitId: unit.id } : undefined));
    if (count) setStatus('Removed supports from 1 object; models untouched, manual edits kept for regeneration.', { n: count }, 'Removed supports from {n} objects; models untouched, manual edits kept for regeneration.');
    else setStatus('No supports to remove.');
  };
  const clearManual = () => {
    const count = forTargets((unit) => (unit.manual.length || unit.suppressed.length || unit.deleted.length ? { type: 'supports/clear-manual', unitId: unit.id } : undefined));
    setStatus(count ? 'Manual edits cleared; automatic contacts restored.' : 'No manual edits to clear.');
    if (count) offerUndo({ kind: 'clearManual' });
  };
  const deleteUnits = useCallback(() => {
    const ids = sceneRef.current.selectedUnitIds;
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: ids.map((unitId) => ({ type: 'unit/remove' as const, unitId })) });
    setStatus('Deleted 1 object (undo restores).', { n: ids.length }, 'Deleted {n} objects (undo restores).');
  }, [dispatch]);
  // Entering a mode or switching tool says what a click or drag now does (editing/status).
  /** A heavy object takes no hand edits: entering Edit Mode or zones says why instead. */
  const refuseHeavy = useCallback((): boolean => {
    const active = sceneRef.current.units.find((unit) => unit.id === sceneRef.current.activeUnitId);
    if (sessionRef.current.mode !== 'off' || !isHeavy(active)) return false;
    setStatus(HEAVY_EDIT, { n: triangleCount(active!).toLocaleString() });
    return true;
  }, [setStatus]);
  const toggleEditMode = useCallback(() => {
    if (!refuseHeavy()) send({ type: 'toggleEdit', activeUnitId: sceneRef.current.activeUnitId });
  }, [refuseHeavy, send]);
  /** Enters zones mode for the active object; Done returns to `from`. From Edit Mode the undo floor it set stays. */
  const openZones = useCallback((from: ZonesReturn) => {
    if (!refuseHeavy()) send({ type: 'openZones', from, activeUnitId: sceneRef.current.activeUnitId });
  }, [refuseHeavy, send]);
  const closeZones = useCallback(() => send({ type: 'closeZones' }), [send]);
  /** A left-panel mode button: enters its mode, or exits it exactly like Done. */
  const pressModeButton = useCallback(({ event }: ModeButton) => {
    if (event.type === 'openZones') openZones(event.from);
    else if (event.type === 'closeZones') closeZones();
    else toggleEditMode();
  }, [closeZones, openZones, toggleEditMode]);
  /** One stroke is one undo step, on the active object only. */
  const onZoneStroke = useCallback((unitId: string, stamps: ZoneStamp[]) => {
    if (sessionRef.current.mode !== 'zones' || unitId !== sceneRef.current.activeUnitId || stamps.length === 0) return;
    dispatch({ type: 'zones/add', unitId, stamps });
    setStatus(stamps[stamps.length - 1]!.kind === 'paint' ? 'Zone painted: automatic supports inside are hidden.' : 'Zone erased.');
  }, [dispatch, setStatus]);
  const clearZones = useCallback((unitId: string) => {
    if (!sceneRef.current.units.find((unit) => unit.id === unitId)?.zones.length) return;
    dispatch({ type: 'zones/clear', unitId });
    setStatus('No-support zones cleared.');
    offerUndo({ kind: 'clearZones' });
  }, [dispatch, offerUndo, setStatus]);

  const fixProblem = useCallback((problem: UnitProblem) => {
    showProblem(problem);
    const { mode } = sessionRef.current;
    if (mode === 'zones') return setStatusMessage(busyStatus(mode));
    if (mode !== 'off' && sceneRef.current.activeUnitId === problem.unitId) return;
    send({ type: 'leave' });
    dispatch({ type: 'selection/set', unitIds: [problem.unitId], activeUnitId: problem.unitId });
    setEditTarget(problem.unitId);
  }, [dispatch, send, showProblem]);
  useEffect(() => {
    if (!editTarget || scene.activeUnitId !== editTarget) return;
    setEditTarget(undefined);
    toggleEditMode();
  }, [editTarget, scene.activeUnitId, toggleEditMode]);

  const onSelect = useCallback((unitId: string | null, additive: boolean) => {
    const current = sceneRef.current;
    const { mode } = sessionRef.current;
    if (mode !== 'off') {
      if (unitId !== current.activeUnitId) setStatusMessage(busyStatus(mode));
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
    if (sessionRef.current.mode === 'zones') return; // supports take no edits while painting zones
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
    const hits = unitContacts(unit).filter(({ position: [x, y, z] }) => (x - local[0]) ** 2 + (y - local[1]) ** 2 + (z - local[2]) ** 2 <= radius * radius);
    if (hits.length === 0) return setStatus('No support here: right-click a support, or the model within {radius} mm of one.', { radius });
    dispatch({ type: 'batch', commands: hits.map((contact) => removeContact(unit, contact.id)) });
    setStatus('Removed 1 support; removals persist through regeneration.', { n: hits.length }, 'Removed {n} supports; removals persist through regeneration.');
  }, [dispatch, removeContact]);

  const onRemoveContact = useCallback((unitId: string, contactId: string) => {
    if (sessionRef.current.mode === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    const contact = unit && unitContacts(unit).find((candidate) => candidate.id === contactId);
    if (unit && contact) eraseNear(unit, [...contact.position]);
  }, [eraseNear]);

  const onEditMiss = useCallback(() => {
    const message = missStatus(sessionRef.current);
    if (message) setStatusMessage(message);
  }, []);

  const onErase = useCallback((unitId: string, point: [number, number, number]) => {
    if (sessionRef.current.mode === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (unit) eraseNear(unit, inverseTransformPoint(unit.transform, point));
  }, [eraseNear]);

  const onToggleContact = useCallback((unitId: string, contactId: string) => {
    if (sessionRef.current.mode !== 'edit' || unitId !== sceneRef.current.activeUnitId) return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    // A support deleted a moment ago can still be under the cursor until the mesh rebuilds.
    if (!unit || !unitContacts(unit).some((contact) => contact.id === contactId)) return;
    send({ type: 'toggleContact', id: contactId });
  }, [send]);

  const onPaint = useCallback((unitId: string, ids: readonly string[], mode: BrushMode) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (sessionRef.current.mode !== 'edit' || !unit || unit.id !== sceneRef.current.activeUnitId) return;
    // A support deleted a moment ago can still be drawn until the mesh rebuilds.
    const alive = new Set(unitContacts(unit).map((contact) => contact.id));
    send({ type: 'paint', ids: ids.filter((id) => alive.has(id)), mode });
  }, [send]);

  /** Clear selection (button or Esc): at once, with Undo on a toast when anything was selected. */
  const clearSelection = useCallback(() => {
    const ids = [...sessionRef.current.selection];
    const unitId = sessionRef.current.activeUnitId;
    send({ type: 'clearSelection' });
    if (ids.length > 0 && unitId) offerUndo({ kind: 'clearSelection', ids, unitId });
  }, [offerUndo, send]);

  const undoToastAction = useCallback(() => {
    const current = toast;
    setToast(undefined);
    if (!current) return;
    if (current.action.kind !== 'clearSelection') {
      if (!undo()) setStatus('Nothing to undo here: leave the mode to undo earlier steps.');
      return;
    }
    // Supports deleted since are not selected again.
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sessionRef.current.activeUnitId);
    const alive = new Set(unit ? unitContacts(unit).map((contact) => contact.id) : []);
    send({ type: 'restoreSelection', ids: current.action.ids.filter((id) => alive.has(id)) });
  }, [send, setStatus, toast, undo]);
  // The toast goes once its Undo would undo something else (a later edit, undo, leaving the mode).
  useEffect(() => {
    if (!toast) return;
    const now = { scene: history.present, mode: editMode, activeUnitId: activeUnit?.id, selectionSize: selection.size };
    if (!toastAlive(toast, now)) setToast(undefined);
    else if (toast.action.kind !== 'clearSelection' && toast.scene === undefined) setToast({ ...toast, scene: history.present });
  }, [activeUnit?.id, editMode, history.present, selection.size, toast]);

  // Exactly the selected supports go, in one undo step; the tool stays as it was.
  const deleteSelected = useCallback(() => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    if (!unit) return;
    const alive = new Set(unitContacts(unit).map((contact) => contact.id));
    const ids = [...selection].filter((id) => alive.has(id));
    send({ type: 'clearSelection' });
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: deleteCommands(unit, ids) });
    setStatus('Deleted 1 support.', { n: ids.length }, 'Deleted {n} supports.');
  }, [dispatch, selection, send, setStatus]);

  const [exporting, setExporting] = useState(false);
  const runExport = async (kind: ExportKind) => {
    const current = sceneRef.current;
    const files = planExport(current, kind);
    if (files.length === 0) {
      if (kind.startsWith('active') && !current.activeUnitId) return setStatus('Select an object to export.');
      // Supports only, and every unit in scope had its contacts deleted or zoned out.
      const emptied = exportUnits(current, kind).filter(([unit]) => unit.supports);
      if (kind.endsWith('supports') && emptied.length === 1) return setStatus('Nothing to export: {name} has no supports left.', { name: emptied[0]![0].name });
      if (kind.endsWith('supports') && emptied.length > 1) return setStatus('Nothing to export: no object in this export has supports left.');
      return setStatus('Nothing to export for this mode.');
    }
    const used = new Set(files.flatMap((file) => file.parts.map((part) => part.unitId)));
    const units = exportUnits(current, kind).filter(([unit]) => used.has(unit.id));
    setExporting(true);
    setStatus('Preparing export at full resolution.');
    // The check runs alongside, on the analysis workers, so the export can warn about gaps.
    // A check that fails or is cancelled leaves its units unchecked: the status says so.
    const checking = runCheck(units.map(([unit]) => unit)).catch((): CheckTally => ({ spots: 0, inZone: 0, incomplete: units.filter(([unit]) => unit.supports).length }));
    const label = { key: files.length === 1 ? 'Exporting {name}' : 'Exporting {n} files', vars: { name: files[0]!.fileName, n: files.length } };
    try {
      const jobs = units.map(([unit, index]) => ({ unitId: unit.id, job: supportJobOf(unit, index, 'export'), transform: unit.transform }));
      const written = await exporter().exportFiles(jobs, files, label, () => {});
      // Nothing came back (every file was empty, or the job was dropped): never report success.
      if (written.length === 0) return setStatus('Nothing to export for this mode.');
      for (const file of written) {
        const url = URL.createObjectURL(new Blob([file.buffer], { type: 'model/stl' }));
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = file.fileName;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      const names = written.map((file) => file.fileName).join(', ');
      setStatusMessage(exportStatus(names, await checking));
    } catch (error) {
      if (isAbort(error)) setStatus('Export cancelled; no file was written.');
      else setStatusMessage(errorStatus('export', codedJobError(error)));
    } finally {
      setExporting(false);
    }
  };

  // ---- Keyboard ------------------------------------------------------------------------
  // The rules live in editing/keys; this only maps an action to the app's handlers.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction({
        key: event.key,
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        target: event.target as HTMLElement | null,
        mode: editMode,
        hasSelection: selection.size > 0,
      });
      if (action.preventDefault) event.preventDefault();
      switch (action.type) {
        case 'undo': return undo();
        case 'redo': return dispatchHistory({ type: 'redo' });
        case 'toggleEdit': return toggleEditMode();
        case 'leaveMode': return editMode === 'zones' ? closeZones() : toggleEditMode();
        case 'deleteSelection': return deleteSelected();
        case 'clearSelection': return clearSelection();
        case 'deleteObjects': return deleteUnits();
        case 'gizmo': return setGizmoMode(action.mode);
        case 'none': return;
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [clearSelection, closeZones, deleteSelected, deleteUnits, editMode, selection, toggleEditMode, undo]);

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
  const editButton = editModeButton(editMode, Boolean(activeUnit) && !activeHeavy);
  const zonesModeButton = zonesButton(editMode, Boolean(activeUnit) && !activeHeavy);

  return <main>
    <header>
      <div className="brand"><h1><BrandLogo /></h1><small>{t('Resin Support Studio')}</small></div>
      <div className="header-actions">
        <div className="segmented lang" role="group" aria-label={t('Language')}>
          {LANGS.map((entry) => <button key={entry.lang} lang={entry.lang} className={lang === entry.lang ? 'active' : ''} aria-pressed={lang === entry.lang} onClick={() => chooseLanguage(entry.lang)} title={entry.name}>{entry.label}</button>)}
        </div>
        <div className="toolbar-group">
          <button onClick={undo} disabled={!canUndo} {...hint('Undo (Ctrl+Z)')}>{t('Undo')}</button>
          <button onClick={() => dispatchHistory({ type: 'redo' })} disabled={history.future.length === 0} {...hint('Redo (Ctrl+Shift+Z)')}>{t('Redo')}</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => setModelVisible((visible) => !visible)} {...hint(modelVisible ? 'Hide the models to see the supports alone. Export is not affected' : 'Show the models again')}>{modelVisible ? t('Hide models') : t('Show models')}</button>
          <button onClick={() => setWireframe((value) => !value)} {...hint(wireframe ? 'Draw the models solid' : 'Draw the models as wireframes to see supports behind them')}>{wireframe ? t('Solid') : t('Wireframe')}</button>
        </div>
        <button className={scopeGenerated ? 'primary regen' : 'primary'} onClick={() => generate()} disabled={scene.units.length === 0} {...hint('Place automatic supports on the selected objects, or on every object when none is selected')}>{pendingCount > 0 ? t('Generating supports') : t(scopeGenerated ? 'Regenerate supports for {scope}' : 'Generate supports for {scope}', { scope: scopeLabel })}</button>
      </div>
    </header>
    <section className="workspace">
      <aside className="panel left">
        <label className="drop" title={t('Choose STL, GLB or glTF files, or drop them on the viewport')}>
          <input type="file" aria-description={t('Choose STL, GLB or glTF files, or drop them on the viewport')} multiple accept=".stl,.glb,.gltf" onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          <strong>{t('Import models')}</strong>
          <small>{t('STL, GLB or glTF. Files stay on this device.')}</small>
        </label>
        <section>
          <h3>{t('Objects')}{scene.units.length > 0 && <small className="count">{scene.units.length}</small>}</h3>
          {scene.units.length === 0 ? <p className="help">{t('Each STL, and each mesh inside a glTF, becomes its own object.')}</p> : <ul className="units">
            {scene.units.map((unit, index) => {
              const selected = scene.selectedUnitIds.includes(unit.id);
              return <li key={unit.id}>
                <button className={`unit${selected ? ' selected' : ''}${unit.id === scene.activeUnitId ? ' active' : ''}`} onClick={(event) => onSelect(unit.id, event.shiftKey || event.ctrlKey || event.metaKey)} {...hint('Click to select; Shift+click or Ctrl+click adds it to the selection or takes it out')}>
                  <b>{resolveSettings(unit.settings).labelText || labelForIndex(index)}</b>
                  <span title={unit.name}>{unit.name}</span>
                  {/* Compact row: the support count alone, spelled out on hover. */}
                  <small title={unit.supports ? plural(unitContacts(unit).length, '1 support', '{n} supports') : t('No supports yet')}>{unit.supports ? unitContacts(unit).length : '–'}</small>
                </button>
              </li>;
            })}
          </ul>}
          <div className="row">
            <button onClick={() => dispatch({ type: 'selection/set', unitIds: scene.units.map((unit) => unit.id), ...(scene.units[0] ? { activeUnitId: scene.activeUnitId ?? scene.units[0].id } : {}) })} disabled={scene.units.length === 0} {...hint('Select every object')}>{t('Select all')}</button>
            <button onClick={deleteUnits} disabled={selectedCount === 0} {...hint('Delete the selected objects (Delete key). Undo brings them back')}>{t('Delete')}</button>
          </div>
        </section>
        <section>
          <h3>{t('Transform')}</h3>
          <div className="segmented">
            {(['none', 'translate', 'rotate'] as const).map((mode) => <button key={mode} className={gizmoMode === mode ? 'active' : ''} aria-pressed={gizmoMode === mode} onClick={() => setGizmoMode(mode)} disabled={editMode !== 'off'} {...hint(mode === 'none' ? 'Select objects without a gizmo' : mode === 'translate' ? 'Move the active object with the gizmo (G)' : 'Rotate the active object with the gizmo (R)')}>{t(mode === 'none' ? 'Select' : mode === 'translate' ? 'Move' : 'Rotate')}</button>)}
          </div>
        </section>
        <section>
          <h3>{t('Edit supports')}</h3>
          <button aria-pressed={editButton.pressed} onClick={() => pressModeButton(editButton)} disabled={editButton.disabled} {...hint(editButton.hint)}>{t(editButton.label)}</button>
          <p className="help">{heavyHint ?? (activeUnit ? t('Add or remove supports by clicking the model. Tab toggles.') : t('Select an object first.'))}</p>
        </section>
        <section>
          <h3>{t('No-support zones')}{activeUnit && <small className="count">{activeUnit.zones.length ? t('Painted') : t('None')}</small>}</h3>
          <div className="row">
            <button aria-pressed={zonesModeButton.pressed} onClick={() => pressModeButton(zonesModeButton)} disabled={zonesModeButton.disabled} {...hint(zonesModeButton.hint)}>{t(zonesModeButton.label)}</button>
            <button className="danger" aria-label={t('Clear all zones')} onClick={() => activeUnit && clearZones(activeUnit.id)} disabled={!activeUnit?.zones.length} {...hint('Clear every no-support zone of this object at once. Undo brings them back')}>{t('Clear')}</button>
          </div>
          <p className="help">{t('Paint where supports must not grow. Manual supports stay.')}</p>
        </section>
        <section>
          <h3>{t('Supports for {scope}', { scope: scopeLabel })}</h3>
          <button className={scopeGenerated ? 'primary regen' : 'primary'} onClick={() => generate()} disabled={scene.units.length === 0} {...hint('Place automatic supports on the selected objects, or on every object when none is selected')}>{t(scopeGenerated ? 'Regenerate' : 'Generate supports')}</button>
          <button onClick={clearManual} disabled={scene.units.length === 0} {...hint('Remove manual supports and bring back removed automatic ones, at once. Undo brings the edits back')}>{t('Clear manual edits')}</button>
          <button onClick={removeSupports} disabled={scene.units.length === 0} {...hint('Remove the supports of the selected objects. Models and manual edits are kept')}>{t('Remove supports')}</button>
        </section>
        <section className="support-check">
          <h3>{t('Check supports')}</h3>
          <button onClick={checkSupports} disabled={!scene.units.some((unit) => unit.supports)} {...hint('Finds islands and overhangs no contact reaches, before you print.')}>{t('Check for unsupported spots')}</button>
          {currentProblems.length > 0 && <ul className="problems">
            {currentProblems.slice(0, 12).map((problem, index) => <li key={`${problem.unitId}-${index}`}>
              <span className={`problem-kind ${problem.kind}`} aria-hidden="true" />
              <span className="problem-text">
                {problem.kind === 'island' ? t('Island') : t('Uncovered overhang')}
                <small>{unitName(problem.unitId)}{problem.kind === 'overhang' ? ` · ${t('{n} mm²', { n: Math.round(problem.area) })}` : ''}{problem.inZone ? ` · ${t('in a no-support zone')}` : ''}</small>
              </span>
              <button onClick={() => showProblem(problem)} {...hint('Frame the camera on this spot')}>{t('Show me')}</button>
              <button className="primary" onClick={() => fixProblem(problem)} {...hint('Open Support Edit Mode on this object to add supports here')}>{t('Fix')}</button>
            </li>)}
          </ul>}
          {currentProblems.length > 12 && <p className="help">{t('and {n} more', { n: currentProblems.length - 12 })}</p>}
          <p className="help">{t('Finds islands and overhangs no contact reaches, before you print.')}</p>
        </section>
      </aside>
      <section
        className={`viewport${isDraggingOver ? ' viewport--dropping' : ''}${editMode === 'off' ? '' : ' viewport--editing'}${editMode === 'zones' ? ' viewport--zones' : ''}${editMode === 'edit' && editTool === 'select' && selectStyle === 'click' ? ' viewport--pick' : ''}`}
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
          liveTool={liveTool}
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
          tipsView={tipsOn}
          onBelowPlate={onBelowPlate}
        />
        <div className="viewport-view" role="group" aria-label={t('View')}>
          <button
            className={tipsOn ? 'active' : ''}
            aria-pressed={tipsOn}
            // Zones force the tips view: the button stays focusable (its hint says why) but does nothing.
            onClick={() => { if (editMode !== 'zones') setTips((state) => tipsToggle(state, largeTips)); }}
            aria-disabled={editMode === 'zones'}
            {...hint(editMode === 'zones' ? 'While painting no-support zones only the contact tips show, so the surface stays visible.' : tipsOn ? 'Only contact tips show. Turns on by itself below the plate; click to switch off. Export stays full.' : 'Show only the contact tips: no pillars, braces or raft. Turns on by itself below the plate. Export stays full.')}
          >{t('Tips only')}</button>
          <button onClick={() => requestView('fit')} disabled={scene.units.length === 0} {...hint('Frame the selection from the current angle')}>{t('Fit view')}</button>
          <button onClick={() => requestView('bottom')} disabled={scene.units.length === 0} {...hint('Look straight up at the selection to check contact points')}>{t('Bottom view')}</button>
        </div>
        {/* Circle size preview while its slider moves (centre of the view), gone 800 ms after release. */}
        {circlePreview && editMode === 'edit' && editTool === 'select' && selectStyle === 'brush' && <div className="brush-circle brush-circle--preview" data-mode={brushMode} style={{ width: brushRadius * 2, height: brushRadius * 2 }} aria-hidden="true" />}
        {isDraggingOver && <div className="viewport-drop-overlay">{t('Drop to import')}</div>}
        <JobActivityPanel />
        <div className="undo-toast-region" role="status" aria-live="polite">
          {toast && <UndoToast key={toast.id} toast={toast} onUndo={undoToastAction} onClose={closeToast} />}
        </div>
        {editMode === 'off' ? <>
          <div className="viewport-object-status">{activeUnit ? activeUnit.name : t('Nothing selected')}</div>
          <button className="viewport-edit-toggle" onClick={toggleEditMode} disabled={!activeUnit || activeHeavy} {...hint(activeHeavy ? HEAVY_EDIT : activeUnit ? 'Add or remove supports by clicking (Tab)' : 'Select an object first.', activeHeavy ? { n: triangleCount(activeUnit!).toLocaleString() } : undefined)}>
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
                <button aria-pressed={zoneKind === 'paint'} onClick={() => send({ type: 'setZoneKind', kind: 'paint' })} {...hint('Paint no-support zones on the model')}>{t('Paint')}</button>
                <button aria-pressed={zoneKind === 'erase'} onClick={() => send({ type: 'setZoneKind', kind: 'erase' })} {...hint('Erase no-support zones from the model')}>{t('Erase')}</button>
              </div>
              <label className="edit-size">
                {t('Brush size')}
                <input type="range" min={0.5} max={10} step={0.5} value={zoneRadius} onChange={(event) => send({ type: 'setZoneRadius', radius: Number(event.target.value) })} {...hint('Radius of the zone brush')} />
                <output>{t('{n} mm', { n: zoneRadius })}</output>
              </label>
              <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
            </div>
            {!tips.below && <p className="edit-note" role="note">{t('Supports attach underneath: turn the view (Bottom view) to paint where they are.')}</p>}
            <div className="edit-row">
              <button className="danger" onClick={() => activeUnit && clearZones(activeUnit.id)} disabled={!activeUnit?.zones.length} {...hint('Clear every no-support zone of this object at once. Undo brings them back')}>{t('Clear all zones')}</button>
              <button className="primary edit-done" onClick={closeZones} {...hint('Finish painting zones (Esc or Enter)')}>{t('Done')} <kbd>Esc</kbd></button>
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
                <button aria-pressed={editTool === 'add'} onClick={() => send({ type: 'setTool', tool: 'add' })} {...hint('Click the model to add a support; right-click or Ctrl+click a support to remove it')}>{t('Add supports')}</button>
                <button aria-pressed={editTool === 'select'} onClick={() => send({ type: 'setTool', tool: 'select' })} {...hint('Pick supports to delete several at once')}>{t('Select supports')}</button>
              </div>
              {editTool === 'select' && <div className="tool-choice" role="group" aria-label={t('How to select')}>
                <button aria-pressed={selectStyle === 'click'} onClick={() => send({ type: 'setSelectStyle', style: 'click' })} {...hint('Click supports one at a time to select them')}><PointerIcon />{t('Click')}</button>
                <div className="tool-stack">
                  <button aria-pressed={selectStyle === 'brush'} onClick={() => send({ type: 'setSelectStyle', style: 'brush' })} {...hint('Drag over supports to select many at once, starting anywhere in the view')}><BrushIcon />{t('Drag over')}</button>
                  {/* The tool's own size, under it: shown only while Drag over is the way to select. */}
                  {selectStyle === 'brush' && <label className="tool-option">
                    <span className="tool-option-head">{t('Circle size')}<output>{t('{n} px', { n: brushRadius })}</output></span>
                    <input
                      type="range" min={8} max={80} step={4} value={brushRadius}
                      onChange={(event) => { send({ type: 'setBrushRadius', radius: Number(event.target.value) }); previewCircle(true); }}
                      onPointerDown={() => previewCircle(true)}
                      onPointerUp={() => previewCircle(false)}
                      onKeyUp={() => previewCircle(false)}
                      onBlur={() => previewCircle(false)}
                      {...hint('Radius of the circle around the pointer, in screen pixels: supports it passes over are selected')}
                    />
                  </label>}
                </div>
              </div>}
              {editTool === 'select' && selectStyle === 'brush' && <>
                <div className="segmented" role="group" aria-label={t('Dragging over supports')}>
                  <button aria-pressed={brushMode === 'select'} onClick={() => send({ type: 'setBrushMode', mode: 'select' })} {...hint('Dragging adds supports to the selection')}>{t('Select')}</button>
                  <button aria-pressed={brushMode === 'unselect'} onClick={() => send({ type: 'setBrushMode', mode: 'unselect' })} {...hint('Dragging takes supports out of the selection')}>{t('Unselect')}</button>
                </div>
              </>}
            </div>
            <div className="edit-row">
              {/* Selecting: Ctrl+click selects like a plain click, so only right-click removes. */}
              <span className="edit-hint"><kbd>{t('Right-click')}</kbd>{editTool === 'add' && <> / <kbd>Ctrl</kbd>+<kbd>{t('Click')}</kbd></>} {t('remove')}</span>
              <span className="edit-hint"><kbd>Ctrl</kbd>+<kbd>Z</kbd> {t('undo')}</span>
              <button onClick={() => openZones('edit')} {...hint('Switch to painting no-support zones; Done comes back here')}>{t('Edit no-support zones →')}</button>
              {selection.size > 0 && <>
                <span className="edit-count">{t('{n} selected', { n: selection.size })}</span>
                <button className="danger" onClick={deleteSelected} {...hint('Delete the selected supports (Delete key). Undo brings them back')}>{t('Delete')}</button>
                <button onClick={clearSelection} {...hint('Unselect every support at once (Esc). Undo on the notice brings the selection back')}>{t('Clear selection')}</button>
              </>}
              <button className="primary edit-done" onClick={toggleEditMode} {...hint('Finish editing supports (Esc or Enter)')}>{t('Done')} <kbd>Esc</kbd></button>
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
          {EXPORTS.map((entry) => <button key={entry.kind} onClick={() => void runExport(entry.kind)} disabled={scene.units.length === 0 || exporting} {...hint(entry.hint)}>{t(entry.label)}</button>)}
          <p className="help">{t('Exports match the viewport at full resolution. Source models are never changed.')}</p>
        </section>
      </aside>
    </section>
    <footer>
      <span>{plural(scene.units.length, '1 object', '{n} objects')}</span>
      {activeUnit && <span>{t('{n} triangles', { n: (activeUnit.source.indices.length / 3).toLocaleString() })}</span>}
      {contactCounts && <span>{t('{auto} automatic, {manual} manual, {removed} removed', contactCounts)}</span>}
      {/* Announced to screen readers, so errors and step results are heard too. */}
      <strong role="status" aria-live="polite">{translateMessage(status)}</strong>
    </footer>
  </main>;
}
