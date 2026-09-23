import { supabase } from './supabase'

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || (import.meta.env.PROD ? '' : 'http://localhost:8000')
const useSupabaseAuth = Boolean(supabase) && !API_BASE_URL.includes('localhost')
const OFFLINE_QUEUE_KEY = 'vahana:offline-mutations'
function mapVehicle(vehicle) {
  return {
    ...vehicle,
    reg: vehicle.registration_number,
    km: `${Number(vehicle.odometer_km || 0).toLocaleString()} km`,
    driver: vehicle.driver_name || 'Unassigned',
    accent: vehicle.status === 'In workshop' ? 'orange' : vehicle.status === 'On route' ? 'blue' : 'green',
  }
}

async function request(path, options = {}) {
  const controller = new AbortController()
  const timeout = window.setTimeout(() => controller.abort(), 20_000)
  let response
  try {
    response = await fetch(`${API_BASE_URL}${path}`, {
      ...options,
      signal: options.signal || controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {}),
      },
    })
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('The request timed out. Check your connection and try again.')
    }
    throw error
  } finally {
    window.clearTimeout(timeout)
  }

  if (!response.ok) {
    const body = await response.json().catch(() => null)
    const detail = Array.isArray(body?.detail)
      ? body.detail.map((item) => item.msg || item.detail || JSON.stringify(item)).join(', ')
      : typeof body?.detail === 'object'
        ? JSON.stringify(body.detail)
        : body?.detail
    const error = new Error(detail || `Request failed with status ${response.status}`)
    error.status = response.status
    throw error
  }

  return response.json()
}

export function getReadiness() {
  return request('/ready')
}

function queueOfflineMutation(path, token, payload) {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]')
  queue.push({
    id: crypto.randomUUID(),
    path,
    token,
    payload,
    idempotencyKey: crypto.randomUUID(),
  })
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(queue))
}

