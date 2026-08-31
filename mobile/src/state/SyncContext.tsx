import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useNet } from './NetContext';
import * as engine from '../sync/engine';
import type { DownloadSummary, UploadSummary } from '../sync/engine';
import * as metaRepo from '../db/repo/metaRepo';
import type { SyncCounts } from '../types';

export type ConnectionPillStatus = 'ONLINE' | 'SYNCING' | 'OFFLINE';

interface SyncContextValue {
  pillStatus: ConnectionPillStatus;
  isOnline: boolean;
  isSyncing: boolean;
  pending: SyncCounts;
  pendingTotal: number;
  lastDownload: DownloadSummary | null;
  lastUpload: UploadSummary | null;
  lastSyncAt: string | null;
  syncError: string | null;
  /** Call after any local write (new/edited field record) so the pending badge stays accurate. */
  notifyDataChanged: () => void;
  runDownload: () => Promise<DownloadSummary | null>;
  runUpload: () => Promise<UploadSummary | null>;
  runFullSync: () => Promise<void>;
}

const SyncContext = createContext<SyncContextValue | undefined>(undefined);

const EMPTY_COUNTS: SyncCounts = {
  deteksi: 0,
  sensus: 0,
  treatment: 0,
  mortalitas: 0,
  yieldMaking: 0,
  defisiensiHara: 0,
  actionPlan: 0,
  agroObservation: 0,
};

export function SyncProvider({ children }: { children: React.ReactNode }) {
  const { isOnline } = useNet();
  const [isSyncing, setIsSyncing] = useState(false);
  const [pending, setPending] = useState<SyncCounts>(EMPTY_COUNTS);
  const [lastDownload, setLastDownload] = useState<DownloadSummary | null>(null);
  const [lastUpload, setLastUpload] = useState<UploadSummary | null>(null);
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  const [version, setVersion] = useState(0);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const refreshPending = useCallback(async () => {
    const counts = await engine.getPendingCounts();
    if (mounted.current) setPending(counts);
  }, []);

  useEffect(() => {
    refreshPending();
  }, [refreshPending, version]);

  useEffect(() => {
    metaRepo.getMeta(metaRepo.META_KEYS.LAST_UPLOAD).then((v) => {
      if (v && mounted.current) setLastSyncAt(v);
    });
  }, []);

  const notifyDataChanged = useCallback(() => setVersion((v) => v + 1), []);

  const runDownload = useCallback(async (): Promise<DownloadSummary | null> => {
    if (!isOnline) return null;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const summary = await engine.downloadAll();
      if (mounted.current) setLastDownload(summary);
      return summary;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal mengunduh data';
      if (mounted.current) setSyncError(msg);
      return null;
    } finally {
      if (mounted.current) setIsSyncing(false);
    }
  }, [isOnline]);

  const runUpload = useCallback(async (): Promise<UploadSummary | null> => {
    if (!isOnline) return null;
    setIsSyncing(true);
    setSyncError(null);
    try {
      const summary = await engine.uploadAll();
      if (mounted.current) setLastUpload(summary);
      const at = new Date().toISOString();
      await metaRepo.setMeta(metaRepo.META_KEYS.LAST_UPLOAD, at);
      if (mounted.current) setLastSyncAt(at);
      await refreshPending();
      return summary;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Gagal mengunggah data';
      if (mounted.current) setSyncError(msg);
      return null;
    } finally {
      if (mounted.current) setIsSyncing(false);
    }
  }, [isOnline, refreshPending]);

  const runFullSync = useCallback(async () => {
    if (!isOnline) return;
    await runUpload();
    await runDownload();
  }, [isOnline, runUpload, runDownload]);

  const pendingTotal =
    pending.deteksi +
    pending.sensus +
    pending.treatment +
    pending.mortalitas +
    pending.yieldMaking +
    pending.defisiensiHara +
    pending.actionPlan +
    pending.agroObservation;
  const pillStatus: ConnectionPillStatus = !isOnline ? 'OFFLINE' : isSyncing ? 'SYNCING' : 'ONLINE';

  const value = useMemo(
    () => ({
      pillStatus,
      isOnline,
      isSyncing,
      pending,
      pendingTotal,
      lastDownload,
      lastUpload,
      lastSyncAt,
      syncError,
      notifyDataChanged,
      runDownload,
      runUpload,
      runFullSync,
    }),
    [pillStatus, isOnline, isSyncing, pending, pendingTotal, lastDownload, lastUpload, lastSyncAt, syncError, notifyDataChanged, runDownload, runUpload, runFullSync]
  );

  return <SyncContext.Provider value={value}>{children}</SyncContext.Provider>;
}

export function useSync(): SyncContextValue {
  const ctx = useContext(SyncContext);
  if (!ctx) throw new Error('useSync must be used within SyncProvider');
  return ctx;
}
