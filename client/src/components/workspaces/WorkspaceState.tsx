import { RefreshCw } from "lucide-react";

type WorkspaceStateProps = {
  loading?: boolean;
  error?: boolean;
  empty?: boolean;
  onRetry?: () => void;
  children: React.ReactNode;
};

export function WorkspaceState({ loading, error, empty, onRetry, children }: WorkspaceStateProps) {
  if (loading) return <div className="workspace-state" role="status" aria-live="polite"><RefreshCw className="spin" size={18} aria-hidden="true" /> Loading live VahanSync data…</div>;
  if (error) { const retry = onRetry ?? (() => window.location.reload()); return <div className="workspace-state error-state" role="alert" aria-live="assertive"><span>This workspace could not load from Supabase. Check your session and try again.</span><button type="button" className="secondary-button compact-button" aria-label="Retry loading this workspace" onClick={retry}><RefreshCw size={14} aria-hidden="true" /> Retry</button></div>; }
  if (empty) return <div className="workspace-state" role="status" aria-live="polite">No records yet. Use the action above to create the first record.</div>;
  return <>{children}</>;
}

export type { WorkspaceStateProps };

