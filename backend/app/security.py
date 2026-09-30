from datetime import datetime, timedelta, timezone
from typing import Any

import httpx
import jwt
from pwdlib import PasswordHash

from .config import get_settings

password_hash = PasswordHash.recommended()


def hash_password(password: str) -> str:
    return password_hash.hash(password)


def verify_password(password: str, hashed_password: str) -> bool:
    return password_hash.verify(password, hashed_password)


def create_access_token(subject: str, token_version: int = 0) -> str:
    settings = get_settings()
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=settings.access_token_minutes)
    return jwt.encode({"sub": subject, "ver": token_version, "exp": expires_at}, settings.jwt_secret, algorithm="HS256")


def decode_access_token(token: str) -> int:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    return int(payload["sub"])


def decode_token_version(token: str) -> int:
    settings = get_settings()
    payload = jwt.decode(token, settings.jwt_secret, algorithms=["HS256"])
    return int(payload.get("ver", 0))


def decode_supabase_token(token: str) -> dict[str, Any]:
    settings = get_settings()
    if settings.supabase_jwks_url:
        jwks_urls = [settings.supabase_jwks_url]
        if settings.supabase_url:
            derived_jwks_url = f"{settings.supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json"
            if derived_jwks_url not in jwks_urls:
                jwks_urls.append(derived_jwks_url)
        signing_key = None
        for jwks_url in jwks_urls:
            try:
                signing_key = jwt.PyJWKClient(jwks_url).get_signing_key_from_jwt(token).key
                break
            except Exception:
                if jwks_url == jwks_urls[-1]:
                    raise
        assert signing_key is not None
        payload = jwt.decode(token, signing_key, algorithms=["RS256", "ES256"], audience="authenticated", options={"verify_iss": False})
    elif settings.supabase_jwt_secret:
        payload = jwt.decode(
            token,
            settings.supabase_jwt_secret,
            algorithms=["HS256"],
            audience="authenticated",
            options={"verify_iss": False},
        )
    else:
        raise ValueError("Supabase JWT verification is not configured")
    return payload


def provision_supabase_user(email: str, password: str, full_name: str, metadata: dict[str, Any] | None = None) -> str | None:
    settings = get_settings()
    if settings.auth_provider != "supabase" or settings.environment.lower() == "development":
        return None
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError("Supabase Auth admin provisioning is not configured")
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
            "Content-Type": "application/json",
        },
        json={
            "email": email,
            "password": password,
            "email_confirm": True,
            "user_metadata": {"full_name": full_name, **(metadata or {})},
        },
        timeout=30,
    )
    if response.status_code >= 400:
        if response.status_code in {409, 422}:
            raise ValueError("A Supabase Auth user with this email already exists")
        raise ValueError("Supabase Auth rejected the user provisioning request")
    return str(response.json()["id"])


def sign_in_supabase_user(email: str, password: str) -> str:
    settings = get_settings()
    if not settings.supabase_url or not settings.supabase_anon_key:
        raise ValueError("Supabase Auth client credentials are not configured")
    response = httpx.post(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/token?grant_type=password",
        headers={
            "Authorization": f"Bearer {settings.supabase_anon_key}",
            "apikey": settings.supabase_anon_key,
            "Content-Type": "application/json",
        },
        json={"email": email, "password": password},
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError("Supabase Auth could not create a session")
    access_token = response.json().get("access_token")
    if not access_token:
        raise ValueError("Supabase Auth returned no access token")
    return str(access_token)


def delete_supabase_user(user_id: str) -> None:
    settings = get_settings()
    if settings.auth_provider != "supabase" or settings.environment.lower() == "development":
        return
    if not settings.supabase_url or not settings.supabase_service_role_key:
        raise ValueError("Supabase Auth admin provisioning is not configured")
    response = httpx.delete(
        f"{settings.supabase_url.rstrip('/')}/auth/v1/admin/users/{user_id}",
        headers={
            "Authorization": f"Bearer {settings.supabase_service_role_key}",
            "apikey": settings.supabase_service_role_key,
        },
        timeout=30,
    )
    if response.status_code >= 400:
        raise ValueError("Supabase Auth could not remove the provisioned user")
