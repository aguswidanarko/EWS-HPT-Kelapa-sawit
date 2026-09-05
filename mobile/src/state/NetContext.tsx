import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { checkServerHealth } from '../api/health';

/** BRD EWS HPT V3.2.1 section 10 (Mobile Connectivity Status): device network state alone
 * ("isConnected") is not enough to say the app can actually talk to the EWS HPT backend - a
 * device can be on WiFi/data with zero relationship to the plantation server (wrong network, VPN
 * off, server down, firewalled port). The three states below are exactly section 10.1-10.3:
 *   OFFLINE                    - no device network connection at all
 *   SERVER_UNREACHABLE         - device has network, but GET /health didn't answer OK
 *   SERVER_CONNECTED           - GET /health answered { status: 'ok' }
 * `serverStatus` starts UNKNOWN (not yet checked) rather than defaulting to CONNECTED, so the UI
 * never claims a health check succeeded before one actually ran. */
export type ServerStatus = 'UNKNOWN' | 'CHECKING' | 'SERVER_CONNECTED' | 'SERVER_UNREACHABLE';

interface NetContextValue {
  /** True only when the device reports both a network connection AND (when known) internet
   * reachability - used to gate every online-only action (login, download, upload). */
  isOnline: boolean;
  serverStatus: ServerStatus;
  /** Last successful/attempted health check latency + timestamp, for the Sync Center detail row
   * (BRD section 11 "Response: OK"). */
  lastCheckedAt: string | null;
  lastLatencyMs: number | null;
  lastError: string | null;
  /** BRD section 11 "Tes Koneksi Server" button - runs GET /health on demand and updates
   * serverStatus immediately (does not wait for the background poll interval). */
  testServerConnection: () => Promise<ServerStatus>;
}

const NetContext = createContext<NetContextValue>({
  isOnline: true,
  serverStatus: 'UNKNOWN',
  lastCheckedAt: null,
  lastLatencyMs: null,
  lastError: null,
  testServerConnection: async () => 'UNKNOWN',
});

/** How often to re-check backend reachability while the app is open and the device reports a
 * network connection. Kept well above the health check's own timeout so checks never overlap. */
const SERVER_CHECK_INTERVAL_MS = 30000;

export function NetProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);
  const [serverStatus, setServerStatus] = useState<ServerStatus>('UNKNOWN');
  const [lastCheckedAt, setLastCheckedAt] = useState<string | null>(null);
  const [lastLatencyMs, setLastLatencyMs] = useState<number | null>(null);
  const [lastError, setLastError] = useState<string | null>(null);
  const mounted = useRef(true);
  const checkInFlight = useRef<Promise<ServerStatus> | null>(null);

  const runCheck = useCallback(async (): Promise<ServerStatus> => {
    if (checkInFlight.current) return checkInFlight.current;
    const promise = (async () => {
      if (mounted.current) setServerStatus((prev) => (prev === 'UNKNOWN' ? 'CHECKING' : prev));
      const result = await checkServerHealth();
      if (!mounted.current) return result.ok ? 'SERVER_CONNECTED' : 'SERVER_UNREACHABLE';
      setLastCheckedAt(new Date().toISOString());
      setLastLatencyMs(result.latencyMs ?? null);
      setLastError(result.ok ? null : result.error || null);
      const next: ServerStatus = result.ok ? 'SERVER_CONNECTED' : 'SERVER_UNREACHABLE';
      setServerStatus(next);
      return next;
    })();
    checkInFlight.current = promise;
    try {
      return await promise;
    } finally {
      checkInFlight.current = null;
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      const online = !!state.isConnected && reachable !== false;
      setIsOnline(online);
      if (!online && mounted.current) setServerStatus('UNKNOWN'); // no point claiming server reachability with no network at all
    });
    NetInfo.fetch().then((state) => {
      setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    return () => {
      mounted.current = false;
      unsubscribe();
    };
  }, []);

  useEffect(() => {
    if (!isOnline) return undefined;
    runCheck();
    const interval = setInterval(runCheck, SERVER_CHECK_INTERVAL_MS);
    return () => clearInterval(interval);
  }, [isOnline, runCheck]);

  return (
    <NetContext.Provider
      value={{ isOnline, serverStatus, lastCheckedAt, lastLatencyMs, lastError, testServerConnection: runCheck }}
    >
      {children}
    </NetContext.Provider>
  );
}

export function useNet(): NetContextValue {
  return useContext(NetContext);
}
