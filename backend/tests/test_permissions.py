from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from backend.app.dependencies import ROLE_PERMISSIONS, require_permission, require_roles


@pytest.mark.parametrize(
    ("role", "permission", "allowed"),
    [
        ("driver", "fleet", False),
        ("driver", "finance", False),
        ("mechanic", "inventory", False),
        ("technician", "finance", False),
        ("inventory_manager", "finance", False),
        ("accountant", "procurement", False),
        ("fleet_manager", "fleet", True),
        ("inventory_manager", "inventory", True),
        ("accountant", "finance", True),
    ],
)
def test_role_permission_boundaries(role: str, permission: str, allowed: bool):
    user = SimpleNamespace(role=role)
    dependency = require_permission(permission)

    if allowed:
        assert dependency(user) is user
    else:
        with pytest.raises(HTTPException) as error:
            dependency(user)
        assert error.value.status_code == 403


def test_role_permission_matrix_has_no_broad_field_or_finance_access():
    assert "finance" not in ROLE_PERMISSIONS["driver"]
    assert "finance" not in ROLE_PERMISSIONS["mechanic"]
    assert "finance" not in ROLE_PERMISSIONS["technician"]
    assert "inventory" not in ROLE_PERMISSIONS["mechanic"]
    assert "inventory" not in ROLE_PERMISSIONS["technician"]
    assert "procurement" not in ROLE_PERMISSIONS["accountant"]


def test_role_guard_rejects_unrelated_member():
    dependency = require_roles("owner", "fleet_manager")

    with pytest.raises(HTTPException) as error:
        dependency(SimpleNamespace(role="driver"))

    assert error.value.status_code == 403
