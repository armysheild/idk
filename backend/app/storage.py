from hashlib import sha256
from pathlib import Path
from uuid import uuid4

import httpx
from fastapi import UploadFile

from .config import get_settings


def save_upload(upload: UploadFile, namespace: str | None = None) -> tuple[str, int, str]:
    settings = get_settings()
    object_key = f"{namespace.strip('/') + '/' if namespace else ''}documents/{uuid4().hex}"
    digest = sha256()
    size = 0
    chunks: list[bytes] = []
    while chunk := upload.file.read(1024 * 1024):
        size += len(chunk)
        if size > settings.max_upload_bytes:
            raise ValueError("Uploaded file exceeds the maximum allowed size")
        digest.update(chunk)
        chunks.append(chunk)
    content = b"".join(chunks)
    if settings.storage_backend == "local":
        storage_root = Path(settings.storage_path).resolve()
        target = storage_root / object_key
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(content)
    elif settings.storage_backend == "supabase":
        if not settings.supabase_url or not settings.supabase_service_role_key:
            raise ValueError("Supabase Storage is not configured")
        response = httpx.put(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_storage_bucket}/{object_key}",
            content=content,
            headers={
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "apikey": settings.supabase_service_role_key,
                "Content-Type": upload.content_type or "application/octet-stream",
                "x-upsert": "false",
            },
            timeout=30,
        )
        if response.is_error:
            raise ValueError("Supabase Storage rejected the upload")
    else:
        raise ValueError("Unsupported storage backend")
    return object_key, size, digest.hexdigest()


def resolve_object(object_key: str) -> Path:
    if get_settings().storage_backend != "local":
        raise ValueError("Local object resolution is unavailable for the configured storage backend")
    storage_root = Path(get_settings().storage_path).resolve()
    candidate = (storage_root / object_key).resolve()
    if storage_root not in candidate.parents:
        raise ValueError("Invalid storage object key")
    return candidate


def download_object(object_key: str) -> bytes:
    settings = get_settings()
    if settings.storage_backend == "local":
        return resolve_object(object_key).read_bytes()
    if settings.storage_backend == "supabase" and settings.supabase_url and settings.supabase_service_role_key:
        response = httpx.get(
            f"{settings.supabase_url.rstrip('/')}/storage/v1/object/{settings.supabase_storage_bucket}/{object_key}",
            headers={
                "Authorization": f"Bearer {settings.supabase_service_role_key}",
                "apikey": settings.supabase_service_role_key,
            },
            timeout=30,
        )
        if response.is_error:
            raise ValueError("Supabase Storage object was not found")
        return response.content
    raise ValueError("Configured storage backend is not available")
