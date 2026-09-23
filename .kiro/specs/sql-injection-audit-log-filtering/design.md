# SQL Injection in Audit Log Filtering - Bugfix Design

## Overview

The `/audit-log` endpoint in `backend/app/routes.py` contains a critical SQL injection vulnerability in its filtering logic. User-provided `action` and `outcome` query parameters are directly interpolated into SQLAlchemy LIKE filter expressions using f-string formatting. This bypasses SQLAlchemy's parameter binding protection, allowing authenticated attackers to inject arbitrary SQL code and potentially extract or manipulate audit records across the organization.

The fix replaces f-string interpolation with direct parameter passing to SQLAlchemy's `ilike()` method, which automatically parameterizes the values and prevents SQL interpretation. This is a minimal, targeted fix that preserves all existing functionality while eliminating the injection vector.

## Glossary

- **Bug_Condition (C)**: The presence of user-controlled `action` or `outcome` query parameters containing SQL metacharacters that get interpolated into filter expressions via f-string formatting
- **Property (P)**: The fixed function SHALL treat these parameters as literal strings and automatically parameterize them through SQLAlchemy's ORM, preventing SQL interpretation
- **Preservation**: All non-malicious filtering behavior, organization isolation, and API contract must remain unchanged
- **SQLAlchemy `ilike()` method**: The ORM method for case-insensitive substring matching that automatically parameterizes arguments when not using f-string interpolation
- **Parameter binding**: SQLAlchemy's mechanism to safely pass user input to SQL queries by separating SQL structure from data values
- **SQL metacharacters**: Characters with special meaning in SQL (', ", --, ;, UNION, etc.) that enable injection attacks

## Bug Details

### Bug Condition

The bug manifests when an authenticated owner user provides an `action` or `outcome` query parameter to the `/audit-log` endpoint. The vulnerable code in `list_audit_log()` function directly interpolates these untrusted parameters into SQLAlchemy filter expressions using Python f-strings:

```python
if action:
    query = query.filter(AuditLog.action.ilike(f"%{action}%"))
if outcome:
    query = query.filter(AuditLog.changes.ilike(f"%{outcome}%"))
```

When the `action` or `outcome` parameter contains SQL metacharacters or injection payloads, the f-string interpolates them directly into the filter string, which SQLAlchemy then interprets as SQL. This bypasses the ORM's parameter binding protection.

**Formal Specification:**
```
FUNCTION isBugCondition(input)
  INPUT: input of type QueryParameters
  OUTPUT: boolean
  
  RETURN (input.action is not None OR input.outcome is not None)
         AND (input.action contains SQL_metacharacters OR 
              input.outcome contains SQL_metacharacters)
         AND parameters_interpolated_via_f_string(input)
END FUNCTION
```

### Examples

**Example 1: Action parameter SQL injection**
- Request: `GET /api/v1/audit-log?action=%' OR '1'='1`
- Current behavior (VULNERABLE): The f-string produces `f"%{action}%"` → `"%' OR '1'='1%"`, which becomes part of the SQL WHERE clause and bypasses filtering logic
- Expected behavior: Parameter treated as literal string `%' OR '1'='1%`, matching only audit logs whose action field literally contains this substring (none in normal circumstances)

**Example 2: Outcome parameter UNION injection**
- Request: `GET /api/v1/audit-log?outcome=success' UNION SELECT * FROM users WHERE '1'='1`
- Current behavior (VULNERABLE): The injected SQL becomes part of the WHERE clause, potentially allowing data extraction
- Expected behavior: Parameter treated as literal string, no SQL injection possible

**Example 3: Valid filter (baseline)**
- Request: `GET /api/v1/audit-log?action=create&outcome=success`
- Current behavior: Works correctly, returns audit logs with substring matches
- Expected behavior: MUST continue to work identically after fix

**Edge case: SQL metacharacters in legitimate use**
- Request: `GET /api/v1/audit-log?action=update%_changes`
- Current behavior: f-string interpolation allows metacharacters to potentially affect query
- Expected behavior: Metacharacters treated literally, performing substring match on exact string `update%_changes`

## Expected Behavior

### Preservation Requirements

**Unchanged Behaviors:**
- `actor_role` filter using direct equality comparison must continue to work (already safe)
- `entity_type` filter using direct equality comparison must continue to work (already safe)
- Combination of multiple filters using AND logic must produce identical results
- Results must be filtered by `organization_id` to maintain multi-tenancy isolation
- Results must be ordered by `created_at` descending
- Results must respect the `limit` parameter (min 1, max 200)
- Unauthenticated requests must continue to be rejected
- Non-owner users must continue to be rejected by the `require_roles("owner")` dependency
- API response schema and field names must remain unchanged

**Scope:**
All legitimate use cases of the `/audit-log` endpoint—including valid substring searches, multiple filter combinations, and pagination—must produce exactly the same results after the fix. This includes:
- Filtering by `actor_role` (owner, fleet_manager, etc.)
- Filtering by `entity_type` (organization, user, vehicle, etc.)
- Filtering by `action` with normal text values (no injection)
- Filtering by `outcome` with normal text values (no injection)
- Combining filters (e.g., `actor_role=owner&action=create`)
- Authorization and permission checks
- Response ordering and pagination

## Hypothesized Root Cause

Based on the code analysis, the root causes are:

1. **Direct F-String Interpolation**: The developer used f-string formatting (`f"%{action}%"`) to build the search pattern. While convenient, this bypasses SQLAlchemy's built-in parameter binding mechanism that would automatically escape user input.

2. **Misunderstanding of SQLAlchemy ORM**: The developer may not have realized that passing a parameterized string directly to `ilike()` still results in safe parameterization. The ORM doesn't require f-strings to work—direct concatenation or variable passing is equally safe because SQLAlchemy handles parameterization internally.

3. **LIKE Clause Pattern Building**: To support substring matching (the leading and trailing `%` wildcards), the developer used f-strings to inject these literals into the search pattern. However, SQLAlchemy safely handles this if the entire pattern (including wildcards) is passed as a parameter value rather than built with f-strings.

4. **Lack of Input Validation**: There's no input validation or sanitization for these parameters, and the developer relied solely on f-string interpolation without recognizing it as a vulnerability vector.

## Correctness Properties

Property 1: Bug Condition - SQL Injection Prevention

_For any_ query parameter (`action` or `outcome`) that contains SQL metacharacters or injection payloads, the fixed `list_audit_log()` function SHALL treat the parameter as a literal string value, automatically parameterizing it through SQLAlchemy's ORM binding mechanism, preventing any SQL interpretation or injection.

**Validates: Requirements 2.1, 2.2, 2.3**

Property 2: Preservation - Legitimate Filtering Behavior

_For any_ query that does NOT contain SQL injection attempts (normal `action` and `outcome` substring searches, combined filters, valid pagination), the fixed `list_audit_log()` function SHALL produce exactly the same result set, column values, ordering, and response schema as the original function, preserving all legitimate filtering functionality.

**Validates: Requirements 3.1, 3.2, 3.3, 3.4, 3.5**

## Fix Implementation

### Changes Required

**File**: `backend/app/routes.py`

**Function**: `list_audit_log()` (approximately line 360-374)

**Specific Changes**:

1. **Action Parameter Fix**: Replace f-string interpolation with direct parameter passing
   - BEFORE: `query = query.filter(AuditLog.action.ilike(f"%{action}%"))`
   - AFTER: `query = query.filter(AuditLog.action.ilike("%" + action + "%"))`
   - OR: Store the pattern in a variable and pass it as a parameter: `search_pattern = f"%{action}%"` followed by `query = query.filter(AuditLog.action.ilike(search_pattern))`

2. **Outcome Parameter Fix**: Replace f-string interpolation with direct parameter passing
   - BEFORE: `query = query.filter(AuditLog.changes.ilike(f"%{outcome}%"))`
   - AFTER: `query = query.filter(AuditLog.changes.ilike("%" + outcome + "%"))`
   - OR: Store the pattern in a variable and pass it as a parameter

**Rationale**: When you pass a string to SQLAlchemy's `ilike()` method without using f-string interpolation, SQLAlchemy treats the entire string as a parameter value. It generates a parameterized SQL query like:
```sql
WHERE action ILIKE %s  -- with the search pattern as a bound parameter
```

The database engine receives the user input (`action` or `outcome`) only as a data value, never as SQL code, making injection impossible.

**Implementation Details**:
- The fix requires changing only 2 lines of code in the `list_audit_log()` function
- No changes needed to function signature, logic flow, or response schema
- No additional error handling required (SQLAlchemy already handles parameter binding)
- No dependencies need to be added or updated

## Testing Strategy

### Validation Approach

The testing strategy follows a two-phase approach: first, demonstrate that SQL injection works on the UNFIXED code (counterexamples), then verify the fix prevents injection and preserves legitimate functionality.

### Exploratory Bug Condition Checking

**Goal**: Surface concrete counterexamples that demonstrate the SQL injection vulnerability BEFORE implementing the fix. This confirms our root cause analysis and validates that the vulnerability is real and exploitable.

**Test Plan**: Write integration tests that:
1. Simulate SQL injection payloads in `action` and `outcome` parameters
2. Execute these tests on the UNFIXED code and observe that injection succeeds
3. Document the specific SQL that is executed (via database logs or query inspection)
4. Verify that the injected SQL causes unintended behavior (e.g., returning more records than expected, extracting unauthorized data)

**Test Cases**:

1. **OR Injection Test** (will succeed on unfixed code)
   - Payload: `action=%' OR '1'='1`
   - Expected on UNFIXED code: Query should return MORE records than intended (because `OR '1'='1'` makes the WHERE clause always true)
   - Expected on FIXED code: Query returns only records where action literally contains `' OR '1'='1'` (none)

2. **UNION Injection Test** (will succeed on unfixed code)
   - Payload: `outcome=x' UNION SELECT 1,2,3,4,5 WHERE '1'='1`
   - Expected on UNFIXED code: Query structure is corrupted, potentially returns unexpected columns or data
   - Expected on FIXED code: Query treats this as a literal string, returns no matches (audit logs don't have these exact strings in changes field)

3. **Comment Injection Test** (will succeed on unfixed code)
   - Payload: `action=x' -- comment that hides rest of query`
   - Expected on UNFIXED code: The `--` comment allows truncation of the WHERE clause, changing query behavior
   - Expected on FIXED code: Treated as literal string, no SQL truncation

4. **Boolean Blind Test** (may succeed on unfixed code)
   - Payload: `action=x' AND 1=1 AND 'x'='x`
   - Expected on UNFIXED code: Query shape changes, allows complex conditional logic
   - Expected on FIXED code: Treated as literal string

**Expected Counterexamples**:
- The unfixed code will successfully execute injected SQL, as evidenced by:
  - OR injections returning more results than legitimate queries
  - Comment injections bypassing intended filter logic
  - UNION injections potentially exposing unexpected data structures
  - Possible causes confirmed: f-string interpolation directly into SQL WHERE clause without parameterization

### Fix Checking

**Goal**: Verify that SQL injection attempts are prevented and the fixed code is resilient to all injection payloads.

**Pseudocode:**
```
FOR ALL injection_payload WHERE isBugCondition(injection_payload) DO
  result := list_audit_log_fixed(action=injection_payload)
  ASSERT result = list_audit_log_fixed(action=LITERAL_STRING_MATCHING_PAYLOAD)
  ASSERT result.count <= EXPECTED_LEGITIMATE_COUNT
END FOR
```

**Test Cases**:
1. **All injection payloads from Exploratory phase** - re-run on FIXED code, verify they fail to inject
2. **Parameterization verification** - inspect SQLAlchemy query parameters to confirm values are parameterized
3. **Result consistency** - verify that injection payloads return either zero results or results matching literal strings

### Preservation Checking

**Goal**: Verify that legitimate filtering behavior remains unchanged and no regressions are introduced.

**Pseudocode:**
```
FOR ALL legitimate_query WHERE NOT isBugCondition(legitimate_query) DO
  result_original := list_audit_log_original(legitimate_query)
  result_fixed := list_audit_log_fixed(legitimate_query)
  ASSERT result_original = result_fixed
END FOR
```

**Testing Approach**: Property-based testing is recommended for preservation checking because:
- It generates many combinations of legitimate filter values automatically
- It catches edge cases that manual tests might miss (e.g., special characters in normal text, boundary values)
- It provides strong guarantees that behavior is unchanged across the input domain
- It validates preservation without requiring exhaustive manual test cases

**Test Plan**: 
1. First, observe the UNFIXED code's behavior on various legitimate queries (baseline)
2. Then write property-based tests generating random but valid `action`, `outcome`, `actor_role`, `entity_type`, and `limit` values
3. Verify that both versions return identical results for all generated test cases
4. Include edge cases: empty strings, null values, special characters (%, _, etc.), maximum limit

**Test Cases**:

1. **Action Substring Match Preservation** (verify before and after fix)
   - Legitimate searches: `action=create`, `action=update`, `action=delete`, `action=ro`
   - Expected behavior: Both versions return audit logs where action field contains the search string (case-insensitive)
   - Property: `FOR ALL valid_search_terms, fixed_version_results = original_version_results`

2. **Outcome Substring Match Preservation**
   - Legitimate searches: `outcome=success`, `outcome=failed`, `outcome=rejected`
   - Expected behavior: Both versions return audit logs where changes field contains the search string (case-insensitive)

3. **Combined Filter Preservation**
   - Multiple filters: `actor_role=owner&action=create&outcome=success&entity_type=user`
   - Expected behavior: AND logic combines all filters, results match all criteria

4. **Organization Isolation Preservation**
   - Multiple organizations in database
   - Expected behavior: User only sees audit logs from their organization, this behavior unchanged

5. **Pagination Preservation**
   - Various limit values: 1, 50, 100, 200
   - Expected behavior: Results respect limit and order by created_at descending

6. **Empty/Null Parameter Preservation**
   - Requests with missing `action` or `outcome` parameters
   - Expected behavior: Missing parameters are not applied as filters

7. **Special Characters in Legitimate Context**
   - Legitimate searches containing `%` or `_` characters (should be treated literally)
   - Expected behavior: Both versions treat these as literal characters, not LIKE wildcards

### Unit Tests

- Test that `action` parameter with injection payloads produces parameterized queries
- Test that `outcome` parameter with injection payloads produces parameterized queries
- Test that legitimate `action` values still match audit logs correctly
- Test that legitimate `outcome` values still match audit logs correctly
- Test that multiple filters combine with AND logic
- Test that results are filtered by organization_id
- Test that results are ordered by created_at descending
- Test that limit parameter is respected (1-200 range)

### Property-Based Tests

- Generate random valid action/outcome values and verify results are identical in fixed vs original
- Generate random combinations of filters and verify AND logic is preserved
- Generate random limit values and verify pagination works identically
- Verify that no audit logs from other organizations are visible
- Test across many random database states (multiple organizations, multiple users, various audit log entries)

### Integration Tests

- Full API flow: create audit logs, query with various filters, verify correct results
- Multi-organization isolation: create audit logs in different orgs, verify filtering respects org boundaries
- Authorization flow: verify owner role required, non-owners rejected
- Response schema: verify response format matches API contract
- Combined filters in realistic scenarios (e.g., tracking activity by a specific fleet_manager on vehicle events)
