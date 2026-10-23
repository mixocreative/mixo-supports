import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Object3D } from 'three';
import { labelForIndex } from './core/analysis/mesh';
import type { SupportProblem } from './core/analysis/supportCheck';
import type { SupportPoint } from './core/analysis/types';
import type { Vector } from './core/vec3';
import JobActivityPanel from './components/JobActivity';
import { AnalysisClient } from './workers/analysisClient';
import { ImportClient } from './workers/importClient';
import { createAnalysisWorker, createImportWorker, createMeshWorker } from './workers/factories';
import { SupportMeshClient } from './workers/meshClient';
import type { PreparedMesh } from './workers/importProtocol';
import { codedJobError } from './workers/jobErrors';
import ObjectViewport, { acceptModelFile } from './components/ObjectViewport';
import { CirclePreview } from './components/viewport/CirclePreview';
import type { GizmoMode, ViewRequest } from './components/viewport/types';
import SettingsPanel from './components/SettingsPanel';
import { ShapeBand } from './components/ShapeBand';
import { BrandLogo } from './components/BrandLogo';
import { EditBar } from './components/EditBar';
import { CommandButton } from './components/CommandButton';
import { ModeSections } from './components/ModeEntry';
import { ObjectList } from './components/ObjectList';
import { ProblemList } from './components/ProblemList';
import { ZonesBar } from './components/ZonesBar';
import { Segmented } from './components/Segmented';
import { isAbort, RUNTIME, triangleCount } from './components/appShared';
import { useFixSpot } from './components/useFixSpot';
import { useExport } from './components/useExport';
import { useRegenerate } from './components/useRegenerate';
import { useProjectFile } from './components/useProjectFile';
import { isProjectFile } from './state/projectFile';
import { hint } from './components/hint';
import { cancelSceneEdit, canUndo as historyCanUndo, createSceneHistory, redoScene, replaceScene, undoScene, withSceneCommand, type SceneHistory } from './state/history';
import { gltfRawMeshes, placeImportedUnits } from './state/import';
import { setDisplayMesh, setPrebuiltBvh } from './state/meshExtras';
import { memoryInfo } from './state/runtime';
import { assertMemoryCapacity, assertPlateCapacity, assertTriangleCapacity, memoryCapBytes, meshTier, refusalLimit } from './core/budget';
import { TriangleGate } from './core/jobGate';
import { PlateLedger, type PlateScene } from './core/plateLedger';
import { estimateTriangles, ESTIMATE_HEAD_BYTES } from './core/import/estimate';
import { emptyScene, reduceScene, type ContactSettings, type PrintScene, type PrintUnit, type SceneCommand, type SupportSettings } from './state/project';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, transformPoint, type ModelTransform } from './state/transform';
import type { ExportKind } from './supports/export';
import type { GeneratedSupportMesh } from './core/supports/mesh';
import { meshBounds } from './core/supports/meshQuery';
import { problemInZone, type ZoneStamp } from './core/supports/zones';
import { deleteCommands } from './supports/selection';
import { gesture, type GestureKind } from './editing/gesture';
import { TIPS_START, tipsButton, tipsCamera, tipsPress } from './editing/view';
import { applyPreset, defaultSupportSettings, setRoofMode, updateSetting, withShape, type LiveSupportSettings, type SettingKey, type ShapeKey } from './core/supports/settings';
import { checkJobOf, currentBuild, hiddenByZones, orientationOf, placementPending, PLACEMENT_KEYS, resolveSettings, supportJobOf, unitContacts, unitRemovedCount, unitSupportMesh, type UnitBuild } from './supports/unitSupports';
import { COMMAND_IDS, resolve, type CommandId, type UiState } from './editing/commands';
import { effectiveBrushMode } from './editing/selection';
import { keyAction } from './editing/keys';
import { customisedAmong, liveSelection, scopeCounts, shapePatch, shapeView } from './editing/shapeEdit';
import { lockNote, sectionLocked, type Panel } from './editing/locks';
import { contactToRemove } from './editing/removal';
import { initialSession, reduceSession, startsEditing, type SessionEvent } from './editing/session';
import { BUILDING_STATUS, busyStatus, heavyStatus, importRefusal, importStatus, missStatus, sessionStatus } from './editing/status';
import { CodedError, errorStatus } from './editing/errors';
import { checkStatus, joinRun, runToken, tallyChecks, uncovered, type CheckTally } from './editing/check';
import { stepKind } from './state/stepKind';
import { toastAlive, undoToast, type UndoAction, type UndoToast as UndoToastState } from './editing/toast';
import UndoToast from './components/UndoToast';
import TermsDialog from './components/TermsDialog';
import type { BrushMode } from './editing/types';
import { detectLanguage, LANGS, plural, setLanguage, t, translateMessage, type Lang, type Message } from './i18n';

type HistoryAction = { type: 'command'; command: SceneCommand; edit?: string } | { type: 'cancelEdit'; edit: string } | { type: 'undo' } | { type: 'redo' } | { type: 'replace'; scene: PrintScene };

function historyReducer(history: SceneHistory, action: HistoryAction): SceneHistory {
  if (action.type === 'undo') return undoScene(history);
  if (action.type === 'redo') return redoScene(history);
  if (action.type === 'replace') return replaceScene(history, action.scene);
  if (action.type === 'cancelEdit') return cancelSceneEdit(history, action.edit);
  return withSceneCommand(history, action.command, action.edit);
}

const NO_OVERRIDES: ContactSettings = {};

/** Settings edits come in bursts (typing a value); a unit's preview rebuild waits this long. */
const BUILD_DELAY_MS = 120;

/** The Export STL commands (editing/commands): `export.` and the kind. */
const EXPORT_IDS = COMMAND_IDS.filter((id): id is Extract<CommandId, `export.${string}`> => id.startsWith('export.'));
const exportKindOf = (id: CommandId) => id.slice('export.'.length) as ExportKind;

