import { useCallback, useEffect, useMemo, useReducer, useRef, useState } from 'react';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { Object3D } from 'three';
import { labelForIndex } from './analysis/mesh';
import { isCurrentPlacement } from './analysis/placement';
import type { PlacementWorkerProgress, PlacementWorkerRequest, PlacementWorkerResponse, SupportPoint } from './analysis/types';
import ProgressBar, { type ProgressTask } from './components/ProgressBar';
import { SupportMeshClient, type MeshProgress } from './workers/meshClient';
import ObjectViewport, { acceptModelFile, type EditMode, type GizmoMode } from './components/ObjectViewport';
import SettingsPanel from './components/SettingsPanel';
import { createSceneHistory, redoScene, undoScene, withSceneCommand, type SceneHistory } from './state/history';
import { importGltfUnits, importStlUnit, placeImportedUnits, type ImportedMesh } from './state/import';
import { emptyScene, type PrintScene, type PrintUnit, type SceneCommand, type SupportSettings } from './state/project';
import { applyTransform, inverseTransformDirection, inverseTransformPoint, type ModelTransform } from './state/transform';
import { buildExportJobs, encodeStl, exportUnits, type ExportKind } from './supports/export';
import { meshBounds, type GeneratedSupportMesh } from './supports/mesh';
import { applyPreset, defaultSupportSettings, setRoofMode, toPlacementSettings, updateSetting, type LiveSupportSettings, type SettingKey } from './supports/settings';
import { resolveSettings, unitContacts, unitSupportMesh } from './supports/unitSupports';

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

const EXPORTS: { kind: ExportKind; label: string }[] = [
  { kind: 'active-printable', label: 'Active unit with model' },
  { kind: 'active-supports', label: 'Active unit, supports only' },
  { kind: 'separate-printable', label: 'Each unit with model' },
  { kind: 'separate-supports', label: 'Each unit, supports only' },
  { kind: 'whole-printable', label: 'Whole plate in one file' },
];

interface PendingJob {
  revision: number;
  /** Lifted unit transform committed with the result. */
  transform: ModelTransform;
  /** Frame the worker analysed: the unit rotation without translation. */
  orientation: ModelTransform;
}

