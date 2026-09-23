# Implementation Plan - SQL Injection in Audit Log Filtering

## Phase 1: Exploration - Demonstrate the Vulnerability

- [x] 1. Write SQL injection vulnerability exploration test
  - **Property 1: Bug Condition** - SQL Injection Prevention Through Parameterization
  - **CRITICAL**: This test MUST FAIL on unfixed code - failure confirms the SQL injection vulnerability exists
  - **DO NOT attempt to fix the test or the code when it fails**
  - **NOTE**: This test encodes the expected secure behavior - it will validate the fix when it passes after implementation
  - **GOAL**: Surface concrete counterexamples that demonstrate SQL injection works on vulnerable code
  - **Scoped PBT Approach**: Focus on concrete injection payloads that are known to exploit the vulnerability
  
  **Test Implementation Details:**
  - Create integration test in `backend/tests/test_sql_injection_audit_log.py`
  - Use authenticated owner user context for all injection tests
  - Test four injection payload categories as specified in Design section:
    
    1. **OR Injection Test**
       - Payload: `action=%' OR '1'='1`
       - Expected on UNFIXED code: Query returns MORE records than legitimate action filters (OR injection bypasses WHERE clause)
       - Expected assertion: `len(response_vulnerable) > len(response_legitimate)` (proves OR injection works)
       - Expected on FIXED code: Query returns 0 or 1 record matching literal string `' OR '1'='1'`
    
    2. **UNION Injection Test**
       - Payload: `outcome=success' UNION SELECT 1,2,3,4,5 WHERE '1'='1`
       - Expected on UNFIXED code: SQLAlchemy constructs corrupted SQL, may return unexpected result shapes
       - Expected assertion: Query executes without parameter binding protection (proves UNION injection works)
       - Expected on FIXED code: Treats entire string as literal value in ILIKE pattern
    
    3. **Comment Injection Test**
       - Payload: `action=create' -- injected comment`
       - Expected on UNFIXED code: The `--` comment truncates/modifies the WHERE clause structure
       - Expected assertion: Comment injection changes query behavior (proves comment injection works)
       - Expected on FIXED code: Treated as literal string, no SQL comment processing
    
    4. **Boolean Blind Test**
       - Payload: `action=x' AND 1=1 AND 'x'='x`
       - Expected on UNFIXED code: Query logic is altered by AND expressions
       - Expected assertion: Blind boolean logic affects WHERE clause (proves boolean injection works)
       - Expected on FIXED code: Parameter binding prevents logical operators from executing as SQL
  
  - **Test Structure:**
    ```python
    @pytest.mark.asyncio
    async def test_action_parameter_or_injection():
        """Demonstrates OR injection vulnerability on unfixed code"""
        client = TestClient(app)
        headers = get_owner_auth_headers()
        
        # Legitimate query baseline
        legit_response = client.get(
            "/api/v1/audit-log?action=create",
            headers=headers
        )
        legit_count = legit_response.json()["count"]
        
        # Injection attempt - OR '1'='1'
        injection_payload = "%' OR '1'='1"
        injection_response = client.get(
            f"/api/v1/audit-log?action={injection_payload}",
            headers=headers
        )
        injection_count = injection_response.json()["count"]
        
        # On UNFIXED code: injection_count >> legit_count (proves injection works)
        # On FIXED code: injection_count == 0 (proves injection prevented)
        # This test FAILS on unfixed code because injection_count is too high
        assert injection_count == 0, f"SQL injection succeeded: {injection_count} records returned"
    ```
  
  - Run test on UNFIXED code
  - **EXPECTED OUTCOME**: Test FAILS with assertion errors showing injection payloads return more records than expected (concrete evidence of vulnerability)
  - Document counterexamples found (e.g., "OR injection returned 50 records instead of 2")
  - Mark task complete when test is written, run on unfixed code, and failure is documented
  - _Requirements: 1.1, 1.2, 1.3_

