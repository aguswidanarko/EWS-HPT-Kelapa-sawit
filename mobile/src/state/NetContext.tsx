import NetInfo from '@react-native-community/netinfo';
import React, { createContext, useContext, useEffect, useState } from 'react';

interface NetContextValue {
  /** True only when the device reports both a network connection AND (when known) internet
   * reachability - used to gate every online-only action (login, download, upload). */
  isOnline: boolean;
}

const NetContext = createContext<NetContextValue>({ isOnline: true });

export function NetProvider({ children }: { children: React.ReactNode }) {
  const [isOnline, setIsOnline] = useState(true);

  useEffect(() => {
    const unsubscribe = NetInfo.addEventListener((state) => {
      const reachable = state.isInternetReachable;
      setIsOnline(!!state.isConnected && reachable !== false);
    });
    NetInfo.fetch().then((state) => {
      setIsOnline(!!state.isConnected && state.isInternetReachable !== false);
    });
    return () => unsubscribe();
  }, []);

  return <NetContext.Provider value={{ isOnline }}>{children}</NetContext.Provider>;
}

export function useNet(): NetContextValue {
  return useContext(NetContext);
}
