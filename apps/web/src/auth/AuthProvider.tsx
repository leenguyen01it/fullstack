import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { AuthResponse, AuthUser, LoginInput, RegisterInput } from '@taskflow/shared';
import * as authApi from '../api/auth';
import { refreshAccessToken, setAccessToken, subscribeSession } from '../api/client';

/**
 * Describes the auth state and actions exposed to components.
 * @since REQ-002
 */
export interface AuthContextValue {
  user: AuthUser | null;
  isRestoring: boolean;
  login: (input: LoginInput) => Promise<void>;
  register: (input: RegisterInput) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

/**
 * Holds the signed-in user, restores the session from the refresh cookie on load, exposes auth actions,
 * and clears the query cache whenever the signed-in user changes so no data leaks between accounts.
 * @since REQ-002
 * @updated REQ-007
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isRestoring, setIsRestoring] = useState(true);
  const queryClient = useQueryClient();
  const previousUserId = useRef<string | null>(null);

  useEffect(() => {
    const userId = user?.id ?? null;
    if (previousUserId.current !== userId) {
      previousUserId.current = userId;
      queryClient.clear();
    }
  }, [user, queryClient]);

  const applySession = useCallback((session: AuthResponse | null) => {
    setAccessToken(session?.accessToken ?? null);
    setUser(session?.user ?? null);
  }, []);

  useEffect(() => {
    subscribeSession((session) => setUser(session?.user ?? null));
    void refreshAccessToken().finally(() => setIsRestoring(false));
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({
      user,
      isRestoring,
      login: async (input) => applySession(await authApi.login(input)),
      register: async (input) => applySession(await authApi.register(input)),
      logout: async () => {
        try {
          await authApi.logout();
        } finally {
          applySession(null);
        }
      },
    }),
    [user, isRestoring, applySession],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/**
 * Returns the auth context; must be used inside AuthProvider.
 * @since REQ-002
 */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