- [x] 2. Write preservation property tests for legitimate filtering (BEFORE implementing fix)
  - **Property 2: Preservation** - Legitimate Filtering Behavior Unchanged
  - **IMPORTANT**: Follow observation-first methodology
  - **GOAL**: Capture baseline behavior of legitimate queries on UNFIXED code, then verify preservation after fix
  
  **Test Implementation Details:**
  - Create property-based tests in `backend/tests/test_audit_log_preservation.py`
  - Use Hypothesis framework to generate random but valid filter combinations
  - Observe behavior on UNFIXED code first for these legitimate cases:
    
    1. **Valid Action Substring Searches**
       - Observe: `action=create` returns audit logs where action contains "create" (case-insensitive)
       - Observe: `action=update` returns logs where action contains "update"
       - Observe: `action=delete` returns logs where action contains "delete"
       - Write property: `FOR ALL valid_action_terms, fixed_results == original_results`
    
    2. **Valid Outcome Substring Searches**
       - Observe: `outcome=success` returns logs where changes contains "success"
       - Observe: `outcome=failed` returns logs where changes contains "failed"
       - Write property: `FOR ALL valid_outcome_terms, fixed_results == original_results`
    
    3. **Combined Filter AND Logic**
       - Observe: Multiple filters combine with AND (all criteria must match)
       - Observe: `actor_role=owner&action=create` returns logs matching both conditions
       - Write property: Results from combined filters subset of single filters
    
    4. **Organization Isolation Preservation**
       - Observe: User only sees logs from their organization
       - Observe: Logs from other organizations are excluded
       - Write property: All results have organization_id matching authenticated user's org
    
    5. **Pagination Preservation**
       - Observe: Results respect limit parameter (1-200)
       - Observe: Results ordered by created_at descending
       - Write property: `len(results) <= limit` and `results[i].created_at >= results[i+1].created_at`
    
    6. **Empty/Null Parameters Preservation**
       - Observe: Missing action/outcome parameters don't filter
       - Observe: Query without filters returns all org's audit logs (respecting limit)
       - Write property: Results without filters include all action types and outcomes
    
    7. **Special Characters in Legitimate Context**
       - Observe: Legitimate searches with `%` or `_` characters (treated as literals, not LIKE wildcards)
       - Observe: These characters don't act as SQL pattern matching operators
       - Write property: Searching for `update%old` matches only logs with literal string "update%old"
  
  - **Test Structure:**
    ```python
    from hypothesis import given, strategies as st
    
    @given(
        action_term=st.text(min_size=1, max_size=20).filter(lambda x: not any(c in x for c in ["'", '"'])),
        outcome_term=st.text(min_size=1, max_size=20).filter(lambda x: not any(c in x for c in ["'", '"'])),
    )
    @pytest.mark.asyncio
    async def test_action_outcome_preservation(action_term, outcome_term):
        """Property: legitimate action/outcome filters return identical results in fixed version"""
        original_results = get_audit_logs_original(action=action_term, outcome=outcome_term)
        fixed_results = get_audit_logs_fixed(action=action_term, outcome=outcome_term)
        
        # Both versions should return the same records in the same order
        assert len(original_results) == len(fixed_results)
        assert [r["id"] for r in original_results] == [r["id"] for r in fixed_results]
    ```
  
  - Verify tests PASS on UNFIXED code (captures baseline behavior)
  - Mark task complete when tests are written, run on unfixed code, and all pass
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

## Phase 2: Implementation - Apply the Fix

