# VahanSync Master Bugfix Roadmap

## Overview
36 bugs identified across frontend (React/Vite), backend (FastAPI), and database layers.
Execution strategy: Fix by category in priority order.
App running locally: frontend localhost:5173, backend localhost:8000, database vahana.db

## Category 1: Truncated Files (CRITICAL - Phase 1)
- [Bug 1] backend/app/routes.py line 717+ incomplete - HIGH EFFORT
- [Bug 2] src/main.jsx line 316+ incomplete - HIGH EFFORT
- [Bug 3] src/api.js line 943+ incomplete - HIGH EFFORT
- [Bug 4] backend/app/models.py incomplete - HIGH EFFORT
Status: Not started
Dependencies: None
Effort: 8 hours
Impact: Blocks all other features

## Category 2: Security Issues (CRITICAL - Phase 2)
- [Bug 6] SQL injection /audit-log endpoint - MEDIUM EFFORT - *IN PROGRESS*
- [Bug 7] Fleet manager permission gap - MEDIUM EFFORT
- [Bug 8] Database migration mismatch - LOW EFFORT
Status: Partially started (Bug 6)
Dependencies: None
Effort: 4 hours
Impact: Critical security holes

## Category 3: Type & Schema Issues (HIGH - Phase 2)
- [Bug 5] Vehicle model type mismatch (assigned_driver_id vs driver_name) - LOW EFFORT
- [Bug 9] WorkOrderAssignment schema missing - MEDIUM EFFORT
- [Bug 10] Financial schema missing - MEDIUM EFFORT
- [Bug 24] Email validation missing - LOW EFFORT
- [Bug 28] Database constraints missing - MEDIUM EFFORT
- [Bug 32] API naming inconsistency - HIGH EFFORT
Status: Not started
Dependencies: After truncated files fixed
Effort: 6 hours
Impact: Data integrity, API consistency

## Category 4: Pagination (HIGH - Phase 3)
- [Bug 11] /vehicles, /work-orders, /users missing pagination - MEDIUM EFFORT
- [Bug 12] /inventory missing pagination - LOW EFFORT
Status: Not started
Dependencies: After truncated files fixed
Effort: 2 hours
Impact: Performance, UX

## Category 5: Transactions & Race Conditions (HIGH - Phase 3)
- [Bug 14] Inventory transaction race condition - MEDIUM EFFORT
- [Bug 15] Vehicle status transition race condition - MEDIUM EFFORT
Status: Not started
Dependencies: After database setup complete
Effort: 3 hours
Impact: Data consistency

## Category 6: Timezone & Localization (MEDIUM - Phase 4)
- [Bug 16] Timezone handling inconsistent - MEDIUM EFFORT
- [Bug 27] IST hardcoded (should be configurable) - LOW EFFORT
Status: Not started
Dependencies: Schema updates complete
Effort: 2 hours
Impact: Multi-region support

## Category 7: Code Duplication (LOW - Phase 5)
- [Bug 18] calculateDistance duplicated - LOW EFFORT
- [Bug 31] formatDate duplicated - LOW EFFORT
Status: Not started
Dependencies: None
Effort: 1 hour
Impact: Maintainability

## Category 8: Missing Middleware & Headers (MEDIUM - Phase 3)
- [Bug 13] CORS middleware missing headers - LOW EFFORT
Status: Not started
Dependencies: None
Effort: 30 minutes
Impact: Cross-origin requests

## Category 9: Missing Features (MEDIUM - Phase 4)
- [Bug 19] Work order notifications missing - MEDIUM EFFORT
- [Bug 20] API field validation incomplete - MEDIUM EFFORT
- [Bug 21] Inventory sync gaps - MEDIUM EFFORT
- [Bug 22] Financial audit trail missing - MEDIUM EFFORT
- [Bug 25] Inconsistent response structures - MEDIUM EFFORT
- [Bug 26] Report field mappings missing - MEDIUM EFFORT
- [Bug 30] /organization/{id}/settings endpoint incomplete - MEDIUM EFFORT
Status: Not started
Dependencies: Schemas complete, features available
Effort: 8 hours
Impact: Feature completeness

## Category 10: Performance (MEDIUM - Phase 4)
- [Bug 29] N+1 queries in vehicle listing - LOW EFFORT
Status: Not started
Dependencies: None
Effort: 1 hour
Impact: Query performance

## Category 11: Permissions (MEDIUM - Phase 4)
- [Bug 23] Fleet manager cannot create fleets - LOW EFFORT
Status: Not started
Dependencies: Permission system complete
Effort: 30 minutes
Impact: Access control

## Category 12: Hardcoded Values (MEDIUM - Phase 4)
- [Bug 17] Hardcoded subscription plans - MEDIUM EFFORT
Status: Not started
Dependencies: Database schema complete
Effort: 2 hours
Impact: Flexibility, admin control

## Category 13: Polish & Testing (LOW - Phase 5)
- [Bug 33] Missing function docstrings - LOW EFFORT
- [Bug 34] Missing unit tests - HIGH EFFORT
- [Bug 35] Frontend console warnings - LOW EFFORT
- [Bug 36] Form validation message inconsistencies - LOW EFFORT
Status: Not started
Dependencies: Code complete
Effort: 4 hours
Impact: Code quality

## Execution Plan

**Phase 1: Foundation (Truncated Files)** - 8 hours
Fix all incomplete file implementations first. This unblocks all other features.

**Phase 2: Security & Schemas** - 10 hours
Fix critical security issues and schema/type problems that affect data integrity.

**Phase 3: Core Functionality** - 7 hours
Add pagination, fix race conditions, add middleware.

**Phase 4: Features & Optimization** - 13 hours
Implement missing features, optimize queries, fix permissions, add timezone support.

**Phase 5: Polish** - 5 hours
Add tests, docstrings, clean up warnings, standardize messages.

**Total Estimated Effort: 43 hours**

## Current Status
- SQL injection (Bug 6): Partially complete with exploration tests, preservation tests, and fix applied
- All other 35 bugs: Not started

## Next Steps
1. Complete Bug 6 (SQL injection) - finish integration tests and QA tasks
2. Start Phase 1 (Truncated files) - highest impact, unblocks everything
3. Continue through remaining phases in order
