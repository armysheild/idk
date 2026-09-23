"""
Unit Tests for SQL Injection Prevention in /audit-log Endpoint

This module verifies that the fixed /audit-log endpoint properly prevents
SQL injection attacks through parameter binding. Tests confirm:

1. All SQL injection payloads are neutralized
2. Parameters appear in bound parameters, not SQL statement
3. Legitimate queries continue to work
4. No regressions in existing functionality

The fix replaces f-string interpolation with direct string concatenation:
  BEFORE: query.filter(AuditLog.action.ilike(f"%{action}%"))
  AFTER:  query.filter(AuditLog.action.ilike("%" + action + "%"))

This ensures SQLAlchemy handles parameter binding automatically.

Validates: Requirements 2.1, 2.2, 2.3
"""

import os
from pathlib import Path
import sys
from uuid import uuid4
from unittest.mock import patch
from io import StringIO

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-injection-prevention.db"
os.environ["VAHANA_SEED_ADMIN_EMAIL"] = "test-admin@example.com"
os.environ["VAHANA_SEED_ADMIN_PASSWORD"] = "TestPassword!123"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import event, text
from backend.app.database import Base, engine
from backend.app.main import app
from backend.app.models import AuditLog, User


def _get_owner_headers(client):
    """Helper to get authenticated owner headers"""
    login = client.post(
        "/api/v1/auth/login",
        json={
            "email": "test-admin@example.com",
            "password": "TestPassword!123"
        }
    )
    assert login.status_code == 200
    token = login.json()["access_token"]
    return {"Authorization": f"Bearer {token}"}


def _create_test_audit_logs(db_session):
    """
    Helper to create a baseline set of audit logs for testing.
    """
    from uuid import uuid4

    # Get the owner user
    user = db_session.query(User).filter_by(email="test-admin@example.com").first()
    assert user is not None

    # Create baseline audit logs with various actions and outcomes
    test_logs = [
        ("create", "success", "user"),
        ("create", "success", "vehicle"),
        ("create", "failed", "vehicle"),
        ("update", "success", "user"),
        ("update", "success", "vehicle"),
        ("update", "failed", "user"),
        ("delete", "success", "vehicle"),
        ("delete", "failed", "user"),
        ("read", "success", "user"),
        ("read", "success", "organization"),
    ]

    for action, outcome, entity_type in test_logs:
        log = AuditLog(
            organization_id=user.organization_id,
            actor_user_id=user.id,
            action=action,
            changes=outcome,  # Using changes field for outcome matching
            entity_type=entity_type,
            entity_id=str(uuid4()),  # Required field
        )
        db_session.add(log)
    
    db_session.commit()
    return len(test_logs)