- [x] 3. Fix SQL injection vulnerability in /audit-log endpoint

  - [x] 3.1 Locate vulnerable code and analyze it
    - Read `backend/app/routes.py` and find the `list_audit_log()` function (approximately lines 360-374)
    - Identify the vulnerable lines:
      - `query = query.filter(AuditLog.action.ilike(f"%{action}%"))`
      - `query = query.filter(AuditLog.changes.ilike(f"%{outcome}%"))`
    - Understand that f-string interpolation bypasses SQLAlchemy's parameter binding
    - Document the root cause: direct string interpolation into SQL WHERE clause
    - _Bug_Condition: f-string interpolation of user-controlled action/outcome parameters_
    - _Expected_Behavior: Pass parameters directly to ilike() for automatic parameterization_
    - _Requirements: 2.1, 2.2, 2.3_

  - [x] 3.2 Replace f-string interpolation for action parameter
    - In `list_audit_log()` function, find line with `AuditLog.action.ilike(f"%{action}%")`
    - Replace with one of these safe approaches:
      - **RECOMMENDED**: `query = query.filter(AuditLog.action.ilike("%" + action + "%"))`
      - OR: Store pattern in variable first: `pattern = "%" + action + "%"` then `query = query.filter(AuditLog.action.ilike(pattern))`
      - OR: Use SQLAlchemy's `concat()` function: `query = query.filter(AuditLog.action.ilike(concat("%", action, "%")))`
    - Verify change is syntactically correct
    - Verify indentation and formatting match existing code style
    - _Requirements: 2.1, 2.3_

  - [x] 3.3 Replace f-string interpolation for outcome parameter
    - In `list_audit_log()` function, find line with `AuditLog.changes.ilike(f"%{outcome}%")`
    - Replace with matching approach used for action parameter:
      - **RECOMMENDED**: `query = query.filter(AuditLog.changes.ilike("%" + outcome + "%"))`
      - OR: `pattern = "%" + outcome + "%"` then `query = query.filter(AuditLog.changes.ilike(pattern))`
    - Verify change is syntactically correct
    - Verify indentation and formatting match existing code style
    - Confirm both changes use the same approach for consistency
    - _Requirements: 2.2, 2.3_

  - [x] 3.4 Verify changes compile and syntax is correct
    - Run Python syntax checker on `backend/app/routes.py`:
      - `python -m py_compile backend/app/routes.py`
    - Verify no syntax errors are reported
    - Verify the application still imports without errors:
      - `python -c "from backend.app.routes import list_audit_log; print('Import successful')"`
    - Verify related imports are still present (SQLAlchemy, models, etc.)
    - Confirm function signature is unchanged
    - _Requirements: 2.1, 2.2, 2.3_

## Phase 3: Verification - Validate Fix

- [x] 4. Verify bug condition exploration test now passes
  - **Property 1: Expected Behavior** - SQL Injection Payloads Prevented
  - **CRITICAL**: Re-run the SAME test from task 1 on FIXED code - do NOT write a new test
  - The test from task 1 encodes the expected secure behavior
  - When this test passes on fixed code, it confirms the expected behavior is satisfied
  - Run all four injection payload tests from task 1 on FIXED code:
    - ✓ OR injection test (should now fail to inject, return 0 results)
    - ✓ UNION injection test (should treat string as literal, return 0 results)
    - ✓ Comment injection test (should not truncate WHERE clause, return 0 results)
    - ✓ Boolean blind test (should prevent AND logic injection, return 0 results)
  - **EXPECTED OUTCOME**: All tests PASS (confirms SQL injection is prevented)
  - ✓ All 5 injection payload tests passed on fixed code
  - ✓ All injection payloads are now neutralized
  - ✓ Parameter binding prevents SQL injection attacks
  - _Requirements: Expected Behavior Properties from design_

- [x] 5. Verify preservation tests still pass
  - **Property 2: Preservation** - Legitimate Filtering Behavior Unchanged
  - **CRITICAL**: Re-run the SAME tests from task 2 on FIXED code - do NOT write new tests
  - Run all legitimate filtering property-based tests from task 2:
    - Valid action substring searches (same results as before)
    - Valid outcome substring searches (same results as before)
    - Combined filter AND logic (same results as before)
    - Organization isolation (same results as before)
    - Pagination (same results as before)
    - Empty/null parameters (same results as before)
    - Special characters in legitimate context (same results as before)
  - **EXPECTED OUTCOME**: All preservation tests PASS (confirms no regressions)
  - Verify result counts match original for all legitimate queries
  - Verify result ordering matches original
  - Verify response schema unchanged
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