export async function flushOfflineMutations() {
  const queue = JSON.parse(localStorage.getItem(OFFLINE_QUEUE_KEY) || '[]')
  const remaining = []
  for (const item of queue) {
    try {
      await request(item.path, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${item.token}`,
          'Idempotency-Key': item.idempotencyKey,
        },
        body: JSON.stringify(item.payload),
      })
    } catch (error) {
      if (error.status !== 409) remaining.push(item)
    }
  }
  localStorage.setItem(OFFLINE_QUEUE_KEY, JSON.stringify(remaining))
  return { flushed: queue.length - remaining.length, pending: remaining.length }
}

export async function login(email, password) {
  if (useSupabaseAuth) {
    const { data, error } = await supabase.auth.signInWithPassword({ email, password })
    if (!error && data.session) {
      return { access_token: data.session.access_token, token_type: 'bearer' }
    }
    throw new Error(error?.message || 'Unable to sign in')
  }
  return request('/api/v1/auth/login', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  })
}

export async function requestPasswordReset(email) {
  if (!useSupabaseAuth) {
    throw new Error('Password recovery is available through the configured Supabase Auth provider.')
  }
  const { error } = await supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}/?page=app&reset=1`,
  })
  if (error) throw new Error(error.message)
}

export async function updatePassword(password) {
  if (!useSupabaseAuth) {
    throw new Error('Password recovery is available through the configured Supabase Auth provider.')
  }
  const { error } = await supabase.auth.updateUser({ password })
  if (error) throw new Error(error.message)
}

export async function logout() {
  if (useSupabaseAuth) {
    const { error } = await supabase.auth.signOut()
    if (error) throw new Error(error.message)
  }
}

export function signupOrganization(payload) {
  return request('/api/v1/auth/signup', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(async (result) => {
    if (useSupabaseAuth) {
      return login(payload.email, payload.password)
    }
    return result
  })
}

export function acceptInvitation(payload) {
  return request('/api/v1/auth/invitations/accept', {
    method: 'POST',
    body: JSON.stringify(payload),
  }).then(async (result) => {
    if (useSupabaseAuth) {
      return login(result.user.email, payload.password)
    }
    return result
  })
}

export function createInvitation(token, payload) {
  return request('/api/v1/invitations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function getInvitations(token) {
  return request('/api/v1/invitations', { headers: { Authorization: `Bearer ${token}` } })
}

export function revokeInvitation(token, invitationId) {
  return request(`/api/v1/invitations/${invitationId}/revoke`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getUsers(token) {
  return request('/api/v1/users', { headers: { Authorization: `Bearer ${token}` } })
}

export function createUser(token, payload) {
  return request('/api/v1/users', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function updateUserRole(token, userId, role) {
  return request(`/api/v1/users/${userId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ role }),
  })
}

export function deleteUser(token, userId) {
  return request(`/api/v1/users/${userId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getVehicles(token) {
  return request('/api/v1/vehicles', {
    headers: { Authorization: `Bearer ${token}` },
  }).then((vehicles) => vehicles.map(mapVehicle))
}

export function updateVehicle(token, vehicleId, payload) {
  return request(`/api/v1/vehicles/${vehicleId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  }).then(mapVehicle)
}

export function deleteVehicle(token, vehicleId) {
  return request(`/api/v1/vehicles/${vehicleId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getCurrentUser(token) {
  return request('/api/v1/auth/me', { headers: { Authorization: `Bearer ${token}` } })
}

export function getAuditLog(token, filters = {}) {
  const params = new URLSearchParams(Object.entries(filters).filter(([, value]) => value !== undefined && value !== ''))
  return request(`/api/v1/audit-log${params.toString() ? `?${params}` : ''}`, { headers: { Authorization: `Bearer ${token}` } })
}

export function getFleetOperationsSummary(token) {
  return request('/api/v1/fleet/operations-summary', { headers: { Authorization: `Bearer ${token}` } })
}

export function getFleetAnalytics(token) {
  return request('/api/v1/fleet/analytics', { headers: { Authorization: `Bearer ${token}` } })
}

export function updateMyContact(token, mobile_phone) {
  return request('/api/v1/users/me/contact', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mobile_phone }),
  })
}

export function updateMyProfile(token, profile) {
  return request('/api/v1/users/me', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(profile),
  })
}

export function getSubscription(token) {
  return request('/api/v1/subscription', { headers: { Authorization: `Bearer ${token}` } })
}

export function changeSubscription(token, planCode) {
  return request('/api/v1/subscription', {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan_code: planCode }),
  })
}

export function getSubscriptionPlans(token) {
  return request('/api/v1/subscription/plans', { headers: { Authorization: `Bearer ${token}` } })
}

export function createSubscriptionCheckout(token, planCode) {
  return request('/api/v1/subscription/checkout', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ plan_code: planCode }),
  })
}

export function verifySubscriptionPayment(token, payment) {
  return request('/api/v1/subscription/verify', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payment),
  })
}

export function getNotificationPreferences(token) {
  return request('/api/v1/notification-preferences', { headers: { Authorization: `Bearer ${token}` } })
}

export function updateNotificationPreference(token, preference) {
  return request('/api/v1/notification-preferences', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(preference),
  })
}

export function getNotificationDeliveries(token) {
  return request('/api/v1/notification-deliveries', { headers: { Authorization: `Bearer ${token}` } })
}

export function dispatchQueuedSms(token) {
  return request('/api/v1/notification-deliveries/dispatch', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createVehicle(token, vehicle) {
  return request('/api/v1/vehicles', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      registration_number: vehicle.registration_number ?? vehicle.reg,
      model: vehicle.model,
      vehicle_type: vehicle.vehicle_type ?? vehicle.type,
      depot: vehicle.depot,
      status: 'Idle / parked',
      health: 100,
      odometer_km: 0,
      driver_name: null,
    }),
  }).then(mapVehicle)
}

export function getWorkOrders(token) {
  return request('/api/v1/work-orders', { headers: { Authorization: `Bearer ${token}` } })
}

export function getVehicleAssignments(token, vehicleId) {
  return request(`/api/v1/vehicles/${vehicleId}/assignments`, { headers: { Authorization: `Bearer ${token}` } })
}

export function getVehicleOdometer(token, vehicleId) {
  return request(`/api/v1/vehicles/${vehicleId}/odometer`, { headers: { Authorization: `Bearer ${token}` } })
}

export function getBillingInvoices(token) {
  return request('/api/v1/billing/invoices', { headers: { Authorization: `Bearer ${token}` } })
}

export function getBillingPayments(token, invoiceId) {
  return request(`/api/v1/billing/invoices/${invoiceId}/payments`, { headers: { Authorization: `Bearer ${token}` } })
}

export function createWorkOrder(token, workOrder) {
  return request('/api/v1/work-orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(workOrder),
  })
}

