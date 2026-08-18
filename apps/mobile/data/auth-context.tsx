import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import type { Organization } from "./types";

interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  email: string | null;
  name: string | null;
  organizations: Organization[];
  activeOrg: Organization | null;
  login: (email: string, password: string) => Promise<string | null>;
  logout: () => Promise<void>;
  selectOrg: (orgId: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      if (s) fetchOrganizations(s.user.id);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (s) {
        fetchOrganizations(s.user.id);
      } else {
        setOrganizations([]);
        setActiveOrg(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  async function fetchOrganizations(userId: string) {
    const { data, error } = await supabase
      .from("organization_members")
      .select("id, org_id, role, organizations(name, timezone)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (error || !data) {
      setOrganizations([]);
      return;
    }

    const orgs: Organization[] = data.map((row: Record<string, unknown>) => {
      const orgData = row.organizations as
        | { name: string; timezone: string }
        | { name: string; timezone: string }[]
        | null;
      const org = Array.isArray(orgData) ? orgData[0] : orgData;
      return {
        orgId: row.org_id as string,
        name: org?.name ?? "",
        timezone: org?.timezone ?? "UTC",
        role: row.role as "owner" | "manager" | "staff",
      };
    });

    setOrganizations(orgs);
  }

  const login = useCallback(
    async (email: string, password: string): Promise<string | null> => {
      const { error } = await supabase.auth.signInWithPassword({
        email,
        password,
      });
      if (error) return error.message;
      return null;
    },
    [],
  );

  const logout = useCallback(async () => {
    await supabase.auth.signOut();
    setSession(null);
    setOrganizations([]);
    setActiveOrg(null);
  }, []);

  const selectOrg = useCallback(
    (orgId: string) => {
      const org = organizations.find((o) => o.orgId === orgId) ?? null;
      setActiveOrg(org);
    },
    [organizations],
  );

  const user = session?.user ?? null;

  return (
    <AuthContext.Provider
      value={{
        isLoggedIn: !!session,
        isLoading,
        email: user?.email ?? null,
        name: user?.user_metadata?.full_name ?? user?.email ?? null,
        organizations,
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
