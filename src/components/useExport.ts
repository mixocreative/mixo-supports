import { useCallback, useState, type MutableRefObject } from 'react';
import { errorStatus } from '../editing/errors';
import { exportStatus, type CheckTally } from '../editing/check';
import { plural, type Message } from '../i18n';
import type { PrintScene, PrintUnit } from '../state/project';
import { exportUnits, planExport, type ExportKind } from '../supports/export';
import { currentBuilds, supportJobOf, unitContacts, type UnitBuild } from '../supports/unitSupports';
import type { SupportMeshClient } from '../workers/meshClient';
import { codedJobError } from '../workers/jobErrors';
import { isAbort, type SetStatus } from './appShared';

/**
 * Export: plans the files, builds them at full resolution in the export worker, hands them to the
 * browser, and says what came out. The support check runs alongside so the status can warn about
 * gaps; a check that fails or is cancelled leaves its units unchecked and the status says so.
 */
export function useExport(host: {
  sceneRef: MutableRefObject<PrintScene>;
  builtRef: MutableRefObject<ReadonlyMap<string, UnitBuild>>;
  exporter: () => SupportMeshClient;
  runCheck: (units: readonly PrintUnit[]) => Promise<CheckTally>;
  setStatus: SetStatus;
  setStatusMessage: (message: Message) => void;
}) {
  const { sceneRef, builtRef, exporter, runCheck, setStatus, setStatusMessage } = host;
  const [exporting, setExporting] = useState(false);
  const runExport = useCallback(async (kind: ExportKind) => {
    const current = sceneRef.current;
    // A unit changed since its build keeps its supports part (the worker skips an empty one).
    const files = planExport(current, kind, currentBuilds(current.units, builtRef.current));
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
      // The file names and how many supports the files hold, as the status names them.
      const count = units.reduce((sum, [unit]) => sum + unitContacts(unit, builtRef.current.get(unit.id)?.mesh).length, 0);
      const names = `${written.map((file) => file.fileName).join(', ')} (${plural(count, '1 support', '{n} supports')})`;
      setStatusMessage(exportStatus(names, await checking));
    } catch (error) {
      if (isAbort(error)) setStatus('Export cancelled; no file was written.');
      else setStatusMessage(errorStatus('export', codedJobError(error)));
    } finally {
      setExporting(false);
    }
  }, [builtRef, exporter, runCheck, sceneRef, setStatus, setStatusMessage]);
  return { exporting, runExport };
}