export default function App() {
  const [history, dispatchHistory] = useReducer(historyReducer, emptyScene, createSceneHistory);
  const scene = history.present;
  const sceneRef = useRef(scene);
  sceneRef.current = scene;
  const dispatch = useCallback((command: SceneCommand) => dispatchHistory({ type: 'command', command }), []);

  const [status, setStatus] = useState('Drop STL, GLB or glTF files to begin. Every mesh becomes a print unit.');
  const [editMode, setEditMode] = useState<EditMode>('off');
  const [gizmoMode, setGizmoMode] = useState<GizmoMode>('translate');
  const [modelVisible, setModelVisible] = useState(true);
  const [wireframe, setWireframe] = useState(false);
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);

  const activeUnit = scene.units.find((unit) => unit.id === scene.activeUnitId);
  const activeIndex = activeUnit ? scene.units.indexOf(activeUnit) : -1;
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

  // ---- Support meshes ------------------------------------------------------------------
  // Built in a worker from scene state; a unit keeps showing its previous mesh until the new
  // one arrives, and units that did not change are not rebuilt.
  const [supportMeshes, setSupportMeshes] = useState<ReadonlyMap<string, GeneratedSupportMesh>>(new Map());
  const requested = useRef(new Map<string, { unit: PrintUnit; index: number }>());
  const meshClient = useRef<SupportMeshClient | null>(null);
  const client = useCallback(() => {
    meshClient.current ??= new SupportMeshClient(
      (progress: MeshProgress) => setTask(`mesh:${progress.mode}:${progress.unitId}`, {
        label: `${progress.mode === 'export' ? 'Preparing export for' : 'Building supports for'} ${unitName(progress.unitId)}`,
        stage: progress.stage,
        fraction: progress.fraction,
      }),
      (mode, unitId) => setTask(`mesh:${mode}:${unitId}`, undefined),
    );
    return meshClient.current;
  }, [setTask, unitName]);
  useEffect(() => () => meshClient.current?.dispose(), []);

  useEffect(() => {
    const ids = new Set(scene.units.map((unit) => unit.id));
    for (const id of [...requested.current.keys()]) if (!ids.has(id)) requested.current.delete(id);
    setSupportMeshes((current) => {
      const kept = new Map([...current].filter(([id]) => ids.has(id)));
      return kept.size === current.size ? current : kept;
    });
    scene.units.forEach((unit, index) => {
      const previous = requested.current.get(unit.id);
      if (previous && previous.unit === unit && previous.index === index) return;
      requested.current.set(unit.id, { unit, index });
      if (unit.supports === undefined) {
        const empty = unitSupportMesh(unit, index);
        setSupportMeshes((current) => new Map(current).set(unit.id, empty));
        return;
      }
      setTask(`mesh:preview:${unit.id}`, { label: `Building supports for ${unitName(unit.id)}`, stage: 'Queued', fraction: 0 });
      client().build(unit, index, 'preview').then((mesh) => {
        if (!mesh || requested.current.get(unit.id)?.unit !== unit) return;
        setSupportMeshes((current) => new Map(current).set(unit.id, mesh));
      }, (error: Error) => setStatus(`Support building failed: ${error.message}`));
    });
  }, [scene.units, client, setTask, unitName]);

  // ---- Placement worker ------------------------------------------------------------
  const workerRef = useRef<Worker | null>(null);
  const pending = useRef(new Map<string, PendingJob>());
  const revision = useRef(0);
  const jobId = useRef(0);

  const onPlacement = useCallback((response: PlacementWorkerResponse | PlacementWorkerProgress) => {
    const job = pending.current.get(response.unitId);
    if (response.kind === 'progress') {
      if (job?.revision === response.revision) {
        setTask(`placement:${response.unitId}`, { label: `Placing contacts on ${unitName(response.unitId)}`, stage: response.stage, fraction: response.fraction });
      }
      return;
    }
    const latest = job ? { [response.unitId]: job.revision } : {};
    if (!job || !isCurrentPlacement(latest, response)) return;
    pending.current.delete(response.unitId);
    setPendingCount(pending.current.size);
    setTask(`placement:${response.unitId}`, undefined);
    if (!sceneRef.current.units.some((unit) => unit.id === response.unitId)) return;
    const toLocal = (point: SupportPoint): SupportPoint => ({
      ...point,
      position: inverseTransformPoint(job.orientation, point.position),
      normal: inverseTransformDirection(job.orientation, point.normal),
    });
    const points = response.result.points.map(toLocal);
    dispatch({ type: 'batch', commands: [
      { type: 'transform/set', unitId: response.unitId, transform: job.transform },
      {
        type: 'supports/set',
        unitId: response.unitId,
        placement: {
          points,
          regions: response.result.regions,
          contactPositions: new Float32Array(points.flatMap((point) => point.position)),
          contactNormals: new Float32Array(points.flatMap((point) => point.normal)),
        },
        supports: { kind: 'live', data: { transform: { position: [...job.transform.position], rotation: [...job.transform.rotation] } } },
      },
    ] });
    const unit = sceneRef.current.units.find((candidate) => candidate.id === response.unitId);
    setStatus(`${unit?.name ?? 'Unit'}: ${points.length} automatic contacts generated.`);
  }, [dispatch, setTask, unitName]);

  const worker = useCallback(() => {
    if (!workerRef.current) {
      const created = new Worker(new URL('./workers/supportWorker.ts', import.meta.url), { type: 'module' });
      created.onmessage = (event: MessageEvent<PlacementWorkerResponse | PlacementWorkerProgress>) => onPlacement(event.data);
      created.onerror = () => {
        for (const id of pending.current.keys()) setTask(`placement:${id}`, undefined);
        pending.current.clear();
        setPendingCount(0);
        setStatus('Support analysis failed; adjust the model or settings and generate again.');
        workerRef.current?.terminate();
        workerRef.current = null;
      };
      workerRef.current = created;
    }
    return workerRef.current;
  }, [onPlacement, setTask]);
  useEffect(() => () => workerRef.current?.terminate(), []);

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
      const orientation: ModelTransform = { position: [0, 0, 0], rotation: transform.rotation };
      const mesh = applyTransform(unit.source, orientation);
      const job: PendingJob = { revision: ++revision.current, transform, orientation };
      pending.current.set(unit.id, job);
      const request: PlacementWorkerRequest = { jobId: ++jobId.current, unitId: unit.id, revision: job.revision, mesh, settings: toPlacementSettings(settings) };
      worker().postMessage(request, [mesh.positions.buffer, mesh.indices.buffer]);
      setTask(`placement:${unit.id}`, { label: `Placing contacts on ${unitName(unit.id)}`, stage: 'Queued', fraction: 0 });
    }
    setPendingCount(pending.current.size);
    setStatus(`Analysing overhangs for ${units.length} unit${units.length === 1 ? '' : 's'}.`);
  }, [setTask, targets, unitName, worker]);

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
    try {
      const imported: ImportedMesh[][] = [];
      for (const file of accepted) {
        const data = await file.arrayBuffer();
        if (/\.stl$/i.test(file.name)) imported.push([importStlUnit(new STLLoader().parse(data), file.name)]);
        else {
          const gltf = await new Promise<{ scene: Object3D }>((resolve, reject) => new GLTFLoader().parse(data, '', resolve, reject));
          const meshes = importGltfUnits(gltf, file.name);
          if (meshes.length === 0) throw new Error(`${file.name} contains no mesh`);
          imported.push(meshes);
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
      setStatus(`Imported ${added.length} print unit${added.length === 1 ? '' : 's'}. Generate to place supports.`);
    } catch (error) {
      setStatus(`Import error: ${error instanceof Error ? error.message : 'unsupported model'}`);
    }
  }, [dispatch]);

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
    const count = forTargets((unit) => (unit.supports ? { type: 'supports/remove', unitId: unit.id } : undefined));
    setStatus(count ? `Removed supports from ${count} unit${count === 1 ? '' : 's'}; models untouched, manual edits kept for regeneration.` : 'No supports to remove.');
  };
  const clearManual = () => {
    const count = forTargets((unit) => (unit.manual.length || unit.suppressed.length ? { type: 'supports/clear-manual', unitId: unit.id } : undefined));
    setStatus(count ? 'Manual edits cleared; automatic contacts restored.' : 'No manual edits to clear.');
  };
  const deleteUnits = useCallback(() => {
    const ids = sceneRef.current.selectedUnitIds;
    if (ids.length === 0) return;
    dispatch({ type: 'batch', commands: ids.map((unitId) => ({ type: 'unit/remove' as const, unitId })) });
    setStatus(`Deleted ${ids.length} unit${ids.length === 1 ? '' : 's'} (undo restores).`);
  }, [dispatch]);

  const onSelect = useCallback((unitId: string | null, additive: boolean) => {
    const current = sceneRef.current;
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
    setStatus('Unit moved with its supports. Regenerate to re-plant supports after a rotation.');
  }, [dispatch]);

  const onAddContact = useCallback((unitId: string, point: [number, number, number], normal: [number, number, number]) => {
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
    setStatus('Manual support added.');
  }, [dispatch]);

  const removeContact = useCallback((unit: PrintUnit, contactId: string): SceneCommand => (
    unit.manual.some((point) => point.id === contactId)
      ? { type: 'manual/remove', unitId: unit.id, pointId: contactId }
      : { type: 'suppression/add', unitId: unit.id, pointId: contactId }
  ), []);

  const onRemoveContact = useCallback((unitId: string, contactId: string) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    dispatch(removeContact(unit, contactId));
    setStatus('Support removed; the removal persists through regeneration.');
  }, [dispatch, removeContact]);

  const onErase = useCallback((unitId: string, point: [number, number, number]) => {
    const unit = sceneRef.current.units.find((candidate) => candidate.id === unitId);
    if (!unit) return;
    const local = inverseTransformPoint(unit.transform, point);
    const radius = resolveSettings(unit.settings).eraseRadius;
    const hits = unitContacts(unit).filter((contact) => Math.hypot(...contact.position.map((value, axis) => value - local[axis]!)) <= radius);
    if (hits.length === 0) return setStatus(`No support contact within ${radius} mm of the click.`);
    dispatch({ type: 'batch', commands: hits.map((contact) => removeContact(unit, contact.id)) });
    setStatus(`Removed ${hits.length} support${hits.length === 1 ? '' : 's'} within ${radius} mm.`);
  }, [dispatch, removeContact]);

  const [exporting, setExporting] = useState(false);
  const runExport = async (kind: ExportKind) => {
    const current = sceneRef.current;
    const units = exportUnits(current, kind);
    if (units.length === 0) return setStatus(kind.startsWith('active') && !current.activeUnitId ? 'Select a unit to export.' : 'Nothing to export for this mode.');
    setExporting(true);
    setStatus('Preparing export at full resolution.');
    let meshes: Map<string, GeneratedSupportMesh>;
    try {
      const built = await Promise.all(units.map(async ([unit, index]) => [unit.id, await client().build(unit, index, 'export')] as const));
      meshes = new Map(built.filter((entry): entry is readonly [string, GeneratedSupportMesh] => entry[1] !== undefined));
    } catch (error) {
      setExporting(false);
      return setStatus(`Export failed: ${error instanceof Error ? error.message : 'support building error'}`);
    }
    setExporting(false);
    const jobs = buildExportJobs(current, { kind }, meshes);
    if (jobs.length === 0) return setStatus('Nothing to export for this mode.');
    for (const job of jobs) {
      const url = URL.createObjectURL(new Blob([encodeStl(job.group)], { type: 'model/stl' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = job.fileName;
      anchor.click();
      window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }
    setStatus(`Exported ${jobs.map((job) => job.fileName).join(', ')}.`);
  };

  // ---- Keyboard ------------------------------------------------------------------------
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const mod = event.ctrlKey || event.metaKey;
      if (mod && event.key.toLowerCase() === 'z') {
        event.preventDefault();
        dispatchHistory({ type: event.shiftKey ? 'redo' : 'undo' });
      } else if (mod && event.key.toLowerCase() === 'y') {
        event.preventDefault();
        dispatchHistory({ type: 'redo' });
      } else if (event.key === 'Tab') {
        event.preventDefault();
        setEditMode((mode) => (mode === 'off' ? 'add' : 'off'));
      } else if (event.key === 'Escape') {
        setEditMode('off');
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
  }, [deleteUnits, editMode]);

  const dropImport = (event: React.DragEvent<HTMLElement>) => {
    event.preventDefault();
    setIsDraggingOver(false);
    void importFiles([...event.dataTransfer.files]);
  };

  const contactCounts = activeUnit ? {
    auto: activeUnit.placement?.points.filter((point) => !activeUnit.suppressed.includes(point.id)).length ?? 0,
    manual: activeUnit.manual.length,
    removed: activeUnit.suppressed.length,
  } : undefined;
  const selectedCount = scene.selectedUnitIds.length;
  const scopeLabel = selectedCount > 0 ? `${selectedCount} selected` : `all ${scene.units.length}`;

  return <main>
    <header>
      <div className="brand"><h1>Resin Support Studio</h1><small>Mixo supports</small></div>
      <div className="header-actions">
        <div className="toolbar-group">
          <button onClick={() => dispatchHistory({ type: 'undo' })} disabled={history.past.length === 0} title="Undo (Ctrl+Z)">Undo</button>
          <button onClick={() => dispatchHistory({ type: 'redo' })} disabled={history.future.length === 0} title="Redo (Ctrl+Shift+Z)">Redo</button>
        </div>
        <div className="toolbar-group">
          <button onClick={() => setModelVisible((visible) => !visible)}>{modelVisible ? 'Hide' : 'Show'} models</button>
          <button onClick={() => setWireframe((value) => !value)}>{wireframe ? 'Solid' : 'Wireframe'}</button>
        </div>
        <button className="primary" onClick={() => generate()} disabled={scene.units.length === 0}>{pendingCount > 0 ? 'Generating supports' : `Generate supports for ${scopeLabel}`}</button>
      </div>
    </header>
    <section className="workspace">
      <aside className="panel left">
        <label className="drop">
          <input type="file" multiple accept=".stl,.glb,.gltf" onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ''; }} />
          <strong>Import models</strong>
          <small>STL, GLB or glTF. Files stay on this device.</small>
        </label>
        <section>
          <h3>Print units</h3>
          {scene.units.length === 0 ? <p className="help">Each STL, and each mesh inside a glTF, becomes its own unit.</p> : <ul className="units">
            {scene.units.map((unit, index) => {
              const selected = scene.selectedUnitIds.includes(unit.id);
              return <li key={unit.id}>
                <button className={`unit${selected ? ' selected' : ''}${unit.id === scene.activeUnitId ? ' active' : ''}`} onClick={(event) => onSelect(unit.id, event.shiftKey || event.ctrlKey || event.metaKey)}>
                  <b>{resolveSettings(unit.settings).labelText || labelForIndex(index)}</b>
                  <span>{unit.name}</span>
                  <small>{unit.supports ? `${unitContacts(unit).length} supports` : 'No supports yet'}</small>
                </button>
              </li>;
            })}
          </ul>}
          <div className="row">
            <button onClick={() => dispatch({ type: 'selection/set', unitIds: scene.units.map((unit) => unit.id), ...(scene.units[0] ? { activeUnitId: scene.activeUnitId ?? scene.units[0].id } : {}) })} disabled={scene.units.length === 0}>Select all</button>
            <button onClick={deleteUnits} disabled={selectedCount === 0}>Delete</button>
          </div>
        </section>
        <section>
          <h3>Object</h3>
          <div className="segmented">
            {(['none', 'translate', 'rotate'] as const).map((mode) => <button key={mode} className={gizmoMode === mode ? 'active' : ''} aria-pressed={gizmoMode === mode} onClick={() => { setGizmoMode(mode); setEditMode('off'); }}>{mode === 'none' ? 'select' : mode === 'translate' ? 'move' : 'rotate'}</button>)}
          </div>
        </section>
        <section>
          <h3>Edit supports</h3>
          <div className="segmented">
            {(['off', 'add', 'remove'] as const).map((mode) => <button key={mode} className={editMode === mode ? 'active' : ''} aria-pressed={editMode === mode} onClick={() => setEditMode(mode)} disabled={mode !== 'off' && !activeUnit}>{mode}</button>)}
          </div>
          <p className="help">{editMode === 'off'
            ? 'Press Tab to edit the active unit. Shift-click adds units to the selection.'
            : editMode === 'add'
              ? 'Click the model to add a support. Right-click or Ctrl-click a support to remove it. Ctrl-click the model to erase nearby supports. Esc when done.'
              : 'Click a support, or the model near one, to remove it. Esc when done.'}</p>
        </section>
        <section>
          <h3>Supports for {scopeLabel}</h3>
          <button onClick={() => generate()} disabled={scene.units.length === 0}>Regenerate</button>
          <button onClick={clearManual} disabled={scene.units.length === 0}>Clear manual edits</button>
          <button onClick={removeSupports} disabled={scene.units.length === 0}>Remove supports</button>
        </section>
      </aside>
      <section
        className={isDraggingOver ? 'viewport viewport--dropping' : 'viewport'}
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
        />
        {isDraggingOver && <div className="viewport-drop-overlay">Drop to import</div>}
        <ProgressBar tasks={[...tasks.values()]} />
        <div className={`viewport-object-status${editMode === 'off' ? '' : ' editing'}`}>
          {editMode === 'off' ? (activeUnit ? activeUnit.name : 'Nothing selected') : `Editing supports on ${activeUnit?.name ?? 'unit'}`}
        </div>
        <div className="viewport-note">Millimetres. Build plate at zero.</div>
      </section>
      <aside className="panel right">
        <h2>Support settings{activeUnit ? <small>{activeUnit.name}{selectedCount > 1 ? ` and ${selectedCount - 1} more` : ''}</small> : null}</h2>
        {!activeUnit && <p className="help">Select a unit to edit its settings. Changes apply to every selected unit.</p>}
        <SettingsPanel
          settings={activeSettings}
          autoLabel={activeIndex >= 0 ? labelForIndex(activeIndex) : 'A'}
          disabled={!activeUnit}
          onChange={onSettingChange}
          onPreset={(preset) => changeSettings((settings) => applyPreset(preset, settings), false)}
          onRoofMode={(mode) => changeSettings((settings) => setRoofMode(settings, mode), false)}
        />
        <section className="export">
          <h3>Export STL</h3>
          {EXPORTS.map((entry) => <button key={entry.kind} onClick={() => void runExport(entry.kind)} disabled={scene.units.length === 0 || exporting}>{entry.label}</button>)}
          <p className="help">Exports match the viewport at full resolution. Source models are never changed.</p>
        </section>
      </aside>
    </section>
    <footer>
      <span>{scene.units.length} unit{scene.units.length === 1 ? '' : 's'}</span>
      {activeUnit && <span>{(activeUnit.source.indices.length / 3).toLocaleString()} triangles</span>}
      {contactCounts && <span>{contactCounts.auto} automatic, {contactCounts.manual} manual, {contactCounts.removed} removed</span>}
      <strong>{status}</strong>
    </footer>
  </main>;
}
