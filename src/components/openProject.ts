import { refusalLimit, type Runtime } from '../core/budget';
import type { PrintScene } from '../state/project';
import { triangleCountOf } from '../state/projectFile';
import type { JobActivity } from '../workers/jobActivity';
import { MODELS_IGNORED, openedStatus, openFailure, ProjectTooLarge } from '../editing/project';
import { importRefusal } from '../editing/status';
import type { EditMode, StatusMessage } from '../editing/types';
import type { UndoAction } from '../editing/toast';

/** What Open project needs of the app; the hook supplies them. */
export interface OpenHost {
  jobs: JobActivity;
  runtime: Runtime;
  read: (file: Blob) => Promise<PrintScene>;
  mode: () => EditMode;
  hadObjects: () => boolean;
  replace: (scene: PrintScene) => void;
  markSaved: (scene: PrintScene) => void;
  setStatusMessage: (message: StatusMessage) => void;
  offerUndo: (action: UndoAction) => void;
  refused: (message: StatusMessage) => void;
}

/** Open a project file: read it, check it fits, replace the plate as one history step. Every path ends its job row. */
export async function openProjectFile(file: File, host: OpenHost, modelsIgnored = false): Promise<void> {
  const job = host.jobs.begin({ label: { key: 'Opening {name}', vars: { name: file.name } }, blocking: true, context: 'project' });
  try {
    const opened = await host.read(file);
    job.progress({ fraction: 0.9 });
    const triangles = triangleCountOf(opened);
    const limit = refusalLimit(host.runtime);
    if (triangles > limit) throw new ProjectTooLarge(triangles, limit);
    // A mode that began while the file was read keeps the plate: nothing is replaced under it.
    const late = importRefusal(host.mode());
    if (late) return host.refused(late);
    const hadObjects = host.hadObjects();
    host.replace(opened);
    host.markSaved(opened);
    host.setStatusMessage(modelsIgnored ? MODELS_IGNORED : openedStatus(file.name));
    if (hadObjects) host.offerUndo({ kind: 'openProject', name: file.name });
  } catch (error) {
    host.setStatusMessage(openFailure(error, file.name));
  } finally {
    job.end();
  }
}
