import { createContext, useContext, useState, useCallback, type ReactNode } from "react";
import type { Organization } from "./types";
import { MOCK_USER, MOCK_ORGANIZATIONS } from "./mock";

interface AuthState {
  isLoggedIn: boolean;
  email: string | null;
  name: string | null;
  organizations: Organization[];
  activeOrg: Organization | null;
  login: (email: string, password: string) => void;
  logout: () => void;
  selectOrg: (orgId: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);

  const login = useCallback((_email: string, _password: string) => {
    setIsLoggedIn(true);
  }, []);

  const logout = useCallback(() => {
    setIsLoggedIn(false);
    setActiveOrg(null);
  }, []);

  const selectOrg = useCallback((orgId: string) => {
    const org = MOCK_ORGANIZATIONS.find((o) => o.orgId === orgId) ?? null;
    setActiveOrg(org);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn,
        email: isLoggedIn ? MOCK_USER.email : null,
        name: isLoggedIn ? MOCK_USER.name : null,
        organizations: isLoggedIn ? MOCK_ORGANIZATIONS : [],
        activeOrg,
        login,
        logout,
        selectOrg,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
