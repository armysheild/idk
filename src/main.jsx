import React, { useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import './styles.css'
// Fixed Bug 35: Frontend console warnings - all list renderings use proper key props
import {
  acceptInvitation, approveWorkOrder, archiveWorkOrder, changeSubscription, completeComponentService, completeWorkOrder,
  createComponent, createDocument, createDriverInspection, createDriverIssue, createExpense, updateComponent,
  createFuelTransaction, createInventoryMovement, createMaintenancePlan, createPart, createPurchaseOrder,
  createStockLocation, createTelematicsDevice, createTelematicsIntegration, createTollTransaction,
  createVehicle, createInvitation, createVendor, createWorkOrder, deleteComponent, deleteUser, deleteVehicle, deleteWorkOrder, dispatchQueuedSms, getAuditLog,
  getAssignableMembers, getComponents, getCurrentUser, getDocuments, getDriverInspections, getDriverIssues, getExpenses,
  getFleetAnalytics, getFleetOperationsSummary, getInvitations, getMaintenancePlans, getNotificationDeliveries,
  getNotificationPreferences, getNotifications, getParts, getPurchaseOrders, getStockLocations,
  getSubscription, getSubscriptionPlans, getTelematicsDevices, getTelematicsHealth, getTelematicsIntegrations, getUsers,
  getBillingInvoices, getTeamRoster, getVehicles, getVendors, getWorkOrderChecklist, getWorkOrders, login, logout, reconcileExpense,
  requestPasswordReset, resolveNotification, revokeInvitation, signupOrganization, startWorkOrder, syncDueTelematics, flushOfflineMutations,
  getWorkOrderTimeline, updateDocument, updateNotification, updateNotificationPreference, updatePurchaseOrder, updateUserRole,
  updateMyProfile, updatePassword, updateVehicle, updateWorkOrder, updateWorkOrderChecklist, uploadDocumentFile, uploadWorkOrderEvidence, downloadFile,
  assignVehicleDriver as assignVehicleDriverApi, assignWorkOrder as assignWorkOrderApi, getWorkOrderHandoffTimeline,
  getSystemHealth, getSystemVersion, getSystemConfig, getOrganizationSettings, updateOrganizationSettings, getOrganizationQuota,
  getDashboardSummary, getDashboardMetrics, listMaintenanceTemplates, createMaintenanceTemplate, getMaintenancePlan, getMaintenanceForecast,
  getOnboardingStatus, getOnboardingChecklist, bootstrapOnboarding, reservePartForWorkOrder, returnReservedPart, getWorkOrderBoard,
  getWorkOrderBoardStats, bulkUpdateWorkOrders, reorderPartsForWorkOrder, getInventoryPartDetail, getInventoryPartReferences,
  getInventoryByLocation, getInventorySummary, getDriverDailyHome, reportUnsafeDisposition, getDriverBehaviorScore, getDriversSummary,
  getTriageQueue, getTriageStats, updateTriageIssue, createWorkOrderFromIssue, assignTriageIssue, resolveTriageIssue, escalateTriageIssue, getTriageDashboard,
  getMaintenancePerformanceReport, getVehicleMaintenanceHistory, getFuelEfficiencyReport, getFinancialMetrics,
  getFinancialReconciliation, getFinancialApprovalQueue, approveExpense, rejectExpense, bulkApproveExpenses, generateReport, listReports, downloadReport, getFinancialsSummary,
  getActivityFeed, scheduleMaintenancePlan, getMaintenancePlanSchedule, updateMaintenancePlan, deleteMaintenancePlan,
  getVendorList, getVendorDetails, updateVendor, getVendorPricingHistory, createVendorPricingRecord, getVendorPerformanceMetrics,
  getPurchaseOrderDetails, getPurchaseOrderLines, receiveFullPurchaseOrder, receivePartialPurchaseOrder, rejectPurchaseOrderReceipt, getPurchaseOrderHistory, reconcilePurchaseOrder,
  getTelematicsDeviceDetails, getTelemetryReadings, updateTelematicsDevice, deactivateTelematicsDevice,
  getDriverBehaviorEvents, getDriverPerformanceMetrics, getFleetDriverMetrics,
  getFuelTransactions, getFuelEfficiencyAnalysis, getFuelCostAnalysis, getFuelTrends, logFuelTransaction,
  getComplianceDocuments, getDocumentVersions, getComplianceExpiryReport, getComplianceSummary, updateDocumentVersion, archiveComplianceDocument, getComplianceAuditTrail,
  checkPlanEligibility, activateStarterPlan, getTestPlans, getNotificationSourceDetail, escalateNotification,
  getPendingNotifications, bulkResolveNotifications, getAuditLogsAdvanced,
  getReadiness,
} from './api'
import { supabase } from './supabase'
import { navigateToWorkspace, navByRole, roleNames, workspaceForRole, workspaceFromLocation } from './navigation'

const routeQuery = new URLSearchParams(window.location.search)
const route = window.location.pathname === '/'
  ? ({ app: '/app', signup: '/signup', invite: '/invite' }[routeQuery.get('page')] || '/')
  : window.location.pathname
const invitationToken = routeQuery.get('token') || (window.location.pathname.startsWith('/invite/') ? decodeURIComponent(window.location.pathname.slice('/invite/'.length)) : '')
const today = () => new Date().toISOString().slice(0, 10)
const money = (paise = 0) => `₹${(Number(paise) / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`
const dateText = (value) => value ? new Date(value).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—'
const initials = (name = 'VahanSync') => name.split(/\s+/).map((part) => part[0]).join('').slice(0, 2).toUpperCase()

// Fixed Bug 36: Standardized validation messages for consistent form feedback
const validationMessages = {
  required: 'This field is required',
  email: 'Please enter a valid email address',
  minLength: (min) => `Minimum ${min} characters required`,
  maxLength: (max) => `Maximum ${max} characters allowed`,
  pattern: 'Invalid format',
  numeric: 'Please enter a valid number',
  phone: 'Please enter a valid phone number',
}

function App() {
  if (route === '/') return <LandingPage />
  if (route === '/signup') return <AuthPage mode="signup" />
  if (route === '/invite' || route.startsWith('/invite/')) return <AuthPage mode="invite" token={invitationToken} />
  if (route === '/app' && routeQuery.get('reset') === '1' && supabase) return <ResetPasswordPage />
  return <AuthenticatedApp />
}

function AuthPage({ mode, token }) {
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [form, setForm] = useState(mode === 'signup' ? { organization_name: '', full_name: '', email: '', mobile_phone: '', password: '' } : { password: '' })
  async function submit(event) {
    event.preventDefault()
    setError('')
    setBusy(true)
    try {
      const result = mode === 'signup' ? await signupOrganization(form) : await acceptInvitation({ token, password: form.password })
      sessionStorage.setItem('vahana:access-token', result.access_token)
      window.location.href = '/app'
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="auth-layout"><section className="auth-story"><Brand /><div className="auth-story-copy"><span className="overline">India-ready fleet operations</span><h1>{mode === 'signup' ? 'Build a calmer operating rhythm.' : 'Join the operating picture.'}</h1><p>{mode === 'signup' ? 'Put vehicles, people, work orders, inventory, compliance, and finance on one accountable record.' : 'Your invitation connects you to the workspace responsibilities assigned by your organisation owner.'}</p><div className="story-list"><span>01 <b>Every vehicle has a history.</b></span><span>02 <b>Every handoff has evidence.</b></span><span>03 <b>Every rupee has context.</b></span></div></div><small className="auth-footnote">Secure, organisation-scoped access for fleet operators.</small></section><section className="auth-panel"><form className="auth-card" onSubmit={submit}><span className="overline">{mode === 'signup' ? 'Create workspace' : 'Invitation access'}</span><h2>{mode === 'signup' ? 'Start your organisation' : 'Activate your membership'}</h2><p className="muted">{mode === 'signup' ? 'Your first account is created as Owner / Superadmin.' : 'Set a password to accept this role assignment.'}</p>{mode === 'signup' && <><Field label="Organisation name" value={form.organization_name} onChange={(value) => setForm({ ...form, organization_name: value })} required /><Field label="Your full name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required /><Field label="Work email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required /><Field label="Mobile number" type="tel" placeholder="+91 98765 43210" value={form.mobile_phone} onChange={(value) => setForm({ ...form, mobile_phone: value })} required /></>}{mode === 'invite' && <div className="invite-confirm"><span>Invitation token received</span><strong>Your assigned workspace is ready to activate.</strong></div>}<Field label={mode === 'signup' ? 'Password' : 'Create password'} type="password" value={form.password} onChange={(value) => setForm({ ...form, password: value })} minLength="8" required />{error && <div className="error-box">{error}</div>}<button className="primary-button wide" disabled={busy}>{busy ? 'Working…' : mode === 'signup' ? 'Create organisation' : 'Accept invitation'}</button><a className="auth-switch" href="/app">{mode === 'signup' ? 'Already have access? Sign in' : 'Already activated? Sign in'}</a></form></section></div>
}

function AuthenticatedApp() {
  const [token, setToken] = useState(() => sessionStorage.getItem('vahana:access-token'))
  const [user, setUser] = useState(null)
  const [page, setPage] = useState(workspaceFromLocation)
  const [query, setQuery] = useState('')
  const [notice, setNotice] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  const [refreshKey, setRefreshKey] = useState(0)
  const [data, setData] = useState({})
  const [apiStatus, setApiStatus] = useState('checking')

  useEffect(() => {
    const syncWorkspace = () => setPage(workspaceFromLocation())
    window.addEventListener('popstate', syncWorkspace)
    return () => window.removeEventListener('popstate', syncWorkspace)
  }, [])

  useEffect(() => {
    if (!user) return
    const workspace = workspaceForRole(page, user.role)
    if (workspace !== page) navigate(workspace)
  }, [page, user])

  function navigate(workspace) {
    navigateToWorkspace(workspace)
  }

  useEffect(() => {
    let active = true
    const checkReadiness = () => {
      getReadiness()
        .then(() => { if (active) setApiStatus('ready') })
        .catch(() => { if (active) setApiStatus('degraded') })
    }
    checkReadiness()
    const interval = window.setInterval(checkReadiness, 30 * 1000)
    return () => {
      active = false
      window.clearInterval(interval)
    }
  }, [])

  useEffect(() => {
    if (!supabase) return
    let active = true
    supabase.auth.getSession().then(({ data: sessionData }) => {
      const accessToken = sessionData.session?.access_token
      if (active && accessToken) {
        sessionStorage.setItem('vahana:access-token', accessToken)
        setToken(accessToken)
      }
    })
    const { data: listener } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!active) return
      const accessToken = session?.access_token
      if (accessToken) {
        sessionStorage.setItem('vahana:access-token', accessToken)
        setToken(accessToken)
      } else {
        sessionStorage.removeItem('vahana:access-token')
        setToken(null)
      }
    })
    return () => {
      active = false
      listener.subscription.unsubscribe()
    }
  }, [])

  useEffect(() => {
    if (!token) return
    flushOfflineMutations(token).catch(() => {})
    const flush = () => flushOfflineMutations(token).catch(() => {})
    window.addEventListener('online', flush)
    return () => window.removeEventListener('online', flush)
  }, [token])

  useEffect(() => {
    if (!token) {
      setLoading(false)
      return
    }
    let active = true
    async function load() {
      setLoading(true)
      try {
        const current = await getCurrentUser(token)
        const canSeeVehicles = ['owner', 'fleet_manager', 'driver', 'mechanic', 'technician'].includes(current.role)
        const canSeeMaintenance = ['owner', 'fleet_manager', 'mechanic', 'technician'].includes(current.role)
        const canSeeFinance = ['owner', 'fleet_manager', 'accountant'].includes(current.role)
        const canSeeProcurement = ['owner', 'inventory_manager', 'accountant'].includes(current.role)
        const canSeeInventory = ['owner', 'fleet_manager', 'inventory_manager', 'mechanic', 'technician'].includes(current.role)
        const canSeeTelematics = ['owner', 'fleet_manager'].includes(current.role)
        const results = await Promise.allSettled([
          canSeeVehicles ? getVehicles(token) : Promise.resolve([]),
          canSeeMaintenance ? getWorkOrders(token) : Promise.resolve([]),
          canSeeMaintenance ? getComponents(token) : Promise.resolve([]),
          ['owner', 'fleet_manager', 'driver'].includes(current.role) ? getDocuments(token) : Promise.resolve([]),
          getNotifications(token),
          current.role === 'owner' ? getSubscription(token) : Promise.resolve(null),
          canSeeInventory ? getParts(token) : Promise.resolve([]),
          canSeeFinance ? getExpenses(token) : Promise.resolve([]),
          canSeeMaintenance ? getMaintenancePlans(token) : Promise.resolve([]),
          canSeeProcurement ? getVendors(token) : Promise.resolve([]),
          canSeeProcurement ? getPurchaseOrders(token) : Promise.resolve([]),
          ['owner', 'inventory_manager'].includes(current.role) ? getStockLocations(token) : Promise.resolve([]),
          getNotificationPreferences(token), getNotificationDeliveries(token), current.role === 'driver' ? getDriverInspections(token) : Promise.resolve([]),
          current.role === 'driver' ? getDriverIssues(token) : Promise.resolve([]),
          canSeeTelematics ? getTelematicsIntegrations(token) : Promise.resolve([]),
          canSeeTelematics ? getTelematicsDevices(token) : Promise.resolve([]),
          current.role === 'owner' ? getUsers(token) : Promise.resolve([]),
          current.role === 'owner' ? getInvitations(token) : Promise.resolve([]),
          current.role === 'owner' ? getAuditLog(token) : Promise.resolve([]),
          ['owner', 'fleet_manager'].includes(current.role) ? getFleetOperationsSummary(token) : Promise.resolve(null),
          ['owner', 'fleet_manager'].includes(current.role) ? getFleetAnalytics(token) : Promise.resolve(null),
          getSubscriptionPlans(token),
          current.role === 'owner' ? getBillingInvoices(token) : Promise.resolve([]),
          ['owner', 'fleet_manager'].includes(current.role) ? getTelematicsHealth(token) : Promise.resolve(null),
        ])
        if (!active) return
        const value = results.map((result) => result.status === 'fulfilled' ? result.value : null)
        setUser(current)
        setData({
          vehicles: value[0] || [], workOrders: value[1] || [], components: value[2] || [], documents: value[3] || [],
          notifications: value[4] || [], subscription: value[5], parts: value[6] || [], expenses: value[7] || [],
          plans: value[8] || [], vendors: value[9] || [], purchaseOrders: value[10] || [], locations: value[11] || [],
          notificationPreferences: value[12] || [], deliveries: value[13] || [], inspections: value[14] || [],
          issues: value[15] || [], integrations: value[16] || [], devices: value[17] || [], users: value[18] || [],
          invitations: value[19] || [], audit: value[20] || [], operations: value[21], analytics: value[22], subscriptionPlans: value[23] || [],
          billingInvoices: value[24] || [], telematicsHealth: value[25],
        })
      } catch (requestError) {
        if (requestError.status === 401) {
          sessionStorage.removeItem('vahana:access-token')
          setToken(null)
          setUser(null)
          setError('')
          return
        }
        if (active) setError(requestError.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token, refreshKey])

  useEffect(() => {
    if (!token) return undefined
    const interval = window.setInterval(() => setRefreshKey((value) => value + 1), 5 * 60 * 1000)
    return () => window.clearInterval(interval)
  }, [token])

  function refresh(message) {
    if (message) {
      setNotice(message)
      window.setTimeout(() => setNotice(''), 3500)
    }
    setRefreshKey((value) => value + 1)
  }
  async function signOut() {
    try { await logout() } catch {}
    sessionStorage.removeItem('vahana:access-token')
    setToken(null)
    window.location.href = '/app'
  }
  if (!token) return <LoginPage onAuthenticated={(value) => { sessionStorage.setItem('vahana:access-token', value); setToken(value) }} />
  if (loading && !user) return <LoadingScreen />
  if (error && !user) return <ErrorScreen error={error} onRetry={() => { setError(''); setRefreshKey((value) => value + 1) }} />
  if (!user) return <LoginPage onAuthenticated={(value) => { sessionStorage.setItem('vahana:access-token', value); setToken(value) }} />

  const nav = navByRole[user.role] || navByRole.owner
  const filteredQuery = query.trim().toLowerCase()
  return <div className="app-shell"><aside className="sidebar"><div className="sidebar-brand"><img className="brand-mark" src="/vahansync-v-check-road-mark.png" alt="" /><div><strong>VahanSync</strong><small>Fleet intelligence for India’s operators</small></div></div><div className="tenant-switch"><span className="status-dot" /><div><small>Organisation</small><strong>{user.organization_name}</strong></div><span>⌄</span></div><nav className="primary-nav"><span className="nav-caption">Your workspace</span>{nav.map(([id, label, icon]) => <button key={id} className={page === id ? 'nav-item active' : 'nav-item'} onClick={() => navigate(id)}><span className="nav-icon">{icon}</span>{label}{id === 'notifications' && data.notifications?.some((item) => item.status === 'unread') && <i className="nav-badge" />}</button>)}</nav><div className="sidebar-bottom"><div className="user-card"><span className="avatar">{initials(user.full_name)}</span><div><strong>{user.full_name}</strong><small>{roleNames[user.role]}</small></div></div><button className="signout" onClick={signOut}>↪ Sign out</button></div></aside><main className="main-area"><header className="topbar"><div><span className="breadcrumb">VahanSync <b>/</b> {nav.find(([id]) => id === page)?.[1] || 'Workspace'}</span><h1>{pageTitle(page, user.role)}</h1></div><div className="topbar-actions"><label className="global-search"><span>⌕</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search this workspace" /></label><span className={apiStatus === 'degraded' ? 'live-pill degraded' : 'live-pill'}><i /> {apiStatus === 'ready' ? 'API ready' : apiStatus === 'degraded' ? 'API reconnecting' : 'Checking API'}</span><button className="avatar avatar-button" onClick={() => navigate('notifications')}>{initials(user.full_name)}</button></div></header><div className="content">
    {page === 'command' && <><CommandPage token={token} role={user.role} data={data} onNavigate={navigate} />{['owner', 'fleet_manager'].includes(user.role) && <FleetAnalyticsPanel analytics={data.analytics} />}</>}
    {page === 'members' && <MembersPage token={token} data={data} refresh={refresh} />}
    {page === 'billing' && <BillingPage token={token} data={data} refresh={refresh} />}
    {page === 'audit' && <AuditPage token={token} entries={data.audit} summary={data.operations} />}
    {page === 'settings' && <OrganizationSettingsPage token={token} refresh={refresh} />}
    {page === 'onboarding' && <OnboardingPage token={token} refresh={refresh} />}
    {page === 'vehicles' && <VehiclesPage token={token} data={data} refresh={refresh} query={filteredQuery} />}
    {page === 'maintenance' && <MaintenancePage token={token} data={data} refresh={refresh} query={filteredQuery} />}
    {page === 'compliance' && <CompliancePage token={token} data={data} refresh={refresh} query={filteredQuery} />}
    {page === 'inventory' && <InventoryPage token={token} data={data} refresh={refresh} query={filteredQuery} />}
    {page === 'fleet' && <FleetManagerWorkspace token={token} data={data} refresh={refresh} query={filteredQuery} />}
    {page === 'work' && (user.role === 'fleet_manager' ? <FleetManagerWorkspace token={token} data={data} refresh={refresh} query={filteredQuery} /> : <MechanicExecutionWorkspace role={user.role} token={token} data={data} refresh={refresh} query={filteredQuery} />)}
    {page === 'checks' && <DriverPortal token={token} data={data} refresh={refresh} />}
    {page === 'finance' && (user.role === 'accountant' ? <FinancialsWorkspace token={token} data={data} refresh={refresh} /> : <FinancePage token={token} data={data} refresh={refresh} />)}
    {page === 'triage' && <TriageWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'reports' && <ReportsWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'activity' && <ActivityFeedWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'maintenance-planning' && <MaintenancePlanningWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'vendors' && <VendorWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'procurement' && <ProcurementAdvancedWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'telematics' && <TelematicsWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'driver-behavior' && <DriverBehaviorWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'fuel-tracking' && <FuelTrackingWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'compliance-versions' && <ComplianceVersioningWorkspace token={token} data={data} refresh={refresh} />}
    {page === 'notifications' && <NotificationsPage token={token} data={data} refresh={refresh} role={user.role} />}
    {page === 'profile' && <ProfilePage token={token} user={user} refresh={(message, updated) => { if (updated) setUser(updated); refresh(message) }} />}
  </div></main>{notice && <div className="toast">{notice}</div>}</div>
}

function LoginPage({ onAuthenticated }) {
  const [email, setEmail] = useState(() => localStorage.getItem('vahana:last-email') || '')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState('login')
  const [rememberEmail, setRememberEmail] = useState(Boolean(localStorage.getItem('vahana:last-email')))
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const session = await login(email, password)
      if (rememberEmail) localStorage.setItem('vahana:last-email', email)
      else localStorage.removeItem('vahana:last-email')
      onAuthenticated(session.access_token)
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  async function reset(event) {
    event.preventDefault()
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await requestPasswordReset(email)
      setNotice('If this email belongs to a VahanSync organisation, a password-reset link is on its way.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="login-layout"><div className="login-visual"><Brand /><div><span className="overline">Welcome back</span><h1>Keep every operating decision connected.</h1><p>Sign in to the workspace that matches your responsibility: governance, fleet, workshop, field, or finance.</p></div><div className="login-stat"><strong>One record.</strong><span>Vehicle identity, action, evidence, and cost.</span></div></div><form className="login-card" onSubmit={mode === 'login' ? submit : reset}><span className="overline">Secure sign in</span><h2>{mode === 'login' ? 'Enter your workspace' : 'Recover your access'}</h2><p className="muted">{mode === 'login' ? 'Use the work email assigned to your VahanSync organisation.' : 'We will send a secure reset link without revealing whether the account exists.'}</p><Field label="Email" type="email" value={email} onChange={setEmail} required />{mode === 'login' && <><Field label="Password" type="password" value={password} onChange={setPassword} required minLength="8" /><label className="remember-row"><input type="checkbox" checked={rememberEmail} onChange={(event) => { setRememberEmail(event.target.checked); if (!event.target.checked) localStorage.removeItem('vahana:last-email') }} /><span>Remember this email on this device</span></label></>}{error && <div className="error-box">{error}</div>}{notice && <div className="success-box">{notice}</div>}<button className="primary-button wide" disabled={busy}>{busy ? 'Working…' : mode === 'login' ? 'Sign in' : 'Send reset link'}</button>{mode === 'login' ? <button type="button" className="auth-switch link-button" onClick={() => { setMode('reset'); setError(''); setNotice('') }}>Forgot password?</button> : <button type="button" className="auth-switch link-button" onClick={() => { setMode('login'); setError(''); setNotice('') }}>Back to sign in</button>}<a className="auth-switch" href="/signup">Create a new organisation</a></form></div>
}

function ResetPasswordPage() {
  const [password, setPassword] = useState('')
  const [confirmation, setConfirmation] = useState('')
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [busy, setBusy] = useState(false)
  async function submit(event) {
    event.preventDefault()
    if (password !== confirmation) {
      setError('Passwords do not match.')
      return
    }
    setBusy(true)
    setError('')
    setNotice('')
    try {
      await updatePassword(password)
      await supabase.auth.signOut()
      sessionStorage.removeItem('vahana:access-token')
      setNotice('Password updated. You can now sign in with the new password.')
    } catch (requestError) {
      setError(requestError.message)
    } finally {
      setBusy(false)
    }
  }
  return <div className="login-layout"><div className="login-visual"><Brand /><div><span className="overline">Account recovery</span><h1>Restore access without interrupting the operation.</h1><p>Choose a new password, then return to the secure sign-in screen.</p></div><div className="login-stat"><strong>Secure recovery.</strong><span>Passwords never enter VahanSync application storage.</span></div></div><form className="login-card" onSubmit={submit}><span className="overline">New password</span><h2>Set a new password</h2><p className="muted">Use at least 8 characters and keep it unique to your organisation account.</p><Field label="New password" type="password" value={password} onChange={setPassword} required minLength="8" /><Field label="Confirm password" type="password" value={confirmation} onChange={setConfirmation} required minLength="8" />{error && <div className="error-box">{error}</div>}{notice && <div className="success-box">{notice}</div>}<button className="primary-button wide" disabled={busy}>{busy ? 'Updating…' : 'Update password'}</button><a className="auth-switch" href="/app">Back to sign in</a></form></div>
}

function LandingPage() {
  return <div className="landing-page"><header className="landing-header"><Brand /><nav><a href="#platform">Platform</a><a href="#roles">Roles</a><a href="#india">India-ready</a></nav><div><a className="text-link" href="/app">Sign in</a><a className="primary-button small" href="/signup">Create organisation →</a></div></header><main><section className="landing-hero"><div className="landing-hero-copy"><span className="overline">VahanSync operating intelligence</span><h1>Keep the fleet moving with a <em>single accountable signal.</em></h1><p>VahanSync connects vehicle identity, people, maintenance, parts, safety, and INR finance so the next responsible action is visible before a roadside failure becomes a business interruption.</p><div className="landing-actions"><a className="primary-button" href="/signup">Create your organisation →</a><a className="text-link" href="#platform">See how it works ↓</a></div><div className="proof-row"><span>Organisation-scoped access</span><span>Role-constrained workspaces</span><span>VIN-first records</span></div></div><figure className="landing-master-brand"><img src="/vahansync-master-readiness-logo.png" alt="VahanSync fleet readiness illustration with buses, route, readiness check, and upward movement" /></figure></section><section className="landing-proof"><span><b>01</b> Preventive maintenance</span><span><b>02</b> Evidence at every handoff</span><span><b>03</b> INR-native accountability</span></section><section className="landing-section" id="platform"><div className="section-heading"><span className="overline">The operating chain</span><h2>Not another dashboard. A connected way to move work.</h2><p>Every workspace is role-specific, but every action stays attached to the same operational record.</p></div><div className="feature-grid"><Feature number="01" title="Signal the condition" text="Odometer, component life, documents, and driver reports create a clear readiness picture." /><Feature number="02" title="Route the decision" text="Fleet Managers assign accountable maintenance work with vehicle identity and exception context attached." /><Feature number="03" title="Protect the handoff" text="Parts, supplier receipts, work evidence, and approval states stay linked to the same record." /></div></section><section className="role-band" id="roles"><div className="section-heading"><span className="overline">Every member, the right surface</span><h2>Responsibility without noise.</h2></div><div className="role-grid">{Object.entries(roleNames).map(([key, name], index) => <article key={key}><span>{String(index + 1).padStart(2, '0')}</span><strong>{name}</strong><p>{roleDescription(key)}</p></article>)}</div></section><section className="landing-section india-section" id="india"><div className="india-copy"><span className="overline">Built for Indian fleet realities</span><h2>Registration numbers, PUC, fitness, GST, FASTag, and paise-precise finance.</h2><p>Provider-neutral telematics and daily odometer sync keep the operating model ready for the way Indian transport businesses actually work.</p><a className="text-link" href="/signup">Build your workspace →</a></div><div className="india-grid"><span><b>₹</b><small>INR-native</small></span><span><b>24/7</b><small>operational visibility</small></span><span><b>1</b><small>source of truth</small></span><span><b>∞</b><small>members per plan</small></span></div></section></main><footer className="landing-footer"><Brand /><span>© 2026 VahanSync · Built for fleet operators in India</span><a className="text-link" href="/app">Sign in →</a></footer></div>
}

function Feature({ number, title, text }) { return <article className="feature-card"><span>{number}</span><h3>{title}</h3><p>{text}</p><a className="text-link" href="/signup">Explore the workflow →</a></article> }
function Brand() { return <a className="brand" href="/"><img className="brand-mark" src="/vahansync-v-check-road-mark.png" alt="" /><span><strong>VahanSync</strong><small>Fleet intelligence for India’s operators</small></span></a> }

function CommandPage({ token, role, data, onNavigate }) {
  const [summary, setSummary] = useState(null)
  const [workOrderMetrics, setWorkOrderMetrics] = useState(null)

  useEffect(() => {
    let active = true
    Promise.all([getDashboardSummary(token), getDashboardMetrics(token, 'work_orders')])
      .then(([dashboardSummary, metrics]) => {
        if (!active) return
        setSummary(dashboardSummary)
        setWorkOrderMetrics(metrics)
      })
      .catch(() => {})
    return () => { active = false }
  }, [token])

  return <div className={`command-page role-${role}`}><section className="workspace-hero"><div><span className="overline">{roleNames[role]} workspace</span><h2>{commandHeadline(role)}</h2><p>{commandSubhead(role)}</p></div><div className="hero-date"><span>Today</span><strong>{new Date().toLocaleDateString('en-IN', { weekday: 'long', day: '2-digit', month: 'short' })}</strong><small>Live from organisation records</small></div></section><section className="stat-grid">{commandStats(role, data).map((stat) => <Metric key={stat.label} {...stat} />)}</section>{summary && <DataPanel title="Live dashboard metrics" eyebrow="Backend KPI snapshot"><div className="detail-list"><span><small>Total vehicles</small><strong>{summary.vehicle_count ?? summary.total_vehicles ?? '—'}</strong></span><span><small>Active work orders</small><strong>{summary.active_work_orders ?? summary.open_work_orders ?? '—'}</strong></span><span><small>Work-order statuses</small><strong>{Object.values(workOrderMetrics?.status_counts || {}).reduce((total, count) => total + count, 0) || '—'}</strong></span></div></DataPanel>}<div className="command-grid"><section className="panel"><PanelHeader eyebrow="Next actions" title="Move the operation forward" /><div className="action-list">{commandActions(role).map((action) => <button key={action.page} className="action-card" onClick={() => onNavigate(action.page)}><span className={`action-icon ${action.tone}`}>{action.icon}</span><span><strong>{action.title}</strong><small>{action.detail}</small></span><b>→</b></button>)}</div></section><section className="panel"><PanelHeader eyebrow="Operating picture" title="What needs attention" /><AttentionList role={role} data={data} onNavigate={onNavigate} /></section></div><section className="panel activity-panel"><PanelHeader eyebrow="Connected records" title="Recent organisation activity" /><RecentActivity data={data} /></section></div>
}

function MembersPage({ token, data, refresh }) {
  const [showInvite, setShowInvite] = useState(false)
  const [form, setForm] = useState({ email: '', full_name: '', mobile_phone: '', role: 'fleet_manager' })
  const [error, setError] = useState('')
  async function invite(event) { event.preventDefault(); try { const invitation = await createInvitation(token, form); const inviteLink = `${window.location.origin}${invitation.invite_path}`; window.prompt('Copy this invitation link', inviteLink); setForm({ email: '', full_name: '', mobile_phone: '', role: 'fleet_manager' }); setShowInvite(false); refresh('Invitation created.') } catch (requestError) { setError(requestError.message) } }
  async function changeRole(id, role) { try { await updateUserRole(token, id, role); refresh('Member role updated.') } catch (requestError) { setError(requestError.message) } }
  async function removeMember(id) { if (!window.confirm('Remove this member?')) return; try { await deleteUser(token, id); refresh('Member removed.') } catch (requestError) { setError(requestError.message) } }
  async function revoke(id) { try { await revokeInvitation(token, id); refresh('Invitation revoked.') } catch (requestError) { setError(requestError.message) } }
  return <PageFrame eyebrow="01 · Governance" title="Members & invitations" description="Give each person the least-privileged workspace needed to move the fleet forward. The first account remains the organisation owner."><div className="page-toolbar"><div><strong>{data.users.length} members</strong><span>{data.invitations.filter((item) => !item.accepted_at && !item.revoked_at).length} pending invitations</span></div><button className="primary-button" onClick={() => setShowInvite(!showInvite)}>{showInvite ? 'Close invite form' : 'Invite teammate'}</button></div>{showInvite && <FormCard title="Invite a teammate" description="Mobile numbers enable SMS and WhatsApp delivery when provider credentials are configured."><form className="form-grid" onSubmit={invite}><Field label="Full name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required /><Field label="Work email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} required /><Field label="Mobile number" type="tel" value={form.mobile_phone} onChange={(value) => setForm({ ...form, mobile_phone: value })} /><SelectField label="Workspace role" value={form.role} onChange={(value) => setForm({ ...form, role: value })} options={Object.keys(roleNames).filter((role) => role !== 'owner').map((role) => [role, roleNames[role]])} /><button className="primary-button">Send invitation</button></form>{error && <div className="error-box">{error}</div>}</FormCard>}<section className="split-grid"><DataPanel title="Organisation directory" eyebrow="Current access"><Table headers={['Member', 'Role', 'Mobile', 'Action']} rows={data.users.map((member) => [<span className="person-cell"><span className="avatar small">{initials(member.full_name)}</span><span><strong>{member.full_name}</strong><small>{member.email}</small></span></span>, member.role === 'owner' ? roleNames.owner : <select className="inline-select" value={member.role} onChange={(event) => changeRole(member.id, event.target.value)}>{Object.keys(roleNames).filter((role) => role !== 'owner').map((role) => <option key={role} value={role}>{roleNames[role]}</option>)}</select>, member.mobile_phone || 'Not added', member.role === 'owner' ? <span className="muted">Protected</span> : <div className="row-actions"><span className="status good">Active</span><button className="table-action" onClick={() => removeMember(member.id)}>Remove</button></div>])} empty="No additional members have joined yet." /></DataPanel><DataPanel title="Invitation ledger" eyebrow="Access handoffs"><Table headers={['Invitee', 'Role', 'Expires', 'Status', 'Action']} rows={data.invitations.map((invite) => [<span><strong>{invite.full_name}</strong><small>{invite.email}</small></span>, roleNames[invite.role] || invite.role, dateText(invite.expires_at), invite.accepted_at ? <span className="status good">Accepted</span> : invite.revoked_at ? <span className="status bad">Revoked</span> : <span className="status warn">Pending</span>, !invite.accepted_at && !invite.revoked_at ? <button className="table-action" onClick={() => revoke(invite.id)}>Revoke</button> : '—'])} empty="No invitations have been created." /></DataPanel></section></PageFrame>
}

function ProfilePage({ token, user, refresh }) {
  const [form, setForm] = useState({ full_name: user.full_name || '', mobile_phone: user.mobile_phone || '' })
  async function save(event) {
    event.preventDefault()
    try {
      const updated = await updateMyProfile(token, form)
      refresh('Profile updated.', updated)
    } catch (error) {
      refresh(error.message)
    }
  }
  return <PageFrame eyebrow="Account control" title="Profile & account" description="Keep your identity and mobile contact current for workspace access and consent-aware notifications."><div className="split-grid"><FormCard title="Personal profile" description="Changes apply to your VahanSync member record immediately."><form className="stack-form" onSubmit={save}><Field label="Full name" value={form.full_name} onChange={(value) => setForm({ ...form, full_name: value })} required /><Field label="Work email" value={user.email} onChange={() => {}} type="email" disabled /><Field label="Mobile number" type="tel" value={form.mobile_phone} onChange={(value) => setForm({ ...form, mobile_phone: value })} placeholder="+91 98765 43210" /><button className="primary-button">Save profile</button></form></FormCard><DataPanel title="Access details" eyebrow="Read-only identity"><div className="detail-list"><span><small>Workspace role</small><strong>{roleNames[user.role]}</strong></span><span><small>Organisation</small><strong>{user.organization_name}</strong></span><span><small>Member ID</small><strong>#{user.id}</strong></span></div></DataPanel></div></PageFrame>
}

function OrganizationSettingsPage({ token, refresh }) {
  const [settings, setSettings] = useState(null)
  const [quota, setQuota] = useState(null)
  const [form, setForm] = useState({ name: '', timezone: 'Asia/Kolkata', default_currency: 'INR' })
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    let active = true
    Promise.all([getOrganizationSettings(token), getOrganizationQuota(token)])
      .then(([organizationSettings, organizationQuota]) => {
        if (!active) return
        setSettings(organizationSettings)
        setQuota(organizationQuota)
        setForm({
          name: organizationSettings?.name || '',
          timezone: organizationSettings?.timezone || 'Asia/Kolkata',
          default_currency: organizationSettings?.default_currency || 'INR',
        })
      })
      .catch((error) => refresh(error.message))
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  }, [token])

  async function save(event) {
    event.preventDefault()
    setSaving(true)
    try {
      const updated = await updateOrganizationSettings(token, form)
      setSettings(updated)
      refresh('Organisation settings saved.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setSaving(false)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading organisation settings…</h2></div>

  return <PageFrame eyebrow="02 · Governance" title="Organisation settings" description="Control tenant defaults and monitor the capacity available to your operating teams.">
    <div className="split-grid">
      <FormCard title="Tenant defaults" description="These values are applied to new operational records unless overridden by a workflow.">
        <form className="stack-form" onSubmit={save}>
          <Field label="Organisation name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
          <SelectField label="Timezone" value={form.timezone} onChange={(value) => setForm({ ...form, timezone: value })} options={['Asia/Kolkata', 'UTC', 'Asia/Dubai', 'Asia/Singapore'].map((value) => [value, value])} />
          <SelectField label="Default currency" value={form.default_currency} onChange={(value) => setForm({ ...form, default_currency: value })} options={['INR', 'USD', 'AED', 'SGD'].map((value) => [value, value])} />
          <button className="primary-button" disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
        </form>
      </FormCard>
      <DataPanel title="Capacity" eyebrow="Current plan quota">
        <div className="detail-list">
          <span><small>Vehicles used</small><strong>{quota?.vehicles_used ?? '—'} / {quota?.vehicles_limit ?? '—'}</strong></span>
          <span><small>Members used</small><strong>{quota?.members_used ?? '—'} / {quota?.members_limit ?? '—'}</strong></span>
          <span><small>Subscription</small><strong>{settings?.subscription_status || quota?.plan_code || '—'}</strong></span>
        </div>
      </DataPanel>
    </div>
  </PageFrame>
}

function OnboardingPage({ token, refresh }) {
  const [status, setStatus] = useState(null)
  const [checklist, setChecklist] = useState([])
  const [form, setForm] = useState({ organization_name: '', first_name: '', last_name: '', industry: '', fleet_size: '' })
  const [loading, setLoading] = useState(true)

  async function load() {
    try {
      const [onboardingStatus, onboardingChecklist] = await Promise.all([getOnboardingStatus(token), getOnboardingChecklist(token)])
      setStatus(onboardingStatus)
      setChecklist(onboardingChecklist || [])
      setForm((current) => ({
        ...current,
        organization_name: onboardingStatus?.organization_name || '',
      }))
    } catch (error) {
      refresh(error.message)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [token])

  async function bootstrap(event) {
    event.preventDefault()
    try {
      await bootstrapOnboarding(token, form)
      refresh('Onboarding defaults created.')
      await load()
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading onboarding checklist…</h2></div>

  return <PageFrame eyebrow="01 · Setup" title="Onboarding checklist" description="Complete the foundational setup steps before handing the operating system to the wider team.">
    <div className="stat-grid">
      <Metric label="Completion" value={`${status?.completion_percent ?? 0}%`} detail={status?.is_complete ? 'Ready for operations' : 'Setup remains'} tone={status?.is_complete ? 'green' : 'amber'} />
      <Metric label="Checklist items" value={checklist.length} detail={`${checklist.filter((item) => item.completed).length} completed`} tone="blue" />
    </div>
    <div className="split-grid">
      <FormCard title="Bootstrap organisation" description="Create the default warehouse and notification preferences for this tenant.">
        <form className="stack-form" onSubmit={bootstrap}>
          <Field label="Organisation name" value={form.organization_name} onChange={(value) => setForm({ ...form, organization_name: value })} required />
          <Field label="First name" value={form.first_name} onChange={(value) => setForm({ ...form, first_name: value })} required />
          <Field label="Last name" value={form.last_name} onChange={(value) => setForm({ ...form, last_name: value })} required />
          <Field label="Industry" value={form.industry} onChange={(value) => setForm({ ...form, industry: value })} />
          <Field label="Fleet size" value={form.fleet_size} onChange={(value) => setForm({ ...form, fleet_size: value })} />
          <button className="primary-button">Bootstrap defaults</button>
        </form>
      </FormCard>
      <DataPanel title="Setup progress" eyebrow={`${checklist.filter((item) => item.completed).length} of ${checklist.length} complete`}>
        <Table headers={['Step', 'Description', 'Status']} rows={checklist.map((item) => [<strong>{item.title}</strong>, item.description, item.completed ? <span className="status good">Complete</span> : <span className="status warn">Pending</span>])} empty="No onboarding steps returned." />
      </DataPanel>
    </div>
  </PageFrame>
}

function BillingPage({ token, data, refresh }) {
  const current = data.subscription
  async function selectPlan(code) { try { await changeSubscription(token, code); refresh('Subscription plan updated.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="02 · Governance" title="Billing & plans" description="Choose the operating capacity that fits your fleet. Every plan includes a 14-day trial and unlimited member onboarding."><section className="billing-hero"><div><span className="overline">Current subscription</span><h3>{current?.plan?.name || 'Starter'}</h3><p>{current?.status || 'Trialing'} · trial ends {dateText(current?.trial_ends_on)}</p></div><div className="billing-numbers"><span><b>{current?.vehicle_count || 0}</b> vehicles</span><span><b>∞</b> members</span><span><b>{money(current?.estimated_subtotal_paise || 0)}</b> estimate</span></div></section><div className="plan-grid">{data.subscriptionPlans.map((plan) => <article className={current?.plan?.code === plan.code ? 'plan-card selected' : 'plan-card'} key={plan.code}><span className="plan-name">{plan.name}</span><strong>{plan.monthly_price_paise ? money(plan.monthly_price_paise) : 'Custom'}</strong><small>per month</small><p>{plan.description}</p><div className="plan-limit">{plan.included_vehicles || 'Custom'} included vehicles <b>·</b> unlimited members</div><ul>{plan.features.map((feature) => <li key={feature}>✓ {feature}</li>)}</ul><button className={current?.plan?.code === plan.code ? 'secondary-button wide' : 'primary-button wide'} onClick={() => selectPlan(plan.code)}>{current?.plan?.code === plan.code ? 'Current plan' : 'Choose plan'}</button></article>)}</div><DataPanel title="Invoice history" eyebrow={`${data.billingInvoices.length} persisted invoices`}><Table headers={['Period', 'Plan', 'Amount', 'Status', 'Created']} rows={data.billingInvoices.map((invoice) => [`${invoice.period_start} → ${invoice.period_end}`, invoice.plan, money(invoice.total_paise), invoice.status, dateText(invoice.created_at)])} empty="No invoices have been issued yet." /></DataPanel></PageFrame>
}

function AuditPage({ token, entries, summary }) {
  const [filters, setFilters] = useState({ actor_role: '', entity_type: '', action: '', outcome: '' })
  const [rows, setRows] = useState(entries)
  const [busy, setBusy] = useState(false)
  async function search(event) { event.preventDefault(); setBusy(true); try { setRows(await getAuditLog(token, filters)) } finally { setBusy(false) } }
  return <PageFrame eyebrow="03 · Governance" title="Audit trail" description="Search the organisation record by actor, entity, action, and outcome. This is the Owner's read-only operating evidence."><section className="stat-grid">{Object.entries(summary || {}).map(([label, value]) => <Metric key={label} label={label.replaceAll('_', ' ')} value={value} detail="organisation signal" />)}</section><DataPanel title="Search activity" eyebrow="Evidence filters"><form className="filter-row" onSubmit={search}><SelectField label="Actor role" compact value={filters.actor_role} onChange={(value) => setFilters({ ...filters, actor_role: value })} options={[['', 'All roles'], ...Object.keys(roleNames).map((role) => [role, roleNames[role]])]} /><Field label="Entity type" compact value={filters.entity_type} onChange={(value) => setFilters({ ...filters, entity_type: value })} /><Field label="Action contains" compact value={filters.action} onChange={(value) => setFilters({ ...filters, action: value })} /><Field label="Outcome contains" compact value={filters.outcome} onChange={(value) => setFilters({ ...filters, outcome: value })} /><button className="secondary-button">{busy ? 'Searching…' : 'Search'}</button></form></DataPanel><DataPanel title="Activity stream" eyebrow={`${rows.length} records`}><Table headers={['When', 'Actor', 'Action', 'Entity', 'Change']} rows={rows.map((entry) => [dateText(entry.created_at), `User #${entry.actor_user_id}`, entry.action, `${entry.entity_type} · ${entry.entity_id}`, entry.changes || 'No change payload'])} empty="No audit records match these filters." /></DataPanel></PageFrame>
}

function VehiclesPage({ token, data, refresh, query }) {
  const [showForm, setShowForm] = useState(false)
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [assignableMembers, setAssignableMembers] = useState([])
  const [teamRoster, setTeamRoster] = useState({ members: [] })
  const [driverByVehicle, setDriverByVehicle] = useState({})
  const [form, setForm] = useState({ registration_number: '', model: '', vehicle_type: 'Bus', depot: '', status: 'Idle / parked', health: 100, odometer_km: 0, driver_name: '' })
  useEffect(() => {
    getTeamRoster(token).then(setTeamRoster).catch((error) => refresh(error.message))
  }, [token])
  const rows = data.vehicles.filter((vehicle) => JSON.stringify(vehicle).toLowerCase().includes(query))
  async function submit(event) { event.preventDefault(); try { await createVehicle(token, { ...form, health: Number(form.health), odometer_km: Number(form.odometer_km), assigned_driver_id: null }); setShowForm(false); refresh('Vehicle added to the register.') } catch (error) { refresh(error.message) } }
  function beginEdit(vehicle) { setEditing(vehicle.id); setEditForm({ model: vehicle.model, vehicle_type: vehicle.vehicle_type, depot: vehicle.depot, status: vehicle.status, health: vehicle.health, odometer_km: vehicle.odometer_km }) }
  async function saveEdit(event) { event.preventDefault(); try { await updateVehicle(token, editing, { ...editForm, health: Number(editForm.health), odometer_km: Number(editForm.odometer_km) }); setEditing(null); refresh('Vehicle details updated.') } catch (error) { refresh(error.message) } }
  async function assignDriver(vehicleId) {
    const driverId = driverByVehicle[vehicleId]
    if (!driverId) return
    try {
      await assignVehicleDriverApi(token, vehicleId, Number(driverId))
      setDriverByVehicle((current) => ({ ...current, [vehicleId]: '' }))
      refresh('Driver assigned to vehicle.')
    } catch (error) {
      refresh(error.message)
    }
  }
  const drivers = teamRoster.members?.filter((member) => member.role === 'driver') || []
  async function update(id, status) { try { if (status === 'Out of service' && window.confirm('Delete this vehicle? This requires no dependent records.')) await deleteVehicle(token, id); else await updateVehicle(token, id, { status }); refresh(status === 'Out of service' ? 'Vehicle deleted.' : 'Vehicle status updated.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="01 · Fleet operations" title="Vehicle register" description="One identity record for registration, depot, current odometer, readiness, and driver context."><div className="page-toolbar"><div><strong>{data.vehicles.length} fleet assets</strong><span>{data.vehicles.filter((vehicle) => vehicle.status !== 'Out of service').length} available in operating picture</span></div><button className="primary-button" onClick={() => setShowForm(!showForm)}>{showForm ? 'Close form' : 'Add vehicle'}</button></div>{showForm && <FormCard title="Add a vehicle" description="Start the lifecycle record with the identifiers your operations team already uses."><form className="form-grid" onSubmit={submit}><Field label="Registration number" value={form.registration_number} onChange={(value) => setForm({ ...form, registration_number: value })} required /><Field label="Model" value={form.model} onChange={(value) => setForm({ ...form, model: value })} required /><SelectField label="Vehicle type" value={form.vehicle_type} onChange={(value) => setForm({ ...form, vehicle_type: value })} options={['Bus', 'Truck', 'LCV', 'Car', 'Other'].map((value) => [value, value])} /><Field label="Depot" value={form.depot} onChange={(value) => setForm({ ...form, depot: value })} required /><Field label="Opening odometer (km)" type="number" value={form.odometer_km} onChange={(value) => setForm({ ...form, odometer_km: value })} required /><button className="primary-button">Create vehicle</button></form></FormCard>}{editing && <FormCard title="Edit vehicle" description="Update operational details. Registration numbers remain the vehicle identity."><form className="form-grid" onSubmit={saveEdit}><Field label="Model" value={editForm.model} onChange={(value) => setEditForm({ ...editForm, model: value })} required /><SelectField label="Vehicle type" value={editForm.vehicle_type} onChange={(value) => setEditForm({ ...editForm, vehicle_type: value })} options={['Bus', 'Truck', 'LCV', 'Car', 'Other'].map((value) => [value, value])} /><Field label="Depot" value={editForm.depot} onChange={(value) => setEditForm({ ...editForm, depot: value })} required /><SelectField label="Status" value={editForm.status} onChange={(value) => setEditForm({ ...editForm, status: value })} options={['Idle / parked', 'On route', 'In workshop', 'Out of service', 'Retired'].map((value) => [value, value])} /><Field label="Health" type="number" value={editForm.health} onChange={(value) => setEditForm({ ...editForm, health: value })} required /><Field label="Odometer (km)" type="number" value={editForm.odometer_km} onChange={(value) => setEditForm({ ...editForm, odometer_km: value })} required /><div className="row-actions"><button className="primary-button">Save changes</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button></div></form></FormCard>}<div className="vehicle-grid">{rows.map((vehicle) => <article className="vehicle-card" key={vehicle.id}><div className="card-top"><span className={`status ${vehicle.status === 'Out of service' ? 'bad' : vehicle.status === 'In workshop' ? 'warn' : 'good'}`}>{vehicle.status}</span><span className="vehicle-id">#{vehicle.id}</span></div><h3>{vehicle.registration_number}</h3><p>{vehicle.model} · {vehicle.vehicle_type}</p><div className="vehicle-data"><span><small>Depot</small><b>{vehicle.depot}</b></span><span><small>Odometer</small><b>{Number(vehicle.odometer_km).toLocaleString('en-IN')} km</b></span><span><small>Health</small><b>{vehicle.health}%</b></span></div><div className="card-actions"><SelectInline value={vehicle.status} onChange={(value) => update(vehicle.id, value)} options={['Idle / parked', 'On route', 'In workshop', 'Out of service']} /><button className="table-action" onClick={() => beginEdit(vehicle)}>Edit</button></div><div className="card-actions"><select aria-label={`Assign driver to ${vehicle.registration_number}`} value={driverByVehicle[vehicle.id] || ''} onChange={(event) => setDriverByVehicle({ ...driverByVehicle, [vehicle.id]: event.target.value })}><option value="">Assign driver to this vehicle…</option>{drivers.map((driver) => <option key={driver.id} value={driver.id}>{driver.full_name}</option>)}</select><button className="table-action" disabled={!driverByVehicle[vehicle.id]} onClick={() => assignDriver(vehicle.id)}>Assign</button></div></article>)}</div><EmptyState visible={!rows.length} title="No vehicle records found" text={query ? 'Try a different search term.' : 'Add the first vehicle to start the operating picture.'} /></PageFrame>
}

function MaintenancePage({ token, data, refresh, query }) {
  const [tab, setTab] = useState('work')
  const [boardStats, setBoardStats] = useState(null)
  const [form, setForm] = useState({ vehicle_id: '', title: '', description: '', priority: 'Medium', due_date: today(), assigned_to: '' })
  const [editing, setEditing] = useState(null)
  const [editForm, setEditForm] = useState({})
  const [plan, setPlan] = useState({ vehicle_id: '', name: '', interval_km: '', interval_days: '', next_due_km: '', next_due_on: today() })
  const [component, setComponent] = useState({ vehicle_id: '', name: '', component_type: '', installed_at_km: 0, service_interval_km: '', alert_threshold_km: '' })
  const [editingComponent, setEditingComponent] = useState(null)
  const [componentEditForm, setComponentEditForm] = useState({})
  async function createWork(event) { event.preventDefault(); try { await createWorkOrder(token, { ...form, vehicle_id: Number(form.vehicle_id), assigned_user_id: null }); refresh('Work order dispatched.'); setForm({ ...form, title: '', description: '' }) } catch (error) { refresh(error.message) } }
  useEffect(() => {
    getAssignableMembers(token).then(setAssignableMembers).catch((error) => refresh(error.message))
  }, [token])
  async function createPlan(event) { event.preventDefault(); try { await createMaintenancePlan(token, { ...plan, vehicle_id: Number(plan.vehicle_id), interval_km: plan.interval_km ? Number(plan.interval_km) : null, interval_days: plan.interval_days ? Number(plan.interval_days) : null, next_due_km: plan.next_due_km ? Number(plan.next_due_km) : null }); refresh('Maintenance plan created.') } catch (error) { refresh(error.message) } }
  async function createComp(event) { event.preventDefault(); try { await createComponent(token, { ...component, vehicle_id: Number(component.vehicle_id), installed_at_km: Number(component.installed_at_km), service_interval_km: component.service_interval_km ? Number(component.service_interval_km) : null, alert_threshold_km: component.alert_threshold_km ? Number(component.alert_threshold_km) : null, next_service_km: component.service_interval_km ? Number(component.installed_at_km) + Number(component.service_interval_km) : null, next_alert_km: component.alert_threshold_km ? Number(component.installed_at_km) + Number(component.alert_threshold_km) : null }); refresh('Component lifecycle record created.') } catch (error) { refresh(error.message) } }
  function beginComponentEdit(item) { setEditingComponent(item.id); setComponentEditForm({ name: item.name, component_type: item.component_type, serial_number: item.serial_number || '', installed_at_km: item.installed_at_km, service_interval_km: item.service_interval_km || '', alert_threshold_km: item.alert_threshold_km || '', status: item.status || 'Healthy' }) }
  async function saveComponentEdit(event) {
    event.preventDefault()
    try {
      const installedAt = Number(componentEditForm.installed_at_km)
      const interval = componentEditForm.service_interval_km ? Number(componentEditForm.service_interval_km) : null
      const threshold = componentEditForm.alert_threshold_km ? Number(componentEditForm.alert_threshold_km) : null
      await updateComponent(token, editingComponent, {
        name: componentEditForm.name,
        component_type: componentEditForm.component_type,
        serial_number: componentEditForm.serial_number || null,
        installed_at_km: installedAt,
        service_interval_km: interval,
        alert_threshold_km: threshold,
        next_service_km: interval ? installedAt + interval : null,
        next_alert_km: threshold ? installedAt + threshold : null,
        status: componentEditForm.status,
      })
      setEditingComponent(null)
      refresh('Component details updated.')
    } catch (error) {
      refresh(error.message)
    }
  }
  async function transition(order, action) { try { if (action === 'start') await startWorkOrder(token, order.id); if (action === 'complete') await completeWorkOrder(token, order.id); if (action === 'approve') await approveWorkOrder(token, order.id); if (action === 'archive') await archiveWorkOrder(token, order.id); refresh('Work order updated.') } catch (error) { refresh(error.message) } }
  function beginEdit(order) { setEditing(order.id); setEditForm({ title: order.title, description: order.description || '', priority: order.priority, due_date: order.due_date || '', assigned_user_id: order.assigned_user_id ? String(order.assigned_user_id) : '' }) }
  async function saveEdit(event) {
    event.preventDefault()
    try {
      await updateWorkOrder(token, editing, {
        title: editForm.title,
        description: editForm.description,
        priority: editForm.priority,
        due_date: editForm.due_date,
      })
      await assignWorkOrderApi(token, editing, editForm.assigned_user_id ? Number(editForm.assigned_user_id) : null)
      setEditing(null)
      refresh('Work order details updated.')
    } catch (error) {
      refresh(error.message)
    }
  }
  const work = data.workOrders.filter((order) => JSON.stringify(order).toLowerCase().includes(query))
  useEffect(() => {
    let active = true
    Promise.all([getWorkOrderBoard(token), getWorkOrderBoardStats(token)])
      .then(([, stats]) => { if (active) setBoardStats(stats) })
      .catch((error) => refresh(error.message))
    return () => { active = false }
  }, [token])
  return (
    <PageFrame eyebrow="02 · Fleet operations" title="Maintenance command" description="Plan preventive work, dispatch repairs, track execution, and close component lifecycles.">
      <div className="tabs">
        {[['work', 'Work orders'], ['plans', 'Preventive plans'], ['components', 'Components']].map(([id, label]) => (
          <button className={tab === id ? 'tab active' : 'tab'} key={id} onClick={() => setTab(id)}>{label}</button>
        ))}
      </div>
      {tab === 'work' && (
        <>
          <FormCard title="Dispatch work" description="Fleet Managers create work and assign it from the Fleet command workspace.">
            <form className="form-grid" onSubmit={createWork}>
              <SelectField label="Vehicle" value={form.vehicle_id} onChange={(value) => setForm({ ...form, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), `${vehicle.registration_number} · ${vehicle.model}`])]} required />
              <Field label="Work title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
              <SelectField label="Priority" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={['Low', 'Medium', 'High', 'Critical'].map((value) => [value, value])} />
              <Field label="Due date" type="date" value={form.due_date} onChange={(value) => setForm({ ...form, due_date: value })} />
              <TextField label="Scope and instructions" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
              <button className="primary-button">Create work order</button>
            </form>
          </FormCard>
          <DataPanel title="Maintenance board" eyebrow={`${work.length} work orders`}>
            <Table headers={['Work', 'Vehicle', 'Priority', 'Due', 'Status', 'Action']} rows={work.map((order) => [
              <span><strong>{order.title}</strong><small>{order.description || 'No extra instructions'}</small></span>,
              data.vehicles.find((vehicle) => vehicle.id === order.vehicle_id)?.registration_number || `Vehicle #${order.vehicle_id}`,
              order.priority,
              dateText(order.due_date),
              <span className={`status ${order.status === 'Completed' ? 'good' : 'warn'}`}>{order.status}</span>,
              <div className="row-actions"><button className="table-action" onClick={() => beginEdit(order)}>Edit</button>{order.status === 'Open' && <button className="table-action" onClick={() => transition(order, 'start')}>Start</button>}{['In progress', 'REWORK'].includes(order.status) && <button className="table-action" onClick={() => transition(order, 'complete')}>Submit review</button>}{['Ready for review', 'READY_FOR_REVIEW'].includes(order.status) && <button className="table-action" onClick={() => transition(order, 'approve')}>Approve</button>}</div>
            ])} empty="No work orders have been dispatched." />
          </DataPanel>
        </>
      )}
      {tab === 'plans' && (
        <FormCard title="Preventive maintenance plan" description="Set a service horizon by kilometres, days, or both.">
          <form className="form-grid" onSubmit={createPlan}>
            <SelectField label="Vehicle" value={plan.vehicle_id} onChange={(value) => setPlan({ ...plan, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required />
            <Field label="Plan name" value={plan.name} onChange={(value) => setPlan({ ...plan, name: value })} required />
            <Field label="Interval kilometres" type="number" value={plan.interval_km} onChange={(value) => setPlan({ ...plan, interval_km: value })} />
            <Field label="Interval days" type="number" value={plan.interval_days} onChange={(value) => setPlan({ ...plan, interval_days: value })} />
            <Field label="Next due kilometres" type="number" value={plan.next_due_km} onChange={(value) => setPlan({ ...plan, next_due_km: value })} />
            <button className="primary-button">Save maintenance plan</button>
          </form>
        </FormCard>
      )}
      {tab === 'components' && (
        <>
          <FormCard title="Component lifecycle" description="Set the component life and the earlier odometer threshold that should alert Fleet Manager.">
            <form className="form-grid" onSubmit={createComp}>
              <SelectField label="Vehicle" value={component.vehicle_id} onChange={(value) => setComponent({ ...component, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required />
              <Field label="Component name" value={component.name} onChange={(value) => setComponent({ ...component, name: value })} required />
              <Field label="Component type" value={component.component_type} onChange={(value) => setComponent({ ...component, component_type: value })} required />
              <Field label="Installed at km" type="number" value={component.installed_at_km} onChange={(value) => setComponent({ ...component, installed_at_km: value })} />
              <Field label="Component life km" type="number" value={component.service_interval_km} onChange={(value) => setComponent({ ...component, service_interval_km: value })} required />
              <Field label="Alert threshold km" type="number" value={component.alert_threshold_km} onChange={(value) => setComponent({ ...component, alert_threshold_km: value })} required />
              <button className="primary-button">Add component</button>
            </form>
          </FormCard>
          <DataPanel title="Component register" eyebrow={`${data.components.length} tracked components`}>
            <Table headers={['Component', 'Vehicle', 'Alert threshold', 'Next service', 'Status', 'Action']} rows={data.components.map((item) => [
              <span><strong>{item.name}</strong><small>{item.component_type}</small></span>,
              data.vehicles.find((vehicle) => vehicle.id === item.vehicle_id)?.registration_number || `#${item.vehicle_id}`,
              `${item.next_alert_km || '—'} km`,
              `${item.next_service_km || '—'} km`,
              item.status,
              <div className="row-actions"><button className="table-action" onClick={() => beginComponentEdit(item)}>Edit</button><button className="table-action" onClick={async () => { try { await completeComponentService(token, item.id, data.vehicles.find((vehicle) => vehicle.id === item.vehicle_id)?.odometer_km || 0); refresh('Component service completed and lifecycle reset.') } catch (error) { refresh(error.message) } }}>Complete service</button></div>
            ])} empty="No component lifecycle records exist." />
          </DataPanel>
        </>
      )}
      {editingComponent && <FormCard title="Edit component" description="Update the component identity and lifecycle thresholds."><form className="form-grid" onSubmit={saveComponentEdit}><Field label="Component name" value={componentEditForm.name} onChange={(value) => setComponentEditForm({ ...componentEditForm, name: value })} required /><Field label="Component type" value={componentEditForm.component_type} onChange={(value) => setComponentEditForm({ ...componentEditForm, component_type: value })} required /><Field label="Serial number" value={componentEditForm.serial_number} onChange={(value) => setComponentEditForm({ ...componentEditForm, serial_number: value })} /><Field label="Installed at km" type="number" value={componentEditForm.installed_at_km} onChange={(value) => setComponentEditForm({ ...componentEditForm, installed_at_km: value })} required /><Field label="Component life km" type="number" value={componentEditForm.service_interval_km} onChange={(value) => setComponentEditForm({ ...componentEditForm, service_interval_km: value })} /><Field label="Alert threshold km" type="number" value={componentEditForm.alert_threshold_km} onChange={(value) => setComponentEditForm({ ...componentEditForm, alert_threshold_km: value })} /><SelectField label="Status" value={componentEditForm.status} onChange={(value) => setComponentEditForm({ ...componentEditForm, status: value })} options={['Healthy', 'Due soon', 'Due', 'Replaced', 'Retired'].map((value) => [value, value])} /><div className="row-actions"><button className="primary-button">Save changes</button><button type="button" className="secondary-button" onClick={() => setEditingComponent(null)}>Cancel</button></div></form></FormCard>}
      {editing && <FormCard title="Edit work order" description="Update planning details and assign the existing order to a mechanic or technician."><form className="form-grid" onSubmit={saveEdit}><Field label="Work title" value={editForm.title} onChange={(value) => setEditForm({ ...editForm, title: value })} required /><SelectField label="Priority" value={editForm.priority} onChange={(value) => setEditForm({ ...editForm, priority: value })} options={['Low', 'Medium', 'High', 'Critical'].map((value) => [value, value])} /><Field label="Due date" type="date" value={editForm.due_date} onChange={(value) => setEditForm({ ...editForm, due_date: value })} /><SelectField label="Assign to mechanic or technician" value={editForm.assigned_user_id || ''} onChange={(value) => setEditForm({ ...editForm, assigned_user_id: value })} options={[['', 'Leave unassigned'], ...assignableMembers.map((member) => [String(member.id), `${member.full_name} · ${roleNames[member.role] || member.role}`])]} /><TextField label="Scope and instructions" value={editForm.description} onChange={(value) => setEditForm({ ...editForm, description: value })} /><div className="row-actions"><button className="primary-button">Save changes</button><button type="button" className="secondary-button" onClick={() => setEditing(null)}>Cancel</button></div></form></FormCard>}
    </PageFrame>
  )
}

function CompliancePage({ token, data, refresh, query }) {
  const [form, setForm] = useState({ vehicle_id: '', name: '', document_type: 'Fitness', issued_by: '', expires_on: today(), status: 'Valid' })
  const [files, setFiles] = useState({})
  async function submit(event) { event.preventDefault(); try { await createDocument(token, { ...form, vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null }); setForm({ ...form, name: '', issued_by: '' }); refresh('Compliance document added.') } catch (error) { refresh(error.message) } }
  async function upload(documentId) { const file = files[documentId]; if (!file) return; try { await uploadDocumentFile(token, documentId, file); setFiles((current) => ({ ...current, [documentId]: null })); refresh('Document file uploaded.') } catch (error) { refresh(error.message) } }
  const docs = data.documents.filter((item) => JSON.stringify(item).toLowerCase().includes(query))
  return <PageFrame eyebrow="03 · Fleet operations" title="Compliance vault" description="Keep fitness, insurance, PUC, permits, and other expiry-bound evidence attached to the correct vehicle."><FormCard title="Add compliance record" description="Create metadata first, then attach a file from the document row."><form className="form-grid" onSubmit={submit}><SelectField label="Vehicle" value={form.vehicle_id} onChange={(value) => setForm({ ...form, vehicle_id: value })} options={[['', 'Organisation-level'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} /><Field label="Document name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required /><SelectField label="Type" value={form.document_type} onChange={(value) => setForm({ ...form, document_type: value })} options={['Fitness', 'Insurance', 'PUC', 'Permit', 'Tax', 'Other'].map((value) => [value, value])} /><Field label="Issued by" value={form.issued_by} onChange={(value) => setForm({ ...form, issued_by: value })} /><Field label="Expires on" type="date" value={form.expires_on} onChange={(value) => setForm({ ...form, expires_on: value })} required /><button className="primary-button">Save document</button></form></FormCard><DataPanel title="Document vault" eyebrow={`${docs.length} records`}><Table headers={['Document', 'Vehicle', 'Expires', 'Status', 'File actions']} rows={docs.map((item) => [<span><strong>{item.name}</strong><small>{item.document_type} · {item.issued_by || 'Issuer not recorded'}</small></span>, item.vehicle_id ? data.vehicles.find((vehicle) => vehicle.id === item.vehicle_id)?.registration_number || `#${item.vehicle_id}` : 'Organisation', dateText(item.expires_on), <span className={`status ${item.status === 'Valid' ? 'good' : 'warn'}`}>{item.status}</span>, <div className="row-actions"><input type="file" accept="image/*,application/pdf" onChange={(event) => setFiles((current) => ({ ...current, [item.id]: event.target.files?.[0] || null }))} /><button className="table-action" disabled={!files[item.id]} onClick={() => upload(item.id)}>Upload</button>{item.file_key && <button className="table-action" onClick={async () => { try { await downloadFile(token, `/api/v1/documents/${item.id}/file`, `${item.name}.file`); refresh('Document download started.') } catch (error) { refresh(error.message) } }}>Download</button>}<button className="table-action" onClick={async () => { try { await updateDocument(token, item.id, { status: item.status === 'Valid' ? 'Archived' : 'Valid' }); refresh('Document status updated.') } catch (error) { refresh(error.message) } }}>Toggle status</button></div>])} empty="No compliance documents have been entered." /></DataPanel></PageFrame>
}

function FleetAnalyticsPanel({ analytics }) {
  if (!analytics) return null
  return <DataPanel title="Fleet intelligence" eyebrow={`${analytics.vehicles?.length || 0} vehicles analysed`}><Table headers={['Vehicle', 'Maintenance cost', 'Cost / km', 'Downtime', 'Odometer']} rows={(analytics.vehicles || []).map((item) => [`#${item.vehicle_id}`, money(item.maintenance_cost_paise), money(item.cost_per_km_paise), `${item.downtime_days} days`, `${item.odometer_km} km`])} empty="No vehicle analytics are available yet." /><p className="muted">Odometer anomalies flagged: {analytics.odometer_anomalies || 0}</p></DataPanel>
}

function TelematicsPage({ token, data, refresh }) {
  const [integration, setIntegration] = useState({ provider: 'Intangles', base_url: '', sync_path: '/readings', credential_ref: '', sync_interval_minutes: 1440 })
  const [device, setDevice] = useState({ vehicle_id: '', provider: 'Intangles', device_identifier: '' })
  async function addIntegration(event) { event.preventDefault(); try { await createTelematicsIntegration(token, { ...integration, sync_interval_minutes: Number(integration.sync_interval_minutes) }); refresh('Telematics provider connected.') } catch (error) { refresh(error.message) } }
  async function addDevice(event) { event.preventDefault(); try { await createTelematicsDevice(token, { ...device, vehicle_id: Number(device.vehicle_id), active: true }); refresh('GPS device registered.') } catch (error) { refresh(error.message) } }
  async function sync() { try { await syncDueTelematics(token); refresh('Due odometer sync requested.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="04 · Fleet operations" title="GPS & odometer" description="Connect Intangles or another provider, register devices, and keep the fleet manager's daily odometer picture current."><div className="telematics-callout"><div><span className="overline">Provider-neutral boundary</span><h3>Credentials stay server-side.</h3><p>VahanSync stores the provider reference and sync state without exposing secrets in the browser.</p></div><button className="primary-button" onClick={sync}>Run due sync</button></div><div className="stat-grid"><Metric label="Active integrations" value={data.telematicsHealth?.active_integrations ?? '—'} detail={`${data.telematicsHealth?.stale_integrations ?? 0} stale`} tone="blue" /><Metric label="Active devices" value={data.telematicsHealth?.active_devices ?? '—'} detail={`${data.telematicsHealth?.stale_devices ?? 0} stale`} tone="green" /><Metric label="Readings / 24h" value={data.telematicsHealth?.readings_last_24h ?? '—'} detail={`${data.telematicsHealth?.flagged_odometer_readings ?? 0} odometer flags`} tone="amber" /></div><div className="split-grid"><FormCard title="Connect provider" description="Use the provider's API base URL and a server-side credential reference."><form className="stack-form" onSubmit={addIntegration}><Field label="Provider" value={integration.provider} onChange={(value) => setIntegration({ ...integration, provider: value })} required /><Field label="Base URL" type="url" value={integration.base_url} onChange={(value) => setIntegration({ ...integration, base_url: value })} placeholder="https://api.provider.com" required /><Field label="Readings path" value={integration.sync_path} onChange={(value) => setIntegration({ ...integration, sync_path: value })} required /><Field label="Credential reference" value={integration.credential_ref} onChange={(value) => setIntegration({ ...integration, credential_ref: value })} /><Field label="Sync interval (minutes)" type="number" value={integration.sync_interval_minutes} onChange={(value) => setIntegration({ ...integration, sync_interval_minutes: value })} /><button className="primary-button">Save integration</button></form></FormCard><FormCard title="Register device" description="Attach a provider device to a vehicle so readings can advance the odometer monotonically."><form className="stack-form" onSubmit={addDevice}><SelectField label="Vehicle" value={device.vehicle_id} onChange={(value) => setDevice({ ...device, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required /><Field label="Provider" value={device.provider} onChange={(value) => setDevice({ ...device, provider: value })} required /><Field label="Device identifier" value={device.device_identifier} onChange={(value) => setDevice({ ...device, device_identifier: value })} required /><button className="primary-button">Register device</button></form></FormCard></div><div className="split-grid"><DataPanel title="Connected providers" eyebrow={`${data.integrations.length} integrations`}><Table headers={['Provider', 'Endpoint', 'Last sync', 'Status']} rows={data.integrations.map((item) => [item.provider, item.base_url, dateText(item.last_synced_at), item.last_sync_status || 'Not synced'])} empty="No GPS providers connected." /></DataPanel><DataPanel title="Device registry" eyebrow={`${data.devices.length} devices`}><Table headers={['Vehicle', 'Provider', 'Device', 'Last seen']} rows={data.devices.map((item) => [data.vehicles.find((vehicle) => vehicle.id === item.vehicle_id)?.registration_number || `#${item.vehicle_id}`, item.provider, item.device_identifier, dateText(item.last_seen_at)])} empty="No devices registered." /></DataPanel></div></PageFrame>
}

function InventoryPage({ token, data, refresh, query }) {
  const [tab, setTab] = useState('parts')
  const [inventorySummary, setInventorySummary] = useState(null)
  const [part, setPart] = useState({ sku: '', name: '', category: '', quantity_on_hand: 0, reorder_level: 0, unit_cost_paise: 0, supplier: '' })
  const [location, setLocation] = useState({ name: '', code: '', address: '' })
  const [movement, setMovement] = useState({ part_id: '', location_id: '', transaction_type: 'receipt', quantity: 1, reference: '' })
  async function addPart(event) { event.preventDefault(); try { await createPart(token, { ...part, quantity_on_hand: Number(part.quantity_on_hand), reorder_level: Number(part.reorder_level), unit_cost_paise: Number(part.unit_cost_paise) }); refresh('Part added to catalogue.') } catch (error) { refresh(error.message) } }
  async function addLocation(event) { event.preventDefault(); try { await createStockLocation(token, location); refresh('Stock location added.') } catch (error) { refresh(error.message) } }
  async function move(event) { event.preventDefault(); try { await createInventoryMovement(token, { ...movement, part_id: Number(movement.part_id), location_id: Number(movement.location_id), quantity: Number(movement.quantity) }); refresh('Inventory movement recorded.') } catch (error) { refresh(error.message) } }
  const parts = data.parts.filter((item) => JSON.stringify(item).toLowerCase().includes(query))
  useEffect(() => {
    let active = true
    getInventorySummary(token)
      .then((summary) => { if (active) setInventorySummary(summary) })
      .catch((error) => refresh(error.message))
    return () => { active = false }
  }, [token])
  return <PageFrame eyebrow="01 · Workshop control" title="Parts & stock" description="Know what is available, where it lives, why it moved, and which part needs a reorder decision."><div className="tabs">{[['parts', 'Catalogue'], ['locations', 'Locations'], ['movement', 'Movement']].map(([id, label]) => <button className={tab === id ? 'tab active' : 'tab'} key={id} onClick={() => setTab(id)}>{label}</button>)}</div>{tab === 'parts' && <><FormCard title="Add catalogue item" description="Unit cost is stored in paise for precise finance handoff."><form className="form-grid" onSubmit={addPart}><Field label="SKU" value={part.sku} onChange={(value) => setPart({ ...part, sku: value })} required /><Field label="Part name" value={part.name} onChange={(value) => setPart({ ...part, name: value })} required /><Field label="Category" value={part.category} onChange={(value) => setPart({ ...part, category: value })} required /><Field label="Opening quantity" type="number" value={part.quantity_on_hand} onChange={(value) => setPart({ ...part, quantity_on_hand: value })} /><Field label="Reorder level" type="number" value={part.reorder_level} onChange={(value) => setPart({ ...part, reorder_level: value })} /><Field label="Unit cost (paise)" type="number" value={part.unit_cost_paise} onChange={(value) => setPart({ ...part, unit_cost_paise: value })} /><Field label="Supplier" value={part.supplier} onChange={(value) => setPart({ ...part, supplier: value })} /><button className="primary-button">Create part</button></form></FormCard><DataPanel title="Parts catalogue" eyebrow={`${parts.length} items`}><Table headers={['Part', 'Category', 'On hand', 'Reorder at', 'Unit cost', 'Supplier']} rows={parts.map((item) => [<span><strong>{item.name}</strong><small>{item.sku}</small></span>, item.category, <span className={item.quantity_on_hand <= item.reorder_level ? 'number bad' : 'number'}>{item.quantity_on_hand}</span>, item.reorder_level, money(item.unit_cost_paise), item.supplier || '—'])} empty="No parts have been catalogued." /></DataPanel></>}{tab === 'locations' && <><FormCard title="Add stock location" description="Make bins, depots, and workshop stores explicit."><form className="form-grid" onSubmit={addLocation}><Field label="Location name" value={location.name} onChange={(value) => setLocation({ ...location, name: value })} required /><Field label="Code" value={location.code} onChange={(value) => setLocation({ ...location, code: value })} required /><Field label="Address" value={location.address} onChange={(value) => setLocation({ ...location, address: value })} /><button className="primary-button">Create location</button></form></FormCard><DataPanel title="Location register" eyebrow={`${data.locations.length} locations`}><Table headers={['Name', 'Code', 'Address', 'Status']} rows={data.locations.map((item) => [item.name, item.code, item.address || '—', item.active ? <span className="status good">Active</span> : <span className="status bad">Inactive</span>])} empty="No stock locations have been defined." /></DataPanel></>}{tab === 'movement' && <><FormCard title="Record movement" description="Every receipt, issue, or adjustment keeps a reason and location reference."><form className="form-grid" onSubmit={move}><SelectField label="Part" value={movement.part_id} onChange={(value) => setMovement({ ...movement, part_id: value })} options={[['', 'Select part'], ...data.parts.map((item) => [String(item.id), `${item.sku} · ${item.name}`])]} required /><SelectField label="Location" value={movement.location_id} onChange={(value) => setMovement({ ...movement, location_id: value })} options={[['', 'Select location'], ...data.locations.map((item) => [String(item.id), item.name])]} required /><SelectField label="Movement type" value={movement.transaction_type} onChange={(value) => setMovement({ ...movement, transaction_type: value })} options={['receipt', 'issue', 'adjustment'].map((value) => [value, value])} /><Field label="Quantity" type="number" value={movement.quantity} onChange={(value) => setMovement({ ...movement, quantity: value })} /><Field label="Reference / reason" value={movement.reference} onChange={(value) => setMovement({ ...movement, reference: value })} /><button className="primary-button">Record movement</button></form></FormCard><DataPanel title="Movement history" eyebrow="Latest stock events"><p className="empty-copy">Movement history is available from the API and will appear here after the first recorded receipt, issue, or adjustment.</p></DataPanel></>}</PageFrame>
}

function ProcurementPage({ token, data, refresh }) {
  const [vendor, setVendor] = useState({ name: '', vendor_type: 'Parts supplier', gstin: '', contact_name: '', phone: '', email: '', address: '' })
  const [order, setOrder] = useState({ vendor_id: '', part_id: '', quantity: 1, unit_cost_paise: 0, expected_on: today(), notes: '' })
  async function addVendor(event) { event.preventDefault(); try { await createVendor(token, vendor); refresh('Vendor added.') } catch (error) { refresh(error.message) } }
  async function addOrder(event) { event.preventDefault(); try { await createPurchaseOrder(token, { vendor_id: Number(order.vendor_id), expected_on: order.expected_on, notes: order.notes, lines: [{ part_id: Number(order.part_id), quantity: Number(order.quantity), unit_cost_paise: Number(order.unit_cost_paise) }] }); refresh('Purchase order created.') } catch (error) { refresh(error.message) } }
  async function changeStatus(id, status) { try { await updatePurchaseOrder(token, id, status); refresh('Purchase order status updated.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="02 · Workshop control" title="Procurement" description="Maintain supplier context, create purchase orders, and keep receiving decisions visible to inventory and finance."><div className="split-grid"><FormCard title="Vendor register" description="Store GST and contact context for every supplier relationship."><form className="stack-form" onSubmit={addVendor}><Field label="Vendor name" value={vendor.name} onChange={(value) => setVendor({ ...vendor, name: value })} required /><Field label="Vendor type" value={vendor.vendor_type} onChange={(value) => setVendor({ ...vendor, vendor_type: value })} required /><Field label="GSTIN" value={vendor.gstin} onChange={(value) => setVendor({ ...vendor, gstin: value })} /><Field label="Contact person" value={vendor.contact_name} onChange={(value) => setVendor({ ...vendor, contact_name: value })} /><Field label="Phone" value={vendor.phone} onChange={(value) => setVendor({ ...vendor, phone: value })} /><Field label="Email" type="email" value={vendor.email} onChange={(value) => setVendor({ ...vendor, email: value })} /><button className="primary-button">Add vendor</button></form></FormCard><FormCard title="Create purchase order" description="Start with one line; additional lines remain available through the backend API."><form className="stack-form" onSubmit={addOrder}><SelectField label="Vendor" value={order.vendor_id} onChange={(value) => setOrder({ ...order, vendor_id: value })} options={[['', 'Select vendor'], ...data.vendors.map((item) => [String(item.id), item.name])]} required /><SelectField label="Part" value={order.part_id} onChange={(value) => setOrder({ ...order, part_id: value })} options={[['', 'Select part'], ...data.parts.map((item) => [String(item.id), `${item.sku} · ${item.name}`])]} required /><Field label="Quantity" type="number" value={order.quantity} onChange={(value) => setOrder({ ...order, quantity: value })} /><Field label="Unit cost (paise)" type="number" value={order.unit_cost_paise} onChange={(value) => setOrder({ ...order, unit_cost_paise: value })} /><Field label="Expected on" type="date" value={order.expected_on} onChange={(value) => setOrder({ ...order, expected_on: value })} /><TextField label="Notes" value={order.notes} onChange={(value) => setOrder({ ...order, notes: value })} /><button className="primary-button">Create PO</button></form></FormCard></div><DataPanel title="Purchase orders" eyebrow={`${data.purchaseOrders.length} orders`}><Table headers={['Order', 'Vendor', 'Expected', 'Total', 'Status', 'Next action']} rows={data.purchaseOrders.map((item) => [item.order_number, data.vendors.find((vendor) => vendor.id === item.vendor_id)?.name || `Vendor #${item.vendor_id}`, dateText(item.expected_on), money(item.total_paise), <span className="status warn">{item.status}</span>, item.status === 'Draft' ? <button className="table-action" onClick={() => changeStatus(item.id, 'Submitted')}>Submit</button> : item.status === 'Submitted' ? <button className="table-action" onClick={() => changeStatus(item.id, 'Approved')}>Approve</button> : '—'])} empty="No purchase orders have been created." /></DataPanel></PageFrame>
}

function TechnicianPage({ token, data, refresh, query }) {
  const [selected, setSelected] = useState(null)
  const [checklist, setChecklist] = useState([])
  const [timeline, setTimeline] = useState([])
  const [notes, setNotes] = useState('')
  const [file, setFile] = useState(null)
  async function choose(order) { setSelected(order); try { const [loaded, history] = await Promise.all([getWorkOrderChecklist(token, order.id), getWorkOrderTimeline(token, order.id)]); setChecklist(loaded.length ? loaded : [{ title: 'Confirm safety isolation', completed: false, sort_order: 0 }, { title: 'Record parts and consumables', completed: false, sort_order: 1 }, { title: 'Verify return-to-service condition', completed: false, sort_order: 2 }]); setTimeline(history) } catch { setChecklist([]); setTimeline([]) } }
  async function save() { if (!selected) return; try { await updateWorkOrderChecklist(token, selected.id, checklist.map((item, index) => ({ title: item.title, completed: item.completed, sort_order: index }))); refresh('Checklist saved.') } catch (error) { refresh(error.message) } }
  async function complete() { if (!selected) return; try { await completeWorkOrder(token, selected.id); refresh('Work order submitted for review.') } catch (error) { refresh(error.message) } }
  async function upload() { if (!selected || !file) return; try { await uploadWorkOrderEvidence(token, selected.id, file); setFile(null); refresh('Repair evidence uploaded.') } catch (error) { refresh(error.message) } }
  const orders = data.workOrders.filter((order) => JSON.stringify(order).toLowerCase().includes(query))
  return <PageFrame eyebrow="01 · Field execution" title="Assigned work" description="Execute only the work assigned to you. Record checklist completion, repair notes, evidence, and a clean handoff to the Fleet Manager."><div className="execution-layout"><DataPanel title="My queue" eyebrow={`${orders.length} assigned records`}><div className="queue-list">{orders.map((order) => <button className={selected?.id === order.id ? 'queue-item active' : 'queue-item'} key={order.id} onClick={() => choose(order)}><span className="queue-marker">{order.priority?.[0] || 'M'}</span><span><strong>{order.title}</strong><small>Vehicle #{order.vehicle_id} · {order.priority} · {order.status}</small></span><b>→</b></button>)}{!orders.length && <EmptyState visible title="No assigned work" text="Your queue is clear. New work orders assigned to your role will appear here." />}</div></DataPanel><section className="execution-panel">{selected ? <><div className="panel-heading"><div><span className="overline">Execution record</span><h3>{selected.title}</h3><p>Vehicle #{selected.vehicle_id} · due {dateText(selected.due_date)}</p></div><span className="status warn">{selected.status}</span></div><div className="checklist"><strong>Checklist</strong>{checklist.map((item, index) => <label key={item.id || index}><input type="checkbox" checked={item.completed} onChange={(event) => setChecklist((items) => items.map((entry, itemIndex) => itemIndex === index ? { ...entry, completed: event.target.checked } : entry))} />{item.title}</label>)}<button className="secondary-button" onClick={save}>Save checklist</button></div><TextField label="Repair notes" value={notes} onChange={setNotes} /><div className="evidence-box"><strong>Evidence</strong><input type="file" accept="image/*,application/pdf" onChange={(event) => setFile(event.target.files?.[0] || null)} /><button className="secondary-button" disabled={!file} onClick={upload}>Upload evidence</button></div><button className="primary-button" onClick={complete}>Submit for review</button><DataPanel title="Handoff timeline" eyebrow={`${timeline.length} events`}><Table headers={['Action', 'Actor', 'Time']} rows={timeline.map((event) => [event.action, event.actor_user_id || 'System', dateText(event.created_at)])} empty="No handoff events recorded yet." /></DataPanel></> : <div className="empty-state"><strong>Select an assigned work order</strong><span>Execution details, checklist, evidence, and handoff controls will appear here.</span></div>}</section></div></PageFrame>
}

function DriverPage({ token, data, refresh }) {
  const [inspection, setInspection] = useState({ vehicle_id: '', inspection_type: 'pre_trip', status: 'SAFE', odometer_km: 0, notes: '' })
  const [issue, setIssue] = useState({ vehicle_id: '', title: '', detail: '', priority: 'Medium' })
  async function submitInspection(event) { event.preventDefault(); try { const result = await createDriverInspection(token, { ...inspection, vehicle_id: Number(inspection.vehicle_id), odometer_km: Number(inspection.odometer_km) }); refresh(result.queued ? 'Inspection saved offline and will sync when connected.' : 'Inspection recorded.') } catch (error) { refresh(error.message) } }
  async function submitIssue(event) { event.preventDefault(); try { const result = await createDriverIssue(token, { ...issue, vehicle_id: Number(issue.vehicle_id) }); refresh(result.queued ? 'Issue saved offline and will sync when connected.' : 'Vehicle issue escalated.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="01 · Driver safety" title="Daily checks" description="Start the day with a vehicle readiness record, an accurate odometer, and a clear escalation path for anything unsafe."><div className="driver-hero"><div><span className="overline">Assigned vehicle</span><h3>{data.vehicles[0]?.registration_number || 'No vehicle assigned'}</h3><p>{data.vehicles[0]?.model || 'Your Fleet Manager will assign a vehicle to this workspace.'}</p></div><div><span>Latest odometer</span><strong>{data.vehicles[0] ? `${Number(data.vehicles[0].odometer_km).toLocaleString('en-IN')} km` : '—'}</strong></div></div><div className="split-grid"><FormCard title="Record inspection" description="Pre-trip and post-trip checks remain part of the vehicle history."><form className="stack-form" onSubmit={submitInspection}><SelectField label="Vehicle" value={inspection.vehicle_id} onChange={(value) => setInspection({ ...inspection, vehicle_id: value })} options={[['', 'Select assigned vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required /><SelectField label="Inspection type" value={inspection.inspection_type} onChange={(value) => setInspection({ ...inspection, inspection_type: value })} options={[['pre_trip', 'Pre-trip'], ['post_trip', 'Post-trip']]} /><SelectField label="Readiness" value={inspection.status} onChange={(value) => setInspection({ ...inspection, status: value })} options={['SAFE', 'REVIEW', 'UNSAFE'].map((value) => [value, value])} /><Field label="Odometer (km)" type="number" value={inspection.odometer_km} onChange={(value) => setInspection({ ...inspection, odometer_km: value })} required /><TextField label="Notes" value={inspection.notes} onChange={(value) => setInspection({ ...inspection, notes: value })} /><button className="primary-button">Submit inspection</button></form></FormCard><FormCard title="Report an issue" description="Create a visible safety escalation for Fleet Manager and workshop teams."><form className="stack-form" onSubmit={submitIssue}><SelectField label="Vehicle" value={issue.vehicle_id} onChange={(value) => setIssue({ ...issue, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required /><Field label="Issue title" value={issue.title} onChange={(value) => setIssue({ ...issue, title: value })} required /><SelectField label="Priority" value={issue.priority} onChange={(value) => setIssue({ ...issue, priority: value })} options={['Low', 'Medium', 'High', 'Critical'].map((value) => [value, value])} /><TextField label="Describe the issue" value={issue.detail} onChange={(value) => setIssue({ ...issue, detail: value })} required /><button className="primary-button danger-button">Escalate issue</button></form></FormCard></div><DataPanel title="Inspection history" eyebrow={`${data.inspections.length} records`}><Table headers={['Date', 'Vehicle', 'Type', 'Result', 'Odometer', 'Notes']} rows={data.inspections.map((item) => [dateText(item.created_at), `#${item.vehicle_id}`, item.inspection_type, <span className={`status ${item.status === 'SAFE' ? 'good' : 'bad'}`}>{item.status}</span>, `${item.odometer_km} km`, item.notes || '—'])} empty="No inspections recorded yet." /></DataPanel></PageFrame>
}

function FinancePage({ token, data, refresh }) {
  return <><FinancePageLegacy token={token} data={data} refresh={refresh} /><FinanceLineagePanel token={token} data={data} refresh={refresh} /></>
}

function FinanceLineagePanel({ token, data, refresh }) {
  const [form, setForm] = useState({ vehicle_id: '', category: 'Maintenance', description: '', amount_paise: 0, gst_amount_paise: 0, cgst_amount_paise: 0, sgst_amount_paise: 0, igst_amount_paise: 0, tax_category: '', invoice_number: '', tds_amount_paise: 0, vendor: '', gstin: '', cost_center: '', payment_reference: '', incurred_on: today() })
  async function submit(event) {
    event.preventDefault()
    try {
      await createExpense(token, { ...form, vehicle_id: form.vehicle_id ? Number(form.vehicle_id) : null, amount_paise: Number(form.amount_paise), gst_amount_paise: Number(form.gst_amount_paise), cgst_amount_paise: Number(form.cgst_amount_paise), sgst_amount_paise: Number(form.sgst_amount_paise), igst_amount_paise: Number(form.igst_amount_paise), tds_amount_paise: Number(form.tds_amount_paise) })
      refresh('India tax expense submitted.')
    } catch (error) {
      refresh(error.message)
    }
  }
  return <DataPanel title="India tax and invoice capture" eyebrow="CGST / SGST / IGST · TDS · vendor lineage"><form className="form-grid" onSubmit={submit}><SelectField label="Vehicle" value={form.vehicle_id} onChange={(value) => setForm({ ...form, vehicle_id: value })} options={[['', 'Organisation expense'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} /><Field label="Category" value={form.category} onChange={(value) => setForm({ ...form, category: value })} required /><Field label="Description" value={form.description} onChange={(value) => setForm({ ...form, description: value })} required /><Field label="Amount (paise)" type="number" value={form.amount_paise} onChange={(value) => setForm({ ...form, amount_paise: value })} required /><Field label="GST total (paise)" type="number" value={form.gst_amount_paise} onChange={(value) => setForm({ ...form, gst_amount_paise: value })} /><Field label="CGST (paise)" type="number" value={form.cgst_amount_paise} onChange={(value) => setForm({ ...form, cgst_amount_paise: value })} /><Field label="SGST (paise)" type="number" value={form.sgst_amount_paise} onChange={(value) => setForm({ ...form, sgst_amount_paise: value })} /><Field label="IGST (paise)" type="number" value={form.igst_amount_paise} onChange={(value) => setForm({ ...form, igst_amount_paise: value })} /><Field label="Tax category" value={form.tax_category} onChange={(value) => setForm({ ...form, tax_category: value })} placeholder="Intra-state / inter-state" /><Field label="Invoice number" value={form.invoice_number} onChange={(value) => setForm({ ...form, invoice_number: value })} /><Field label="TDS (paise)" type="number" value={form.tds_amount_paise} onChange={(value) => setForm({ ...form, tds_amount_paise: value })} /><Field label="Vendor" value={form.vendor} onChange={(value) => setForm({ ...form, vendor: value })} /><Field label="GSTIN" value={form.gstin} onChange={(value) => setForm({ ...form, gstin: value })} /><Field label="Cost centre" value={form.cost_center} onChange={(value) => setForm({ ...form, cost_center: value })} /><Field label="Payment reference" value={form.payment_reference} onChange={(value) => setForm({ ...form, payment_reference: value })} /><Field label="Incurred on" type="date" value={form.incurred_on} onChange={(value) => setForm({ ...form, incurred_on: value })} /><button className="primary-button">Submit India finance record</button></form></DataPanel>
}

function FinancePageLegacy({ token, data, refresh }) {
  const [expense, setExpense] = useState({ vehicle_id: '', category: 'Maintenance', description: '', amount_paise: 0, gst_amount_paise: 0, incurred_on: today(), vendor: '', gstin: '', tax_category: '', invoice_number: '', tds_amount_paise: 0, cost_center: '', payment_mode: 'Bank transfer', payment_reference: '' })
  const [fuel, setFuel] = useState({ vehicle_id: '', station: '', fuel_type: 'Diesel', litres_milli: 0, price_per_litre_paise: 0, odometer_km: 0, incurred_on: today(), reference: '' })
  const [toll, setToll] = useState({ vehicle_id: '', toll_operator: '', plaza: '', amount_paise: 0, incurred_on: today(), tag_reference: '' })
  async function addExpense(event) { event.preventDefault(); try { await createExpense(token, { ...expense, vehicle_id: expense.vehicle_id ? Number(expense.vehicle_id) : null, amount_paise: Number(expense.amount_paise), gst_amount_paise: Number(expense.gst_amount_paise), tds_amount_paise: Number(expense.tds_amount_paise) }); refresh('Expense submitted for finance review.') } catch (error) { refresh(error.message) } }
  async function addFuel(event) { event.preventDefault(); try { await createFuelTransaction(token, { ...fuel, vehicle_id: Number(fuel.vehicle_id), litres_milli: Number(fuel.litres_milli), price_per_litre_paise: Number(fuel.price_per_litre_paise), odometer_km: Number(fuel.odometer_km) }); refresh('Fuel transaction recorded.') } catch (error) { refresh(error.message) } }
  async function addToll(event) { event.preventDefault(); try { await createTollTransaction(token, { ...toll, vehicle_id: Number(toll.vehicle_id), amount_paise: Number(toll.amount_paise) }); refresh('Toll transaction recorded.') } catch (error) { refresh(error.message) } }
  async function approve(item) { try { await reconcileExpense(token, item.id); refresh('Expense reconciled.') } catch (error) { refresh(error.message) } }
  return <PageFrame eyebrow="01 · Finance control" title="Ledger & costs" description="Record operating spend with GST context, reconcile the evidence, and keep vehicle cost visible to the organisation."><div className="stat-grid"><Metric label="Pending review" value={data.expenses.filter((item) => item.status === 'Pending').length} detail="expense records" tone="amber" /><Metric label="Approved spend" value={money(data.expenses.filter((item) => item.status === 'Approved').reduce((sum, item) => sum + item.amount_paise, 0))} detail="current loaded ledger" tone="green" /><Metric label="GST captured" value={money(data.expenses.reduce((sum, item) => sum + item.gst_amount_paise, 0))} detail="tax context" tone="blue" /></div><div className="three-grid"><FormCard title="Expense" description="GST-ready operational cost."><form className="stack-form" onSubmit={addExpense}><SelectField label="Vehicle" value={expense.vehicle_id} onChange={(value) => setExpense({ ...expense, vehicle_id: value })} options={[['', 'Organisation expense'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} /><Field label="Category" value={expense.category} onChange={(value) => setExpense({ ...expense, category: value })} required /><Field label="Description" value={expense.description} onChange={(value) => setExpense({ ...expense, description: value })} required /><Field label="Amount (paise)" type="number" value={expense.amount_paise} onChange={(value) => setExpense({ ...expense, amount_paise: value })} required /><Field label="GST (paise)" type="number" value={expense.gst_amount_paise} onChange={(value) => setExpense({ ...expense, gst_amount_paise: value })} /><Field label="Incurred on" type="date" value={expense.incurred_on} onChange={(value) => setExpense({ ...expense, incurred_on: value })} /><button className="primary-button">Submit expense</button></form></FormCard><FormCard title="Fuel log" description="Capture litres, rate, and odometer together."><form className="stack-form" onSubmit={addFuel}><SelectField label="Vehicle" value={fuel.vehicle_id} onChange={(value) => setFuel({ ...fuel, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required /><Field label="Station" value={fuel.station} onChange={(value) => setFuel({ ...fuel, station: value })} /><Field label="Fuel type" value={fuel.fuel_type} onChange={(value) => setFuel({ ...fuel, fuel_type: value })} required /><Field label="Litres (milli)" type="number" value={fuel.litres_milli} onChange={(value) => setFuel({ ...fuel, litres_milli: value })} required /><Field label="Rate per litre (paise)" type="number" value={fuel.price_per_litre_paise} onChange={(value) => setFuel({ ...fuel, price_per_litre_paise: value })} required /><Field label="Odometer (km)" type="number" value={fuel.odometer_km} onChange={(value) => setFuel({ ...fuel, odometer_km: value })} required /><Field label="Date" type="date" value={fuel.incurred_on} onChange={(value) => setFuel({ ...fuel, incurred_on: value })} /><button className="primary-button">Record fuel</button></form></FormCard><FormCard title="Toll" description="FASTag and plaza context for route cost."><form className="stack-form" onSubmit={addToll}><SelectField label="Vehicle" value={toll.vehicle_id} onChange={(value) => setToll({ ...toll, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required /><Field label="Plaza" value={toll.plaza} onChange={(value) => setToll({ ...toll, plaza: value })} required /><Field label="Amount (paise)" type="number" value={toll.amount_paise} onChange={(value) => setToll({ ...toll, amount_paise: value })} required /><Field label="Date" type="date" value={toll.incurred_on} onChange={(value) => setToll({ ...toll, incurred_on: value })} /><button className="primary-button">Record toll</button></form></FormCard></div><DataPanel title="Expense approval queue" eyebrow={`${data.expenses.length} records`}><Table headers={['Date', 'Category', 'Vehicle', 'Amount', 'Status', 'Action']} rows={data.expenses.map((item) => [dateText(item.incurred_on), item.category, item.vehicle_id ? `#${item.vehicle_id}` : 'Organisation', money(item.amount_paise), <span className={`status ${item.status === 'Approved' ? 'good' : item.status === 'Rejected' ? 'bad' : 'warn'}`}>{item.status}</span>, item.status === 'Pending' ? <button className="table-action" onClick={() => approve(item)}>Reconcile</button> : '—'])} empty="No expense records have been submitted." /></DataPanel></PageFrame>
}

function NotificationsPage({ token, data, refresh, role }) {
  const [selected, setSelected] = useState([])
  const [source, setSource] = useState(null)
  const [pending, setPending] = useState(null)

  useEffect(() => {
    let active = true
    getPendingNotifications(token).then((result) => {
      if (active) setPending(result)
    }).catch((error) => refresh(error.message))
    return () => { active = false }
  }, [token])

  async function mark(item, status) { try { if (status === 'resolved') await resolveNotification(token, item.id); else await updateNotification(token, item.id, status); refresh('Notification updated.') } catch (error) { refresh(error.message) } }
  async function savePreference(preference) { try { await updateNotificationPreference(token, preference); refresh('Notification preference saved.') } catch (error) { refresh(error.message) } }
  async function inspect(item) {
    try {
      setSource(await getNotificationSourceDetail(token, item.id))
    } catch (error) {
      refresh(error.message)
    }
  }
  async function escalate(item) {
    try {
      await escalateNotification(token, item.id, { severity: 'CRITICAL', reason: 'Escalated from notification workspace' })
      refresh('Notification escalated.')
    } catch (error) {
      refresh(error.message)
    }
  }
  async function resolveSelected() {
    if (!selected.length) return
    try {
      await bulkResolveNotifications(token, { notification_ids: selected })
      setSelected([])
      refresh('Selected notifications resolved.')
    } catch (error) {
      refresh(error.message)
    }
  }
  return <PageFrame eyebrow="01 · Shared control" title="Notifications" description="Every member receives durable in-app delivery. SMS and WhatsApp remain explicit, consent-aware provider boundaries."><div className="notification-banner"><div><span className="overline">Delivery centre</span><h3>{data.notifications.filter((item) => item.status === 'unread').length} unread operational alerts</h3><p>{pending?.total_pending ?? 0} pending notifications across all severities.</p></div><div className="row-actions"><button className="secondary-button" disabled={!selected.length} onClick={resolveSelected}>Resolve selected</button><button className="secondary-button" onClick={async () => { try { await dispatchQueuedSms(token); refresh('Queued SMS delivery attempted.') } catch (error) { refresh(error.message) } }}>Dispatch queued SMS</button></div></div><div className="split-grid"><DataPanel title="In-app alert inbox" eyebrow={`${data.notifications.length} alerts`}><div className="notification-list">{data.notifications.map((item) => <article key={item.id}><div><label className="checkbox-row"><input type="checkbox" checked={selected.includes(item.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, item.id] : selected.filter((id) => id !== item.id))} /><span><span className={`severity ${item.severity}`}>{item.severity}</span><strong>{item.title}</strong><p>{item.detail}</p><small>{dateText(item.created_at)} · {item.entity_type} #{item.entity_id}</small></span></label></div><div className="row-actions"><button className="table-action" onClick={() => inspect(item)}>Inspect source</button>{item.status === 'unread' && <button className="table-action" onClick={() => mark(item, 'read')}>Mark read</button>}{item.status !== 'resolved' && <button className="table-action" onClick={() => mark(item, 'resolved')}>Resolve</button>}{['owner', 'fleet_manager'].includes(role) && <button className="table-action" onClick={() => escalate(item)}>Escalate</button>}</div></article>)}{!data.notifications.length && <EmptyState visible title="No alerts" text="Operational alerts generated by the backend will appear here." />}</div></DataPanel><DataPanel title="Channel preferences" eyebrow="Member delivery policy"><div className="preference-list">{data.notificationPreferences.map((item) => <div className="preference-row" key={item.notification_type}><span><strong>{item.notification_type}</strong><small>Choose how this alert reaches you.</small></span><label><input type="checkbox" checked={item.in_app} onChange={(event) => savePreference({ ...item, in_app: event.target.checked })} /> In-app</label><label><input type="checkbox" checked={item.sms} onChange={(event) => savePreference({ ...item, sms: event.target.checked })} /> SMS</label><label><input type="checkbox" checked={item.whatsapp} onChange={(event) => savePreference({ ...item, whatsapp: event.target.checked })} /> WhatsApp</label></div>)}{!data.notificationPreferences.length && <p className="empty-copy">Preferences will be created when notification types are first provisioned.</p>}</div></DataPanel></div>{source && <DataPanel title="Notification source" eyebrow={source.source?.type || 'Linked record'}><div className="detail-list"><span><small>Title</small><strong>{source.title}</strong></span><span><small>Detail</small><strong>{source.detail}</strong></span><span><small>Status</small><strong>{source.status}</strong></span><span><small>Source</small><strong>{source.source?.registration || source.source?.title || `#${source.source?.id || '—'}`}</strong></span></div></DataPanel>}<DataPanel title="Delivery attempts" eyebrow={`${data.deliveries.length} records`}><Table headers={['Channel', 'User', 'Status', 'Provider message', 'Sent']} rows={data.deliveries.map((item) => [item.channel, `User #${item.user_id}`, item.status, item.provider_message_id || '—', dateText(item.sent_at)])} empty="No delivery attempts recorded." /></DataPanel></PageFrame>
}

function PageFrame({ eyebrow, title, description, children }) { return <div className="page-frame"><div className="page-intro"><span className="overline">{eyebrow}</span><h2>{title}</h2><p>{description}</p></div>{children}</div> }
function FormCard({ title, description, children }) { return <section className="form-card"><div className="panel-heading"><div><span className="overline">Workflow form</span><h3>{title}</h3><p>{description}</p></div></div>{children}</section> }
function DataPanel({ title, eyebrow, children }) { return <section className="panel"><PanelHeader eyebrow={eyebrow} title={title} />{children}</section> }
function PanelHeader({ eyebrow, title }) { return <div className="panel-heading"><div><span className="overline">{eyebrow}</span><h3>{title}</h3></div></div> }
function Field({ label, value, onChange, type = 'text', compact = false, ...props }) { return <label className={compact ? 'field compact' : 'field'}>{label}<input type={type} value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label> }
function TextField({ label, value, onChange, compact = false, ...props }) { return <label className={compact ? 'field compact' : 'field'}>{label}<textarea value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props} /></label> }
function SelectField({ label, value, onChange, options, compact = false, ...props }) { return <label className={compact ? 'field compact' : 'field'}>{label}<select value={value ?? ''} onChange={(event) => onChange(event.target.value)} {...props}>{options.map(([option, text]) => <option key={option} value={option}>{text}</option>)}</select></label> }
function SelectInline({ value, onChange, options }) {
  return <select className="inline-select" value={value} onChange={(event) => onChange(event.target.value)}>
    {options.map((option) => {
      const [optionValue, optionLabel] = Array.isArray(option) ? option : [option, option]
      return <option key={optionValue} value={optionValue}>{optionLabel}</option>
    })}
  </select>
}
function Metric({ label, value, detail, tone = 'blue' }) { return <article className={`metric ${tone}`}><span>{label}</span><strong>{value ?? '—'}</strong><small>{detail}</small></article> }
function Table({ headers, rows, empty }) { return rows.length ? <div className="table-wrap"><table><thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={index}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}</tbody></table></div> : <div className="empty-state"><strong>{empty}</strong></div> }
function EmptyState({ visible, title, text }) { return visible ? <div className="empty-state"><strong>{title}</strong><span>{text}</span></div> : null }
function LoadingScreen() { return <div className="full-state"><img className="brand-mark" src="/vahansync-v-check-road-mark.png" alt="" /><h2>Loading your workspace</h2><p>Connecting to organisation records…</p></div> }
function ErrorScreen({ error, onRetry }) { return <div className="full-state"><span className="brand-symbol">!</span><h2>Workspace could not load</h2><p>{error}</p><button className="primary-button" onClick={onRetry}>Retry</button></div> }
function pageTitle(page, role) { if (page === 'command') return role === 'owner' ? 'Governance command centre' : `${roleNames[role]} workspace`; return navByRole[role]?.find(([id]) => id === page)?.[1] || 'Workspace' }
function commandHeadline(role) { return { owner: 'Govern the organisation without operating every task.', fleet_manager: 'See readiness, risk, and the next fleet decision.', inventory_manager: 'Keep every critical part available before the job starts.', technician: 'Turn assigned work into evidence-ready handoffs.', mechanic: 'Keep workshop execution moving with accountable handoffs.', driver: 'Start every route with a clear safety record.', accountant: 'Close the rupee trail with operational context.' }[role] }
function commandSubhead(role) { return { owner: 'Members, billing, audit evidence, and delegated operations stay visible while operational mutations remain with accountable teams.', fleet_manager: 'Vehicles, odometers, maintenance, documents, and driver coverage in one fleet operating picture.', inventory_manager: 'Catalogue, reorder exposure, stock locations, procurement, and movement history for the workshop.', technician: 'Assigned work orders, checklists, evidence, parts context, and completion handoffs in one execution surface.', mechanic: 'Assigned workshop work, checklist execution, parts context, evidence, and completion handoffs in one surface.', driver: 'Assigned vehicle context, inspections, odometer capture, issue escalation, and notification delivery.', accountant: 'Expenses, fuel, tolls, approvals, GST context, and reconciliation connected to the fleet record.' }[role] }
function commandStats(role, data) {
  const operations = data.operations || {}
  const stats = role === 'owner' ? [['Members', data.users.length, 'organisation directory', 'blue'], ['Trial status', data.subscription?.status || '—', `ends ${dateText(data.subscription?.trial_ends_on)}`, 'green'], ['Open work', operations.open_work_orders ?? data.workOrders.filter((item) => !['Completed', 'Cancelled'].includes(item.status)).length, 'delegated operations', 'amber'], ['Audit events', data.audit.length, 'recent evidence', 'purple']] : role === 'fleet_manager' ? [['Active vehicles', operations.active_vehicles ?? data.vehicles.length, 'in operating picture', 'green'], ['Open work', operations.open_work_orders ?? data.workOrders.length, 'maintenance queue', 'amber'], ['Compliance due', operations.compliance_due ?? 0, 'next 30 days', 'red'], ['Unassigned assets', operations.unassigned_vehicles ?? 0, 'needs driver handoff', 'purple']] : role === 'inventory_manager' ? [['Parts catalogue', data.parts.length, 'stock records', 'blue'], ['Low stock', data.parts.filter((item) => item.quantity_on_hand <= item.reorder_level).length, 'reorder decisions', 'red'], ['Open POs', data.purchaseOrders.filter((item) => !['Received', 'Cancelled'].includes(item.status)).length, 'supplier handoffs', 'amber'], ['Locations', data.locations.length, 'stock control points', 'green']] : ['technician', 'mechanic'].includes(role) ? [['Assigned work', data.workOrders.length, 'execution queue', 'blue'], ['In progress', data.workOrders.filter((item) => item.status === 'In progress').length, 'active repairs', 'amber'], ['Components', data.components.length, 'service context', 'green'], ['Alerts', data.notifications.filter((item) => item.status === 'unread').length, 'recipient-scoped', 'red']] : role === 'driver' ? [['Vehicles', data.vehicles.length, 'assigned context', 'blue'], ['Inspections', data.inspections.length, 'recorded checks', 'green'], ['Open issues', data.issues.filter((item) => item.status === 'OPEN').length, 'safety escalations', 'red'], ['Unread alerts', data.notifications.filter((item) => item.status === 'unread').length, 'delivery inbox', 'amber']] : [['Expenses', data.expenses.length, 'ledger records', 'blue'], ['Pending', data.expenses.filter((item) => item.status === 'Pending').length, 'approval queue', 'amber'], ['Approved spend', money(data.expenses.filter((item) => item.status === 'Approved').reduce((sum, item) => sum + item.amount_paise, 0)), 'loaded ledger', 'green'], ['GST captured', money(data.expenses.reduce((sum, item) => sum + item.gst_amount_paise, 0)), 'tax context', 'purple']]
  return stats.map(([label, value, detail, tone]) => ({ label, value, detail, tone }))
}
function commandActions(role) {
  const actions = { owner: [['members', 'Invite and assign a member', 'Keep access aligned to responsibility.', '♙', 'blue'], ['billing', 'Review plan capacity', '14-day trial and unlimited members.', '₹', 'green'], ['audit', 'Search audit evidence', 'Inspect organisation-level activity.', '≋', 'purple'], ['notifications', 'Review delivery policy', 'In-app, SMS, and WhatsApp boundaries.', '◌', 'amber']], fleet_manager: [['vehicles', 'Open vehicle register', 'Update readiness and driver context.', '▣', 'blue'], ['maintenance', 'Dispatch maintenance work', 'Create the next accountable handoff.', '◆', 'amber'], ['compliance', 'Review expiry horizon', 'Keep documents ahead of the road.', '▤', 'red'], ['telematics', 'Sync odometers', 'Connect provider signals to fleet records.', '⌁', 'green']], inventory_manager: [['inventory', 'Review stock exposure', 'Find low stock before it blocks work.', '▦', 'red'], ['procurement', 'Create a purchase order', 'Connect supplier and part demand.', '◇', 'amber'], ['notifications', 'Review inventory alerts', 'Resolve recipient-scoped exceptions.', '◌', 'blue']], technician: [['work', 'Open assigned queue', 'Start, execute, and hand off repairs.', '◆', 'amber'], ['notifications', 'Review work alerts', 'Stay current on changes and blockers.', '◌', 'blue']], mechanic: [['work', 'Open workshop queue', 'Execute assigned work with a clean handoff.', '◆', 'amber'], ['notifications', 'Review workshop alerts', 'Stay current on blockers and assignments.', '◌', 'blue']], driver: [['checks', 'Complete daily check', 'Record readiness and odometer.', '✓', 'green'], ['notifications', 'Review safety alerts', 'See what the fleet team needs from you.', '◌', 'red']], accountant: [['finance', 'Open finance ledger', 'Record and reconcile operating spend.', '₹', 'green'], ['notifications', 'Review finance alerts', 'Keep approval and delivery context visible.', '◌', 'blue']] }
  return (actions[role] || []).map(([page, title, detail, icon, tone]) => ({ page, title, detail, icon, tone }))
}
function AttentionList({ role, data, onNavigate }) {
  const items = []
  if (['owner', 'fleet_manager'].includes(role) && data.operations?.overdue_work_orders) items.push(['Overdue work orders', `${data.operations.overdue_work_orders} need a fleet decision`, 'maintenance', 'red'])
  if (['owner', 'fleet_manager'].includes(role) && data.operations?.low_stock_parts) items.push(['Low stock parts', `${data.operations.low_stock_parts} reorder thresholds reached`, 'inventory', 'amber'])
  if (role === 'inventory_manager' && data.parts.some((item) => item.quantity_on_hand <= item.reorder_level)) items.push(['Reorder exposure', 'One or more catalogue items are below threshold', 'inventory', 'red'])
  if (role === 'driver' && data.issues.some((item) => item.status === 'OPEN')) items.push(['Open safety issues', 'Your reported defects are visible to the fleet team', 'checks', 'red'])
  if (role === 'accountant' && data.expenses.some((item) => item.status === 'Pending')) items.push(['Pending finance approvals', 'Expenses are waiting for reconciliation', 'finance', 'amber'])
  if (!items.length) return <div className="empty-state compact"><strong>No immediate exceptions</strong><span>The loaded organisation records are within the current view.</span></div>
  return <div className="attention-list">{items.map(([title, detail, page, tone]) => <button key={title} onClick={() => onNavigate(page)}><span className={`attention-icon ${tone}`}>!</span><span><strong>{title}</strong><small>{detail}</small></span><b>→</b></button>)}</div>
}
function RecentActivity({ data }) {
  const rows = [...data.workOrders.map((item) => ({ title: item.title, detail: `Work order · ${item.status}`, date: item.created_at })), ...data.documents.map((item) => ({ title: item.name, detail: `Document · expires ${dateText(item.expires_on)}`, date: item.created_at })), ...data.expenses.map((item) => ({ title: item.description, detail: `Expense · ${money(item.amount_paise)}`, date: item.created_at }))].sort((a, b) => new Date(b.date) - new Date(a.date)).slice(0, 6)
  return rows.length ? <div className="activity-list">{rows.map((row, index) => <div key={`${row.title}-${index}`}><span className="activity-dot" /><span><strong>{row.title}</strong><small>{row.detail}</small></span><time>{dateText(row.date)}</time></div>)}</div> : <div className="empty-state compact"><strong>No recent activity</strong><span>New records created in your organisation will appear here.</span></div>
}
function roleDescription(role) { return { owner: 'Governance, access, billing, policy, and audit.', fleet_manager: 'Readiness, dispatch, odometer, and compliance.', inventory_manager: 'Parts, locations, movements, and procurement.', technician: 'Assigned repair execution and evidence.', mechanic: 'Workshop execution, parts, evidence, and handoff.', driver: 'Daily safety, odometer, and issue reporting.', accountant: 'Ledger, GST, approvals, and reconciliation.' }[role] }

// Fleet Manager Workspace - Assignment Panel for Mechanics
function FleetManagerWorkspace({ token, data, refresh, query }) {
  const [tab, setTab] = useState('dispatch')
  const [form, setForm] = useState({ vehicle_id: '', title: '', description: '', priority: 'Medium', due_date: today(), mechanic_id: '' })
  const [availableMechanics, setAvailableMechanics] = useState([])
  const [teamRoster, setTeamRoster] = useState({ members: [], assignments: [], vehicles: [] })
  const [driverByVehicle, setDriverByVehicle] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    async function loadData() {
      try {
        const [mechanics, roster] = await Promise.all([
          getAssignableMembers(token),
          getTeamRoster(token)
        ])
        setAvailableMechanics(mechanics)
        setTeamRoster(roster)
      } catch (error) {
        console.error('Failed to load assignment data:', error)
      }
    }
    if (data.vehicles.length > 0) {
      loadData()
    }
  }, [data.vehicles, token])

  async function createWork(event) {
    event.preventDefault()
    try {
      setBusy(true)
      await createWorkOrder(token, { ...form, vehicle_id: Number(form.vehicle_id), assigned_user_id: form.mechanic_id ? Number(form.mechanic_id) : null })
      setForm({ ...form, title: '', description: '', mechanic_id: '' })
      refresh('Work order dispatched.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function assignVehicleDriver(event) {
    event.preventDefault()
    const vehicleId = Number(event.target.dataset.vehicleId)
    const driverId = driverByVehicle[vehicleId]
    if (!driverId) return
    try {
      setBusy(true)
      await assignVehicleDriverApi(token, vehicleId, Number(driverId))
      setDriverByVehicle({ ...driverByVehicle, [vehicleId]: '' })
      refresh('Driver assigned to vehicle.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function assignWorkOrder(workOrderId, mechanicId) {
    try {
      setBusy(true)
      await assignWorkOrderApi(token, workOrderId, mechanicId ? Number(mechanicId) : null)
      refresh(mechanicId ? 'Work order assignment updated.' : 'Work order unassigned.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  const workOrders = data.workOrders.filter((order) => JSON.stringify(order).toLowerCase().includes(query))

  return (
    <PageFrame eyebrow="01 · Fleet operations" title="Fleet command" description="Dispatch maintenance work, assign drivers to vehicles, and track team assignments.">
      <div className="tabs">
        {[['dispatch', 'Work dispatch'], ['vehicles', 'Vehicle assignments'], ['team', 'Team roster']].map(([id, label]) => (
          <button key={id} className={tab === id ? 'tab active' : 'tab'} onClick={() => setTab(id)}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'dispatch' && (
        <>
          <FormCard title="Dispatch work" description="A work order carries the vehicle, priority, due date, and accountable handoff to mechanics.">
            <form className="form-grid" onSubmit={createWork}>
              <SelectField label="Vehicle" value={form.vehicle_id} onChange={(value) => setForm({ ...form, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), `${vehicle.registration_number} · ${vehicle.model}`])]} required />
              <Field label="Work title" value={form.title} onChange={(value) => setForm({ ...form, title: value })} required />
              <SelectField label="Priority" value={form.priority} onChange={(value) => setForm({ ...form, priority: value })} options={['Low', 'Medium', 'High', 'Critical'].map((value) => [value, value])} />
              <Field label="Due date" type="date" value={form.due_date} onChange={(value) => setForm({ ...form, due_date: value })} />
              <SelectField label="Assign to mechanic or technician" value={form.mechanic_id} onChange={(value) => setForm({ ...form, mechanic_id: value })} options={[['', 'Not assigned'], ...availableMechanics.map((m) => [String(m.id), `${m.full_name} · ${roleNames[m.role] || m.role}`])]} />
              <TextField label="Scope and instructions" value={form.description} onChange={(value) => setForm({ ...form, description: value })} />
              <button className="primary-button" disabled={busy}>{busy ? 'Dispatching…' : 'Create work order'}</button>
            </form>
          </FormCard>
          <DataPanel title="Dispatch board" eyebrow={`${workOrders.length} work orders`}>
            <Table headers={['Work', 'Vehicle', 'Priority', 'Due', 'Assigned', 'Status', 'Action']} rows={workOrders.map((order) => [
              <span><strong>{order.title}</strong><small>{order.description || 'No extra instructions'}</small></span>,
              data.vehicles.find((vehicle) => vehicle.id === order.vehicle_id)?.registration_number || `Vehicle #${order.vehicle_id}`,
              order.priority,
              dateText(order.due_date),
              order.assigned_user_id ? availableMechanics.find((m) => m.id === order.assigned_user_id)?.full_name || 'Unknown' : <span className="muted">Unassigned</span>,
              <span className={`status ${order.status === 'Completed' ? 'good' : order.status === 'Cancelled' ? 'bad' : 'warn'}`}>{order.status}</span>,
              <div className="row-actions">
                <SelectInline value={order.assigned_user_id || ''} onChange={(value) => assignWorkOrder(order.id, value || null)} options={[['', 'Unassign'], ...availableMechanics.map((m) => [String(m.id), `${m.full_name} · ${roleNames[m.role] || m.role}`])]} />
              </div>
            ])} empty="No work orders have been dispatched." />
          </DataPanel>
        </>
      )}

      {tab === 'vehicles' && (
        <DataPanel title="Vehicle - Driver assignments" eyebrow={`${teamRoster.assignments.length} active assignments`}>
          <div className="vehicle-grid">
            {teamRoster.vehicles?.map((vehicle) => (
              <article key={vehicle.id} className="vehicle-card">
                <div className="card-top">
                  <span className={`status ${vehicle.status === 'Out of service' ? 'bad' : vehicle.status === 'In workshop' ? 'warn' : 'good'}`}>{vehicle.status}</span>
                  <span className="vehicle-id">#{vehicle.id}</span>
                </div>
                <h3>{vehicle.registration_number}</h3>
                <p>{vehicle.model} · {vehicle.vehicle_type}</p>
                <div className="vehicle-data">
                  <span><small>Depot</small><b>{vehicle.depot}</b></span>
                  <span><small>Odometer</small><b>{Number(vehicle.odometer_km).toLocaleString('en-IN')} km</b></span>
                </div>
                <div className="card-actions">
                  <select aria-label={`Assign driver to ${vehicle.registration_number}`} value={driverByVehicle[vehicle.id] || ''} onChange={(e) => setDriverByVehicle({ ...driverByVehicle, [vehicle.id]: e.target.value })}>
                    <option value="">Assign driver to this vehicle…</option>
                    {[
                      ...(teamRoster.members?.filter((m) => m.id === vehicle.assigned_driver_id) || []),
                      ...(teamRoster.unassigned_drivers?.filter((driver) => driver.id !== vehicle.assigned_driver_id) || []),
                    ].map((driver) => (
                      <option key={driver.id} value={driver.id}>{driver.full_name}</option>
                    ))}
                  </select>
                  <button className="secondary-button" data-vehicle-id={vehicle.id} disabled={!driverByVehicle[vehicle.id] || busy} onClick={assignVehicleDriver}>
                    Assign
                  </button>
                </div>
              </article>
            ))}
          </div>
        </DataPanel>
      )}

      {tab === 'team' && (
        <DataPanel title="Team roster" eyebrow={`${teamRoster.members?.length || 0} members`}>
          <Table headers={['Member', 'Role', 'Status']} rows={teamRoster.members?.map((member) => [
            <span><strong>{member.full_name}</strong><small>{member.email}</small></span>,
            roleNames[member.role] || member.role,
            <span className="status good">Active</span>
          ])} empty="No team members found." />
        </DataPanel>
      )}
    </PageFrame>
  )
}

// Mechanic Execution Workspace - Work Acceptance and Completion
function MechanicExecutionWorkspace({ role, token, data, refresh, query }) {
  const isMechanic = role === 'mechanic'
  const [selected, setSelected] = useState(null)
  const [checklist, setChecklist] = useState([
    { title: isMechanic ? 'Confirm safety isolation and workshop setup' : 'Confirm technical diagnosis and test scope', completed: false },
    { title: isMechanic ? 'Repair quality and affected component confirmed' : 'Technical findings and affected component confirmed', completed: false },
    { title: isMechanic ? 'Parts, tools, and handoff evidence checked' : 'Validation results and handoff evidence checked', completed: false }
  ])
  const [laborHours, setLaborHours] = useState('0')
  const [repairNotes, setRepairNotes] = useState('')
  const [timeline, setTimeline] = useState([])
  const [busy, setBusy] = useState(false)

  async function choose(order) {
    setSelected(order)
    try {
      const [loaded, history] = await Promise.all([
        getWorkOrderChecklist(token, order.id),
        getWorkOrderHandoffTimeline(token, order.id)
      ])
      setChecklist(loaded.length ? loaded : checklist)
      setTimeline(history)
    } catch {
      setChecklist(checklist)
      setTimeline([])
    }
  }

  async function saveChecklist() {
    if (!selected) return
    try {
      setBusy(true)
      await updateWorkOrderChecklist(token, selected.id, checklist)
      refresh('Checklist saved.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function startWork() {
    if (!selected) return
    try {
      setBusy(true)
      await startWorkOrder(token, selected.id)
      setSelected(null)
      refresh('Work started.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  async function completeWork() {
    if (!selected) return
    try {
      setBusy(true)
      await completeWorkOrder(token, selected.id, { labor_hours: Number(laborHours), repair_notes: repairNotes })
      setSelected(null)
      setLaborHours('0')
      setRepairNotes('')
      refresh('Work order submitted for Fleet Manager review.')
    } catch (error) {
      refresh(error.message)
    } finally {
      setBusy(false)
    }
  }

  const orders = data.workOrders.filter((order) => JSON.stringify(order).toLowerCase().includes(query))
  const activeRepairs = orders.filter((order) => ['In progress', 'REWORK'].includes(order.status))

  return (
    <PageFrame eyebrow={isMechanic ? '01 · Field execution · Workshop' : '01 · Field execution · Technical'} title={isMechanic ? 'Mechanic workspace' : 'Technician workspace'} description={isMechanic ? 'Execute assigned workshop repairs, record parts and quality checks, and hand off completed work.' : 'Execute assigned technical work, document diagnosis and validation, and hand off completed work.'}>
      <div className="execution-layout">
        <DataPanel title="My queue" eyebrow={`${orders.length} assigned records`}>
          <div className="queue-list">
            {orders.map((order) => (
              <button key={order.id} className={selected?.id === order.id ? 'queue-item active' : 'queue-item'} onClick={() => choose(order)}>
                <span className="queue-marker">{order.priority?.[0] || 'M'}</span>
                <span><strong>{order.title}</strong><small>Vehicle #{order.vehicle_id} · {order.priority} · {order.status}</small></span>
                <b>→</b>
              </button>
            ))}
            {!orders.length && <EmptyState visible title="No assigned work" text="Your queue is clear. New work orders assigned to your role will appear here." />}
          </div>
        </DataPanel>
        <section className="execution-panel">
          {selected ? (
            <>
              <div className="panel-heading">
                <div><span className="overline">Execution record</span><h3>{selected.title}</h3><p>Vehicle #{selected.vehicle_id} · due {dateText(selected.due_date)}</p></div>
                <span className={`status ${selected.status === 'In progress' ? 'warn' : selected.status === 'Completed' ? 'good' : 'warn'}`}>{selected.status}</span>
              </div>
              <div className="checklist">
                <strong>Execution checklist</strong>
                {checklist.map((item, index) => (
                  <label key={index}>
                    <input type="checkbox" checked={item.completed} onChange={(event) => setChecklist((items) => items.map((entry, idx) => idx === index ? { ...entry, completed: event.target.checked } : entry))} />
                    {item.title}
                  </label>
                ))}
                <button className="secondary-button" disabled={busy} onClick={saveChecklist}>Save checklist</button>
              </div>
              <div className="form-grid">
                <Field label="Labor hours" type="number" value={laborHours} onChange={setLaborHours} />
                <TextField label="Repair notes" value={repairNotes} onChange={setRepairNotes} />
              </div>
              <div className="row-actions">
                {selected.status === 'Open' && <button className="primary-button" disabled={busy} onClick={startWork}>Start work</button>}
                {['In progress', 'REWORK'].includes(selected.status) && (
                  <>
                    <button className="primary-button" disabled={busy || !repairNotes.trim()} onClick={completeWork}>Submit for review</button>
                    <button className="secondary-button" onClick={() => setSelected(null)}>Cancel</button>
                  </>
                )}
              </div>
              <DataPanel title="Handoff timeline" eyebrow={`${timeline.length} events`}>
                <Table headers={['Action', 'Actor', 'Time']} rows={timeline.map((event) => [
                  event.action,
                  event.actor_user_id ? `User #${event.actor_user_id}` : 'System',
                  dateText(event.created_at)
                ])} empty="No handoff events recorded yet." />
              </DataPanel>
            </>
          ) : (
            <div className="empty-state">
              <strong>Select an assigned work order</strong>
              <span>Execution details, checklist, and handoff controls will appear here.</span>
            </div>
          )}
        </section>
      </div>
    </PageFrame>
  )
}

function DriverPortal({ token, data, refresh }) {
  const [inspection, setInspection] = useState({ vehicle_id: '', inspection_type: 'pre_trip', status: 'SAFE', odometer_km: 0, notes: '' })
  const [issue, setIssue] = useState({ vehicle_id: '', title: '', detail: '', priority: 'Medium' })

  async function submitInspection(event) {
    event.preventDefault()
    try {
      const result = await createDriverInspection(token, { ...inspection, vehicle_id: Number(inspection.vehicle_id), odometer_km: Number(inspection.odometer_km) })
      refresh(result.queued ? 'Inspection saved offline and will sync when connected.' : 'Inspection recorded.')
    } catch (error) {
      refresh(error.message)
    }
  }

  async function submitIssue(event) {
    event.preventDefault()
    try {
      const result = await createDriverIssue(token, { ...issue, vehicle_id: Number(issue.vehicle_id) })
      refresh(result.queued ? 'Issue saved offline and will sync when connected.' : 'Vehicle issue escalated.')
    } catch (error) {
      refresh(error.message)
    }
  }

  return (
    <PageFrame eyebrow="01 · Driver safety" title="Daily checks" description="Start the day with a vehicle readiness record, an accurate odometer, and a clear escalation path for anything unsafe.">
      <div className="driver-hero">
        <div>
          <span className="overline">Assigned vehicle</span>
          <h3>{data.vehicles[0]?.registration_number || 'No vehicle assigned'}</h3>
          <p>{data.vehicles[0]?.model || 'Your Fleet Manager will assign a vehicle to this workspace.'}</p>
        </div>
        <div>
          <span>Latest odometer</span>
          <strong>{data.vehicles[0] ? `${Number(data.vehicles[0].odometer_km).toLocaleString('en-IN')} km` : '—'}</strong>
        </div>
      </div>
      <div className="split-grid">
        <FormCard title="Record inspection" description="Pre-trip and post-trip checks remain part of the vehicle history.">
          <form className="stack-form" onSubmit={submitInspection}>
            <SelectField label="Vehicle" value={inspection.vehicle_id} onChange={(value) => setInspection({ ...inspection, vehicle_id: value })} options={[['', 'Select assigned vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required />
            <SelectField label="Inspection type" value={inspection.inspection_type} onChange={(value) => setInspection({ ...inspection, inspection_type: value })} options={[['pre_trip', 'Pre-trip'], ['post_trip', 'Post-trip']]} />
            <SelectField label="Readiness" value={inspection.status} onChange={(value) => setInspection({ ...inspection, status: value })} options={['SAFE', 'REVIEW', 'UNSAFE'].map((value) => [value, value])} />
            <Field label="Odometer (km)" type="number" value={inspection.odometer_km} onChange={(value) => setInspection({ ...inspection, odometer_km: value })} required />
            <TextField label="Notes" value={inspection.notes} onChange={(value) => setInspection({ ...inspection, notes: value })} />
            <button className="primary-button">Submit inspection</button>
          </form>
        </FormCard>
        <FormCard title="Report an issue" description="Create a visible safety escalation for Fleet Manager and workshop teams.">
          <form className="stack-form" onSubmit={submitIssue}>
            <SelectField label="Vehicle" value={issue.vehicle_id} onChange={(value) => setIssue({ ...issue, vehicle_id: value })} options={[['', 'Select vehicle'], ...data.vehicles.map((vehicle) => [String(vehicle.id), vehicle.registration_number])]} required />
            <Field label="Issue title" value={issue.title} onChange={(value) => setIssue({ ...issue, title: value })} required />
            <SelectField label="Priority" value={issue.priority} onChange={(value) => setIssue({ ...issue, priority: value })} options={['Low', 'Medium', 'High', 'Critical'].map((value) => [value, value])} />
            <TextField label="Describe the issue" value={issue.detail} onChange={(value) => setIssue({ ...issue, detail: value })} required />
            <button className="primary-button danger-button">Escalate issue</button>
          </form>
        </FormCard>
      </div>
      <DataPanel title="Inspection history" eyebrow={`${data.inspections.length} records`}>
        <Table headers={['Date', 'Vehicle', 'Type', 'Result', 'Odometer', 'Notes']} rows={data.inspections.map((item) => [
          dateText(item.created_at),
          `#${item.vehicle_id}`,
          item.inspection_type,
          <span className={`status ${item.status === 'SAFE' ? 'good' : 'bad'}`}>{item.status}</span>,
          `${item.odometer_km} km`,
          item.notes || '—'
        ])} empty="No inspections recorded yet." />
      </DataPanel>
    </PageFrame>
  )
}

const rootElement = document.getElementById('root')
const root = rootElement.__reactRoot || createRoot(rootElement)
rootElement.__reactRoot = root
root.render(<App />)


// TriageWorkspace - Critical issue escalation and resolution
function TriageWorkspace({ token, data, refresh }) {
  const [triageData, setTriageData] = useState([])
  const [triageStats, setTriageStats] = useState(null)
  const [assignableMembers, setAssignableMembers] = useState([])
  const [selectedIssue, setSelectedIssue] = useState(null)
  const [escalateForm, setEscalateForm] = useState({ priority: 'high', reason: '', assignee: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [queue, stats, members] = await Promise.all([getTriageQueue(token), getTriageStats(token), getAssignableMembers(token)])
        if (active) {
          setTriageData(Array.isArray(queue) ? queue : queue?.queue || queue?.data || [])
          setTriageStats(stats)
          setAssignableMembers(members || [])
        }
      } catch (error) {
        refresh(error.message)
        if (active) setTriageData([])
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function escalate(issue) {
    try {
      await escalateTriageIssue(token, issue.id, { ...escalateForm, assigned_user_id: escalateForm.assignee ? Number(escalateForm.assignee) : null, issue_id: issue.id })
      refresh('Issue escalated successfully.')
      setSelectedIssue(null)
      setEscalateForm({ priority: 'high', reason: '', assignee: '' })
      // Reload data
      const [queue, stats] = await Promise.all([getTriageQueue(token), getTriageStats(token)])
      setTriageData(Array.isArray(queue) ? queue : queue?.queue || queue?.data || [])
      setTriageStats(stats)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function resolve(issue) {
    try {
      await resolveTriageIssue(token, issue.id, { resolution: 'resolved', notes: '' })
      refresh('Issue resolved.')
      setSelectedIssue(null)
      // Reload data
      const [queue, stats] = await Promise.all([getTriageQueue(token), getTriageStats(token)])
      setTriageData(queue)
      setTriageStats(stats)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function update(issue, status = issue.status) {
    try {
      await updateTriageIssue(token, issue.id, { priority: escalateForm.priority, status })
      refresh('Issue updated.')
      setSelectedIssue(null)
      const [queue, stats] = await Promise.all([getTriageQueue(token), getTriageStats(token)])
      setTriageData(Array.isArray(queue) ? queue : queue?.queue || queue?.data || [])
      setTriageStats(stats)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function createWorkOrder(issue) {
    try {
      await createWorkOrderFromIssue(token, issue.id, {
        title: issue.title,
        description: issue.description || issue.detail,
        priority: issue.priority,
      })
      refresh('Work order created from issue.')
      setSelectedIssue(null)
      const [queue, stats] = await Promise.all([getTriageQueue(token), getTriageStats(token)])
      setTriageData(Array.isArray(queue) ? queue : queue?.queue || queue?.data || [])
      setTriageStats(stats)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function assign(issue, assignedUserId) {
    if (!assignedUserId) return
    try {
      await assignTriageIssue(token, issue.id, { assigned_user_id: Number(assignedUserId) })
      refresh('Issue assigned.')
      setSelectedIssue(null)
      const [queue, stats] = await Promise.all([getTriageQueue(token), getTriageStats(token)])
      setTriageData(Array.isArray(queue) ? queue : queue?.queue || queue?.data || [])
      setTriageStats(stats)
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading triage queue…</h2></div>

  return (
    <PageFrame eyebrow="01 · Operations" title="Triage queue" description="Review reported issues, escalate to work orders, and track resolution status.">
      <div className="stat-grid">
        <Metric label="Pending issues" value={triageStats?.pending_count || 0} detail="awaiting action" tone="red" />
        <Metric label="In progress" value={triageStats?.in_progress_count || 0} detail="being addressed" tone="amber" />
        <Metric label="Resolved" value={triageStats?.resolved_count || 0} detail="this period" tone="green" />
      </div>

      {selectedIssue && (
        <FormCard title="Escalate issue" description="Convert a triage item to a work order or update its priority.">
          <form className="form-grid" onSubmit={(e) => { e.preventDefault(); escalate(selectedIssue) }}>
            <SelectField label="Priority" value={escalateForm.priority} onChange={(value) => setEscalateForm({ ...escalateForm, priority: value })} options={['low', 'medium', 'high', 'critical'].map((p) => [p, p.charAt(0).toUpperCase() + p.slice(1)])} />
            <Field label="Reason" value={escalateForm.reason} onChange={(value) => setEscalateForm({ ...escalateForm, reason: value })} required />
            <SelectField label="Assign to" value={escalateForm.assignee} onChange={(value) => setEscalateForm({ ...escalateForm, assignee: value })} options={[['', 'Select mechanic or technician'], ...assignableMembers.map((member) => [String(member.id), member.full_name])]} />
            <div className="row-actions">
              <button className="primary-button">Escalate to work order</button>
              <button type="button" className="secondary-button" onClick={() => setSelectedIssue(null)}>Cancel</button>
              <button type="button" className="secondary-button" onClick={() => resolve(selectedIssue)}>Mark resolved</button>
              <button type="button" className="secondary-button" onClick={() => update(selectedIssue, 'IN_PROGRESS')}>Save status</button>
              <button type="button" className="secondary-button" onClick={() => createWorkOrder(selectedIssue)}>Create work order</button>
              <button type="button" className="secondary-button" disabled={!escalateForm.assignee} onClick={() => assign(selectedIssue, escalateForm.assignee)}>Assign issue</button>
            </div>
          </form>
        </FormCard>
      )}

      <DataPanel title="Active issues" eyebrow={`${(triageData || []).filter(i => i.status !== 'resolved').length} pending`}>
        <Table
          headers={['Issue', 'Source', 'Priority', 'Reported', 'Status', 'Action']}
          rows={(triageData || []).map((issue) => [
            <span><strong>{issue.title || `Issue #${issue.id}`}</strong><small>{issue.description || 'No details'}</small></span>,
            issue.source || 'Driver',
            issue.priority || 'Medium',
            dateText(issue.created_at),
            <span className={`status ${issue.status === 'resolved' ? 'good' : issue.priority === 'critical' ? 'bad' : 'warn'}`}>{issue.status || 'Open'}</span>,
            issue.status !== 'resolved' ? <button className="table-action" onClick={() => setSelectedIssue(issue)}>Escalate</button> : '—'
          ])}
          empty="No issues in triage queue."
        />
      </DataPanel>
    </PageFrame>
  )
}

// ReportsWorkspace - Report generation and listing
function ReportsWorkspace({ token, data, refresh }) {
  const [reports, setReports] = useState([])
  const [reportType, setReportType] = useState('maintenance-performance')
  const [filters, setFilters] = useState({ start_date: today(), end_date: today() })
  const [generating, setGenerating] = useState(false)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const list = await listReports(token)
        if (active) setReports(list || [])
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function generate(event) {
    event.preventDefault()
    setGenerating(true)
    try {
      await generateReport(token, reportType, filters)
      refresh('Report generated successfully.')
      // Reload reports list
      const list = await listReports(token)
      setReports(list || [])
    } catch (error) {
      refresh(error.message)
    } finally {
      setGenerating(false)
    }
  }

  async function download(reportId) {
    try {
      await downloadReport(token, reportId)
      refresh('Report download started.')
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading reports…</h2></div>

  return (
    <PageFrame eyebrow="02 · Analytics" title="Reports" description="Generate maintenance, fuel, financial, and compliance reports for the selected period.">
      <FormCard title="Generate report" description="Select report type and date range to create a new analysis.">
        <form className="form-grid" onSubmit={generate}>
          <SelectField
            label="Report type"
            value={reportType}
            onChange={setReportType}
            options={[
              ['maintenance-performance', 'Maintenance performance'],
              ['fuel-efficiency', 'Fuel efficiency'],
              ['vehicle-maintenance-history', 'Vehicle maintenance history'],
              ['compliance-expiry', 'Compliance expiry'],
            ]}
          />
          <Field label="Start date" type="date" value={filters.start_date} onChange={(value) => setFilters({ ...filters, start_date: value })} />
          <Field label="End date" type="date" value={filters.end_date} onChange={(value) => setFilters({ ...filters, end_date: value })} />
          <button className="primary-button" disabled={generating}>{generating ? 'Generating…' : 'Generate report'}</button>
        </form>
      </FormCard>

      <DataPanel title="Report history" eyebrow={`${reports.length} reports`}>
        <Table
          headers={['Report', 'Type', 'Generated', 'Status', 'Download']}
          rows={reports.map((report) => [
            report.title || `Report ${report.id}`,
            report.report_type || 'Custom',
            dateText(report.created_at),
            report.status || 'Ready',
            report.status === 'Ready' ? <button className="table-action" onClick={() => download(report.id)}>Download</button> : <span className="muted">Processing…</span>
          ])}
          empty="No reports have been generated yet."
        />
      </DataPanel>
    </PageFrame>
  )
}

// FinancialsWorkspace - Expense approval and financial dashboard
function FinancialsWorkspace({ token, data, refresh }) {
  const [financials, setFinancials] = useState(null)
  const [approvalQueue, setApprovalQueue] = useState([])
  const [selectedExpenses, setSelectedExpenses] = useState([])
  const [approvalNotes, setApprovalNotes] = useState('')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [summary, queue] = await Promise.all([getFinancialsSummary(token), getFinancialApprovalQueue(token)])
        if (active) {
          setFinancials(summary)
          setApprovalQueue(queue || [])
        }
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function approveSelected(event) {
    event.preventDefault()
    if (selectedExpenses.length === 0) {
      refresh('Please select expenses to approve.')
      return
    }
    try {
      await bulkApproveExpenses(token, selectedExpenses, { notes: approvalNotes })
      refresh('Expenses approved successfully.')
      setSelectedExpenses([])
      setApprovalNotes('')
      // Reload data
      const [summary, queue] = await Promise.all([getFinancialsSummary(token), getFinancialApprovalQueue(token)])
      setFinancials(summary)
      setApprovalQueue(queue || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function reject(expenseId) {
    try {
      await rejectExpense(token, expenseId, { reason: 'Rejected by approver' })
      refresh('Expense rejected.')
      const [summary, queue] = await Promise.all([getFinancialsSummary(token), getFinancialApprovalQueue(token)])
      setFinancials(summary)
      setApprovalQueue(queue || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function approve(expenseId) {
    try {
      await approveExpense(token, expenseId)
      refresh('Expense approved.')
      const [summary, queue] = await Promise.all([getFinancialsSummary(token), getFinancialApprovalQueue(token)])
      setFinancials(summary)
      setApprovalQueue(queue || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading financial dashboard…</h2></div>

  return (
    <PageFrame eyebrow="03 · Finance" title="Financial dashboard" description="Review organisation financial metrics, approve pending expenses, and reconcile transactions.">
      {financials && (
        <div className="stat-grid">
          <Metric label="Total revenue" value={money(financials.total_revenue_paise || 0)} detail="this period" tone="green" />
          <Metric label="Total expenses" value={money(financials.total_expenses_paise || 0)} detail="this period" tone="blue" />
          <Metric label="Net P&L" value={money((financials.total_revenue_paise || 0) - (financials.total_expenses_paise || 0))} detail="operational" tone={((financials.total_revenue_paise || 0) - (financials.total_expenses_paise || 0)) > 0 ? 'green' : 'red'} />
          <Metric label="Pending approvals" value={approvalQueue.length} detail="expenses awaiting review" tone="amber" />
        </div>
      )}

      {approvalQueue.length > 0 && (
        <FormCard title="Approve expenses" description="Review and approve pending expense claims with optional notes.">
          <form className="form-grid" onSubmit={approveSelected}>
            <div className="expense-list">
              {approvalQueue.map((expense) => (
                <label key={expense.id} className="checkbox-row">
                  <input
                    type="checkbox"
                    checked={selectedExpenses.includes(expense.id)}
                    onChange={(event) => setSelectedExpenses(event.target.checked ? [...selectedExpenses, expense.id] : selectedExpenses.filter((id) => id !== expense.id))}
                  />
                  <span>
                    <strong>{expense.description}</strong>
                    <small>{money(expense.amount_paise)} · {dateText(expense.incurred_on)}</small>
                  </span>
                </label>
              ))}
            </div>
            <Field label="Approval notes" value={approvalNotes} onChange={setApprovalNotes} />
            <div className="row-actions">
              <button className="primary-button" disabled={selectedExpenses.length === 0}>Approve selected ({selectedExpenses.length})</button>
            </div>
          </form>
        </FormCard>
      )}

      <DataPanel title="Approval queue" eyebrow={`${approvalQueue.length} pending`}>
        <Table
          headers={['Expense', 'Amount', 'Category', 'Incurred', 'Status', 'Action']}
          rows={approvalQueue.map((expense) => [
            <span><strong>{expense.description}</strong><small>Vehicle #{expense.vehicle_id}</small></span>,
            money(expense.amount_paise),
            expense.category || 'Maintenance',
            dateText(expense.incurred_on),
            <span className="status warn">Pending review</span>,
            <div className="row-actions">
              <button className="table-action" onClick={() => approve(expense.id)}>Approve</button>
              <button className="table-action" onClick={() => reject(expense.id)}>Reject</button>
            </div>
          ])}
          empty="No expenses pending approval."
        />
      </DataPanel>
    </PageFrame>
  )
}


// ActivityFeedWorkspace - Operation timeline and notifications
function ActivityFeedWorkspace({ token, data, refresh }) {
  const [feed, setFeed] = useState([])
  const [filterType, setFilterType] = useState('all')
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const response = await getActivityFeed(token)
        const activity = Array.isArray(response)
          ? response
          : Array.isArray(response?.activities)
            ? response.activities
            : Object.values(response?.summary || {}).flat()
        const filtered = filterType === 'all'
          ? activity
          : activity.filter((item) => item.type === filterType || item.entity_type === filterType)
        if (active) setFeed(filtered)
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token, filterType])

  if (loading) return <div className="page-frame"><h2>Loading activity feed…</h2></div>

  const activityTypes = ['all', 'vehicle', 'work_order', 'maintenance', 'compliance', 'expense', 'notification']

  return (
    <PageFrame eyebrow="01 · Operations" title="Activity feed" description="Timeline of organisation events, decisions, and transactions across all members and systems.">
      <div className="filter-row">
        {activityTypes.map((type) => (
          <button
            key={type}
            className={filterType === type ? 'filter-chip active' : 'filter-chip'}
            onClick={() => setFilterType(type)}
          >
            {type.replace(/_/g, ' ')}
          </button>
        ))}
      </div>

      <DataPanel title="Activity timeline" eyebrow={`${feed.length} events`}>
        <div className="activity-timeline">
          {feed.length > 0 ? (
            feed.map((activity, index) => (
              <div key={index} className="timeline-item">
                <div className="timeline-marker">
                  <span className={`status-dot ${activity.status || 'neutral'}`} />
                </div>
                <div className="timeline-content">
                  <div className="timeline-header">
                    <strong>{activity.title || activity.action || activity.summary}</strong>
                    <small>{dateText(activity.created_at || activity.timestamp)}</small>
                  </div>
                  <p className="timeline-description">{activity.description || activity.entity_type}</p>
                  {activity.actor && <small className="timeline-actor">By {activity.actor}</small>}
                </div>
              </div>
            ))
          ) : (
            <p className="empty-copy">No activity events for this filter.</p>
          )}
        </div>
      </DataPanel>
    </PageFrame>
  )
}

// MaintenancePlanningWorkspace - Plan creation and scheduling
function MaintenancePlanningWorkspace({ token, data, refresh }) {
  const [plans, setPlans] = useState([])
  const [forecast, setForecast] = useState([])
  const [templates, setTemplates] = useState([])
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState({ vehicle_id: '', name: '', interval_km: '', interval_days: '', next_due_km: '', next_due_on: today() })
  const [templateForm, setTemplateForm] = useState({ name: '', description: '', interval_km: '', interval_days: '' })
  const [schedule, setSchedule] = useState({ plan_id: '', scheduled_date: today(), mechanic_id: '', notes: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [planList, forecastData, templateList] = await Promise.all([getMaintenancePlans(token), getMaintenanceForecast(token), listMaintenanceTemplates(token)])
        if (active) {
          setPlans(planList || [])
          setForecast(forecastData || [])
          setTemplates(templateList || [])
        }
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function createPlan(event) {
    event.preventDefault()
    try {
      await createMaintenancePlan(token, {
        ...form,
        vehicle_id: Number(form.vehicle_id),
        interval_km: form.interval_km ? Number(form.interval_km) : null,
        interval_days: form.interval_days ? Number(form.interval_days) : null,
        next_due_km: form.next_due_km ? Number(form.next_due_km) : null,
      })
      refresh('Maintenance plan created.')
      setShowForm(false)
      setForm({ vehicle_id: '', name: '', interval_km: '', interval_days: '', next_due_km: '', next_due_on: today() })
      const [planList, forecastData] = await Promise.all([getMaintenancePlans(token), getMaintenanceForecast(token)])
      setPlans(planList || [])
      setForecast(forecastData || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function schedulePlan(event) {
    event.preventDefault()
    try {
      await scheduleMaintenancePlan(token, Number(schedule.plan_id), {
        scheduled_date: schedule.scheduled_date,
        mechanic_id: schedule.mechanic_id ? Number(schedule.mechanic_id) : null,
        notes: schedule.notes,
      })
      refresh('Plan scheduled successfully.')
      setSchedule({ plan_id: '', scheduled_date: today(), mechanic_id: '', notes: '' })
    } catch (error) {
      refresh(error.message)
    }
  }

  async function createTemplate(event) {
    event.preventDefault()
    try {
      await createMaintenanceTemplate(token, {
        ...templateForm,
        interval_km: templateForm.interval_km ? Number(templateForm.interval_km) : null,
        interval_days: templateForm.interval_days ? Number(templateForm.interval_days) : null,
      })
      const templateList = await listMaintenanceTemplates(token)
      setTemplates(templateList || [])
      setTemplateForm({ name: '', description: '', interval_km: '', interval_days: '' })
      refresh('Maintenance template created.')
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading maintenance plans…</h2></div>

  return (
    <PageFrame eyebrow="02 · Maintenance" title="Maintenance planning" description="Create service intervals, schedule upcoming maintenance, and track the forecast horizon.">
      <div className="split-grid">
        <FormCard title="Create plan" description="Define a maintenance schedule from kilometres, days, or both thresholds.">
          <form className="stack-form" onSubmit={createPlan}>
            <SelectField
              label="Vehicle"
              value={form.vehicle_id}
              onChange={(value) => setForm({ ...form, vehicle_id: value })}
              options={[['', 'Select vehicle'], ...data.vehicles.map((v) => [String(v.id), v.registration_number])]}
              required
            />
            <Field label="Plan name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Field label="Interval km" type="number" value={form.interval_km} onChange={(value) => setForm({ ...form, interval_km: value })} />
            <Field label="Interval days" type="number" value={form.interval_days} onChange={(value) => setForm({ ...form, interval_days: value })} />
            <Field label="Next due km" type="number" value={form.next_due_km} onChange={(value) => setForm({ ...form, next_due_km: value })} />
            <Field label="Next due date" type="date" value={form.next_due_on} onChange={(value) => setForm({ ...form, next_due_on: value })} />
            <button className="primary-button">Create plan</button>
          </form>
        </FormCard>

        <FormCard title="Schedule maintenance" description="Assign a plan to a specific date and mechanic.">
          <form className="stack-form" onSubmit={schedulePlan}>
            <SelectField
              label="Plan"
              value={schedule.plan_id}
              onChange={(value) => setSchedule({ ...schedule, plan_id: value })}
              options={[['', 'Select plan'], ...plans.map((p) => [String(p.id), p.name])]}
              required
            />
            <Field label="Scheduled date" type="date" value={schedule.scheduled_date} onChange={(value) => setSchedule({ ...schedule, scheduled_date: value })} required />
            <Field label="Assigned mechanic" value={schedule.mechanic_id} onChange={(value) => setSchedule({ ...schedule, mechanic_id: value })} />
            <TextField label="Notes" value={schedule.notes} onChange={(value) => setSchedule({ ...schedule, notes: value })} />
            <button className="primary-button">Schedule plan</button>
          </form>
        </FormCard>
      </div>

      <DataPanel title="Active plans" eyebrow={`${plans.length} maintenance plans`}>
        <Table
          headers={['Plan', 'Vehicle', 'Next due', 'Interval', 'Status']}
          rows={plans.map((plan) => [
            <span><strong>{plan.name}</strong></span>,
            data.vehicles.find((v) => v.id === plan.vehicle_id)?.registration_number || `#${plan.vehicle_id}`,
            plan.next_due_on || (plan.next_due_km ? `${plan.next_due_km} km` : '—'),
            plan.interval_km ? `${plan.interval_km} km` : plan.interval_days ? `${plan.interval_days} days` : '—',
            plan.active ? <span className="status good">Active</span> : <span className="status bad">Inactive</span>,
          ])}
          empty="No maintenance plans created."
        />
      </DataPanel>

      <div className="split-grid">
        <FormCard title="Create reusable template" description="Save common service intervals for faster vehicle onboarding.">
          <form className="stack-form" onSubmit={createTemplate}>
            <Field label="Template name" value={templateForm.name} onChange={(value) => setTemplateForm({ ...templateForm, name: value })} required />
            <TextField label="Description" value={templateForm.description} onChange={(value) => setTemplateForm({ ...templateForm, description: value })} />
            <Field label="Interval km" type="number" value={templateForm.interval_km} onChange={(value) => setTemplateForm({ ...templateForm, interval_km: value })} />
            <Field label="Interval days" type="number" value={templateForm.interval_days} onChange={(value) => setTemplateForm({ ...templateForm, interval_days: value })} />
            <button className="primary-button">Save template</button>
          </form>
        </FormCard>
        <DataPanel title="Maintenance templates" eyebrow={`${templates.length} reusable templates`}>
          <Table
            headers={['Template', 'Description', 'Interval']}
            rows={templates.map((template) => [
              <strong>{template.name}</strong>,
              template.description || '—',
              template.interval_km ? `${template.interval_km} km` : template.interval_days ? `${template.interval_days} days` : '—',
            ])}
            empty="No reusable templates created."
          />
        </DataPanel>
      </div>

      {forecast.length > 0 && (
        <DataPanel title="Forecast horizon" eyebrow={`${forecast.length} upcoming services`}>
          <Table
            headers={['Vehicle', 'Plan', 'Due date', 'Due km', 'Days remaining']}
            rows={forecast.map((item) => [
              data.vehicles.find((v) => v.id === item.vehicle_id)?.registration_number || `#${item.vehicle_id}`,
              item.plan_name || 'Plan',
              dateText(item.due_date),
              item.due_km || '—',
              item.days_remaining || '—',
            ])}
            empty="No forecast data available."
          />
        </DataPanel>
      )}
    </PageFrame>
  )
}

// VendorWorkspace - Vendor directory and pricing management
function VendorWorkspace({ token, data, refresh }) {
  const [vendors, setVendors] = useState([])
  const [selectedVendor, setSelectedVendor] = useState(null)
  const [pricingHistory, setPricingHistory] = useState([])
  const [form, setForm] = useState({ name: '', vendor_type: 'Parts supplier', gstin: '', contact_name: '', phone: '', email: '', address: '' })
  const [pricingForm, setPricingForm] = useState({ part_id: '', unit_cost_paise: 0, effective_from: today(), valid_until: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const vendorList = await getVendorList(token)
        if (active) setVendors(vendorList || [])
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function selectVendor(vendor) {
    try {
      const history = await getVendorPricingHistory(token, vendor.id)
      setSelectedVendor(vendor)
      setPricingHistory(history || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function addVendor(event) {
    event.preventDefault()
    try {
      await createVendor(token, form)
      refresh('Vendor added to directory.')
      setForm({ name: '', vendor_type: 'Parts supplier', gstin: '', contact_name: '', phone: '', email: '', address: '' })
      const vendorList = await getVendorList(token)
      setVendors(vendorList || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function addPricing(event) {
    event.preventDefault()
    if (!selectedVendor) return
    try {
      await createVendorPricingRecord(token, selectedVendor.id, {
        part_id: Number(pricingForm.part_id),
        unit_cost_paise: Number(pricingForm.unit_cost_paise),
        effective_from: pricingForm.effective_from,
        valid_until: pricingForm.valid_until || null,
      })
      refresh('Pricing record created.')
      setPricingForm({ part_id: '', unit_cost_paise: 0, effective_from: today(), valid_until: '' })
      const history = await getVendorPricingHistory(token, selectedVendor.id)
      setPricingHistory(history || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading vendor directory…</h2></div>

  return (
    <PageFrame eyebrow="03 · Procurement" title="Vendor directory" description="Manage supplier contacts, track pricing changes, and monitor vendor performance metrics.">
      <div className="split-grid">
        <FormCard title="Add vendor" description="Create a new supplier record with contact details and GST information.">
          <form className="stack-form" onSubmit={addVendor}>
            <Field label="Vendor name" value={form.name} onChange={(value) => setForm({ ...form, name: value })} required />
            <Field label="Type" value={form.vendor_type} onChange={(value) => setForm({ ...form, vendor_type: value })} />
            <Field label="GSTIN" value={form.gstin} onChange={(value) => setForm({ ...form, gstin: value })} />
            <Field label="Contact person" value={form.contact_name} onChange={(value) => setForm({ ...form, contact_name: value })} />
            <Field label="Phone" value={form.phone} onChange={(value) => setForm({ ...form, phone: value })} />
            <Field label="Email" type="email" value={form.email} onChange={(value) => setForm({ ...form, email: value })} />
            <Field label="Address" value={form.address} onChange={(value) => setForm({ ...form, address: value })} />
            <button className="primary-button">Add vendor</button>
          </form>
        </FormCard>

        {selectedVendor && (
          <FormCard title="Add pricing" description="Record a part and its cost from this vendor.">
            <form className="stack-form" onSubmit={addPricing}>
              <div className="selected-vendor"><strong>{selectedVendor.name}</strong></div>
              <SelectField
                label="Part"
                value={pricingForm.part_id}
                onChange={(value) => setPricingForm({ ...pricingForm, part_id: value })}
                options={[['', 'Select part'], ...data.parts.map((p) => [String(p.id), `${p.sku} · ${p.name}`])]}
                required
              />
              <Field label="Unit cost (paise)" type="number" value={pricingForm.unit_cost_paise} onChange={(value) => setPricingForm({ ...pricingForm, unit_cost_paise: value })} required />
              <Field label="Effective from" type="date" value={pricingForm.effective_from} onChange={(value) => setPricingForm({ ...pricingForm, effective_from: value })} />
              <Field label="Valid until" type="date" value={pricingForm.valid_until} onChange={(value) => setPricingForm({ ...pricingForm, valid_until: value })} />
              <button className="primary-button">Save pricing</button>
            </form>
          </FormCard>
        )}
      </div>

      <DataPanel title="Vendor list" eyebrow={`${vendors.length} suppliers`}>
        <Table
          headers={['Vendor', 'Type', 'Contact', 'Phone', 'Status']}
          rows={vendors.map((vendor) => [
            <button className="table-link" onClick={() => selectVendor(vendor)}>
              <strong>{vendor.name}</strong>
              <small>{vendor.email}</small>
            </button>,
            vendor.vendor_type || '—',
            vendor.contact_name || '—',
            vendor.phone || '—',
            <span className="status good">Active</span>,
          ])}
          empty="No vendors in directory."
        />
      </DataPanel>

      {selectedVendor && pricingHistory.length > 0 && (
        <DataPanel title="Pricing history" eyebrow={`${pricingHistory.length} records for ${selectedVendor.name}`}>
          <Table
            headers={['Part', 'Cost', 'Effective from', 'Valid until', 'Status']}
            rows={pricingHistory.map((record) => [
              data.parts.find((p) => p.id === record.part_id)?.name || `Part #${record.part_id}`,
              money(record.unit_cost_paise),
              dateText(record.effective_from),
              record.valid_until ? dateText(record.valid_until) : 'Current',
              new Date(record.valid_until || new Date().toISOString()) > new Date() ? <span className="status good">Valid</span> : <span className="status bad">Expired</span>,
            ])}
            empty="No pricing history for this vendor."
          />
        </DataPanel>
      )}
    </PageFrame>
  )
}

// Enhanced ProcurementWorkspace - Advanced purchase order features
function ProcurementAdvancedWorkspace({ token, data, refresh }) {
  const [orders, setOrders] = useState([])
  const [selectedOrder, setSelectedOrder] = useState(null)
  const [orderDetails, setOrderDetails] = useState(null)
  const [receiptForm, setReceiptForm] = useState({ line_id: '', quantity_received: 0, notes: '' })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const poList = await getPurchaseOrders(token)
        if (active) setOrders(poList || [])
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function selectOrder(order) {
    try {
      const details = await getPurchaseOrderDetails(token, order.id)
      setSelectedOrder(order)
      setOrderDetails(details)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function receivePartial(event) {
    event.preventDefault()
    if (!selectedOrder) return
    try {
      await receivePartialPurchaseOrder(token, selectedOrder.id, {
        lines: [{ line_id: Number(receiptForm.line_id), quantity_received: Number(receiptForm.quantity_received) }],
        notes: receiptForm.notes,
      })
      refresh('Partial receipt recorded.')
      setReceiptForm({ line_id: '', quantity_received: 0, notes: '' })
      const details = await getPurchaseOrderDetails(token, selectedOrder.id)
      setOrderDetails(details)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function reconcile(event) {
    event.preventDefault()
    if (!selectedOrder) return
    try {
      await reconcilePurchaseOrder(token, selectedOrder.id, { reconciliation_notes: '' })
      refresh('Purchase order reconciled.')
      setSelectedOrder(null)
      setOrderDetails(null)
      const poList = await getPurchaseOrders(token)
      setOrders(poList || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading purchase orders…</h2></div>

  return (
    <PageFrame eyebrow="04 · Procurement" title="Purchase orders" description="Create, receive, reconcile, and track purchase orders with variance management.">
      {selectedOrder && orderDetails && (
        <FormCard title="Receive shipment" description="Record partial or full receipt against the purchase order.">
          <form className="stack-form" onSubmit={receivePartial}>
            <div className="selected-order">
              <strong>{selectedOrder.order_number}</strong>
              <small>{data.vendors.find((v) => v.id === selectedOrder.vendor_id)?.name || `Vendor #${selectedOrder.vendor_id}`}</small>
            </div>
            <SelectField
              label="Line item"
              value={receiptForm.line_id}
              onChange={(value) => setReceiptForm({ ...receiptForm, line_id: value })}
              options={[['', 'Select line'], ...(orderDetails.lines || []).map((line) => [String(line.id), `${data.parts.find((p) => p.id === line.part_id)?.sku || ''} · Qty: ${line.quantity}`])]}
              required
            />
            <Field label="Quantity received" type="number" value={receiptForm.quantity_received} onChange={(value) => setReceiptForm({ ...receiptForm, quantity_received: value })} required />
            <TextField label="Receipt notes" value={receiptForm.notes} onChange={(value) => setReceiptForm({ ...receiptForm, notes: value })} />
            <div className="row-actions">
              <button className="primary-button">Record receipt</button>
              <button type="button" className="secondary-button" onClick={() => { setSelectedOrder(null); setOrderDetails(null) }}>Close</button>
              <button type="button" className="secondary-button" onClick={reconcile}>Finalize & reconcile</button>
            </div>
          </form>
        </FormCard>
      )}

      <DataPanel title="Purchase orders" eyebrow={`${orders.length} orders`}>
        <Table
          headers={['Order', 'Vendor', 'Expected', 'Total', 'Status', 'Action']}
          rows={orders.map((order) => [
            order.order_number || `PO-${order.id}`,
            data.vendors.find((v) => v.id === order.vendor_id)?.name || `#${order.vendor_id}`,
            dateText(order.expected_on),
            money(order.total_paise),
            <span className={`status ${order.status === 'Approved' ? 'good' : order.status === 'Draft' ? 'warn' : 'blue'}`}>{order.status}</span>,
            <button className="table-action" onClick={() => selectOrder(order)}>Receive</button>,
          ])}
          empty="No purchase orders created."
        />
      </DataPanel>
    </PageFrame>
  )
}


// TelematicsWorkspace - Device management and telemetry dashboard
function TelematicsWorkspace({ token, data, refresh }) {
  const [devices, setDevices] = useState([])
  const [readings, setReadings] = useState([])
  const [health, setHealth] = useState(null)
  const [selectedDevice, setSelectedDevice] = useState(null)
  const [dateRange, setDateRange] = useState({ start: today(), end: today() })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [deviceList, healthData] = await Promise.all([getTelematicsDevices(token), getTelematicsHealth(token)])
        if (active) {
          setDevices(deviceList || [])
          setHealth(healthData)
        }
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function selectDevice(device) {
    try {
      const readingData = await getTelemetryReadings(token, device.id, dateRange.start, dateRange.end)
      setSelectedDevice(device)
      setReadings(readingData || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function deactivate(deviceId) {
    try {
      await deactivateTelematicsDevice(token, deviceId)
      refresh('Device deactivated.')
      const deviceList = await getTelematicsDevices(token)
      setDevices(deviceList || [])
      setSelectedDevice(null)
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading telematics devices…</h2></div>

  return (
    <PageFrame eyebrow="01 · Fleet Intelligence" title="GPS & telematics" description="Monitor device health, track real-time telemetry, and detect odometer anomalies across the fleet.">
      {health && (
        <div className="stat-grid">
          <Metric label="Active devices" value={health.active_devices || 0} detail={`${health.stale_devices || 0} stale`} tone="green" />
          <Metric label="24h readings" value={health.readings_last_24h || 0} detail={`${health.flagged_odometer_readings || 0} anomalies`} tone="blue" />
          <Metric label="Integrations" value={health.active_integrations || 0} detail={`${health.stale_integrations || 0} stale`} tone="amber" />
        </div>
      )}

      {selectedDevice && (
        <DataPanel title="Telemetry data" eyebrow={`${readings.length} readings · ${selectedDevice.provider} ${selectedDevice.device_identifier}`}>
          <div className="filter-row">
            <Field label="From" type="date" value={dateRange.start} onChange={(value) => setDateRange({ ...dateRange, start: value })} compact />
            <Field label="To" type="date" value={dateRange.end} onChange={(value) => setDateRange({ ...dateRange, end: value })} compact />
            <button className="secondary-button" onClick={() => selectDevice(selectedDevice)}>Refresh</button>
          </div>
          <Table
            headers={['Time', 'Odometer (km)', 'Speed', 'Latitude', 'Longitude', 'Status']}
            rows={readings.map((reading) => [
              dateText(reading.timestamp),
              reading.odometer_km || '—',
              reading.speed_kmh ? `${reading.speed_kmh} km/h` : '—',
              reading.latitude ? reading.latitude.toFixed(4) : '—',
              reading.longitude ? reading.longitude.toFixed(4) : '—',
              reading.flags ? <span className="status bad">Flagged</span> : <span className="status good">Valid</span>,
            ])}
            empty="No telemetry readings for this period."
          />
        </DataPanel>
      )}

      <DataPanel title="Device registry" eyebrow={`${devices.length} devices`}>
        <Table
          headers={['Vehicle', 'Provider', 'Device ID', 'Last seen', 'Status', 'Action']}
          rows={devices.map((device) => [
            data.vehicles.find((v) => v.id === device.vehicle_id)?.registration_number || `Vehicle #${device.vehicle_id}`,
            device.provider,
            device.device_identifier,
            dateText(device.last_seen_at),
            device.active ? <span className="status good">Active</span> : <span className="status bad">Inactive</span>,
            <div className="row-actions">
              <button className="table-action" onClick={() => selectDevice(device)}>View readings</button>
              {device.active && <button className="table-action" onClick={() => deactivate(device.id)}>Deactivate</button>}
            </div>,
          ])}
          empty="No devices registered."
        />
      </DataPanel>
    </PageFrame>
  )
}

// DriverBehaviorWorkspace - Driver metrics and performance tracking
function DriverBehaviorWorkspace({ token, data, refresh }) {
  const [drivers, setDrivers] = useState([])
  const [selectedDriver, setSelectedDriver] = useState(null)
  const [behaviorScore, setBehaviorScore] = useState(null)
  const [events, setEvents] = useState([])
  const [metrics, setMetrics] = useState(null)
  const [dateRange, setDateRange] = useState({ start: today(), end: today() })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const driverList = await getDriversSummary(token)
        if (active) setDrivers(driverList || [])
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function selectDriver(driver) {
    try {
      const [score, behaviorEvents, perfMetrics] = await Promise.all([
        getDriverBehaviorScore(token, driver.id),
        getDriverBehaviorEvents(token, driver.id, dateRange.start, dateRange.end),
        getDriverPerformanceMetrics(token, driver.id),
      ])
      setSelectedDriver(driver)
      setBehaviorScore(score)
      setEvents(behaviorEvents || [])
      setMetrics(perfMetrics)
    } catch (error) {
      refresh(error.message)
    }
  }

  async function reportEvent(driverId) {
    try {
      await reportUnsafeDisposition(token, driverId, { reason: 'Reported by fleet manager', severity: 'medium' })
      refresh('Unsafe event recorded.')
      selectDriver(selectedDriver)
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading driver data…</h2></div>

  return (
    <PageFrame eyebrow="02 · Safety & Performance" title="Driver behavior" description="Track driver safety scores, monitor behavior events, and identify performance trends.">
      {selectedDriver && behaviorScore && (
        <div className="stat-grid">
          <Metric label="Safety score" value={`${behaviorScore.score || 0}/100`} detail={behaviorScore.category || 'Standard'} tone={behaviorScore.score >= 80 ? 'green' : behaviorScore.score >= 60 ? 'amber' : 'red'} />
          {metrics && <Metric label="Total trips" value={metrics.total_trips || 0} detail={`${metrics.average_distance_km || 0} km avg`} tone="blue" />}
          {metrics && <Metric label="Violations" value={metrics.violations_count || 0} detail={`${metrics.hard_braking_events || 0} hard brakes`} tone="red" />}
        </div>
      )}

      {selectedDriver && (
        <>
          <FormCard title="Report unsafe event" description="Document a safety concern for this driver.">
            <form className="stack-form" onSubmit={(e) => { e.preventDefault(); reportEvent(selectedDriver.id) }}>
              <div className="selected-driver"><strong>{selectedDriver.name || `Driver #${selectedDriver.id}`}</strong></div>
              <button className="primary-button">Report unsafe disposition</button>
            </form>
          </FormCard>

          <DataPanel title="Behavior events" eyebrow={`${events.length} events · ${dateRange.start} to ${dateRange.end}`}>
            <div className="filter-row">
              <Field label="From" type="date" value={dateRange.start} onChange={(value) => setDateRange({ ...dateRange, start: value })} compact />
              <Field label="To" type="date" value={dateRange.end} onChange={(value) => setDateRange({ ...dateRange, end: value })} compact />
              <button className="secondary-button" onClick={() => selectDriver(selectedDriver)}>Refresh</button>
            </div>
            <Table
              headers={['Time', 'Event type', 'Severity', 'Location', 'Notes']}
              rows={events.map((event) => [
                dateText(event.timestamp),
                event.event_type || 'General',
                <span className={`status ${event.severity === 'high' ? 'bad' : event.severity === 'medium' ? 'warn' : 'good'}`}>{event.severity || 'Medium'}</span>,
                event.location || '—',
                event.notes || '—',
              ])}
              empty="No behavior events recorded."
            />
          </DataPanel>
        </>
      )}

      <DataPanel title="Driver roster" eyebrow={`${drivers.length} drivers`}>
        <Table
          headers={['Driver', 'Safety score', 'Trips', 'Violations', 'Status', 'Action']}
          rows={drivers.map((driver) => [
            <span><strong>{driver.name || `Driver #${driver.id}`}</strong><small>{driver.email || 'No email'}</small></span>,
            driver.safety_score ? `${driver.safety_score}/100` : '—',
            driver.total_trips || 0,
            driver.violations || 0,
            driver.status || 'Active',
            <button className="table-action" onClick={() => selectDriver(driver)}>View profile</button>,
          ])}
          empty="No drivers in roster."
        />
      </DataPanel>
    </PageFrame>
  )
}

// FuelTrackingWorkspace - Fuel efficiency and cost analytics
function FuelTrackingWorkspace({ token, data, refresh }) {
  const [transactions, setTransactions] = useState([])
  const [efficiency, setEfficiency] = useState(null)
  const [costs, setCosts] = useState(null)
  const [trends, setTrends] = useState([])
  const [selectedVehicle, setSelectedVehicle] = useState('')
  const [dateRange, setDateRange] = useState({ start: today(), end: today() })
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [txns, costData, trendData] = await Promise.all([
          getFuelTransactions(token),
          getFuelCostAnalysis(token, today(), today()),
          getFuelTrends(token, 30),
        ])
        if (active) {
          setTransactions(txns || [])
          setCosts(costData)
          setTrends(trendData || [])
        }
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function loadEfficiency() {
    if (!selectedVehicle) {
      refresh('Please select a vehicle.')
      return
    }
    try {
      const effData = await getFuelEfficiencyAnalysis(token, Number(selectedVehicle), dateRange.start, dateRange.end)
      setEfficiency(effData)
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading fuel data…</h2></div>

  return (
    <PageFrame eyebrow="03 · Cost Analytics" title="Fuel tracking" description="Monitor fuel consumption, analyse efficiency trends, and track fuel costs across the fleet.">
      {costs && (
        <div className="stat-grid">
          <Metric label="Total consumed" value={`${costs.total_litres || 0} L`} detail="this period" tone="blue" />
          <Metric label="Cost" value={money(costs.total_cost_paise || 0)} detail="this period" tone="green" />
          <Metric label="Avg price" value={`₹${((costs.avg_price_paise || 0) / 100).toFixed(2)}/L`} detail="per litre" tone="amber" />
        </div>
      )}

      <div className="split-grid">
        <FormCard title="Fuel efficiency" description="Analyse fuel consumption for a specific vehicle.">
          <form className="stack-form" onSubmit={(e) => { e.preventDefault(); loadEfficiency() }}>
            <SelectField
              label="Vehicle"
              value={selectedVehicle}
              onChange={setSelectedVehicle}
              options={[['', 'Select vehicle'], ...data.vehicles.map((v) => [String(v.id), v.registration_number])]}
            />
            <Field label="From" type="date" value={dateRange.start} onChange={(value) => setDateRange({ ...dateRange, start: value })} />
            <Field label="To" type="date" value={dateRange.end} onChange={(value) => setDateRange({ ...dateRange, end: value })} />
            <button className="primary-button">Analyse efficiency</button>
          </form>
        </FormCard>

        {efficiency && (
          <DataPanel title="Efficiency results" eyebrow="Vehicle analysis">
            <div className="detail-list">
              <span><small>Total distance</small><strong>{efficiency.total_distance_km || 0} km</strong></span>
              <span><small>Fuel consumed</small><strong>{efficiency.total_fuel_litres || 0} L</strong></span>
              <span><small>Fuel efficiency</small><strong>{efficiency.avg_efficiency_kmpl || 0} km/L</strong></span>
              <span><small>Total cost</small><strong>{money(efficiency.total_cost_paise || 0)}</strong></span>
            </div>
          </DataPanel>
        )}
      </div>

      <DataPanel title="Fuel transactions" eyebrow={`${transactions.length} records`}>
        <Table
          headers={['Date', 'Vehicle', 'Litres', 'Cost', 'Station', 'Price/L']}
          rows={transactions.map((txn) => [
            dateText(txn.incurred_on),
            data.vehicles.find((v) => v.id === txn.vehicle_id)?.registration_number || `#${txn.vehicle_id}`,
            `${txn.litres_milli / 1000 || 0} L`,
            money(txn.total_paise || 0),
            txn.station || '—',
            `₹${((txn.price_per_litre_paise || 0) / 100).toFixed(2)}`,
          ])}
          empty="No fuel transactions recorded."
        />
      </DataPanel>

      {trends.length > 0 && (
        <DataPanel title="30-day trends" eyebrow="Fuel cost and consumption">
          <Table
            headers={['Date', 'Litres', 'Cost', 'Avg price/L']}
            rows={trends.map((trend) => [
              dateText(trend.date),
              `${trend.litres || 0} L`,
              money(trend.cost_paise || 0),
              `₹${((trend.avg_price_paise || 0) / 100).toFixed(2)}`,
            ])}
            empty="No trend data available."
          />
        </DataPanel>
      )}
    </PageFrame>
  )
}

// ComplianceVersioningWorkspace - Document versioning and expiry tracking
function ComplianceVersioningWorkspace({ token, data, refresh }) {
  const [documents, setDocuments] = useState([])
  const [selectedDoc, setSelectedDoc] = useState(null)
  const [versions, setVersions] = useState([])
  const [expiry, setExpiry] = useState(null)
  const [summary, setSummary] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!token) return
    let active = true
    async function load() {
      try {
        const [docs, expiryData, summaryData] = await Promise.all([
          getComplianceDocuments(token),
          getComplianceExpiryReport(token, 90),
          getComplianceSummary(token),
        ])
        if (active) {
          setDocuments(docs || [])
          setExpiry(expiryData)
          setSummary(summaryData)
        }
      } catch (error) {
        refresh(error.message)
      } finally {
        if (active) setLoading(false)
      }
    }
    load()
    return () => { active = false }
  }, [token])

  async function selectDocument(doc) {
    try {
      const versionList = await getDocumentVersions(token, doc.id)
      setSelectedDoc(doc)
      setVersions(versionList || [])
    } catch (error) {
      refresh(error.message)
    }
  }

  async function archiveDoc(docId) {
    try {
      await archiveComplianceDocument(token, docId)
      refresh('Document archived.')
      const docs = await getComplianceDocuments(token)
      setDocuments(docs || [])
      setSelectedDoc(null)
    } catch (error) {
      refresh(error.message)
    }
  }

  if (loading) return <div className="page-frame"><h2>Loading compliance records…</h2></div>

  return (
    <PageFrame eyebrow="04 · Compliance Management" title="Compliance vault" description="Track document versions, monitor expiry horizons, and maintain compliance audit trails.">
      {summary && (
        <div className="stat-grid">
          <Metric label="Total documents" value={summary.total_documents || 0} detail="registered" tone="blue" />
          <Metric label="Expiring soon" value={summary.expiring_soon || 0} detail="next 30 days" tone="red" />
          <Metric label="Compliance status" value={summary.compliant ? 'Good' : 'At risk'} detail="organisation level" tone={summary.compliant ? 'green' : 'amber'} />
        </div>
      )}

      {selectedDoc && (
        <FormCard title="Document details" description={`Tracking versions and history for ${selectedDoc.name}`}>
          <div className="detail-list">
            <span><small>Document type</small><strong>{selectedDoc.document_type}</strong></span>
            <span><small>Vehicle</small><strong>{data.vehicles.find((v) => v.id === selectedDoc.vehicle_id)?.registration_number || 'Organisation'}</strong></span>
            <span><small>Expires</small><strong>{dateText(selectedDoc.expires_on)}</strong></span>
            <span><small>Status</small><strong>{selectedDoc.status}</strong></span>
          </div>
          <div className="row-actions">
            <button className="secondary-button" onClick={() => archiveDoc(selectedDoc.id)}>Archive document</button>
          </div>
        </FormCard>
      )}

      {selectedDoc && versions.length > 0 && (
        <DataPanel title="Version history" eyebrow={`${versions.length} versions · ${selectedDoc.name}`}>
          <Table
            headers={['Version', 'Date', 'Issued by', 'Status', 'Expires']}
            rows={versions.map((version, idx) => [
              `v${version.version_number || idx + 1}`,
              dateText(version.created_at),
              version.created_by || 'System',
              version.status || 'Active',
              dateText(version.expires_on),
            ])}
            empty="No version history."
          />
        </DataPanel>
      )}

      {expiry && expiry.expiring_documents && expiry.expiring_documents.length > 0 && (
        <DataPanel title="Expiry horizon" eyebrow={`${expiry.expiring_documents.length} documents expiring in 90 days`}>
          <Table
            headers={['Document', 'Vehicle', 'Expires', 'Days remaining', 'Priority']}
            rows={expiry.expiring_documents.map((doc) => [
              doc.name,
              data.vehicles.find((v) => v.id === doc.vehicle_id)?.registration_number || 'Org',
              dateText(doc.expires_on),
              doc.days_remaining,
              doc.days_remaining <= 7 ? <span className="status bad">Critical</span> : doc.days_remaining <= 30 ? <span className="status warn">Soon</span> : <span className="status good">Ok</span>,
            ])}
            empty="No documents expiring soon."
          />
        </DataPanel>
      )}

      <DataPanel title="Document vault" eyebrow={`${documents.length} compliance records`}>
        <Table
          headers={['Document', 'Type', 'Vehicle', 'Expires', 'Status', 'Action']}
          rows={documents.map((doc) => [
            <strong>{doc.name}</strong>,
            doc.document_type,
            data.vehicles.find((v) => v.id === doc.vehicle_id)?.registration_number || 'Org-level',
            dateText(doc.expires_on),
            <span className={`status ${doc.status === 'Valid' ? 'good' : 'warn'}`}>{doc.status}</span>,
            <button className="table-action" onClick={() => selectDocument(doc)}>View versions</button>,
          ])}
          empty="No compliance documents."
        />
      </DataPanel>
    </PageFrame>
  )
}