import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { AuthUser, LoginResponse, Permission } from '@ai-content-os/contracts';
import { authRequest, refreshAccessToken, setAccessToken } from '../api/client';

interface AuthContextValue {
  user?: AuthUser;
  loading: boolean;
  selectedWorkspaceId?: string;
  login(email: string, password: string): Promise<void>;
  logout(): Promise<void>;
  logoutAll(): Promise<void>;
  reload(): Promise<void>;
  selectWorkspace(workspaceId: string): void;
  can(permission: Permission, workspaceId?: string): boolean;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);
const selectedWorkspaceKey = 'ai-content-os:selected-workspace-id';

export function AuthProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [user, setUser] = useState<AuthUser>();
  const [loading, setLoading] = useState(true);
  const [selectedWorkspaceId, setSelectedWorkspaceId] = useState<string>();

  const acceptSession = useCallback((session: LoginResponse): void => {
    setAccessToken(session.accessToken);
    setUser(session.user);
    const stored = localStorage.getItem(selectedWorkspaceKey) ?? undefined;
    const selected = session.user.workspaces.some((workspace) => workspace.id === stored)
      ? stored
      : session.user.workspaces[0]?.id;
    setSelectedWorkspaceId(selected);
    if (selected) localStorage.setItem(selectedWorkspaceKey, selected);
  }, []);

  useEffect(() => {
    const expired = (): void => {
      setAccessToken(undefined);
      setUser(undefined);
    };
    window.addEventListener('auth:expired', expired);
    void refreshAccessToken()
      .then(acceptSession)
      .catch(() => undefined)
      .finally(() => setLoading(false));
    return () => window.removeEventListener('auth:expired', expired);
  }, [acceptSession]);

  const login = useCallback(
    async (email: string, password: string): Promise<void> => {
      const result = await authRequest<LoginResponse>('/auth/login', {
        method: 'POST',
        body: JSON.stringify({ email, password }),
      });
      acceptSession(result);
    },
    [acceptSession],
  );

  const clear = useCallback((): void => {
    setAccessToken(undefined);
    setUser(undefined);
  }, []);

  const logout = useCallback(async (): Promise<void> => {
    try {
      await authRequest<void>('/auth/logout', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const logoutAll = useCallback(async (): Promise<void> => {
    try {
      await authRequest<void>('/auth/logout-all', { method: 'POST' });
    } finally {
      clear();
    }
  }, [clear]);

  const reload = useCallback(async (): Promise<void> => {
    acceptSession(await refreshAccessToken());
  }, [acceptSession]);

  const selectWorkspace = useCallback((workspaceId: string): void => {
    setSelectedWorkspaceId(workspaceId);
    localStorage.setItem(selectedWorkspaceKey, workspaceId);
  }, []);

  const can = useCallback(
    (permission: Permission, workspaceId = selectedWorkspaceId): boolean =>
      user?.workspaces
        .find((workspace) => workspace.id === workspaceId)
        ?.permissions.includes(permission) ?? false,
    [selectedWorkspaceId, user],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      ...(user ? { user } : {}),
      loading,
      ...(selectedWorkspaceId ? { selectedWorkspaceId } : {}),
      login,
      logout,
      logoutAll,
      reload,
      selectWorkspace,
      can,
    }),
    [can, loading, login, logout, logoutAll, reload, selectWorkspace, selectedWorkspaceId, user],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const context = useContext(AuthContext);
  if (!context) throw new Error('AuthProvider manquant.');
  return context;
}