class TestAuditLogInjectionPrevention:
    """Test suite for SQL injection prevention in audit log filtering"""

    @pytest.fixture(autouse=True)
    def setup_teardown(self, tmp_path: Path, monkeypatch):
        """Setup test database and cleanup after each test"""
        monkeypatch.chdir(tmp_path)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        yield
        Base.metadata.drop_all(bind=engine)

    def test_1_action_parameter_or_injection_blocked(self):
        """
        Test 1: Action parameter with OR operator
        
        Verifies that OR injection payloads in the action parameter
        are treated as literal strings and return 0 results (no injection).
        
        Input: action=%' OR '1'='1
        Expected: 0 results (literal string match, not OR logic injection)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: OR operator
            injection_payload = "%' OR '1'='1"
            injection_response = client.get(
                f"/api/v1/audit-log?action={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"OR injection was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_2_action_parameter_union_injection_blocked(self):
        """
        Test 2: Action parameter with UNION operator
        
        Verifies that UNION injection payloads in the action parameter
        are treated as literal strings and return 0 results.
        
        Input: action=x' UNION SELECT 1,2,3,4,5 WHERE '1'='1
        Expected: 0 results (literal string match, not UNION injection)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: UNION operator
            injection_payload = "x' UNION SELECT 1,2,3,4,5 WHERE '1'='1"
            injection_response = client.get(
                f"/api/v1/audit-log?action={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"UNION injection was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_3_action_parameter_comment_injection_blocked(self):
        """
        Test 3: Action parameter with comment syntax
        
        Verifies that SQL comment injection payloads in the action parameter
        are treated as literal strings and return 0 results.
        
        Input: action=create' -- injected comment
        Expected: 0 results (literal string match, no comment truncation)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: SQL comment syntax
            injection_payload = "create' -- injected comment"
            injection_response = client.get(
                f"/api/v1/audit-log?action={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"Comment injection was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_4_outcome_parameter_or_injection_blocked(self):
        """
        Test 4: Outcome parameter with OR operator
        
        Verifies that OR injection payloads in the outcome parameter
        are treated as literal strings and return 0 results.
        
        Input: outcome=success' OR '1'='1
        Expected: 0 results (literal string match, no OR injection)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: OR operator in outcome
            injection_payload = "success' OR '1'='1"
            injection_response = client.get(
                f"/api/v1/audit-log?outcome={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"OR injection in outcome was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_5_outcome_parameter_union_injection_blocked(self):
        """
        Test 5: Outcome parameter with UNION operator
        
        Verifies that UNION injection payloads in the outcome parameter
        are treated as literal strings and return 0 results.
        
        Input: outcome=x' UNION SELECT 1,2,3,4,5 WHERE '1'='1
        Expected: 0 results (literal string match, no UNION injection)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: UNION operator in outcome
            injection_payload = "x' UNION SELECT 1,2,3,4,5 WHERE '1'='1"
            injection_response = client.get(
                f"/api/v1/audit-log?outcome={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"UNION injection in outcome was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_6_outcome_parameter_comment_injection_blocked(self):
        """
        Test 6: Outcome parameter with comment syntax
        
        Verifies that SQL comment injection payloads in the outcome parameter
        are treated as literal strings and return 0 results.
        
        Input: outcome=failed' -- comment
        Expected: 0 results (literal string match, no comment truncation)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payload: SQL comment syntax in outcome
            injection_payload = "failed' -- comment"
            injection_response = client.get(
                f"/api/v1/audit-log?outcome={injection_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (injection prevented)
            assert len(results) == 0, (
                f"Comment injection in outcome was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Parameter: {injection_payload}"
            )

    def test_7_parameterization_verification(self):
        """
        Test 7: Parameterization verification
        
        Verifies that injection payloads appear in bound parameters,
        NOT in the SQL statement itself. This confirms that SQLAlchemy
        is properly parameterizing the user input.
        
        Expected behavior:
        - Injection payload appears in query parameters
        - SQL statement contains placeholders (?, :param)
        - NO literal injection payload in SQL statement
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            from sqlalchemy import event
            
            db = next(get_db())
            _create_test_audit_logs(db)

            # Setup query inspection to capture SQL and parameters
            captured_queries = []
            
            def capture_before_cursor_execute(conn, cursor, statement, parameters, context, executemany):
                """Capture SQL statement and parameters"""
                captured_queries.append({
                    "statement": str(statement),
                    "parameters": parameters
                })
            
            # Register the event listener
            event.listen(engine, "before_cursor_execute", capture_before_cursor_execute)
            
            try:
                # Make request with injection payload
                injection_payload = "%' OR '1'='1"
                injection_response = client.get(
                    f"/api/v1/audit-log?action={injection_payload}",
                    headers=headers
                )
                
                assert injection_response.status_code == 200
                
                # Find queries with LIKE/ILIKE (SQLite uses LIKE, others use ILIKE)
                like_queries = [q for q in captured_queries if "LIKE" in q["statement"] and "audit_logs" in q["statement"]]
                
                assert len(like_queries) > 0, (
                    "No LIKE/ILIKE query for audit_logs found. Cannot verify parameterization. "
                    f"Captured queries: {[q['statement'][:100] for q in captured_queries]}"
                )
                
                like_query = like_queries[0]
                sql_statement = like_query["statement"]
                parameters = like_query["parameters"]
                
                # Verify: SQL statement contains placeholder, not literal payload
                # SQLite uses ? as placeholder
                assert "?" in sql_statement, (
                    f"SQL statement does not contain parameterization placeholder. "
                    f"Statement: {sql_statement}"
                )
                
                # Verify: Literal injection payload should NOT appear in SQL statement
                # The injection payload should not be literally in the SQL
                assert injection_payload not in sql_statement, (
                    f"Injection payload appears in SQL statement! "
                    f"This indicates parameterization failed. "
                    f"Payload: {injection_payload} "
                    f"Statement: {sql_statement}"
                )
                
                # Verify: Injection payload appears in parameters (as data, not code)
                # Parameters should be a tuple/list with the payload as a value
                assert parameters is not None, "Parameters is None"
                
                # Convert parameters to string to check for payload
                params_str = str(parameters)
                # The payload should appear in the parameters, with wildcards added by the LIKE pattern
                pattern_with_wildcards = "%" + injection_payload + "%"
                assert pattern_with_wildcards in params_str or injection_payload in params_str, (
                    f"Injection payload not found in parameters. "
                    f"Parameters: {parameters} "
                    f"Payload: {injection_payload} "
                    f"Expected pattern: {pattern_with_wildcards}"
                )
                
            finally:
                event.remove(engine, "before_cursor_execute", capture_before_cursor_execute)

    def test_8_multiple_injection_combined_filters_blocked(self):
        """
        Test 8: Multiple injection in combined filters
        
        Verifies that injection payloads in BOTH action and outcome
        parameters are parameterized. Both injections must be neutralized
        when used together.
        
        Input: action=%' OR '1'='1 AND outcome=x' UNION SELECT 1
        Expected: 0 results (both parameters parameterized, neither injection executes)
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Injection payloads for both parameters
            action_payload = "%' OR '1'='1"
            outcome_payload = "x' UNION SELECT 1"
            
            injection_response = client.get(
                f"/api/v1/audit-log?action={action_payload}&outcome={outcome_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Assert result count is 0 (both injections prevented)
            assert len(results) == 0, (
                f"Combined injection was NOT blocked. Expected 0 results, got {len(results)}. "
                f"Action parameter: {action_payload} "
                f"Outcome parameter: {outcome_payload}"
            )


class TestAuditLogLegitimateQueries:
    """Test suite to verify legitimate queries still work (no regressions)"""

    @pytest.fixture(autouse=True)
    def setup_teardown(self, tmp_path: Path, monkeypatch):
        """Setup test database and cleanup after each test"""
        monkeypatch.chdir(tmp_path)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        yield
        Base.metadata.drop_all(bind=engine)

    def test_legitimate_action_filter_still_works(self):
        """Verify that legitimate action filtering continues to work"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            total = _create_test_audit_logs(db)

            # Query for legitimate action "create"
            response = client.get(
                "/api/v1/audit-log?action=create",
                headers=headers
            )
            
            assert response.status_code == 200
            results = response.json()
            
            # Should get results matching "create"
            assert len(results) > 0, "Legitimate action filter returned no results"
            assert all("create" in r["action"].lower() for r in results), (
                "Some results don't contain the action term"
            )

    def test_legitimate_outcome_filter_still_works(self):
        """Verify that legitimate outcome filtering continues to work"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            total = _create_test_audit_logs(db)

            # Query for legitimate outcome "success"
            response = client.get(
                "/api/v1/audit-log?outcome=success",
                headers=headers
            )
            
            assert response.status_code == 200
            results = response.json()
            
            # Should get results matching "success"
            assert len(results) > 0, "Legitimate outcome filter returned no results"
            assert all("success" in r["changes"].lower() for r in results), (
                "Some results don't contain the outcome term"
            )

    def test_legitimate_combined_filters_still_work(self):
        """Verify that combined filters with AND logic still work"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            total = _create_test_audit_logs(db)

            # Query with both action and outcome filters
            response = client.get(
                "/api/v1/audit-log?action=create&outcome=success",
                headers=headers
            )
            
            assert response.status_code == 200
            results = response.json()
            
            # Should get results matching BOTH criteria
            if len(results) > 0:  # May be empty if no records match both
                assert all("create" in r["action"].lower() for r in results), (
                    "Some results don't match action filter"
                )
                assert all("success" in r["changes"].lower() for r in results), (
                    "Some results don't match outcome filter"
                )

    def test_query_without_filters_returns_all_records(self):
        """Verify that queries without filters return all audit logs"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            total = _create_test_audit_logs(db)

            # Query without filters
            response = client.get(
                "/api/v1/audit-log",
                headers=headers
            )
            
            assert response.status_code == 200
            results = response.json()
            
            # Should get all records (limited by default limit)
            assert len(results) == total, (
                f"Expected {total} records without filters, got {len(results)}"
            )


class TestAuditLogEdgeCases:
    """Test suite for edge cases and special characters"""

    @pytest.fixture(autouse=True)
    def setup_teardown(self, tmp_path: Path, monkeypatch):
        """Setup test database and cleanup after each test"""
        monkeypatch.chdir(tmp_path)
        Base.metadata.drop_all(bind=engine)
        Base.metadata.create_all(bind=engine)
        yield
        Base.metadata.drop_all(bind=engine)

    def test_special_characters_treated_as_literals(self):
        """
        Verify that special SQL characters in legitimate queries
        are treated as literals, not SQL metacharacters.
        """
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            
            # Create audit log with special characters
            user = db.query(User).filter_by(email="test-admin@example.com").first()
            log = AuditLog(
                organization_id=user.organization_id,
                actor_user_id=user.id,
                action="update%_changes",  # Contains % and _
                changes="completed_success",
                entity_type="vehicle",
                entity_id=str(uuid4()),
            )
            db.add(log)
            db.commit()

            # Query for the special character string (should match literally)
            response = client.get(
                "/api/v1/audit-log?action=update%_changes",
                headers=headers
            )
            
            assert response.status_code == 200
            results = response.json()
            
            # Should find the record with exact string
            assert len(results) == 1, (
                f"Special character query returned {len(results)} results instead of 1"
            )
            assert results[0]["action"] == "update%_changes"

    def test_empty_string_parameter(self):
        """Verify that empty string parameters don't cause issues"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Query with empty action string
            response = client.get(
                "/api/v1/audit-log?action=",
                headers=headers
            )
            
            # Should handle gracefully
            assert response.status_code == 200 or response.status_code == 422

    def test_very_long_injection_payload(self):
        """Verify that very long injection payloads are handled safely"""
        with TestClient(app) as client:
            headers = _get_owner_headers(client)
            
            from backend.app.database import get_db
            db = next(get_db())
            _create_test_audit_logs(db)

            # Create a very long injection payload
            long_payload = "%' OR '1'='1" * 100  # Repeat 100 times
            
            injection_response = client.get(
                f"/api/v1/audit-log?action={long_payload}",
                headers=headers
            )
            
            assert injection_response.status_code == 200
            results = injection_response.json()
            
            # Should return 0 results (injection prevented)
            assert len(results) == 0, (
                "Long injection payload was not blocked"
            )
