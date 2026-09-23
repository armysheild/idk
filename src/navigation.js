export const roleNames = {
  owner: 'Owner / Superadmin',
  fleet_manager: 'Fleet Manager',
  inventory_manager: 'Inventory Manager',
  mechanic: 'Mechanic',
  technician: 'Technician',
  driver: 'Driver',
  accountant: 'Accountant',
}

export const navByRole = {
  owner: [['command', 'Command centre', '⌂'], ['members', 'Members & invitations', '♙'], ['billing', 'Billing & plans', '₹'], ['audit', 'Audit trail', '≋'], ['settings', 'Organisation settings', '⚙'], ['onboarding', 'Onboarding checklist', '✦'], ['triage', 'Triage queue', '⚠'], ['reports', 'Reports', '📊'], ['finance', 'Financial dashboard', '₹'], ['activity', 'Activity feed', '◈'], ['telematics', 'GPS & telematics', '⛛'], ['driver-behavior', 'Driver behavior', '👤'], ['fuel-tracking', 'Fuel tracking', '⛽'], ['compliance-versions', 'Compliance vault', '🔐'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  fleet_manager: [['fleet', 'Fleet command', '⌂'], ['vehicles', 'Vehicle register', '▣'], ['maintenance', 'Maintenance board', '◆'], ['maintenance-planning', 'Maintenance planning', '📅'], ['compliance', 'Compliance vault', '▤'], ['telematics', 'GPS & telematics', '⛛'], ['driver-behavior', 'Driver behavior', '👤'], ['fuel-tracking', 'Fuel tracking', '⛽'], ['triage', 'Triage queue', '⚠'], ['reports', 'Reports', '📊'], ['activity', 'Activity feed', '◈'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  inventory_manager: [['command', 'Inventory command', '⌂'], ['inventory', 'Parts & stock', '▦'], ['procurement', 'Procurement', '◇'], ['vendors', 'Vendor directory', '🤝'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  technician: [['command', 'Repair command', '⌂'], ['work', 'Assigned technical work', '◆'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  mechanic: [['command', 'Workshop command', '⌂'], ['work', 'Assigned workshop work', '◆'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  driver: [['command', 'Driver home', '⌂'], ['checks', 'Daily checks', '✓'], ['driver-behavior', 'Driver behavior', '👤'], ['fuel-tracking', 'Fuel tracking', '⛽'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
  accountant: [['command', 'Finance command', '⌂'], ['finance', 'Financial dashboard', '₹'], ['activity', 'Activity feed', '◈'], ['fuel-tracking', 'Fuel tracking', '⛽'], ['notifications', 'Notifications', '◌'], ['profile', 'Profile & account', '◎']],
}

export function workspaceFromLocation(location = window.location) {
  const pathWorkspace = location.pathname.startsWith('/app/')
    ? location.pathname.slice('/app/'.length).split('/')[0]
    : ''
  const workspace = pathWorkspace || new URLSearchParams(location.search).get('workspace')
  return workspace && workspaceIds.has(workspace) ? workspace : 'command'
}

export function workspaceForRole(workspace, role) {
  const allowed = navByRole[role] || navByRole.owner
  return allowed.some(([id]) => id === workspace) ? workspace : allowed[0][0]
}

export function navigateToWorkspace(workspace) {
  const url = new URL(window.location.href)
  url.pathname = `/app/${workspace}`
  url.searchParams.set('page', 'app')
  url.searchParams.delete('workspace')
  window.history.pushState({ workspace }, '', url)
  window.dispatchEvent(new PopStateEvent('popstate', { state: { workspace } }))
}

const workspaceIds = new Set(Object.values(navByRole).flat().map(([id]) => id))
