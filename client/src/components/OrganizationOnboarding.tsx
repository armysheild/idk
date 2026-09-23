import { useState } from "react";
import { Building2, ShieldCheck } from "lucide-react";
import { toast } from "sonner";
import { trpc } from "@/lib/trpc";

import { BrandMark } from "@/components/BrandMark";

type Props = { initialName?: string; initialOrganization?: string; onComplete: () => void | Promise<void> };

export default function OrganizationOnboarding({ initialName = "", initialOrganization = "", onComplete }: Props) {
  const [fullName, setFullName] = useState(initialName);
  const [organizationName, setOrganizationName] = useState(initialOrganization);
  const [mobileNumber, setMobileNumber] = useState("");
  const [smsAlertsEnabled, setSmsAlertsEnabled] = useState(false);
  const [whatsappAlertsEnabled, setWhatsappAlertsEnabled] = useState(false);
  const complete = trpc.onboarding.complete.useMutation({
    onSuccess: () => { toast.success("Organization workspace created"); onComplete(); },
    onError: (error) => toast.error("Onboarding could not be completed", { description: error.message }),
  });

  return <main className="auth-page"><section className="auth-card onboarding-card"><div className="brand-lockup auth-brand"><BrandMark decorative className="auth-brand-mark" /><div><div className="brand-name">VahanSync</div><div className="brand-tag">Fleet intelligence for India’s operators</div></div></div><div className="onboarding-step"><span>01</span><span>Superadmin setup</span></div><h1>Set up your organization.</h1><p>Create the first tenant workspace. You will become its Superadmin and can invite fleet managers, mechanics, drivers, and accountants next.</p><form className="auth-form" onSubmit={(event) => { event.preventDefault(); complete.mutate({ fullName: fullName.trim(), orgName: organizationName.trim(), mobileNumber: mobileNumber.trim(), smsAlertsEnabled, whatsappAlertsEnabled }); }}><label>Your full name<input required minLength={2} value={fullName} onChange={(event) => setFullName(event.target.value)} placeholder="Arjun Shah" /></label><label>Organization name<input required minLength={2} value={organizationName} onChange={(event) => setOrganizationName(event.target.value)} placeholder="Your organization name" /></label><label>Mobile number <small>Optional · use +91 followed by your 10-digit number.</small><input value={mobileNumber} onChange={(event) => setMobileNumber(event.target.value.replace(/\s/g, ""))} inputMode="tel" placeholder="+919876543210" /></label><label><input type="checkbox" checked={smsAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setSmsAlertsEnabled(event.target.checked)} /> Send my operational alerts by SMS</label><label><input type="checkbox" checked={whatsappAlertsEnabled} disabled={!mobileNumber} onChange={(event) => setWhatsappAlertsEnabled(event.target.checked)} /> Send my approved operational alerts by WhatsApp</label><div className="onboarding-security"><ShieldCheck size={17} /><span>Tenant isolation and role permissions are enforced by Supabase RLS and the VahanSync API.</span></div><button className="primary-button" disabled={complete.isPending}><Building2 size={16} />{complete.isPending ? "Creating workspace…" : "Create organization"}</button></form></section></main>;
}
