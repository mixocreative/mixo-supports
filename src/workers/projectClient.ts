import { ProjectFileError, ProjectTooLarge, type ProjectErrorCode } from '../editing/project';
import type { PrintScene } from '../state/project';
import { unpackProject } from '../state/projectFile';
import type { JobActivity } from './jobActivity';
import { setPrebuiltBvh } from '../state/meshExtras';
import type { ProjectResult, ProjectTask } from './projectProtocol';
import { WorkerJobError, WorkerTask, type WorkerLike } from './WorkerTask';

const FILE_ERRORS: readonly string[] = ['not-project', 'damaged', 'newer'] satisfies ProjectErrorCode[];

/** Open project in a worker. A worker lives only while its file is read (WorkerTask 'per-job'); without Worker the file is read here. */
export class ProjectClient {
  private readonly runner: WorkerTask<ProjectTask, ProjectResult>;

  constructor(create: (() => WorkerLike) | null, activity?: JobActivity) {
    this.runner = new WorkerTask({
      create, mode: 'per-job', name: 'Open project', activity,
      fallback: async ({ file, triangleLimit }) => ({ scene: await unpackProject(file, triangleLimit), picks: [] }),
    });
  }

  /** The scene in `file`; rejects with ProjectFileError or ProjectTooLarge, as `unpackProject` does. */
  async open(file: File, triangleLimit: number): Promise<PrintScene> {
    const label = { key: 'Opening {name}', vars: { name: file.name } };
    try {
      const { scene, picks } = await this.runner.run({ file, triangleLimit }, { label, blocking: true, context: 'project' });
      scene.units.forEach((unit, k) => { if (picks[k]) setPrebuiltBvh(unit.source, picks[k]!); });
      return scene;
    } catch (error) {
      throw rebuilt(error);
    }
  }
}

/** The app's own error classes, rebuilt from the code and values serveTask carried across the worker boundary. */
function rebuilt(error: unknown): unknown {
  if (!(error instanceof WorkerJobError) || !error.code) return error;
  if (FILE_ERRORS.includes(error.code)) return new ProjectFileError(error.code as ProjectErrorCode, error.message, error.vars);
  if (error.code === 'project-too-large') return new ProjectTooLarge(Number(error.vars?.n), Number(error.vars?.limit));
  return error;
}
