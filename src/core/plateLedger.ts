/**
 * The plate guard across imports that run at once (heavy-mesh spec: the plate holds at most the
 * runtime's refusal limit). Each import holds the triangles it is adding while it reads; a check
 * counts the scene plus every hold, and takes its own hold in the same synchronous step, so two
 * imports started together cannot both pass (5M + 2M is refused, not 7M on the plate).
 */

/** The plate as the scene shows it now: its units' ids and their triangles. */
export interface PlateScene {
  ids: ReadonlySet<string>;
  triangles: number;
}

/** One import's hold on the plate. */
export interface PlateReservation {
  /**
   * Sets this import's hold to `triangles` (what it adds in total so far) once `check` accepts the
   * plate it would make: the scene, every other hold and these. Throws what `check` throws, and the
   * earlier hold stays.
   */
  hold(triangles: number, scene: PlateScene, check: (plate: number) => void): void;
  /** The import failed or was cancelled: nothing it held stays. */
  release(): void;
  /** The import's units were dispatched: held until the scene shows them (then the scene counts them). */
  commit(unitIds: readonly string[]): void;
}

interface Hold {
  triangles: number;
  /** Set once committed: the units whose arrival in the scene ends the hold. */
  unitIds?: readonly string[];
}

export class PlateLedger {
  private readonly holds = new Set<Hold>();

  /** Triangles held by imports, not yet in `scene`. */
  reserved(scene: PlateScene, except?: Hold): number {
    this.settle(scene.ids);
    let sum = 0;
    for (const hold of this.holds) if (hold !== except) sum += hold.triangles;
    return sum;
  }

  /** Ends committed holds whose units the scene now shows. */
  settle(sceneIds: ReadonlySet<string>): void {
    for (const hold of this.holds) if (hold.unitIds && hold.unitIds.every((id) => sceneIds.has(id))) this.holds.delete(hold);
  }

  open(): PlateReservation {
    const own: Hold = { triangles: 0 };
    return {
      hold: (triangles, scene, check) => {
        check(scene.triangles + this.reserved(scene, own) + triangles);
        own.triangles = triangles;
        this.holds.add(own);
      },
      release: () => {
        this.holds.delete(own);
      },
      commit: (unitIds) => {
        own.unitIds = [...unitIds];
        if (!this.holds.has(own)) this.holds.add(own);
      },
    };
  }
}