export function updateWorkOrder(token, workOrderId, payload) {
  return request(`/api/v1/work-orders/${workOrderId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function deleteWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getComponents(token) {
  return request('/api/v1/components', { headers: { Authorization: `Bearer ${token}` } })
}

export function createComponent(token, component) {
  return request('/api/v1/components', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(component),
  })
}

export function updateComponent(token, componentId, payload) {
  return request(`/api/v1/components/${componentId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function deleteComponent(token, componentId) {
  return request(`/api/v1/components/${componentId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function completeComponentService(token, componentId, odometerKm) {
  return request(`/api/v1/components/${componentId}/service-complete?odometer_km=${odometerKm}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getMaintenancePlans(token) {
  return request('/api/v1/maintenance-plans', { headers: { Authorization: `Bearer ${token}` } })
}

export function createMaintenancePlan(token, plan) {
  return request('/api/v1/maintenance-plans', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(plan),
  })
}

export function getParts(token) {
  return request('/api/v1/parts', { headers: { Authorization: `Bearer ${token}` } })
}

export function createPart(token, part) {
  return request('/api/v1/parts', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(part),
  })
}

export function createInventoryTransaction(token, transaction) {
  return request('/api/v1/inventory/transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(transaction),
  })
}

export function getStockLocations(token) {
  return request('/api/v1/stock-locations', { headers: { Authorization: `Bearer ${token}` } })
}

export function createStockLocation(token, location) {
  return request('/api/v1/stock-locations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(location),
  })
}

export function createInventoryMovement(token, movement) {
  return request('/api/v1/inventory/movements', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(movement),
  })
}

export function getExpenses(token) {
  return request('/api/v1/expenses', { headers: { Authorization: `Bearer ${token}` } })
}

export function createExpense(token, expense) {
  return request('/api/v1/expenses', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(expense),
  })
}

export function updateExpense(token, expenseId, payload) {
  return request(`/api/v1/expenses/${expenseId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function createFuelTransaction(token, payload) {
  return request('/api/v1/fuel-transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function createTollTransaction(token, payload) {
  return request('/api/v1/toll-transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function getDocuments(token) {
  return request('/api/v1/documents', { headers: { Authorization: `Bearer ${token}` } })
}

export function createDocument(token, document) {
  return request('/api/v1/documents', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(document),
  })
}

export function updateDocument(token, documentId, document) {
  return request(`/api/v1/documents/${documentId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(document),
  })
}

export async function uploadDocumentFile(token, documentId, file) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE_URL}/api/v1/documents/${documentId}/file`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) throw new Error(`Upload failed with status ${response.status}`)
  return response.json()
}

export function getVendors(token) {
  return request('/api/v1/vendors', { headers: { Authorization: `Bearer ${token}` } })
}

export function createVendor(token, vendor) {
  return request('/api/v1/vendors', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(vendor),
  })
}

export function getPurchaseOrders(token) {
  return request('/api/v1/purchase-orders', { headers: { Authorization: `Bearer ${token}` } })
}

export function createPurchaseOrder(token, payload) {
  return request('/api/v1/purchase-orders', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function updatePurchaseOrder(token, orderId, status) {
  return request(`/api/v1/purchase-orders/${orderId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  })
}

export function getPurchaseOrderReceipts(token, orderId) {
  return request(`/api/v1/purchase-orders/${orderId}/receipts`, { headers: { Authorization: `Bearer ${token}` } })
}

