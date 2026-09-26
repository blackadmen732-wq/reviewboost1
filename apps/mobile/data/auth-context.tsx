import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import type { Session } from "@supabase/supabase-js";
import { supabase } from "./supabase";
import { signInForReview } from "./review-sign-in";
import { sendCodeResult, type SendCodeResult } from "./send-code";
import { parseMemberRole, type Organization } from "./types";

interface AuthState {
  isLoggedIn: boolean;
  isLoading: boolean;
  orgLoading: boolean;
  orgError: string | null;
  email: string | null;
  name: string | null;
  organizations: Organization[];
  activeOrg: Organization | null;
  sendCode: (email: string) => Promise<SendCodeResult>;
  verifyCode: (email: string, code: string) => Promise<string | null>;
  logout: () => Promise<string | null>;
  selectOrg: (orgId: string) => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [activeOrg, setActiveOrg] = useState<Organization | null>(null);
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgError, setOrgError] = useState<string | null>(null);
  const authGeneration = useRef(0);

  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session: s } }) => {
      setSession(s);
      setIsLoading(false);
    });

    const {
      data: { subscription },
    } = supabase.auth.onAuthStateChange((_event, s) => {
      setSession(s);
      if (!s) {
        authGeneration.current += 1;
        setOrganizations([]);
        setActiveOrg(null);
        setOrgLoading(false);
        setOrgError(null);
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session?.user.id) {
      fetchOrganizations(session.user.id);
    }
  }, [session?.user.id]);

  async function fetchOrganizations(userId: string) {
    const gen = ++authGeneration.current;
    setOrgLoading(true);
    setOrgError(null);

    const { data, error } = await supabase
      .from("organization_members")
      .select("id, org_id, role, organizations(name, timezone)")
      .eq("user_id", userId)
      .eq("status", "active")
      .order("created_at", { ascending: true });

    if (gen !== authGeneration.current) return;

    if (error || !data) {
      setOrganizations([]);
      setOrgError(error?.message ?? "Failed to load organizations");
      setOrgLoading(false);
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
        role: parseMemberRole(row.role),
      };
    });

    setOrganizations(orgs);
    setActiveOrg((current) =>
      current ? orgs.find((o) => o.orgId === current.orgId) ?? null : null,
    );
    setOrgLoading(false);
  }

  // ReviewBoost accounts have no passwords — sign-in is a six-digit code
  // sent by email, identical to the web app.
  const sendCode = useCallback(async (email: string): Promise<SendCodeResult> => {
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { shouldCreateUser: true },
    });
    return sendCodeResult(error);
  }, []);

  const verifyCode = useCallback(
    async (email: string, code: string): Promise<string | null> => {
      const { error } = await supabase.auth.verifyOtp({
        email,
        token: code,
        type: "email",
      });
      if (!error) return null;
      // The App Review account signs in with a server-configured code rather
      // than an emailed one; for everyone else this is a quiet no.
      if (await signInForReview(email, code)) return null;
      return "That code is not right. Check it and type it again.";
    },
    [],
  );

  const logout = useCallback(async (): Promise<string | null> => {
    const { error } = await supabase.auth.signOut();
    if (error) return error.message;
    setSession(null);
    setOrganizations([]);
    setActiveOrg(null);
    return null;
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
        orgLoading,
        orgError,
        email: user?.email ?? null,
        name: user?.user_metadata?.full_name ?? user?.email ?? null,
        organizations,
        activeOrg,
        sendCode,
        verifyCode,
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
