import { refusalLimit, type Runtime } from '../core/budget';
import type { PrintScene } from '../state/project';
import { triangleCountOf } from '../state/projectFile';
import { MODELS_IGNORED, openedStatus, openFailure, ProjectTooLarge } from '../editing/project';
import { importRefusal } from '../editing/status';
import type { EditMode, StatusMessage } from '../editing/types';
import type { UndoAction } from '../editing/toast';

/** What Open project needs of the app; the hook supplies them. */
export interface OpenHost {
  runtime: Runtime;
  /** Reads the file; its job row (blocking, with progress) is the reader's own, and ends when it settles. */
  read: (file: File, triangleLimit: number) => Promise<PrintScene>;
  mode: () => EditMode;
  hadObjects: () => boolean;
  replace: (scene: PrintScene) => void;
  markSaved: (scene: PrintScene) => void;
  setStatusMessage: (message: StatusMessage) => void;
  offerUndo: (action: UndoAction) => void;
  refused: (message: StatusMessage) => void;
}

/** Open a project file: read it, check it fits, replace the plate as one history step. */
export async function openProjectFile(file: File, host: OpenHost, modelsIgnored = false): Promise<boolean> {
  try {
    const limit = refusalLimit(host.runtime);
    const opened = await host.read(file, limit);
    const triangles = triangleCountOf(opened);
    if (triangles > limit) throw new ProjectTooLarge(triangles, limit);
    // A mode that began while the file was read keeps the plate: nothing is replaced under it.
    const late = importRefusal(host.mode());
    if (late) return host.refused(late), false;
    const hadObjects = host.hadObjects();
    host.replace(opened);
    host.markSaved(opened);
    host.setStatusMessage(modelsIgnored ? MODELS_IGNORED : openedStatus(file.name));
    if (hadObjects) host.offerUndo({ kind: 'openProject', name: file.name });
    return true;
  } catch (error) {
    host.setStatusMessage(openFailure(error, file.name));
    return false;
  }
}