export function receivePurchaseOrder(token, orderId, payload) {
  return request(`/api/v1/purchase-orders/${orderId}/receipts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function downloadUrl(path) {
  return `${API_BASE_URL}${path}`
}

export async function downloadFile(token, path, filename) {
  const response = await fetch(downloadUrl(path), {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) throw new Error(`Download failed with status ${response.status}`)
  const blob = await response.blob()
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function exportResource(token, resource) {
  return fetch(downloadUrl(`/api/v1/export/${resource}`), {
    headers: { Authorization: `Bearer ${token}` },
  }).then(async (response) => {
    if (!response.ok) throw new Error(`Export failed with status ${response.status}`)
    return response.blob()
  })
}

export async function importResource(token, resource, file) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE_URL}/api/v1/import/${resource}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) throw new Error(`Import failed with status ${response.status}`)
  return response.json()
}

export function getAlerts(token) {
  return request('/api/v1/alerts', { headers: { Authorization: `Bearer ${token}` } })
}

export function getNotifications(token) {
  return request('/api/v1/notifications', { headers: { Authorization: `Bearer ${token}` } })
}

export function getTelematicsIntegrations(token) {
  return request('/api/v1/telematics/integrations', { headers: { Authorization: `Bearer ${token}` } })
}

export function getTelematicsHealth(token) {
  return request('/api/v1/telematics/health', { headers: { Authorization: `Bearer ${token}` } })
}

export function syncDueTelematics(token) {
  return request('/api/v1/telematics/sync-due', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createTelematicsIntegration(token, payload) {
  return request('/api/v1/telematics/integrations', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function createTelematicsDevice(token, payload) {
  return request('/api/v1/telematics/devices', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function updateTelematicsIntegration(token, integrationId, payload) {
  return request(`/api/v1/telematics/integrations/${integrationId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function deleteTelematicsIntegration(token, integrationId) {
  return request(`/api/v1/telematics/integrations/${integrationId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getTelematicsDevices(token) {
  return request('/api/v1/telematics/devices', { headers: { Authorization: `Bearer ${token}` } })
}

export function ingestTelemetry(token, deviceId, payload) {
  return request(`/api/v1/telematics/devices/${deviceId}/readings`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify(payload),
  })
}

export function updateNotification(token, notificationId, status) {
  return request(`/api/v1/notifications/${notificationId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ status }),
  })
}

export function resolveNotification(token, notificationId) {
  return request(`/api/v1/notifications/${notificationId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getWorkOrderChecklist(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/checklist`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateWorkOrderChecklist(token, workOrderId, items) {
  return request(`/api/v1/work-orders/${workOrderId}/checklist`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ items }),
  })
}

export function startWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/start`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function completeWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/complete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function approveWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function archiveWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function getWorkOrderParts(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/parts`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getWorkOrderTimeline(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/timeline`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function recordWorkOrderPart(token, workOrderId, payload) {
  return request(`/api/v1/work-orders/${workOrderId}/parts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getWorkOrderEvidence(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/evidence`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export async function uploadWorkOrderEvidence(token, workOrderId, file) {
  const form = new FormData()
  form.append('file', file)
  const response = await fetch(`${API_BASE_URL}/api/v1/work-orders/${workOrderId}/evidence`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: form,
  })
  if (!response.ok) throw new Error(`Evidence upload failed with status ${response.status}`)
  return response.json()
}

export function getDriverInspections(token) {
  return request('/api/v1/driver/inspections', { headers: { Authorization: `Bearer ${token}` } })
}

export async function createDriverInspection(token, payload) {
  if (!navigator.onLine) {
    queueOfflineMutation('/api/v1/driver/inspections', token, payload)
    return { queued: true }
  }
  try {
    return await request('/api/v1/driver/inspections', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      queueOfflineMutation('/api/v1/driver/inspections', token, payload)
      return { queued: true }
    }
    throw error
  }
}

export async function createDriverIssue(token, payload) {
  if (!navigator.onLine) {
    queueOfflineMutation('/api/v1/driver/issues', token, payload)
    return { queued: true }
  }
  try {
    return await request('/api/v1/driver/issues', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
      body: JSON.stringify(payload),
    })
  } catch (error) {
    if (error instanceof TypeError) {
      queueOfflineMutation('/api/v1/driver/issues', token, payload)
      return { queued: true }
    }
    throw error
  }
}

export function getDriverIssues(token) {
  return request('/api/v1/driver/issues', { headers: { Authorization: `Bearer ${token}` } })
}

export function reconcileExpense(token, expenseId) {
  return request(`/api/v1/expenses/${expenseId}/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function reverseExpense(token, expenseId, reason) {
  return request(`/api/v1/expenses/${expenseId}/reverse`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason }),
  })
}

// Assignment endpoints for FleetOps parity
export function getAssignableMembers(token) {
  return request('/api/v1/team/assignable-members', { headers: { Authorization: `Bearer ${token}` } })
}

export function getTeamRoster(token) {
  return request('/api/v1/team/roster', { headers: { Authorization: `Bearer ${token}` } })
}

export function assignVehicleDriver(token, vehicleId, driverId) {
  return request(`/api/v1/vehicles/${vehicleId}/assign-driver`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ driver_id: driverId }),
  })
}