/** The viewport's mode chrome classes per gesture. */
const VIEWPORT_CLASS: Record<GestureKind, string> = {
  none: '',
  zones: ' viewport--editing viewport--zones',
  add: ' viewport--editing',
  pick: ' viewport--editing',
  drag: ' viewport--editing',
};
/** A support check finding, its position in the unit's local frame. */
export interface UnitProblem extends SupportProblem {
  unitId: string;
  /** The spot lies inside a no-support zone, which is why it has no support. */
  inZone: boolean;
}

/** A .gltf (JSON) up to this size is read whole for its pre-parse triangle count. */
const GLTF_ESTIMATE_BYTES = 16 * 1024 * 1024;

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


export default function App() {
  const [history, dispatchHistory] = useReducer(historyReducer, emptyScene, createSceneHistory);
  const scene = history.present;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  /** `edit`: commands of one edit that share one undo step (a number field's typing). */
  const dispatch = useCallback((command: SceneCommand, edit?: string) => dispatchHistory({ type: 'command', command, ...(edit ? { edit } : {}) }), []);

  const cancelEdit = useCallback((edit: string) => dispatchHistory({ type: 'cancelEdit', edit }), []);

  const [lang, setLang] = useState<Lang>(detectLanguage);
  const [termsOpen, setTermsOpen] = useState(false);
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
  const { mode: editMode, selection } = session;
  const press = gesture(session);
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
  const undoStep = canUndo ? stepKind(history.past.at(-1), history.present) : undefined;
  const redoStep = stepKind(history.present, history.future[0]);
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
  /** The support just added (its object, tip and a counter): the viewport flashes a ring there. */
  const [added, setAdded] = useState<{ unitId: string; point: Vector; normal: Vector; seq: number }>();
  const [viewRequest, setViewRequest] = useState<ViewRequest>();
  const requestView = useCallback((kind: ViewRequest['kind']) => setViewRequest((current) => ({ kind, seq: (current?.seq ?? 0) + 1 })), []);
  // Contact tips view (Blender: Only Tip + Ctrl+Numpad 7): view only, settings and export untouched.
  /** Tips only: the user's choice, else on by itself below the plate (editing/view). */
  const [tips, setTips] = useState(TIPS_START);
  const onBelowPlate = useCallback((below: boolean) => setTips((state) => tipsCamera(state, below)), []);
  const [modelVisible, setModelVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  /** The last click on a locked region: its panel's lock note pulses (a new seq restarts the pulse). */
  const [pulse, setPulse] = useState<{ panel: Panel; seq: number }>({ panel: 'left', seq: 0 });

  const activeUnit = scene.units.find((unit) => unit.id === scene.activeUnitId);
  const activeIndex = activeUnit ? scene.units.indexOf(activeUnit) : -1;
  /** Triangles of a heavy active object: the session refuses hand edits on it (Edit Mode, zones); generation and export still run. */
  const activeHeavy = activeUnit && meshTier(triangleCount(activeUnit), RUNTIME) === 'heavy' ? triangleCount(activeUnit) : undefined;
  const tipsContext = { zones: editMode === 'zones' };
  const tipsOnly = tipsButton(tips, tipsContext);
  // Support Edit Mode belongs to the active unit: it ends when that unit goes (delete, undo).
  // The selection empties on leaving a mode or changing the active object; ids that no longer
  // exist (undo, regeneration) drop out.
  useEffect(() => send({ type: 'activeUnitChanged', id: activeUnit?.id, heavy: activeHeavy }), [activeUnit?.id, activeHeavy, send]);
  // ---- Support meshes ------------------------------------------------------------------
  // Built in the preview worker from scene state; a unit keeps showing its previous mesh until
  // the new one arrives, and units that did not change are not rebuilt. Each mesh keeps the unit
  // version it was built from: its `dropped` contacts (zoned landings) decide the unit's contacts,
  // counts, checks and export plan, and a unit edited since shows its counts as still building.
  const [built, setBuilt] = useState<ReadonlyMap<string, UnitBuild>>(new Map());
  const builtRef = useRef(built);
  builtRef.current = built;
  /** Unit versions whose build failed (the error is in the status line): their counts stop waiting. */
  const [failedBuilds, setFailedBuilds] = useState<ReadonlyMap<string, PrintUnit>>(new Map());
  /** The unit's build finished, or failed, for the unit as it is now. */
  const buildSettled = (unit: PrintUnit) => built.get(unit.id)?.unit === unit || failedBuilds.get(unit.id) === unit;
  const supportMeshes = useMemo(() => new Map([...built].map(([id, entry]) => [id, entry.mesh])), [built]);
  /** The unit's contacts as its latest build left them (see `built`). */
  const contactsOf = useCallback((unit: PrintUnit) => unitContacts(unit, builtRef.current.get(unit.id)?.mesh), []);
  /** Whether the unit changed since its shown supports were built (counts follow once the build returns). */
  const building = (unit: PrintUnit) => unit.supports !== undefined && !buildSettled(unit);
  const activeMesh = activeUnit ? built.get(activeUnit.id)?.mesh : undefined;
  const activeContacts = useMemo(() => (activeUnit ? unitContacts(activeUnit, activeMesh) : []), [activeUnit, activeMesh]);
  useEffect(() => send({ type: 'contactsChanged', contacts: activeContacts }), [activeContacts, send]);
  /** Supports the active object's zones hide, in the build the viewport shows. */
  const zonesHidden = useMemo(() => (activeUnit ? hiddenByZones(activeUnit, activeMesh) : 0), [activeUnit, activeMesh]);
  const activeSettings = useMemo(() => resolveSettings(activeUnit?.settings), [activeUnit?.settings]);
  // The Support shape region and the header count (editing/shapeEdit): the supports selected in Support Edit Mode, else the defaults.
  const activeIds = useMemo(() => activeContacts.map((contact) => contact.id), [activeContacts]);
  const selectedIds = useMemo(() => (editMode === 'edit' ? liveSelection(selection, activeIds) : []), [activeIds, editMode, selection]);
  const activeOverrides = activeUnit?.contactSettings ?? NO_OVERRIDES;
  const customisedActive = customisedAmong(activeOverrides, activeIds).length;
  const customisedSelected = customisedAmong(activeOverrides, selectedIds).length;
  const shapeRegion = useMemo(() => ({
    view: shapeView(activeSettings, activeOverrides, selectedIds),
    rep: selectedIds[0] === undefined ? activeSettings : withShape(activeSettings, activeOverrides[selectedIds[0]]) as LiveSupportSettings,
  }), [activeOverrides, activeSettings, selectedIds]);
  /** The objects the header count speaks of: the selected objects, else the active one; in Support Edit Mode the active one. */
  const bandCounts = useMemo(() => {
    const scoped = editMode !== 'edit' && scene.selectedUnitIds.length > 0 ? scene.units.filter((unit) => scene.selectedUnitIds.includes(unit.id)) : activeUnit ? [activeUnit] : [];
    return scopeCounts(scoped.map((unit) => ({ ids: unitContacts(unit, built.get(unit.id)?.mesh).map((contact) => contact.id), overrides: unit.contactSettings })));
  }, [activeUnit, built, editMode, scene.selectedUnitIds, scene.units]);
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

  const { generate, generating, regenQueued, scheduleRegenerate, forgetPlacing } = useRegenerate({
    sceneRef, mode: editMode, targets, analysis, unitName, dispatch, offerUndo, setStatus, setStatusMessage,
  });

  const requested = useRef(new Map<string, { unit: PrintUnit; index: number }>());
  const buildTimers = useRef(new Map<string, number>());
  /** Findings by unit, with the unit version and support build they checked. */
  const [problems, setProblems] = useState<ReadonlyMap<string, { unit: PrintUnit; mesh: GeneratedSupportMesh | undefined; items: UnitProblem[] }>>(new Map());
  const showProblem = useCallback((problem: { unitId: string; position: Vector; area: number }) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === problem.unitId);
    if (unit) setFocus((current) => ({ point: transformPoint(unit.transform, problem.position), area: problem.area, seq: (current?.seq ?? 0) + 1 }));
  }, []);

  const { fix: fixProblem, noteAdded, isRechecking, stopRechecking } = useFixSpot({
    sceneRef, sessionRef, units: scene.units, activeUnitId: scene.activeUnitId, editMode, built, problems, send, dispatch, setStatus, setStatusMessage, showProblem,
  });

  /** A unit left the scene: stop its work and free what the workers hold for it. */
  const forgetUnit = useCallback((unitId: string) => {
    window.clearTimeout(buildTimers.current.get(unitId));
    buildTimers.current.delete(unitId);
    workers.current.preview?.forget(unitId);
    workers.current.export?.forget(unitId);
    workers.current.analysis?.cancel(`place:${unitId}`);
    workers.current.analysis?.cancel(`check:${unitId}`);
    forgetPlacing(unitId);
    setProblems((current) => {
      if (!current.has(unitId)) return current;
      const next = new Map(current);
      next.delete(unitId);
      return next;
    });
  }, [forgetPlacing]);

  useEffect(() => {
    const ids = new Set(scene.units.map((unit) => unit.id));
    // Imported units the scene now shows are counted by the scene, no longer held by their import.
    PLATE.settle(ids);
    for (const id of [...requested.current.keys()]) {
      if (ids.has(id)) continue;
      requested.current.delete(id);
      forgetUnit(id);
    }
    setBuilt((current) => {
      const kept = new Map([...current].filter(([id]) => ids.has(id)));
      return kept.size === current.size ? current : kept;
    });
    setFailedBuilds((current) => {
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
        setBuilt((current) => new Map(current).set(unit.id, { unit, mesh: empty }));
        return;
      }
      buildTimers.current.set(unit.id, window.setTimeout(() => {
        buildTimers.current.delete(unit.id);
        if (requested.current.get(unit.id)?.unit !== unit) return;
        preview().build(unit.id, supportJobOf(unit, index, 'preview'), { key: 'Building supports for {name}', vars: { name: unitName(unit.id) } }).then((mesh) => {
          if (!mesh || requested.current.get(unit.id)?.unit !== unit) return;
          setBuilt((current) => new Map(current).set(unit.id, { unit, mesh }));
        }, (error: unknown) => {
          setStatusMessage(errorStatus('build', codedJobError(error), { name: unit.name }));
          setFailedBuilds((current) => new Map(current).set(unit.id, unit));
        });
      }, BUILD_DELAY_MS));
    });
  }, [scene.units, forgetUnit, preview, setStatus, unitName]);

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
        // Only a build of the unit as it is now says which contacts it dropped.
        const mesh = currentBuild(unit, builtRef.current.get(unit.id));
        const found = await joinRun(checksRunning.current, unit.id, runToken(unit, mesh), () => analysis().check(key, checkJobOf(unit, mesh), { key: 'Checking supports on {name}', vars: { name: unitName(unit.id) } }));
        if (!found) return undefined;
        // Spots face down on the plate: plate down in unit-local space keeps a zone on the far side of a thin floor out.
        const down = inverseTransformDirection(orientation, [0, -1, 0]);
        const items = found.map((problem) => {
          const position = inverseTransformPoint(orientation, problem.position);
          return { ...problem, unitId: unit.id, position, inZone: problemInZone(unit.zones, position, down) };
        });
        setProblems((current) => new Map(current).set(unit.id, { unit, mesh, items }));
        const inZone = items.filter((problem) => problem.inZone).length;
        return { spots: items.length - inZone, inZone };
      }
    }));
    return tallyChecks(checked);
  }, [analysis, unitName]);

  /**
   * The findings listed: those of units and builds unchanged since their check, and, for a unit
   * edited since, its last findings that no support covers yet, marked out of date until its
   * re-check (below) replaces them.
   */
  const { listedProblems, outOfDate } = useMemo(() => {
    let stale = false;
    const listed = scene.units.flatMap((unit) => {
      const entry = problems.get(unit.id);
      if (!entry) return [];
      const mesh = currentBuild(unit, built.get(unit.id));
      if (entry.unit === unit && entry.mesh === mesh) return entry.items;
      const open = uncovered(entry.items, unitContacts(unit, mesh), resolveSettings(unit.settings).scatterSpacing, isRechecking);
      stale ||= open.length > 0;
      return open;
    });
    return { listedProblems: listed, outOfDate: stale };
  }, [built, isRechecking, problems, scene.units]);
  const recheckTimer = useRef<number | undefined>(undefined);
  useEffect(() => {
    const stale = scene.units.filter((unit) => {
      const entry = problems.get(unit.id);
      // Re-checked once the unit's build settles, so the check sees the contacts that build kept.
      return unit.supports && entry && buildSettled(unit) && (entry.unit !== unit || entry.mesh !== currentBuild(unit, built.get(unit.id)));
    });
    if (stale.length === 0) return;
    window.clearTimeout(recheckTimer.current);
    // A recheck replaced by a newer one says nothing (the newer one runs); a failure or a cancel is
    // said, since the edited unit's findings stay hidden until a check finishes.
    recheckTimer.current = window.setTimeout(() => void runCheck(stale).catch((error: unknown) => {
      stopRechecking();
      if (isAbort(error)) setStatus('Support check cancelled. Supports unchanged.');
      else setStatusMessage(errorStatus('check', codedJobError(error)));
    }), 600);
  }, [built, failedBuilds, problems, runCheck, scene.units, setStatus, stopRechecking]);

  const checkSupports = useCallback(() => {
    const units = targets(sceneRef.current).filter((unit) => unit.supports);
    if (units.length === 0) return setStatus('Generate supports before checking them.');
    setStatus('Checking supports on 1 object.', { n: units.length }, 'Checking supports on {n} objects.');
    runCheck(units).then(
      (tally) => setStatusMessage(checkStatus(tally)),
      (error: unknown) => (isAbort(error) ? setStatus('Support check cancelled. Supports unchanged.') : setStatusMessage(errorStatus('check', codedJobError(error)))),
    );
  }, [runCheck, setStatus, targets]);

  // ---- Import --------------------------------------------------------------------------
  const importFiles = useCallback(async (files: readonly File[]) => {
    // A mode owns the scene until it is finished: a dropped or chosen file waits.
    const refusal = importRefusal(sessionRef.current.mode);
    if (refusal) {
      // The refusal also pulses the left panel's lock note, which says why and how out.
      setPulse((current) => ({ panel: 'left', seq: current.seq + 1 }));
      return setStatusMessage(refusal);
    }
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
      // A mode that began while the files were read still ends here, so the new objects are never edited under it.
      send({ type: 'leave' });
      dispatch({ type: 'batch', commands: [
        // Handed over: the worker's fresh arrays, also the keys of their display copy and pick index.
        ...added.map((unit) => ({ type: 'unit/add' as const, unit, owned: true })),
        { type: 'selection/set', unitIds: added.map((unit) => unit.id), activeUnitId: added[0]!.id },
      ] });
      reservation.commit(added.map((unit) => unit.id));
      const heaviest = added.reduce((most, unit) => (triangleCount(unit) > triangleCount(most) ? unit : most));
      const plate = units.reduce((sum, unit) => sum + triangleCount(unit), 0);
      setStatusMessage(importStatus({ name: heaviest.name, triangles: triangleCount(heaviest) }, plate, added.length, RUNTIME));
    } catch (error) {
      reservation.release();
      if (isAbort(error)) setStatus('Import cancelled; nothing was added.');
      else setStatusMessage(errorStatus('import', codedJobError(error), { name: reading }));
    }
  }, [dispatch, importer, send, setStatus]);

  const replaceWith = useCallback((next: PrintScene) => dispatchHistory({ type: 'replace', scene: next }), []);
  const refuseWhileBusy = useCallback((message: Message) => {
    setPulse((current) => ({ panel: 'left', seq: current.seq + 1 }));
    setStatusMessage(message);
  }, []);
  const { openProject, saveProject, chooseProject } = useProjectFile({ sceneRef, modeRef: sessionRef, replace: replaceWith, setStatusMessage, offerUndo, refused: refuseWhileBusy, scene });

  // ---- Commands ------------------------------------------------------------------------
  const forTargets = useCallback((make: (unit: PrintUnit) => SceneCommand | undefined, edit?: string) => {
    const commands = targets(sceneRef.current).map(make).filter((command): command is SceneCommand => command !== undefined);
    if (commands.length > 0) dispatch({ type: 'batch', commands }, edit);
    return commands.length;
  }, [dispatch, targets]);

  const changeSettings = useCallback((change: (settings: LiveSupportSettings) => LiveSupportSettings, regenerate: boolean, edit?: string) => {
    const units = targets(sceneRef.current);
    forTargets((unit) => ({ type: 'settings/set', unitId: unit.id, settings: change(resolveSettings(unit.settings)) as SupportSettings }), edit);
    // Support Edit Mode keeps the supports it shows: a placement change waits for the next Generate.
    if (regenerate && sessionRef.current.mode !== 'edit') scheduleRegenerate(units.filter((unit) => unit.supports).map((unit) => unit.id));
  }, [forTargets, scheduleRegenerate, targets]);

  const onSettingChange = useCallback(<K extends SettingKey>(key: K, value: LiveSupportSettings[K], edit?: string) => {
    changeSettings((settings) => updateSetting(settings, key, value), PLACEMENT_KEYS.includes(key), edit);
  }, [changeSettings]);

  const removeSupports = () => {
    send({ type: 'leave' });
    const count = forTargets((unit) => (unit.supports ? { type: 'supports/remove', unitId: unit.id } : undefined));
    if (!count) return setStatus('No supports to remove.');
    setStatusMessage(undoToast(0, { kind: 'removeSupports', count }).message);
    offerUndo({ kind: 'removeSupports', count });
  };
  const clearManual = () => {
    const cleared = { added: 0, removed: 0, customised: 0 };
    const count = forTargets((unit) => {
      if (!unit.manual.length && !unit.deleted.length && !Object.keys(unit.contactSettings).length) return undefined;
      cleared.added += unit.manual.length;
      cleared.removed += unitRemovedCount(unit);
      cleared.customised += Object.keys(unit.contactSettings).length;
      return { type: 'supports/clear-manual', unitId: unit.id };
    });
    if (!count) return setStatus('No manual edits to clear.');
    setStatusMessage(undoToast(0, { kind: 'clearManual', ...cleared }).message);
    offerUndo({ kind: 'clearManual', ...cleared });
  };
  const deleteUnits = useCallback(() => {
    const ids = sceneRef.current.selectedUnitIds;
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: ids.map((unitId) => ({ type: 'unit/remove' as const, unitId })) });
    setStatusMessage(undoToast(0, { kind: 'deleteObjects', count: ids.length }).message);
    offerUndo({ kind: 'deleteObjects', count: ids.length });
  }, [dispatch, offerUndo]);
  /** One stroke is one undo step, on the active object only. */
  const onZoneStroke = useCallback((unitId: string, stamps: ZoneStamp[]) => {
    if (sessionRef.current.mode !== 'zones' || unitId !== sceneRef.current.activeUnitId || stamps.length === 0) return;
    dispatch({ type: 'zones/add', unitId, stamps });
    setStatus(stamps[stamps.length - 1]!.kind === 'paint' ? 'Zone painted: automatic supports inside are hidden.' : 'Zone erased.');
  }, [dispatch, setStatus]);
  const clearActiveZones = useCallback(() => {
    const unitId = sceneRef.current.activeUnitId;
    if (!unitId || !sceneRef.current.units.find((unit) => unit.id === unitId)?.zones.length) return;
    dispatch({ type: 'zones/clear', unitId });
    setStatus('No-support zones cleared.');
    offerUndo({ kind: 'clearZones', hidden: zonesHidden });
  }, [dispatch, offerUndo, setStatus, zonesHidden]);

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
    setAdded((current) => ({ unitId, point: contact.position, normal: contact.normal, seq: (current?.seq ?? 0) + 1 }));
    if (!noteAdded(unitId, contact.position)) setStatus(normal[1] > 0 ? 'Support added on a top face: it grows from below.' : 'Support added.');
  }, [dispatch, noteAdded, setStatus]);

  // A removal is exact: the manual support itself, or the automatic contact's id. Click reach only decides which support a click on the model hits.
  const removeOne = useCallback((unit: PrintUnit, contactId: string) => {
    dispatch({ type: 'batch', commands: deleteCommands(unit, [contactId]) });
    setStatus('Removed 1 support; removals persist through regeneration.', { n: 1 }, 'Removed {n} supports; removals persist through regeneration.');
  }, [dispatch, setStatus]);

  const eraseNear = useCallback((unit: PrintUnit, local: [number, number, number]) => {
    const radius = resolveSettings(unit.settings).eraseRadius;
    const hit = contactToRemove(contactsOf(unit), local, radius);
    if (!hit) return setStatus('No support here: right-click a support, or the model within {radius} mm of one.', { radius });
    removeOne(unit, hit.id);
  }, [contactsOf, removeOne, setStatus]);

  const onRemoveContact = useCallback((unitId: string, contactId: string) => {
    if (sessionRef.current.mode === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (unit && contactsOf(unit).some((candidate) => candidate.id === contactId)) removeOne(unit, contactId);
  }, [contactsOf, removeOne]);

  const onEditMiss = useCallback(() => {
    const message = missStatus(sessionRef.current);
    if (message) setStatusMessage(message);
  }, []);

  /** A Drag over press with no support bodies to hit: while the object's supports are being built, say so. */
  const onNoBodies = () => {
    if (activeUnit && building(activeUnit)) setStatusMessage(BUILDING_STATUS);
  };

  const onErase = useCallback((unitId: string, point: [number, number, number]) => {
    if (sessionRef.current.mode === 'zones') return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (unit) eraseNear(unit, inverseTransformPoint(unit.transform, point));
  }, [eraseNear]);

  const onToggleContact = useCallback((unitId: string, contactId: string) => {
    if (sessionRef.current.mode !== 'edit' || unitId !== sceneRef.current.activeUnitId) return;
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    // A support deleted a moment ago can still be under the cursor until the mesh rebuilds.
    if (!unit || !contactsOf(unit).some((contact) => contact.id === contactId)) return;
    send({ type: 'toggleContact', id: contactId });
  }, [contactsOf, send]);

  const onShift = useCallback((held: boolean) => send({ type: 'shift', held }), [send]);
  const onPaint = useCallback((unitId: string, ids: readonly string[], mode: BrushMode) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (sessionRef.current.mode !== 'edit' || !unit || unit.id !== sceneRef.current.activeUnitId) return;
    // A support deleted a moment ago can still be drawn until the mesh rebuilds.
    const alive = new Set(contactsOf(unit).map((contact) => contact.id));
    send({ type: 'paint', ids: ids.filter((id) => alive.has(id)), mode });
  }, [contactsOf, send]);

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
    const alive = new Set(unit ? contactsOf(unit).map((contact) => contact.id) : []);
    send({ type: 'restoreSelection', ids: current.action.ids.filter((id) => alive.has(id)) });
  }, [contactsOf, send, setStatus, toast, undo]);
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
    const alive = new Set(contactsOf(unit).map((contact) => contact.id));
    const ids = [...selection].filter((id) => alive.has(id));
    send({ type: 'clearSelection' });
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: deleteCommands(unit, ids) });
    setStatus('Deleted 1 support.', { n: ids.length }, 'Deleted {n} supports.');
  }, [contactsOf, dispatch, selection, send, setStatus]);

  /** A committed Support shape value: the selected supports' own, or, with none selected, the object's defaults. */
  const onShapeChange = useCallback(<K extends SettingKey>(key: K, value: LiveSupportSettings[K], edit?: string) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    const ids = unit && sessionRef.current.mode === 'edit' ? liveSelection(sessionRef.current.selection, contactsOf(unit).map((contact) => contact.id)) : [];
    if (!unit || ids.length === 0) return onSettingChange(key, value, edit);
    const patch = shapePatch(shapeView(resolveSettings(unit.settings), unit.contactSettings, ids), key as ShapeKey, value as never);
    if (patch) dispatch({ type: 'contactSettings/set', unitId: unit.id, contactIds: ids, patch }, edit);
  }, [contactsOf, dispatch, onSettingChange]);

  const resetSelected = useCallback(() => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
    if (!unit || sessionRef.current.mode !== 'edit') return;
    const ids = customisedAmong(unit.contactSettings, liveSelection(sessionRef.current.selection, contactsOf(unit).map((contact) => contact.id)));
    if (ids.length === 0) return;
    dispatch({ type: 'contactSettings/reset', unitId: unit.id, contactIds: ids });
    const message = { key: 'Reset 1 support to the defaults.', other: 'Reset {n} supports to the defaults.', vars: { n: ids.length } };
    setStatusMessage(message);
    offerUndo({ kind: 'resetCustomised', count: ids.length });
  }, [contactsOf, dispatch, offerUndo]);

  /**
   * The customised supports, selected: outside Support Edit Mode it enters the mode first. The mode
   * edits one object, so with none on the active object it makes the first selected object (in
   * list order) that has some active, and says how many sit on the others.
   */
  const selectCustomised = useCallback(() => {
    const current = sceneRef.current;
    const customisedOf = (unit: PrintUnit) => customisedAmong(unit.contactSettings, contactsOf(unit).map((contact) => contact.id));
    let unit = current.units.find((candidate) => candidate.id === current.activeUnitId);
    if (!unit) return;
    let ids = customisedOf(unit);
    let others = 0;
    let change: SceneCommand | undefined;
    if (ids.length === 0 && sessionRef.current.mode === 'off') {
      const withSome = current.units.filter((candidate) => current.selectedUnitIds.includes(candidate.id)).map((candidate) => ({ candidate, found: customisedOf(candidate) })).filter(({ found }) => found.length > 0);
      if (withSome.length === 0) return;
      const [first, ...rest] = withSome;
      unit = first!.candidate;
      ids = first!.found;
      others = rest.reduce((sum, { found }) => sum + found.length, 0);
      change = { type: 'selection/set', unitIds: current.selectedUnitIds, activeUnitId: unit.id };
      dispatch(change);
      // The session follows the scene in an effect; step it now so the mode can start on this object.
      send({ type: 'activeUnitChanged', id: unit.id, heavy: meshTier(triangleCount(unit), RUNTIME) === 'heavy' ? triangleCount(unit) : undefined });
    }
    if (sessionRef.current.mode === 'off') send({ type: 'enterEdit' });
    // Undo inside the mode stops at the scene it began with: the one with this object active.
    if (change) undoFloor.current = reduceScene(historyRef.current.present, change);
    if (sessionRef.current.mode !== 'edit') return;
    send({ type: 'restoreSelection', ids });
    if (unit.id !== current.activeUnitId) {
      const vars = { n: ids.length, m: others, object: unit.name };
      setStatus(others > 0 ? '1 customised support selected on {object}. {m} more on other objects.' : '1 customised support selected on {object}.', vars, others > 0 ? '{n} customised supports selected on {object}. {m} more on other objects.' : '{n} customised supports selected on {object}.');
    } else setStatus('Selected 1 customised support.', { n: ids.length }, 'Selected {n} customised supports.');
  }, [contactsOf, dispatch, send, setStatus]);

  const { exporting, runExport } = useExport({ sceneRef, builtRef, exporter, runCheck, setStatus, setStatusMessage });

  // ---- Commands and keyboard -----------------------------------------------------------
  // Buttons and keys run registry commands (editing/commands); the key rules live in editing/keys.
  // The aliases (Done, the viewport Edit supports) run the command the registry says they run.
  const runCommand = useCallback((id: CommandId) => {
    switch (id) {
      case 'history.undo': return void undo();
      case 'history.redo': return dispatchHistory({ type: 'redo' });
      case 'view.models': return setModelVisible((visible) => !visible);
      case 'view.wireframe': return setWireframe((value) => !value);
      case 'objects.delete': return deleteUnits();
      case 'transform.select': return setGizmoMode('none');
      case 'transform.move': return setGizmoMode('translate');
      case 'transform.rotate': return setGizmoMode('rotate');
      case 'supports.generate': return generate();
      case 'mode.edit': {
        send({ type: 'enterEdit' });
        const unit = sceneRef.current.units.find((candidate) => candidate.id === sceneRef.current.activeUnitId);
        if (sessionRef.current.mode === 'edit' && unit && !unit.supports) setStatus('No supports on {name} yet. Click the model to add one, or press Generate in the bar.', { name: unit.name });
        return;
      }
      case 'edit.generate': return generate(sceneRef.current.activeUnitId ? [sceneRef.current.activeUnitId] : undefined);
      case 'mode.zones': return send({ type: 'enterZones' });
      case 'mode.exit': return send({ type: 'exit' });
      case 'edit.add': return send({ type: 'setAddAction', action: 'add' });
      case 'edit.remove': return send({ type: 'setAddAction', action: 'remove' });
      case 'edit.dragSelect': return send({ type: 'setBrushMode', mode: 'select' });
      case 'edit.dragUnselect': return send({ type: 'setBrushMode', mode: 'unselect' });
      case 'setting.clickReach': return; // a field: set through its input
      case 'edit.clearSelection': return clearSelection();
      case 'edit.deleteSelection': return deleteSelected();
      case 'shape.reset': return resetSelected();
      case 'shape.selectCustomised': return selectCustomised();
      case 'objects.selectAll': return dispatch({ type: 'selection/set', unitIds: sceneRef.current.units.map((unit) => unit.id), ...(sceneRef.current.units[0] ? { activeUnitId: sceneRef.current.activeUnitId ?? sceneRef.current.units[0].id } : {}) });
      case 'supports.clearManual': return clearManual();
      case 'supports.remove': return removeSupports();
      case 'check.run': return checkSupports();
      case 'project.open': return chooseProject();
      case 'project.save': return void saveProject();
      case 'view.fit': return requestView('fit');
      case 'view.bottom': return requestView('bottom');
      case 'zones.clearAll': return clearActiveZones();
      case 'export.active-printable': case 'export.active-supports': case 'export.separate-printable': case 'export.separate-supports': case 'export.whole-printable': return void runExport(exportKindOf(id));
    }
  }, [checkSupports, chooseProject, saveProject, clearActiveZones, clearManual, clearSelection, deleteSelected, deleteUnits, dispatch, generate, removeSupports, requestView, resetSelected, runExport, selectCustomised, send, setStatus, undo]);

  const dropImport = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    const files = [...event.dataTransfer.files];
    const project = files.find((file) => isProjectFile(file.name));
    void (project ? openProject(project, files.length > 1) : importFiles(files));
  };

  const contactCounts = activeUnit ? {
    auto: activeContacts.filter((contact) => !contact.id.startsWith('manual-')).length,
    manual: activeUnit.manual.length,
    removed: unitRemovedCount(activeUnit),
  } : undefined;
  const selectedCount = scene.selectedUnitIds.length;
  const scopeLabel = selectedCount > 0 ? t('{n} selected', { n: selectedCount }) : t('all {n}', { n: scene.units.length });
  // Once every unit in scope has supports, the one generate action becomes Regenerate.
  const scopeUnits = targets(scene);
  const scopeGenerated = scopeUnits.length > 0 && scopeUnits.every((unit) => unit.supports);
  // A placement setting changed in Support Edit Mode waits for Regenerate; leaving the mode does not run it.
  const scopePending = !generating && !regenQueued && scopeUnits.some(placementPending);
  // What the registry's rules read (editing/commands); Undo stops at the mode's floor.
  const ui: UiState = {
    mode: editMode, activeName: activeUnit?.name, supported: scene.units.some((unit) => unit.supports), zones: activeUnit?.zones.length ?? 0, exporting, active: Boolean(activeUnit), heavy: activeHeavy, units: scene.units.length, selectedObjects: selectedCount, tool: session.tool, addAction: session.addAction, method: session.selectStyle, dragAction: effectiveBrushMode(session.brushMode, session.shiftHeld),
    selection: selection.size, customisedActive, customisedSelected, customisedTargeted: bandCounts.customised, customisedOthers: Math.max(0, bandCounts.customised - customisedActive), activeSupported: Boolean(activeUnit?.supports), generating, canUndo, canRedo: history.future.length > 0, undoStep, redoStep, modelsVisible: modelVisible, wireframe, generated: scopeGenerated,
  };
  const command = (id: CommandId) => resolve(id, ui);
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const action = keyAction({
        key: event.key,
        ctrl: event.ctrlKey || event.metaKey,
        shift: event.shiftKey,
        target: event.target as HTMLElement | null,
        ui,
      });
      if (action.preventDefault) event.preventDefault();
      if (action.command) runCommand(action.command);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [runCommand, ui]);
  const locked = (section: Parameters<typeof sectionLocked>[0]) => sectionLocked(section, editMode);
  /** Locked sections are inert, so a click on one falls through to its panel: say why and pulse the note. */
  const blockedClick = (panel: Panel) => (event: React.MouseEvent<HTMLElement>) => {
    const { mode } = sessionRef.current;
    if (mode === 'off') return;
    const onLocked = [...event.currentTarget.querySelectorAll('[inert]')].some((element) => {
      const box = element.getBoundingClientRect();
      return event.clientX >= box.left && event.clientX <= box.right && event.clientY >= box.top && event.clientY <= box.bottom;
    });
    if (!onLocked) return;
    setStatusMessage(busyStatus(mode));
    setPulse((current) => ({ panel, seq: current.seq + 1 }));
  };
  const lockNoteOf = (panel: Panel) => {
    const note = lockNote(panel, editMode);
    return note && <p key={pulse.panel === panel ? pulse.seq : 0} className="lock-note" role="note">{translateMessage(note)}</p>;
  };

  return <main>
    <header>
      <div className="brand"><h1><BrandLogo /></h1><small>{t('Resin Support Studio')}</small></div>
      <div className="header-actions">
        <Segmented className="segmented lang" label={t('Language')} value={lang} onChange={chooseLanguage} options={LANGS.map((entry) => ({ value: entry.lang, label: entry.label, lang: entry.lang, title: entry.name }))} />
        <div className="toolbar-group">
          <CommandButton command={command('history.undo')} run={runCommand} />
          <CommandButton command={command('history.redo')} run={runCommand} />
        </div>
        <div className="toolbar-group">
          <CommandButton command={command('view.models')} run={runCommand} />
          <CommandButton command={command('view.wireframe')} run={runCommand} />
        </div>
      </div>
    </header>
    <section className="workspace">
      <aside className="panel left" onClick={blockedClick('left')}>
        {lockNoteOf('left')}
        <label className="drop" {...(locked('import') ? { inert: '' } : {})} title={t('Choose STL, GLB or glTF files, or drop them on the viewport')}>
          <input type="file" aria-description={t('Choose STL, GLB or glTF files, or drop them on the viewport')} multiple accept=".stl,.glb,.gltf" onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          <strong>{t('Import models')}</strong>
          <small>{t('STL, GLB or glTF. Files stay on this device.')}</small>
        </label>
        <div className="project-row" {...(locked('import') ? { inert: '' } : {})}>
          <CommandButton command={command('project.open')} run={runCommand} />
          <CommandButton command={command('project.save')} run={runCommand} />
        </div>
        <ObjectList
          scene={scene}
          supportCount={(unit) => unitContacts(unit, built.get(unit.id)?.mesh).length}
          building={building}
          onSelect={onSelect}
          selectAllCommand={command('objects.selectAll')}
          deleteCommand={command('objects.delete')}
          locked={locked('objects')}
          run={runCommand}
        />
        <section {...(locked('transform') ? { inert: '' } : {})}>
          <h3>{t('Transform')}</h3>
          <Segmented value={gizmoMode} onChange={setGizmoMode} disabled={!command('transform.move').enabled} options={([['none', 'transform.select'], ['translate', 'transform.move'], ['rotate', 'transform.rotate']] as const).map(([value, id]) => {
            const { label, hint: text, shortcut } = command(id);
            return { value, label: t(label), hint: text, ...(shortcut ? { shortcut } : {}) };
          })} />
        </section>
        <section {...(locked('supports') ? { inert: '' } : {})}>
          <h3>{t('Supports for {scope}', { scope: scopeLabel })}</h3>
          <CommandButton command={command('supports.generate')} run={runCommand} {...(scopeGenerated ? { className: scopePending ? 'regen attention' : 'regen' } : {})} />
          <CommandButton command={command('supports.clearManual')} run={runCommand} />
          <CommandButton command={command('supports.remove')} run={runCommand} />
        </section>
        <ModeSections ui={ui} run={runCommand} zones={activeUnit?.zones.length} />
        <section className="support-check" {...(locked('check') ? { inert: '' } : {})}>
          <h3>{t('Check supports')}</h3>
          <CommandButton command={command('check.run')} run={runCommand} />
          <ProblemList problems={listedProblems} outOfDate={outOfDate} rechecking={isRechecking} unitName={unitName} onShow={showProblem} onFix={fixProblem} />
          <p className="help">{t('Finds islands and overhangs no contact reaches, before you print.')}</p>
        </section>
      </aside>
      <section
        className={`viewport${isDraggingOver ? ' viewport--dropping' : ''}${VIEWPORT_CLASS[press.kind]}`}
        onDragOver={(event) => { event.preventDefault(); setIsDraggingOver(sessionRef.current.mode === 'off'); }}
        onDragLeave={(event) => { if (event.currentTarget === event.target) setIsDraggingOver(false); }}
        onDrop={dropImport}
      >
        <ObjectViewport
          scene={scene}
          supportMeshes={supportMeshes}
          gesture={press}
          gizmoMode={gizmoMode}
          modelVisible={modelVisible}
          wireframe={wireframe}
          onSelect={onSelect}
          onTransform={onTransform}
          onAddContact={onAddContact}
          onRemoveContact={onRemoveContact}
          onErase={onErase}
          onEditMiss={onEditMiss}
          liveTool={liveTool}
          selection={selection}
          onToggleContact={onToggleContact}
          onPaint={onPaint}
          onShift={onShift}
          onZoneStroke={onZoneStroke}
          onNoBodies={onNoBodies}
          problems={listedProblems}
          {...(added ? { added } : {})}
          {...(focus ? { focus } : {})}
          {...(viewRequest ? { viewRequest } : {})}
          tipsView={tipsOnly.shown}
          onBelowPlate={onBelowPlate}
        />
        <div className="viewport-view" role="group" aria-label={t('View')}>
          {/* Forced by zones, the button stays focusable (its hint says why) but does nothing. */}
          <button aria-pressed={tipsOnly.shown} aria-disabled={tipsOnly.forced} onClick={() => setTips((state) => tipsPress(state, tipsContext))} {...hint(tipsOnly.hint)}>{t('Tips only')}</button>
          <CommandButton command={command('view.fit')} run={runCommand} />
          <CommandButton command={command('view.bottom')} run={runCommand} />
        </div>
        <CirclePreview gesture={press} />
        {isDraggingOver && <div className="viewport-drop-overlay">{t('Drop to import')}</div>}
        <JobActivityPanel />
        <div className="undo-toast-region" role="status" aria-live="polite">
          {toast && <UndoToast key={toast.id} toast={toast} onUndo={undoToastAction} onClose={closeToast} />}
        </div>
        {press.kind === 'none' ? <>
          <div className="viewport-object-status">{activeUnit ? activeUnit.name : t('Nothing selected')}</div>
          <div className="viewport-note">{t('Millimetres. Build plate at zero.')}</div>
        </> : press.kind === 'zones'
          ? <ZonesBar brush={press.brush} unitName={activeUnit?.name} belowPlate={tips.below} hidden={zonesHidden} ui={ui} send={send} run={runCommand} />
          : <EditBar gesture={press} unitName={activeUnit?.name} ui={ui} clickReach={{ value: activeSettings.eraseRadius, onChange: (value, edit) => onSettingChange('eraseRadius', value, edit) }} send={send} run={runCommand} />}
      </section>
      <aside className="panel right" onClick={blockedClick('right')}>
        {lockNoteOf('right')}
        {!activeUnit && <p className="help">{t('Select an object to edit its settings. Changes apply to every selected object.')}</p>}
        <SettingsPanel
          settings={activeSettings}
          shape={{ selected: selectedIds.length, ...shapeRegion, onChange: onShapeChange, run: runCommand, band: activeUnit && <ShapeBand supports={bandCounts.supports} customised={bandCounts.customised} ui={ui} run={runCommand} /> }}
          ui={ui}
          scope={activeUnit ? `${activeUnit.name}${selectedCount > 1 ? ` ${t('and {n} more', { n: selectedCount - 1 })}` : ''}` : t('Nothing selected')}
          deferPlacement={editMode === 'edit'}
          placementPending={!generating && !regenQueued && Boolean(activeUnit && placementPending(activeUnit))}
          autoLabel={activeIndex >= 0 ? labelForIndex(activeIndex) : 'A'}
          disabled={!activeUnit}
          locked={locked('settings')}
          onChange={onSettingChange}
          onCancelEdit={cancelEdit}
          onPreset={(preset) => changeSettings((settings) => applyPreset(preset, settings), false)}
          onRoofMode={(mode) => changeSettings((settings) => setRoofMode(settings, mode), false)}
        />
        <section className="export" {...(locked('export') ? { inert: '' } : {})}>
          <h3>{t('Export STL')}</h3>
          {EXPORT_IDS.map((id) => <CommandButton key={id} command={command(id)} run={runCommand} />)}
          <p className="help">{t('Exports match the viewport at full resolution. Source models are never changed.')}</p>
        </section>
      </aside>
    </section>
    <footer>
      <span>{plural(scene.units.length, '1 object', '{n} objects')}</span>
      {activeUnit && <span>{t('{n} triangles', { n: (activeUnit.source.indices.length / 3).toLocaleString() })}</span>}
      {contactCounts && <span className={building(activeUnit!) ? 'building' : undefined} aria-busy={building(activeUnit!) || undefined} {...hint('Automatic supports you removed by hand. Clear manual edits brings them back')}>{t('{auto} automatic, {manual} manual, {removed} removed', contactCounts)}</span>}
      {/* Announced to screen readers, so errors and step results are heard too. */}
      <strong role="status" aria-live="polite">{translateMessage(status)}</strong>
      <button type="button" className="link-button" onClick={() => setTermsOpen(true)} {...hint('Read the terms of use')}>{t('Terms')}</button>
    </footer>
    {termsOpen && <TermsDialog lang={lang} onClose={() => setTermsOpen(false)} />}
  </main>;
}
