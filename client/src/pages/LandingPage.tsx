import { ArrowRight, Check, CircleCheck, ClipboardCheck, Gauge, IndianRupee, PackageCheck, PlayCircle, Route, ShieldCheck, Wrench } from "lucide-react";
import { MarketingFooter, MarketingNav } from "@/pages/MarketingPages";
import "@/public-video-preview.css";

const operatingChain = [
  { step: "01", icon: Gauge, title: "Signal the condition", detail: "Odometer, component life, documents, and driver reports create a clear readiness picture." },
  { step: "02", icon: Wrench, title: "Route the decision", detail: "Fleet Managers assign accountable maintenance work with the vehicle identity and exception context attached." },
  { step: "03", icon: PackageCheck, title: "Protect the handoff", detail: "Parts, supplier receipts, work evidence, and approval states stay linked to the same operating record." },
  { step: "04", icon: IndianRupee, title: "Close the cost", detail: "Finance sees the controlled INR record after the work is completed—not a separate spreadsheet later." },
];

const workspaceSignals = [
  ["Fleet Manager", "VIN-first readiness and dispatch", "fleet"],
  ["Mechanic", "Repair evidence and completion handoff", "repair"],
  ["Inventory Manager", "Controlled stock and receiving", "parts"],
  ["Driver", "Route condition and safety reporting", "route"],
  ["Accountant", "INR ledger and reconciliation", "finance"],
];

const workflowVideo = {
  chapter: "Complete workflow",
  title: "See every accountable handoff, end to end",
  detail: "A real VahanSync workflow from Superadmin governance through fleet dispatch, technician execution, driver safety, inventory control, finance close, and governance review. Hindi narration. No on-screen subtitles.",
  source: `${import.meta.env.VITE_SUPABASE_URL}/storage/v1/object/public/vahansync-media/marketing/workflow/v3/vahansync-real-workflow-demo-hindi-no-subtitles.mp4`,
};

const masterBrandIllustrationUrl = "https://yieicrulmncikbjxjupv.supabase.co/storage/v1/object/public/vahansync-brand/v2/vahansync-master-readiness-logo.png";

export default function LandingPage() {
  return (
    <main className="public-replacement">
      <MarketingNav />
      <section className="public-hero">
        <div className="public-hero-grid" aria-hidden="true"><i /><i /><i /><i /></div>
        <div className="public-hero-copy">
          <div className="public-eyebrow"><Route size={14} /> VahanSync operating intelligence</div>
          <h1>Keep the fleet moving with a <em>single accountable signal.</em></h1>
          <p>VahanSync connects vehicle identity, people, maintenance, parts, safety, and INR finance so the next responsible action is visible before a roadside failure becomes a business interruption.</p>
          <div className="public-hero-actions"><a className="public-primary" href="/create-organization">Create your organization <ArrowRight size={16} /></a><a className="public-quiet-link" href="/login">Sign in to an existing workspace <ArrowRight size={15} /></a></div>
          <div className="public-proofline"><span><Check size={14} /> Organization-scoped access</span><span><Check size={14} /> Role-constrained workspaces</span><span><Check size={14} /> VIN-first operational records</span></div>
        </div>
        <figure className="public-master-brand-panel">
          <img src={masterBrandIllustrationUrl} alt="VahanSync fleet readiness illustration with buses, route, readiness check, and upward movement" />
        </figure>
      </section>
      <section className="public-ticker" aria-label="VahanSync operating principles"><span>Preventive maintenance</span><i /><span>VIN-first control</span><i /><span>Evidence at every handoff</span><i /><span>INR-native accountability</span></section>
      <section className="public-film" aria-labelledby="workflow-film-title">
        <header className="public-film-intro"><div className="public-eyebrow"><PlayCircle size={14} /> VahanSync workflow film</div><h2 id="workflow-film-title">Watch the complete connected operating workflow.</h2><p>Follow the real role-by-role handoff from fleet signal to repair proof, parts control, INR finance, and Superadmin governance. This approved full workflow film is narrated in Hindi without on-screen subtitles.</p></header>
        <div className="public-film-single"><article className="public-film-card" key={workflowVideo.chapter}><div className="public-film-meta"><span>{workflowVideo.chapter}</span><strong>{workflowVideo.title}</strong></div><video controls preload="metadata" playsInline aria-label={`${workflowVideo.title} VahanSync workflow video`}><source src={workflowVideo.source} type="video/mp4" />Your browser does not support HTML video.</video><p>{workflowVideo.detail}</p></article></div>
      </section>
      <section className="public-chain"><header><div className="public-eyebrow"><span /> The operating chain</div><h2>Not another dashboard. A connected way to move work from route signal to controlled resolution.</h2></header><div className="public-chain-grid">{operatingChain.map(({ step, icon: Icon, title, detail }) => <article key={step}><div><span>{step}</span><Icon size={20} /></div><h3>{title}</h3><p>{detail}</p></article>)}</div></section>
      <section className="public-workspaces"><div className="public-workspaces-intro"><div className="public-eyebrow"><span /> Every role, its right next action</div><h2>Give each operator a focused surface without fragmenting the organization record.</h2><p>The organization gets one operating picture. Each role sees only the decisions, evidence, and actions that belong to its responsibility.</p><a className="public-quiet-link" href="/security">See the control model <ArrowRight size={15} /></a></div><div className="public-workspace-list">{workspaceSignals.map(([role, detail, tone], index) => <article className={`is-${tone}`} key={role}><span>{String(index + 1).padStart(2, "0")}</span><div><strong>{role}</strong><small>{detail}</small></div><ArrowRight size={16} /></article>)}</div></section>
      <section className="public-commitment"><div><div className="public-eyebrow"><span /> Start with an accountable foundation</div><h2>Make the next fleet decision easier to see, own, and prove.</h2></div><div><p>Start a secure organization workspace, invite the appropriate roles, and build the vehicle and maintenance record around the work already happening in your fleet.</p><a className="public-primary" href="/create-organization">Create your organization <ArrowRight size={16} /></a></div></section>
      <MarketingFooter />
    </main>
  );
}
