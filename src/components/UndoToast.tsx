import { useEffect, useRef, useState } from 'react';
import { UNDO_TOAST_MS, type UndoToast as Toast } from '../editing/toast';
import { t, translateMessage } from '../i18n';

/**
 * "… · Undo" after a destructive action that ran at once (no confirm dialog): gone after 6 s, the
 * countdown paused while the pointer or keyboard focus is on it. The host renders it inside an
 * always-present polite live region, so screen readers announce it.
 */
export default function UndoToast({ toast, onUndo, onClose }: { toast: Toast; onUndo: () => void; onClose: () => void }) {
  const [paused, setPaused] = useState(false);
  const left = useRef(UNDO_TOAST_MS);
  useEffect(() => {
    left.current = UNDO_TOAST_MS;
  }, [toast.id]);
  useEffect(() => {
    if (paused) return;
    const started = Date.now();
    const timer = window.setTimeout(onClose, left.current);
    return () => {
      window.clearTimeout(timer);
      left.current -= Date.now() - started;
    };
  }, [paused, toast.id, onClose]);
  return <div
    className="undo-toast"
    onPointerEnter={() => setPaused(true)}
    onPointerLeave={() => setPaused(false)}
    onFocus={() => setPaused(true)}
    onBlur={() => setPaused(false)}
  >
    <span>{translateMessage(toast.message)}</span>
    <span aria-hidden="true">·</span>
    <button type="button" onClick={onUndo} title={t('Undo this action')}>{t('Undo')}</button>
  </div>;
}
