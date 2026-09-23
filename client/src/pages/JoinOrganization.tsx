import { useEffect, useState } from "react";
import { useLocation, useRoute } from "wouter";
import { Building2, Loader2, ShieldAlert } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";
import { useFleetOpsAuth } from "@/hooks/useFleetOpsAuth";

const routeForRole = (role: string) => ({ FLEET_MANAGER: "/fleet-manager", INVENTORY_MANAGER: "/inventory", MECHANIC: "/mechanic", TECHNICIAN: "/technician", DRIVER: "/driver", ACCOUNTANT: "/accountant" }[role] ?? "/");

export default function JoinOrganization() {
  const [, params] = useRoute("/join/:token");
  const [, setLocation] = useLocation();
  const token = (params as { token?: string } | null)?.token ?? "";
  const { session, loading: authLoading, signInWithEmail, signOut } = useFleetOpsAuth();
  const details = trpc.onboarding.inviteDetails.useQuery({ token }, { enabled: Boolean(token), retry: false });
  const completeInvite = trpc.onboarding.completeInviteWithPassword.useMutation();
  const [fullName, setFullName] = useState("");
  const [password, setPassword] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [smsAlertsEnabled, setSmsAlertsEnabled] = useState(false);
  const [whatsappAlertsEnabled, setWhatsappAlertsEnabled] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);


  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError("");
    if (!details.data) return;
    setSubmitted(true);
    const completed = await completeInvite.mutateAsync({ token, fullName, password, mobileNumber: mobileNumber.trim(), smsAlertsEnabled, whatsappAlertsEnabled }).catch((mutationError) => ({ error: mutationError as Error }));
    if ("error" in completed && completed.error) { setError(completed.error.message); setSubmitted(false); return; }
    const { error: signInError } = await signInWithEmail(details.data.email, password);
    if (signInError) { setError(signInError.message); setSubmitted(false); return; }
    toast.success("You joined the organization", { description: `Opening your ${String(details.data.role).replaceAll("_", " ").toLowerCase()} workspace.` });
    // The password grant is already the authoritative fresh session. Keep this
    // transition inside the SPA so a newly invited member does not hard-reload
    // while Supabase persistence and the role-scoped summary query are settling.
    setLocation(routeForRole(details.data.role));
  };

  if (authLoading || details.isLoading) return <main className="auth-page"><section className="auth-card"><Loader2 className="spin" /><h1>Checking invitation…</h1><p>Validating the secure organization invitation.</p></section></main>;
  if (details.isError || !details.data) return <main className="auth-page"><section className="auth-card"><ShieldAlert size={28} /><h1>Invitation unavailable</h1><p>{details.error?.message ?? "This invitation is invalid or expired."}</p><a className="primary-button" href="/">Return to VahanSync</a></section></main>;
  if (session && session.user.email?.toLowerCase() !== details.data.email.toLowerCase()) return <main className="auth-page"><section className="auth-card"><ShieldAlert size={28} /><h1>Use the invited email</h1><p>This link is addressed to {details.data.email}, but the browser is signed in as {session.user.email}. Sign out, then create or sign in with the invited email.</p><button className="primary-button" onClick={() => { void signOut(); }}>Sign out and continue</button></section></main>;
  if (submitted) return <main className="auth-page"><section className="auth-card"><Loader2 className="spin" /><h1>Joining {details.data.organization.name}…</h1><p>Your account is being attached to the invited organization and assigned workspace.</p></section></main>;

  return <main className="auth-page"><section className="auth-card"><div className="panel-kicker">Secure organization invitation</div><h1>Join {details.data.organization.name}</h1><p>You were invited as a <strong>{details.data.role.replaceAll("_", " ")}</strong>. Your email is fixed by the invitation and cannot be changed here.</p><div className="invite-org-card"><Building2 size={18} /><div><strong>{details.data.organization.name}</strong><span>{details.data.email}</span></div></div><form className="auth-form" onSubmit={submit}><label>Full name<input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Your full name" /></label><label>Email<input value={details.data.email} readOnly /></label><label>Create password<input required minLength={8} type="password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" /></label><label>Mobile number <small>Optional · use +91 followed by your 10-digit number.</small><input value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value.replace(/\s/g, ""))} inputMode="tel" placeholder="+919876543210" /></label><label><input type="checkbox" checked={smsAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setSmsAlertsEnabled(event.target.checked)} /> Send my operational alerts by SMS</label><label><input type="checkbox" checked={whatsappAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setWhatsappAlertsEnabled(event.target.checked)} /> Send my approved operational alerts by WhatsApp</label>{error && <div className="auth-error">{error}</div>}<button className="primary-button" disabled={!password || completeInvite.isPending || submitted}>Create account and join organization</button></form><p className="invite-security-note">The invitation determines your organization and role. Phone alerts are optional and can be changed later in Profile.</p></section></main>;
}