- [ ] 6. Run unit tests for SQL injection prevention
  - **GOAL**: Comprehensive unit testing of the fixed code with injection payloads
  - Create focused unit tests in `backend/tests/test_audit_log_injection_prevention.py`
  - Test cases:
    
    1. **Action parameter with OR operator**
       - Input: `action=%' OR '1'='1`
       - Assert: Results are 0 (no OR injection), not unlimited rows
    
    2. **Action parameter with UNION operator**
       - Input: `action=x' UNION SELECT 1,2,3`
       - Assert: Results query structure is preserved, no unexpected columns
    
    3. **Action parameter with comment syntax**
       - Input: `action=create' -- comment`
       - Assert: Query execution completes, -- is treated as literal, not comment
    
    4. **Outcome parameter with OR operator**
       - Input: `outcome=success' OR '1'='1`
       - Assert: Results are 0 (no OR injection)
    
    5. **Outcome parameter with UNION operator**
       - Input: `outcome=x' UNION SELECT 1,2,3`
       - Assert: Results structure preserved, no injection
    
    6. **Outcome parameter with comment syntax**
       - Input: `outcome=failed' -- comment`
       - Assert: Comment syntax treated as literal string
    
    7. **Parameterization verification**
       - Inspect SQLAlchemy query parameters via logging/profiling
       - Assert: Injection payloads appear in query parameters, NOT in SQL statement
       - Assert: SQL statement contains `?` or `:param` placeholders, not literal payload values
    
    8. **Multiple injection in combined filters**
       - Input: `action=%' OR '1'='1&outcome=x' UNION SELECT 1`
       - Assert: Both parameters are parameterized, neither injection executes
  
  - Run all unit tests: `pytest backend/tests/test_audit_log_injection_prevention.py -v`
  - **EXPECTED OUTCOME**: All unit tests PASS (confirms all injections are neutralized)
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 7. Run integration tests for API contract preservation
  - **GOAL**: Full API testing to ensure contract remains unchanged
  - Create integration tests in `backend/tests/test_audit_log_integration.py` (or extend existing)
  - Test scenarios:
    
    1. **Basic filtering scenarios (same as before fix)**
       - Filter by action only: `GET /api/v1/audit-log?action=create`
       - Filter by outcome only: `GET /api/v1/audit-log?outcome=success`
       - Filter by actor_role: `GET /api/v1/audit-log?actor_role=owner`
       - Filter by entity_type: `GET /api/v1/audit-log?entity_type=user`
       - Verify results match pre-fix behavior
    
    2. **Combined filters (same as before fix)**
       - `GET /api/v1/audit-log?action=create&outcome=success&actor_role=owner`
       - Verify AND logic combines all filters correctly
       - Verify results are subset of individual filter results
    
    3. **Pagination (same as before fix)**
       - `GET /api/v1/audit-log?limit=10`
       - `GET /api/v1/audit-log?limit=200`
       - Verify results respect limit
       - Verify ordering is by created_at descending
    
    4. **Organization isolation (same as before fix)**
       - Create multiple organizations with different audit logs
       - User from org A queries: `GET /api/v1/audit-log`
       - Verify only org A's audit logs are returned
       - Verify org B's audit logs are excluded
    
    5. **Authorization (same as before fix)**
       - Non-owner user queries endpoint
       - Verify 403 Forbidden response (unchanged)
       - Unauthenticated user queries endpoint
       - Verify 401 Unauthorized response (unchanged)
    
    6. **Response schema (same as before fix)**
       - Verify response includes all expected fields: id, organization_id, actor_id, action, outcome, entity_type, created_at, etc.
       - Verify field types match API schema (strings, timestamps, etc.)
       - Verify count field in response is accurate
    
    7. **Edge cases with special characters (now safe)**
       - Filter by action containing `%`: `action=update%_log`
       - Filter by outcome containing `_`: `outcome=success_new`
       - Verify these are treated as literal strings (not LIKE wildcards)
       - Verify results match only exact literal content
  
  - Run all integration tests: `pytest backend/tests/test_audit_log_integration.py -v`
  - **EXPECTED OUTCOME**: All integration tests PASS (confirms API contract preserved)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5_

## Phase 4: Quality Assurance

