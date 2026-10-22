import { useCallback, useEffect, useRef, type MutableRefObject } from 'react';
import { importRefusal } from '../editing/status';
import { openProjectFile } from './openProject';
import { saveFailure, savedStatus, SAVE_CANCELLED } from '../editing/project';
import type { EditMode, StatusMessage } from '../editing/types';
import type { UndoAction } from '../editing/toast';
import type { PrintScene } from '../state/project';
import { packProject, projectFileName, PROJECT_EXTENSION, sameUnits, unpackProject } from '../state/projectFile';
import { t } from '../i18n';
import { jobActivity } from '../workers/jobActivity';
import { refusalLimit } from '../core/budget';
import { isAbort, RUNTIME } from './appShared';

/** The browser's save dialog, where it has one; automation cannot answer a native dialog, so it downloads instead. */
type SavePicker = (options: object) => Promise<{ name: string; createWritable(): Promise<{ write(data: Blob): Promise<void>; close(): Promise<void> }> }>;
const savePicker = (): SavePicker | undefined => (typeof window !== 'undefined' && !navigator.webdriver ? (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker : undefined);

/**
 * Save project and Open project: the scene as a `.mixosupports` file and back. Opening replaces the
 * plate as one history step (an Undo toast when objects were there); it waits while a mode is on,
 * like an import. `dirty` is true once the objects differ from the last save or open, which arms the
 * page's leave prompt.
 */
export function useProjectFile(host: {
  sceneRef: MutableRefObject<PrintScene>;
  modeRef: MutableRefObject<{ mode: EditMode }>;
  replace: (scene: PrintScene) => void;
  setStatusMessage: (message: StatusMessage) => void;
  offerUndo: (action: UndoAction) => void;
  refused: (message: StatusMessage) => void;
  /** The scene the history shows now (it moves with every step, so the leave prompt follows it). */
  scene: PrintScene;
}) {
  const { sceneRef, modeRef, replace, setStatusMessage, offerUndo, refused, scene } = host;
  const saved = useRef<PrintScene>(scene);
  const busy = useRef(false);
  const dirty = !sameUnits(scene, saved.current);

  useEffect(() => {
    if (!dirty) return;
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [dirty]);

  const openProject = useCallback(async (file: File) => {
    const refusal = importRefusal(modeRef.current.mode);
    if (refusal) return refused(refusal);
    if (busy.current) return;
    busy.current = true;
    try {
      await openProjectFile(file, {
        jobs: jobActivity, runtime: RUNTIME, read: (blob) => unpackProject(blob, refusalLimit(RUNTIME)), mode: () => modeRef.current.mode,
        hadObjects: () => sceneRef.current.units.length > 0, replace, markSaved: (opened) => { saved.current = opened; },
        setStatusMessage, offerUndo, refused,
      });
    } finally {
      busy.current = false;
    }
  }, [modeRef, offerUndo, refused, replace, sceneRef, setStatusMessage]);

  const saveProject = useCallback(async () => {
    const current = sceneRef.current;
    if (current.units.length === 0 || busy.current) return;
    busy.current = true;
    let name = projectFileName(current);
    const job = jobActivity.begin({ label: { key: 'Saving {name}', vars: { name } }, context: 'project' });
    try {
      // The dialog first: it needs the click's activation, which a long pack could outlast.
      const picker = savePicker();
      const target = await picker?.({ suggestedName: name, types: [{ description: t('Mixo Supports project'), accept: { 'application/octet-stream': [PROJECT_EXTENSION] } }] });
      const file = await packProject(current);
      job.progress({ fraction: 0.8 });
      if (target) {
        const writable = await target.createWritable();
        await writable.write(file);
        await writable.close();
        name = target.name;
      } else {
        const url = URL.createObjectURL(file);
        const anchor = document.createElement('a');
        anchor.href = url;
        anchor.download = name;
        anchor.click();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }
      saved.current = current;
      setStatusMessage(savedStatus(name));
      job.end();
    } catch (error) {
      job.end();
      setStatusMessage(isAbort(error) ? SAVE_CANCELLED : saveFailure(error, name));
    } finally {
      busy.current = false;
    }
  }, [sceneRef, setStatusMessage]);

  /** The file chooser for Open project: a detached input, so the page keeps one file input (Import models). */
  const chooseProject = useCallback(() => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = PROJECT_EXTENSION;
    input.addEventListener('change', () => {
      const file = input.files?.[0];
      if (file) void openProject(file);
    });
    input.click();
  }, [openProject]);

  return { openProject, saveProject, chooseProject };
}