export function assignWorkOrder(token, workOrderId, mechanicId) {
  return request(`/api/v1/work-orders/${workOrderId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}` },
    body: JSON.stringify({ mechanic_id: mechanicId }),
  })
}

export function getWorkOrderHandoffTimeline(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/handoff-timeline`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}


// ============================================================================
// NEW API FUNCTIONS - FEATURE PARITY WITH FLEETOPS
// ============================================================================

// System endpoints
export function getSystemHealth() {
  return request('/api/v1/system/health')
}

export function getSystemVersion() {
  return request('/api/v1/system/version')
}

export function getSystemConfig(token) {
  return request('/api/v1/system/config', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Organization settings
export function getOrganizationSettings(token) {
  return request('/api/v1/organization/settings', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateOrganizationSettings(token, payload) {
  return request('/api/v1/organization/settings', {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getOrganizationQuota(token) {
  return request('/api/v1/organization/quota', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Dashboard
export function getDashboardSummary(token) {
  return request('/api/v1/dashboard/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getDashboardMetrics(token, metricType) {
  return request(`/api/v1/dashboard/metrics/${metricType}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Maintenance
export function listMaintenanceTemplates(token) {
  return request('/api/v1/maintenance/templates', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function createMaintenanceTemplate(token, payload) {
  return request('/api/v1/maintenance/templates', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getMaintenancePlan(token) {
  return request('/api/v1/maintenance/plan', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getMaintenanceForecast(token, daysAhead = 90) {
  return request(`/api/v1/maintenance/forecast?days_ahead=${daysAhead}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Onboarding
export function getOnboardingStatus(token) {
  return request('/api/v1/onboarding/status', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getOnboardingChecklist(token) {
  return request('/api/v1/onboarding/checklist', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function bootstrapOnboarding(token, payload) {
  return request('/api/v1/onboarding/bootstrap', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

// Work Order Advanced
export function reservePartForWorkOrder(token, workOrderId, payload) {
  return request(`/api/v1/work-orders/${workOrderId}/reserve-part`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function returnReservedPart(token, workOrderId, payload) {
  return request(`/api/v1/work-orders/${workOrderId}/return-reserved-part`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getWorkOrderBoard(token) {
  return request('/api/v1/work-orders/board', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getWorkOrderBoardStats(token) {
  return request('/api/v1/work-orders/board/stats', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function bulkUpdateWorkOrders(token, payload) {
  return request('/api/v1/work-orders/bulk-update', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function reorderPartsForWorkOrder(token, workOrderId) {
  return request(`/api/v1/work-orders/${workOrderId}/reorder-parts`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

// Inventory Advanced
export function getInventoryPartDetail(token, partId) {
  return request(`/api/v1/inventory/parts/${partId}/detail`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getInventoryPartReferences(token, partId) {
  return request(`/api/v1/inventory/parts/${partId}/references`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getInventoryByLocation(token, locationId) {
  return request(`/api/v1/inventory/parts/by-location/${locationId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getInventorySummary(token) {
  return request('/api/v1/inventory/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Driver Advanced
export function getDriverDailyHome(token, driverId) {
  return request(`/api/v1/drivers/${driverId}/daily-home`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function reportUnsafeDisposition(token, driverId, payload) {
  return request(`/api/v1/drivers/${driverId}/unsafe-disposition`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getDriverBehaviorScore(token, driverId) {
  return request(`/api/v1/drivers/${driverId}/behavior-score`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getDriversSummary(token) {
  return request('/api/v1/drivers/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Triage System
export function getTriageQueue(token) {
  return request('/api/v1/triage/queue', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getTriageStats(token) {
  return request('/api/v1/triage/stats', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateTriageIssue(token, issueId, payload) {
  return request(`/api/v1/triage/issues/${issueId}`, {
    method: 'PUT',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function createWorkOrderFromIssue(token, issueId, payload) {
  return request(`/api/v1/triage/issues/${issueId}/create-work-order`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function assignTriageIssue(token, issueId, payload) {
  return request(`/api/v1/triage/issues/${issueId}/assign`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function resolveTriageIssue(token, issueId, payload) {
  return request(`/api/v1/triage/issues/${issueId}/resolve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

// Reports
export function getMaintenancePerformanceReport(token, startDate, endDate) {
  return request(`/api/v1/reports/maintenance-performance?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getVehicleMaintenanceHistory(token, vehicleId) {
  return request(`/api/v1/reports/vehicle-maintenance-history?vehicle_id=${vehicleId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFuelEfficiencyReport(token, startDate, endDate) {
  return request(`/api/v1/reports/fuel-efficiency?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Financials
export function getFinancialMetrics(token, startDate, endDate) {
  return request(`/api/v1/financials/metrics?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFinancialReconciliation(token) {
  return request('/api/v1/financials/reconciliation', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFinancialApprovalQueue(token) {
  return request('/api/v1/financials/approval-queue', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function approveExpense(token, expenseId) {
  return request(`/api/v1/financials/expenses/${expenseId}/approve`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function rejectExpense(token, expenseId, payload) {
  return request(`/api/v1/financials/expenses/${expenseId}/reject`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function bulkApproveExpenses(token, payload) {
  return request('/api/v1/financials/bulk-approve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

// Billing
export function checkPlanEligibility(token) {
  return request('/api/v1/billing/test/check-plan-eligibility', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function activateStarterPlan(token) {
  return request('/api/v1/billing/test/activate-starter', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
  })
}

export function getTestPlans(token) {
  return request('/api/v1/billing/test/plans', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Notifications Advanced
export function getNotificationSourceDetail(token, notificationId) {
  return request(`/api/v1/notifications/${notificationId}/source-detail`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function escalateNotification(token, notificationId, payload) {
  return request(`/api/v1/notifications/${notificationId}/escalate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getPendingNotifications(token) {
  return request('/api/v1/notifications/pending', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function bulkResolveNotifications(token, payload) {
  return request('/api/v1/notifications/bulk-resolve', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

// Vendors
export function getVendorPricingHistory(token, vendorId) {
  return request(`/api/v1/vendors/${vendorId}/pricing-history`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Purchase Orders Advanced
export function receivePartialPurchaseOrder(token, poId, payload) {
  return request(`/api/v1/purchase-orders/${poId}/receive-partial`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

// Compliance
export function getComplianceSummary(token) {
  return request('/api/v1/compliance/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getComplianceExpiryReport(token, daysAhead = 90) {
  return request(`/api/v1/compliance/documents/expiry-report?days_ahead=${daysAhead}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Activity Feed
export function getActivityFeed(token, limit = 50) {
  return request(`/api/v1/activity-feed?limit=${limit}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}

export function getActivityFeedByType(token, type) {
  return request(`/api/v1/activity-feed/by-type?activity_type=${type}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}

// Audit Logs Advanced
export function getAuditLogsAdvanced(token, filters) {
  const query = new URLSearchParams(filters).toString()
  return request(`/api/v1/audit/logs/advanced?${query}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}


// Missing Triage functions
export function escalateTriageIssue(token, issueId, payload) {
  return request(`/api/v1/triage/issues/${issueId}/escalate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(payload),
  })
}

export function getTriageDashboard(token) {
  return request('/api/v1/triage/dashboard', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Missing Reports functions
export function generateReport(token, reportType, filters) {
  return request('/api/v1/reports/generate', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({ report_type: reportType, ...filters }),
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function listReports(token) {
  return request('/api/v1/reports', {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}

export function downloadReport(token, reportId) {
  return downloadFile(token, `/reports/${reportId}/download`, `report-${reportId}.pdf`).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

// Missing Financials functions
export function getFinancialsSummary(token) {
  return request('/api/v1/financials/summary', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function scheduleMaintenancePlan(token, planId, scheduleData) {
  return request(`/api/v1/maintenance-plans/${planId}/schedule`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(scheduleData),
  })
}

export function getMaintenancePlanSchedule(token, planId) {
  return request(`/api/v1/maintenance-plans/${planId}/schedule`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateMaintenancePlan(token, planId, planData) {
  return request(`/api/v1/maintenance-plans/${planId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(planData),
  })
}

export function deleteMaintenancePlan(token, planId) {
  return request(`/api/v1/maintenance-plans/${planId}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Vendor functions
export function getVendorList(token) {
  return request('/api/v1/vendors', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getVendorDetails(token, vendorId) {
  return request(`/api/v1/vendors/${vendorId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateVendor(token, vendorId, vendorData) {
  return request(`/api/v1/vendors/${vendorId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(vendorData),
  })
}

export function createVendorPricingRecord(token, vendorId, pricingData) {
  return request(`/api/v1/vendors/${vendorId}/pricing`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(pricingData),
  })
}

export function getVendorPerformanceMetrics(token, vendorId) {
  return request(`/api/v1/vendors/${vendorId}/performance`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

// Procurement functions (Purchase Orders)
export function getPurchaseOrderDetails(token, orderId) {
  return request(`/api/v1/purchase-orders/${orderId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getPurchaseOrderLines(token, orderId) {
  return request(`/api/v1/purchase-orders/${orderId}/lines`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function receiveFullPurchaseOrder(token, orderId, receiptData) {
  return request(`/api/v1/purchase-orders/${orderId}/receive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(receiptData),
  })
}

export function rejectPurchaseOrderReceipt(token, orderId, rejectData) {
  return request(`/api/v1/purchase-orders/${orderId}/reject-receipt`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(rejectData),
  })
}

export function getPurchaseOrderHistory(token, orderId) {
  return request(`/api/v1/purchase-orders/${orderId}/history`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function reconcilePurchaseOrder(token, orderId, reconciliationData) {
  return request(`/api/v1/purchase-orders/${orderId}/reconcile`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(reconciliationData),
  })
}


// Telematics functions
export function getTelematicsDeviceDetails(token, deviceId) {
  return request(`/api/v1/telematics/devices/${deviceId}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getTelemetryReadings(token, deviceId, startDate, endDate) {
  return request(`/api/v1/telematics/readings?device_id=${deviceId}&start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function updateTelematicsDevice(token, deviceId, deviceData) {
  return request(`/api/v1/telematics/devices/${deviceId}`, {
    method: 'PATCH',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(deviceData),
  })
}

export function deactivateTelematicsDevice(token, deviceId) {
  return request(`/api/v1/telematics/devices/${deviceId}/deactivate`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({}),
  })
}

// Driver Behavior functions
export function getDriverBehaviorEvents(token, driverId, startDate, endDate) {
  return request(`/api/v1/drivers/${driverId}/behavior-events?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getDriverPerformanceMetrics(token, driverId, period = '30d') {
  return request(`/api/v1/drivers/${driverId}/performance?period=${period}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFleetDriverMetrics(token) {
  return request('/api/v1/drivers/fleet-metrics', {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFuelTransactions(token, vehicleId = null, startDate = null, endDate = null) {
  let url = '/api/v1/fuel-transactions'
  const params = []
  if (vehicleId) params.push(`vehicle_id=${vehicleId}`)
  if (startDate) params.push(`start_date=${startDate}`)
  if (endDate) params.push(`end_date=${endDate}`)
  if (params.length) url += '?' + params.join('&')
  return request(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
}

export function getFuelEfficiencyAnalysis(token, vehicleId, startDate, endDate) {
  return request(`/api/v1/fuel-analytics/efficiency?vehicle_id=${vehicleId}&start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function getFuelCostAnalysis(token, startDate, endDate) {
  return request(`/api/v1/fuel-analytics/cost?start_date=${startDate}&end_date=${endDate}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function getFuelTrends(token, days = 30) {
  return request(`/api/v1/fuel-analytics/trends?days=${days}`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function logFuelTransaction(token, transactionData) {
  return request('/api/v1/fuel-transactions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(transactionData),
  })
}

// Compliance Versioning functions
export function getComplianceDocuments(token, vehicleId = null) {
  let url = '/api/v1/compliance/documents'
  if (vehicleId) url += `?vehicle_id=${vehicleId}`
  return request(url, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}

export function getDocumentVersions(token, documentId) {
  return request(`/api/v1/compliance/documents/${documentId}/versions`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}

export function updateDocumentVersion(token, documentId, versionData) {
  return request(`/api/v1/compliance/documents/${documentId}/versions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify(versionData),
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function archiveComplianceDocument(token, documentId) {
  return request(`/api/v1/compliance/documents/${documentId}/archive`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Idempotency-Key': crypto.randomUUID() },
    body: JSON.stringify({}),
  }).catch(err => {
    if (err.status === 404) return null
    throw err
  })
}

export function getComplianceAuditTrail(token, documentId) {
  return request(`/api/v1/compliance/documents/${documentId}/audit-trail`, {
    headers: { Authorization: `Bearer ${token}` },
  }).catch(err => {
    if (err.status === 404) return []
    throw err
  })
}