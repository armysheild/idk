import { useEffect, useState } from "react";
import type { Session, User } from "@supabase/supabase-js";
import { supabase } from "@/lib/supabase";

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? "" : "http://localhost:8000");

function localSession(token: string, email: string): Session {
  return {
    access_token: token,
    refresh_token: "",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    token_type: "bearer",
    user: { id: "vahana-user", aud: "authenticated", role: "authenticated", email, app_metadata: {}, user_metadata: {}, created_at: new Date().toISOString() },
  } as Session;
}

export function useFleetOpsAuth() {
  const [session, setSession] = useState<Session | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let mounted = true;
    if (supabase) {
      supabase.auth.getSession().then(({ data }) => {
        if (!mounted) return;
        setSession(data.session);
        setUser(data.session?.user ?? null);
        setLoading(false);
      });
      const { data: listener } = supabase.auth.onAuthStateChange((_event, nextSession) => {
        if (!mounted) return;
        setSession(nextSession);
        setUser(nextSession?.user ?? null);
        setLoading(false);
      });
      return () => {
        mounted = false;
        listener.subscription.unsubscribe();
      };
    }
    const token = sessionStorage.getItem("vahana:access-token");
    const email = sessionStorage.getItem("vahana:last-email") || "operator@example.com";
    if (token) {
      const nextSession = localSession(token, email);
      setSession(nextSession);
      setUser(nextSession.user);
    }
    setLoading(false);
    return () => { mounted = false; };
  }, []);

  const signInWithEmail = async (email: string, password: string) => {
    setLoading(true);
    if (supabase) {
      await supabase.auth.signOut({ scope: "local" });
      const result = await supabase.auth.signInWithPassword({ email: email.trim(), password });
      setSession(result.data.session);
      setUser(result.data.session?.user ?? null);
      setLoading(false);
      return result;
    }
    const response = await fetch(`${API_BASE_URL}/api/v1/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: email.trim(), password }),
    });
    if (!response.ok) {
      const body = await response.json().catch(() => null);
      const error = new Error(body?.detail || "Unable to sign in");
      setLoading(false);
      return { data: { session: null }, error };
    }
    const result = await response.json();
    sessionStorage.setItem("vahana:access-token", result.access_token);
    sessionStorage.setItem("vahana:last-email", email.trim());
    const nextSession = localSession(result.access_token, email.trim());
    setSession(nextSession);
    setUser(nextSession.user);
    setLoading(false);
    return { data: { session: nextSession }, error: null };
  };

  const signOut = async () => {
    if (supabase) await supabase.auth.signOut({ scope: "local" });
    sessionStorage.removeItem("vahana:access-token");
    setSession(null);
    setUser(null);
    return { error: null };
  };

  return {
    session,
    user,
    loading,
    isAuthenticated: Boolean(session),
    signInWithEmail,
    signUpWithEmail: async (email: string, password: string, fullName: string) => {
      if (supabase) return supabase.auth.signUp({ email: email.trim(), password, options: { data: { fullName, needsOnboarding: true } } });
      const response = await fetch(`${API_BASE_URL}/api/v1/auth/signup`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email.trim(), password, full_name: fullName, organization_name: fullName }),
      });
      if (!response.ok) throw new Error((await response.json().catch(() => null))?.detail || "Unable to create account");
      return { data: { user: null, session: null }, error: null };
    },
    signOut,
    requestPasswordReset: (email: string, redirectTo: string) => supabase?.auth.resetPasswordForEmail(email.trim(), { redirectTo }) ?? Promise.reject(new Error("Configure Supabase Auth for password recovery.")),
    updatePassword: (password: string) => supabase?.auth.updateUser({ password }) ?? Promise.reject(new Error("Configure Supabase Auth for password recovery.")),
    refreshSession: async () => {
      if (supabase) return supabase.auth.refreshSession();
      return { data: { session }, error: null };
    },
  };
}
