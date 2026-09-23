import { ArrowRight, Check, LockKeyhole, Route, ShieldCheck } from "lucide-react";

import { BrandMark } from "@/components/BrandMark";

type AuthView = "signin" | "signup" | "recover" | "update";

type Props = {
  view: AuthView;
  email: string;
  password: string;
  fullName: string;
  recoveryPassword: string;
  error: string;
  submitting: boolean;
  onEmail: (value: string) => void;
  onPassword: (value: string) => void;
  onFullName: (value: string) => void;
  onRecoveryPassword: (value: string) => void;
  onSubmit: (event: React.FormEvent) => void;
  onSetView?: (view: "signin" | "signup" | "recover") => void;
};

const copy: Record<AuthView, { eyebrow: string; title: string; detail: string; action: string }> = {
  signin: { eyebrow: "Secure organization access", title: "Return to the operating picture.", detail: "Sign in with the Supabase account assigned to your VahanSync organization and role.", action: "Open workspace" },
  signup: { eyebrow: "New organization", title: "Start with an accountable foundation.", detail: "Create the Superadmin account that will establish your organization, team boundaries, and operating record.", action: "Create secure account" },
  recover: { eyebrow: "Account recovery", title: "Recover access without losing context.", detail: "Request a secure Supabase password-reset link for the email address attached to your VahanSync account.", action: "Send recovery link" },
  update: { eyebrow: "Set a new password", title: "Secure your route back in.", detail: "Choose a new password for your VahanSync account, then continue to the role-scoped workspace assigned to you.", action: "Update password" },
};

export function PublicAuthSurface({ view, email, password, fullName, recoveryPassword, error, submitting, onEmail, onPassword, onFullName, onRecoveryPassword, onSubmit, onSetView }: Props) {
  const current = copy[view];
  return <main className="public-auth"><section className="public-auth-story"><a className="public-auth-brand" href="/"><BrandMark decorative className="public-auth-brand-mark" /><div><strong>VahanSync</strong><small>Fleet intelligence for India’s operators</small></div></a><div className="public-auth-story-copy"><div className="public-eyebrow"><span /> Connected operating access</div><h1>Every responsible action starts with the <em>right workspace.</em></h1><p>Vehicle signals, repair proof, controlled inventory, and INR records belong to one organization—but every user receives only the decisions their role owns.</p></div><div className="public-auth-chain"><article><span>01</span><div><strong>Organization identified</strong><small>Your account resolves to its tenant-scoped operating context.</small></div><Check size={15} /></article><article><span>02</span><div><strong>Role boundaries applied</strong><small>Navigation and operational controls are scoped before data opens.</small></div><ShieldCheck size={15} /></article><article><span>03</span><div><strong>Workspace connected</strong><small>VahanSync opens the responsible view for the active session.</small></div><LockKeyhole size={15} /></article></div></section><section className="public-auth-panel"><div className="public-auth-panel-inner"><a className="public-auth-back" href="/"><ArrowRight size={14} /> Back to VahanSync</a><div className="public-eyebrow"><span /> {current.eyebrow}</div><h2>{current.title}</h2><p>{current.detail}</p><form className="public-auth-form" onSubmit={onSubmit}>{view === "signup" && <label>Full name<input required minLength={2} value={fullName} onChange={(event) => onFullName(event.target.value)} placeholder="Your full name" /></label>}{view !== "update" && <label>Email<input required type="email" value={email} onChange={(event) => onEmail(event.target.value)} placeholder="you@company.com" autoComplete="email" /></label>}{view === "signin" || view === "signup" ? <label>Password<input required minLength={8} type="password" value={password} onChange={(event) => onPassword(event.target.value)} placeholder="At least 8 characters" autoComplete={view === "signup" ? "new-password" : "current-password"} /></label> : null}{view === "update" ? <label>New password<input required minLength={8} type="password" value={recoveryPassword} onChange={(event) => onRecoveryPassword(event.target.value)} placeholder="At least 8 characters" autoComplete="new-password" /></label> : null}{error ? <div className="public-auth-error" role="alert">{error}</div> : null}<button className="public-primary" disabled={submitting}>{submitting ? view === "signup" ? "Creating secure account…" : view === "recover" ? "Sending recovery link…" : view === "update" ? "Updating password…" : "Opening workspace…" : <>{current.action} <ArrowRight size={16} /></>}</button></form>{view !== "update" && onSetView ? <div className="public-auth-switches">{view === "signin" ? <><button type="button" onClick={() => onSetView("recover")}>Forgot password?</button><button type="button" onClick={() => onSetView("signup")}>Need an organization? Create one</button></> : <button type="button" onClick={() => onSetView("signin")}>Back to sign in</button>}</div> : null}<div className="public-auth-note"><LockKeyhole size={14} /><span>Authentication is handled by Supabase. VahanSync does not expose organization data until your active role and tenant context are resolved.</span></div></div></section></main>;
}
