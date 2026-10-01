from datetime import datetime, timedelta, timezone
from pathlib import Path
import os
import sys
from types import SimpleNamespace

os.environ["VAHANA_DATABASE_URL"] = "sqlite:///./test-bug-hardening.db"
sys.path.insert(0, str(Path(__file__).resolve().parents[2]))

import httpx
from fastapi import HTTPException, Request
from backend.app.database import Base, SessionLocal, engine
from backend.app.dependencies import normalize_role
from backend.app.models import IdempotencyRecord, Organization, User
from backend.app.routes import enforce_auth_rate_limit, parse_iso_date, reserve_idempotency_key
from backend.app.security import _supabase_request


def test_normalize_role_rejects_non_string_values():
    assert normalize_role(None) == ""
    assert normalize_role(123) == ""
    assert normalize_role(" SUPER_ADMIN ") == "owner"


def test_parse_iso_date_rejects_ambiguous_formats():
    assert parse_iso_date("2026-09-30").isoformat() == "2026-09-30"
    assert parse_iso_date("30/09/2026") is None


def test_idempotency_reservation_removes_expired_records():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    database = SessionLocal()
    try:
        organization = Organization(name="Retention Fleet", slug="retention-fleet")
        database.add(organization)
        database.flush()
        user = User(
            organization_id=organization.id,
            email="retention@example.com",
            full_name="Retention User",
            password_hash="test",
            role="owner",
        )
        database.add(user)
        database.flush()
        database.add(IdempotencyRecord(
            organization_id=organization.id,
            user_id=user.id,
            idempotency_key="expired",
            method="POST",
            path="/api/v1/work-orders",
            created_at=datetime.now(timezone.utc) - timedelta(days=8),
        ))
        database.commit()

        scope = {
            "type": "http",
            "method": "POST",
            "path": "/api/v1/work-orders",
            "headers": [(b"idempotency-key", b"fresh")],
        }
        reserve_idempotency_key(Request(scope), user, database)
        database.commit()

        assert database.query(IdempotencyRecord).filter_by(idempotency_key="expired").one_or_none() is None
    finally:
        database.close()


def test_supabase_request_retries_transient_responses(monkeypatch):
    responses = [
        httpx.Response(503),
        httpx.Response(429),
        httpx.Response(200),
    ]
    calls = []

    def fake_request(url, **kwargs):
        calls.append((url, kwargs))
        return responses.pop(0)

    monkeypatch.setattr(httpx, "post", fake_request)
    monkeypatch.setattr("backend.app.security.time.sleep", lambda _: None)

    response = _supabase_request("POST", "https://example.test", timeout=1)

    assert response.status_code == 200
    assert len(calls) == 3


def test_auth_rate_limit_rejects_excessive_attempts(monkeypatch):
    monkeypatch.setattr("backend.app.routes.get_settings", lambda: SimpleNamespace(environment="production"))
    scope = {
        "type": "http",
        "method": "POST",
        "path": "/api/v1/auth/login",
        "headers": [],
        "client": ("198.51.100.10", 1234),
    }
    request = Request(scope)
    for _ in range(10):
        enforce_auth_rate_limit(request, "test-login")
    try:
        enforce_auth_rate_limit(request, "test-login")
    except HTTPException as error:
        assert error.status_code == 429
    else:
        raise AssertionError("Expected the authentication rate limit to reject the next attempt")
