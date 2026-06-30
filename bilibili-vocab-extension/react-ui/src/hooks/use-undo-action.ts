import { useEffect, useState } from 'react';
import { SettingsV3, cloneSettingsV3 } from '../lib/settings-bridge';

const HIGH_RISK_UNDO_WINDOW_MS = 6000;

export interface PendingUndoAction {
  label: string;
  snapshot: SettingsV3;
  expiresAt: number;
}

export function useUndoAction(): {
  pendingUndo: PendingUndoAction | null;
  registerUndo: (snapshot: SettingsV3, label: string) => void;
  undoAction: (
    setWorkingDirect: (s: SettingsV3) => void,
    save: (msg: string) => Promise<unknown>,
    setStatus: (s: string) => void
  ) => Promise<void>;
  clearUndo: () => void;
} {
  const [pendingUndo, setPendingUndo] = useState<PendingUndoAction | null>(null);

  useEffect(() => {
    if (!pendingUndo) return () => {};
    const remainingMs = Math.max(0, pendingUndo.expiresAt - Date.now());
    const timeoutId = window.setTimeout(() => {
      setPendingUndo((current) =>
        current && current.expiresAt === pendingUndo.expiresAt ? null : current
      );
    }, remainingMs);
    return () => window.clearTimeout(timeoutId);
  }, [pendingUndo]);

  function registerUndo(snapshot: SettingsV3, label: string) {
    setPendingUndo({
      label,
      snapshot: cloneSettingsV3(snapshot),
      expiresAt: Date.now() + HIGH_RISK_UNDO_WINDOW_MS,
    });
  }

  async function undoAction(
    setWorkingDirect: (s: SettingsV3) => void,
    save: (msg: string) => Promise<unknown>,
    setStatus: (s: string) => void
  ) {
    if (!pendingUndo) return;
    setWorkingDirect(cloneSettingsV3(pendingUndo.snapshot));
    const saveResult = await save('已撤销该操作。');
    if (!saveResult) {
      setStatus('撤销该操作失败，请重试。');
      return;
    }
    setPendingUndo(null);
  }

  function clearUndo() {
    setPendingUndo(null);
  }

  return { pendingUndo, registerUndo, undoAction, clearUndo };
}