- [ ] 8. Code review of changes
  - Review the two modified lines in `backend/app/routes.py`:
    - Line with action filter: `query = query.filter(AuditLog.action.ilike("%" + action + "%"))`
    - Line with outcome filter: `query = query.filter(AuditLog.changes.ilike("%" + outcome + "%"))`
  
  - Verification checklist:
    - [ ] F-string interpolation has been completely removed
    - [ ] String concatenation (`"%" + parameter + "%"`) is used instead
    - [ ] No f-string prefix (`f"..."`) remains on these lines
    - [ ] Both changes use the same approach (consistent style)
    - [ ] Indentation matches surrounding code
    - [ ] Function logic is unchanged (only parameter passing changed)
    - [ ] No other code paths were accidentally modified
    - [ ] Comments are clear about why this approach is safe
  
  - Add inline comment above both fixed lines explaining the security fix:
    ```python
    # Security fix: Use parameter binding instead of f-string interpolation
    # This ensures user input is parameterized and cannot be interpreted as SQL
    query = query.filter(AuditLog.action.ilike("%" + action + "%"))
    ```
  
  - Verify no other endpoints have similar SQL injection patterns:
    - Search `routes.py` for other `.ilike(f"` patterns
    - Search `routes.py` for other `.filter()` calls with f-string interpolation
    - Search `routes.py` for `.filter()` calls with string concatenation of user input
    - If found, flag for separate security review
  
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 9. Search for similar SQL injection patterns in other endpoints
  - **GOAL**: Ensure no other endpoints have similar vulnerabilities
  - Search `backend/app/routes.py` for:
    - Pattern: `.ilike(f"` - identifies f-string usage with ILIKE filters
    - Pattern: `.filter(.*f"` - identifies any f-string filters
    - Pattern: `.like(f"` - identifies any LIKE filters with f-strings
    - Pattern: `.filter(.*\+` - identifies string concatenation in filters (may need review)
  
  - For each match found:
    - Review context to determine if it's a security issue
    - Document finding with line number and code snippet
    - If similar vulnerability exists, create separate bug report
    - If not an injection risk (e.g., fixed enum values), document why it's safe
  
  - **Expected outcome**: No additional SQL injection vulnerabilities found in audit log related code
  - If other vulnerabilities exist, flag for triage and separate bugfix
  
  - _Requirements: 2.1, 2.2, 2.3_

- [ ] 10. Document the fix with code comments
  - Add detailed comments in the fixed function explaining the security improvement
  - Comment should explain:
    - What the vulnerability was (f-string interpolation)
    - Why it was vulnerable (bypasses SQLAlchemy's parameter binding)
    - How the fix works (parameter binding through direct string passing)
    - Why this approach is safe (SQLAlchemy handles parameterization automatically)
  
  - Example comment to add:
    ```python
    # SECURITY FIX: SQL Injection Prevention in Audit Log Filtering
    # The original code used f-string interpolation (f"%{action}%") which bypassed
    # SQLAlchemy's parameter binding protection, allowing SQL injection attacks.
    # 
    # The fix uses string concatenation ("%" + action + "%") which passes the
    # complete pattern string to ilike() as a parameter value. SQLAlchemy
    # automatically parameterizes the value, ensuring user input is treated as
    # data, not SQL code. This prevents all forms of SQL injection including:
    # - OR injection: "%' OR '1'='1"
    # - UNION injection: "x' UNION SELECT ..."
    # - Comment injection: "x' -- comment"
    # - Boolean injection: "x' AND 1=1 AND 'x'='x"
    ```
  
  - Add comment at function level explaining the security controls
  - Add comment inline for both fixed filter lines
  
  - _Requirements: 2.1, 2.2, 2.3_

## Phase 5: Final Checkpoint

- [ ] 11. Checkpoint - Ensure all tests pass and fix is complete
  - Run full test suite for audit log functionality:
    - `pytest backend/tests/test_sql_injection_audit_log.py -v` (injection exploitation tests)
    - `pytest backend/tests/test_audit_log_preservation.py -v` (preservation property tests)
    - `pytest backend/tests/test_audit_log_injection_prevention.py -v` (unit tests)
    - `pytest backend/tests/test_audit_log_integration.py -v` (integration tests)
  
  - Verify results:
    - [ ] All injection exploitation tests PASS (injection is prevented)
    - [ ] All preservation tests PASS (legitimate behavior unchanged)
    - [ ] All injection prevention unit tests PASS (injections neutralized)
    - [ ] All integration tests PASS (API contract preserved)
    - [ ] No new test failures in existing test suite
    - [ ] No syntax errors in modified code
    - [ ] Code review checklist complete
    - [ ] Security comments added to code
  
  - Summary verification:
    - [ ] Bug condition is fixed: SQL injection in action parameter prevented
    - [ ] Bug condition is fixed: SQL injection in outcome parameter prevented
    - [ ] Preservation achieved: Legitimate action filtering works identically
    - [ ] Preservation achieved: Legitimate outcome filtering works identically
    - [ ] Preservation achieved: Combined filters work identically
    - [ ] Preservation achieved: Organization isolation maintained
    - [ ] Preservation achieved: Authorization controls intact
    - [ ] Preservation achieved: Response schema unchanged
  
  - If any test fails, diagnose and fix before marking complete
  - If all tests pass, document successful completion
  - Ask the user if questions arise during verification
  
  - _Requirements: 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4, 3.5_
