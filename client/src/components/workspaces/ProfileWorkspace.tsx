import { useEffect, useState } from "react";
import { LogOut, Mail, Save, ShieldCheck, UserRound } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

export function ProfileWorkspace({ organizationName, onSignOut }: { organizationName?: string; onSignOut?: () => void }) {
  const utils = trpc.useUtils();
  const profile = trpc.profile.get.useQuery();
  const [fullName, setFullName] = useState("");
  const [mobileNumber, setMobileNumber] = useState("");
  const [smsAlertsEnabled, setSmsAlertsEnabled] = useState(false);
  const [whatsappAlertsEnabled, setWhatsappAlertsEnabled] = useState(false);
  useEffect(() => { if (profile.data) { setFullName(profile.data.fullName ?? ""); setMobileNumber(profile.data.mobileNumber ?? ""); setSmsAlertsEnabled(Boolean(profile.data.smsAlertsEnabled)); setWhatsappAlertsEnabled(Boolean(profile.data.whatsappAlertsEnabled)); } }, [profile.data]);
  const update = trpc.profile.update.useMutation({
    onSuccess: async () => { await utils.profile.get.invalidate(); toast.success("Profile updated", { description: "Your organization profile is current." }); },
    onError: (error) => toast.error("Profile could not be saved", { description: error.message }),
  });
  if (profile.isLoading) return <section className="profile-workspace profile-workspace-loading"><p>Loading your secure member profile…</p></section>;
  if (profile.error || !profile.data) return <section className="profile-workspace"><h2>Your profile could not load.</h2><p>{profile.error?.message ?? "Please retry this signed-in workspace."}</p></section>;
  const member = profile.data;
  return <section className="profile-workspace">
    <header className="profile-hero"><div className="profile-avatar">{String(member.fullName ?? member.email).slice(0, 2).toUpperCase()}</div><div><span>VahanSync member profile</span><h2>{member.fullName ?? "Unnamed member"}</h2><p>{String(member.role ?? "").replaceAll("_", " ")} · {organizationName ?? member.organizationName}</p></div><ShieldCheck size={21} aria-label="Authenticated member" /></header>
    <div className="profile-grid">
      <form className="profile-card" onSubmit={(event) => { event.preventDefault(); update.mutate({ fullName: fullName.trim(), mobileNumber: mobileNumber.trim(), smsAlertsEnabled, whatsappAlertsEnabled }); }}>
        <div className="profile-card-head"><UserRound size={19} /><div><strong>Personal details</strong><p>Used across your VahanSync workspace and audit trail.</p></div></div>
        <label>Full name<input value={fullName} onChange={(event) => setFullName(event.target.value)} minLength={2} maxLength={120} required /></label>
        <label>Email address<span className="profile-readonly"><Mail size={15} />{member.email}</span></label>
        <label>Mobile number<span className="profile-field-help">Use +91 followed by your 10-digit Indian mobile number.</span><input value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value.replace(/\s/g, ""))} inputMode="tel" autoComplete="tel" placeholder="+919876543210" pattern="^\+91[6-9][0-9]{9}$" /></label>
        <fieldset className="profile-preferences"><legend>Operational phone alerts</legend><p>Choose the channels for your own maintenance, inventory, safety, and escalation alerts. You can change these preferences at any time.</p><label className="profile-switch"><input type="checkbox" checked={smsAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setSmsAlertsEnabled(event.target.checked)} /><span><strong>SMS alerts</strong><small>Receive concise operational text messages.</small></span></label><label className="profile-switch"><input type="checkbox" checked={whatsappAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setWhatsappAlertsEnabled(event.target.checked)} /><span><strong>WhatsApp alerts</strong><small>Receive approved utility notifications in WhatsApp.</small></span></label>{!mobileNumber ? <small className="profile-consent-note">Save a valid mobile number to enable alert preferences.</small> : <small className="profile-consent-note">By saving enabled channels, you consent to receive VahanSync operational alerts at this number.</small>}</fieldset>
        <button className="profile-save" type="submit" disabled={update.isPending || fullName.trim().length < 2}><Save size={16} />{update.isPending ? "Saving profile…" : "Save profile"}</button>
      </form>
      <aside className="profile-card profile-session-card"><div className="profile-card-head"><ShieldCheck size={19} /><div><strong>Session controls</strong><p>Your workspace is protected by your active Supabase session.</p></div></div><div className="profile-session-status"><span /> Secure session active</div><p>Sign out on this shared device when your operational shift is complete.</p><button className="profile-signout" type="button" onClick={onSignOut}><LogOut size={16} />Sign out of VahanSync</button></aside>
    </div>
    <section className="profile-notification-placeholder"><span>Delivery safeguards</span><h3>Your preferences come before every phone alert</h3><p>VahanSync records the selected channel preference with your member profile. Alerts are sent only for authorized organization records, through channels you have enabled, with delivery attempts recorded for operational follow-up.</p></section>
  </section>;
}
