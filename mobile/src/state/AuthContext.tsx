import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import * as authApi from '../api/auth';
import { onAuthFailure, friendlyErrorMessage, getErrorCategory } from '../api/client';
import { clearTokens, setTokens } from '../api/tokenStore';
import { clearUserProfile, loadUserProfile, saveUserProfile } from '../db/repo/metaRepo';
import type { UserProfile } from '../types';

interface AuthContextValue {
  user: UserProfile | null;
  initializing: boolean;
  loginError: string | null;
  loggingIn: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => Promise<void>;
  hasAccess: (permission: string) => boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<UserProfile | null>(null);
  const [initializing, setInitializing] = useState(true);
  const [loggingIn, setLoggingIn] = useState(false);
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      const cached = await loadUserProfile();
      setUser(cached);
      setInitializing(false);
    })();
  }, []);

  useEffect(() => {
    onAuthFailure(() => {
      // Refresh token expired/rejected while offline usage was assumed valid - force re-login.
      setUser(null);
      clearUserProfile().catch(() => {});
    });
  }, []);

  const login = useCallback(async (email: string, password: string) => {
    setLoggingIn(true);
    setLoginError(null);
    try {
      const res = await authApi.login(email, password);
      await setTokens(res.access_token, res.refresh_token);
      await saveUserProfile(res.user);
      setUser(res.user);
      return true;
    } catch (e) {
      // BRD EWS HPT V3.2.1 section 20 (Error Message Mobile): tell "server unreachable" apart
      // from "wrong credentials" - a raw axios/network message must never be the only thing
      // shown here.
      if (getErrorCategory(e) === 'NETWORK_ERROR') {
        setLoginError('Server EWS HPT tidak dapat dihubungi.');
      } else if (getErrorCategory(e) === 'AUTH_ERROR') {
        setLoginError('Login gagal.\n\nUsername atau password tidak valid.');
      } else {
        setLoginError(friendlyErrorMessage(e));
      }
      return false;
    } finally {
      setLoggingIn(false);
    }
  }, []);

  const logout = useCallback(async () => {
    await clearTokens();
    await clearUserProfile();
    setUser(null);
  }, []);

  const hasAccess = useCallback((permission: string) => !!user?.hak_akses?.includes(permission), [user]);

  const value = useMemo(
    () => ({ user, initializing, loginError, loggingIn, login, logout, hasAccess }),
    [user, initializing, loginError, loggingIn, login, logout, hasAccess]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
