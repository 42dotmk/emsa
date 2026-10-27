import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

import type { Role } from "@/constants/enums";
import { queryKeys } from "@/constants/query-keys";
import { ApiRoutes } from "@/constants/routes";
import type { UserProfile } from "@/constants/types";
import { apiClient, ApiError, setUnauthorizedHandler } from "@/lib/api-client";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  imageUrl: string | null;
  profileCompleted: boolean;
  isAlumni: boolean;
  isActive: boolean;
  pointsBalance: number;
}

interface AuthContextValue {
  user: AuthUser | null;
  token: string | null;
  isLoadingUser: boolean;
  login: (token: string) => AuthUser | null;
  logout: () => void;
  updateUser: (patch: Partial<AuthUser>) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function decodeToken(token: string): AuthUser | null {
  try {
    const b64url = token.split(".")[1] ?? "";
    const b64 = b64url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    const payload = JSON.parse(new TextDecoder().decode(bytes));
    if (payload.exp && payload.exp * 1000 < Date.now()) return null;
    return {
      id: payload.sub,
      name: payload.name,
      email: payload.email,
      role: payload.role,
      imageUrl: null,
      profileCompleted: payload.profileCompleted ?? false,
      isAlumni: false,
      isActive: false,
      pointsBalance: 0,
    };
  } catch {
    return null;
  }
}

function getStoredToken(): string | null {
  const stored = localStorage.getItem("token");
  if (!stored) return null;
  const valid = decodeToken(stored);
  if (!valid) {
    localStorage.removeItem("token");
    return null;
  }
  return stored;
}

function getStoredUser(): AuthUser | null {
  const stored = localStorage.getItem("token");
  if (!stored) return null;
  return decodeToken(stored);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [token, setToken] = useState<string | null>(getStoredToken);
  const [user, setUser] = useState<AuthUser | null>(getStoredUser);

  const logout = useCallback(() => {
    localStorage.removeItem("token");
    setToken(null);
    setUser(null);
    queryClient.removeQueries({ queryKey: queryKeys.me() });
  }, [queryClient]);

  const login = useCallback(
    (newToken: string): AuthUser | null => {
      const decoded = decodeToken(newToken);
      if (!decoded) return null;
      localStorage.setItem("token", newToken);
      setToken(newToken);
      setUser(decoded);
      queryClient.removeQueries({ queryKey: queryKeys.me() });
      return decoded;
    },
    [queryClient]
  );

  const {
    data: meData,
    error: meError,
    isLoading: isLoadingMe,
  } = useQuery({
    queryKey: queryKeys.me(),
    queryFn: () => apiClient.get<UserProfile>(ApiRoutes.USERS_ME),
    enabled: !!token,
    retry: false,
    staleTime: 5 * 60 * 1000,
  });

  const hydratedUser = useMemo(() => {
    if (!user || !meData) return user;
    return {
      ...user,
      name: meData.name,
      role: meData.role,
      imageUrl: meData.imageUrl,
      profileCompleted: meData.profileCompleted,
      isAlumni: meData.isAlumni ?? false,
      isActive: meData.isActive ?? false,
      pointsBalance: meData.pointsBalance ?? 0,
    };
  }, [user, meData]);

  useEffect(() => {
    setUnauthorizedHandler(logout);
  }, [logout]);

  useEffect(() => {
    if (meError instanceof ApiError && meError.status === 401) {
      logout();
    }
  }, [meError, logout]);

  const updateUser = useCallback((patch: Partial<AuthUser>) => {
    setUser((prev) => (prev ? { ...prev, ...patch } : prev));
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user: hydratedUser,
        token,
        isLoadingUser: !!token && isLoadingMe,
        login,
        logout,
        updateUser,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
