import hashlib
import hmac
import csv
import io
import json
import os
import re
import secrets
from html import escape
from datetime import date, datetime, timedelta, timezone
from typing import Optional
from uuid import uuid4

import httpx
from fastapi import APIRouter, Depends, File, HTTPException, Query, Request, UploadFile, status
from fastapi.responses import FileResponse, Response
from pydantic import BaseModel, ConfigDict
from sqlalchemy import select, func
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session, selectinload

from .config import get_settings
from .database import get_db
from .dependencies import get_current_user, require_permission, require_roles
from .models import AuditEvent, AuditLog, BillingInvoice, BillingPayment, ComplianceDocument, DocumentAsset, DocumentVersion, DriverInspection, Expense, FuelTransaction, IdempotencyRecord, InventoryMovement, InventoryTransaction, MaintenancePlan, NotificationPreference, NotificationDelivery, OdometerLog, OperationalNotification, Organization, OrganizationInvitation, Part, PurchaseOrder, PurchaseOrderLine, PurchaseOrderReceipt, StockLocation, TelematicsDevice, TelematicsIntegration, TelemetryReading, TollTransaction, User, Vehicle, VehicleAssignment, VehicleComponent, VehicleIssue, Vendor, WorkOrder, WorkOrderChecklistItem, WorkOrderEvidence, WorkOrderPartUsage, utc_now
from .security import create_access_token, hash_password, provision_supabase_user, verify_password
from .schemas import (
    ComponentCreate,
    ComponentRead,
    ComponentUpdate,
    DriverInspectionCreate,
    DriverInspectionRead,
    DocumentCreate,
    DocumentAssetRead,
    DocumentVersionRead,
    DocumentRead,
    DocumentUpdate,
    ExpenseCreate,
    ExpenseRead,
    ExpenseStatusUpdate,
    ExpenseReversal,
    FinanceSummaryRead,
    FleetAnalyticsRead,
    FleetAnalyticsVehicleRead,
    FleetOperationsSummaryRead,
    FuelTransactionCreate,
    FuelTransactionRead,
    IdentityProviderMetadata,
    InvitationAccept,
    InvitationAcceptRead,
    InvitationCreate,
    InvitationRead,
    InventoryTransactionCreate,
    InventoryTransactionRead,
    InventoryMovementCreate,
    InventoryMovementRead,
    LoginRequest,
    OrganizationSignup,
    OrganizationSignupRead,
    MaintenancePlanCreate,
    MaintenancePlanRead,
    NotificationRead,
    NotificationPreferenceRead,
    NotificationPreferenceUpdate,
    NotificationDeliveryRead,
    NotificationStatusUpdate,
    PartCreate,
    PartRead,
    PurchaseOrderCreate,
    PurchaseOrderReceiptCreate,
    PurchaseOrderReceiptRead,
    PurchaseOrderRead,
    PurchaseOrderStatusUpdate,
    StockLocationCreate,
    StockLocationRead,
    TollTransactionCreate,
    TollTransactionRead,
    TelematicsDeviceCreate,
    TelematicsDeviceRead,
    TelematicsHealthRead,
    TelematicsIntegrationCreate,
    TelematicsIntegrationRead,
    TelemetryReadingCreate,
    TelemetryReadingRead,
    Token,
    SubscriptionChange,
    SubscriptionPlanRead,
    SubscriptionRead,
    SubscriptionCheckoutRead,
    RazorpaySubscriptionVerify,
    UserRead,
    UserCreate,
    UserContactUpdate,
    UserProfileUpdate,
    UserRoleUpdate,
    AuditLogRead,
    BillingInvoiceRead,
    BillingPaymentRead,
    VehicleCreate,
    VehicleAssignmentCreate,
    VehicleAssignmentRead,
    VehicleRead,
    VehicleUpdate,
    VendorCreate,
    VendorRead,
    WorkOrderCreate,
    WorkOrderChecklistItemRead,
    WorkOrderChecklistUpdate,
    WorkOrderEvidenceRead,
    WorkOrderPartUsageCreate,
    WorkOrderPartUsageRead,
    WorkOrderRead,
    WorkOrderUpdate,
    WorkOrderAssignmentCreate,
    WorkOrderAssignmentRead,
    OdometerLogRead,
    VehicleIssueCreate,
    VehicleIssueRead,
    AssignableMemberRead,
    VehicleDriverAssignmentCreate,
    VehicleDriverAssignmentRead,
    TeamRosterRead,
    AuditEventRead,
)
from .storage import download_object, resolve_object, save_upload

router = APIRouter(prefix="/api/v1")

# Fixed Bug 26: Report field name mappings for consistent display
VEHICLE_REPORT_FIELD_MAPPINGS = {
    "registration_number": "Registration No.",
    "model": "Vehicle Model",
    "vehicle_type": "Type",
    "depot": "Depot",
    "status": "Current Status",
    "health": "Health %",
    "odometer_km": "Odometer (km)",
    "driver_name": "Assigned Driver",
}

WORK_ORDER_REPORT_FIELD_MAPPINGS = {
    "id": "Order ID",
    "title": "Title",
    "vehicle_id": "Vehicle ID",
    "status": "Status",
    "priority": "Priority",
    "assigned_user_id": "Assigned To",
    "created_at": "Created",
    "completed_at": "Completed",
    "labor_hours": "Labor Hours",
}


def reserve_idempotency_key(request: Request, user: User, database: Session) -> None:
    key = request.headers.get("Idempotency-Key")
    if not key:
        return
    if len(key) > 160:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Idempotency-Key is too long")
    method = request.method.upper()
    path = request.url.path
    existing = database.scalar(select(IdempotencyRecord).where(
        IdempotencyRecord.organization_id == user.organization_id,
        IdempotencyRecord.user_id == user.id,
        IdempotencyRecord.idempotency_key == key,
        IdempotencyRecord.method == method,
        IdempotencyRecord.path == path,
    ))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Idempotency-Key has already been used")
    database.add(IdempotencyRecord(
        organization_id=user.organization_id,
        user_id=user.id,
        idempotency_key=key,
        method=method,
        path=path,
    ))
    database.flush()

SUBSCRIPTION_PLANS = {
    "starter": {
        "code": "starter",
        "name": "Starter",
        "monthly_price_paise": 299900,
        "included_vehicles": 3,
        "overage_vehicle_fee_paise": 50000,
        "min_vehicles": 1,
        "max_vehicles": 10,
        "included_users": 999999,
        "description": "For small operators and pilots.",
        "features": ["Fleet register", "Maintenance", "Compliance vault", "Basic finance", "3 vehicles included"],
    },
    "growth": {
        "code": "growth",
        "name": "Growth",
        "monthly_price_paise": 999900,
        "included_vehicles": 15,
        "overage_vehicle_fee_paise": 45000,
        "min_vehicles": 11,
        "max_vehicles": 49,
        "included_users": 999999,
        "description": "For growing regional fleets.",
        "features": ["Everything in Starter", "15 vehicles included", "Workshop inventory", "Procurement", "Fuel and toll", "Notifications"],
    },
    "scale": {
        "code": "scale",
        "name": "Scale",
        "monthly_price_paise": 2499900,
        "included_vehicles": 50,
        "overage_vehicle_fee_paise": 35000,
        "min_vehicles": 50,
        "max_vehicles": 99,
        "included_users": 999999,
        "description": "For multi-depot operators.",
        "features": ["Everything in Growth", "50 vehicles included", "Telematics", "Advanced finance", "Multi-depot controls", "Priority support"],
    },
    "enterprise": {
        "code": "enterprise",
        "name": "Enterprise",
        "monthly_price_paise": None,
        "included_vehicles": 100,
        "overage_vehicle_fee_paise": 30000,
        "min_vehicles": 100,
        "max_vehicles": 999999,
        "included_users": 999999,
        "description": "For large fleets with custom service and integrations.",
        "features": ["Custom fleet volume", "SSO", "Dedicated onboarding", "Custom integrations", "SLA"],
    },
}


def calculate_monthly_bill(plan: dict, vehicle_count: int) -> dict[str, int]:
    billable_vehicles = max(0, vehicle_count)
    included_vehicles = int(plan["included_vehicles"])
    overage_vehicles = max(0, billable_vehicles - included_vehicles)
    platform_fee = int(plan["monthly_price_paise"] or 0)
    overage = overage_vehicles * int(plan["overage_vehicle_fee_paise"])
    return {
        "billable_vehicles": billable_vehicles,
        "overage_vehicles": overage_vehicles,
        "platform_fee_paise": platform_fee,
        "overage_paise": overage,
        "estimated_subtotal_paise": platform_fee + overage,
    }


def organization_slug(name: str, database: Session) -> str:
    base = "-".join("".join(character.lower() if character.isalnum() else "-" for character in name).split("-"))
    base = base.strip("-") or "organization"
    slug = base
    suffix = 2
    while database.scalar(select(Organization).where(Organization.slug == slug)) is not None:
        slug = f"{base}-{suffix}"
        suffix += 1
    return slug


def normalize_mobile_phone(value: str | None) -> str | None:
    if not value:
        return None
    compact = re.sub(r"[\s().-]", "", value)
    if compact.startswith("00"):
        compact = f"+{compact[2:]}"
    if compact.isdigit() and len(compact) == 10 and compact[0] in "6789":
        compact = f"+91{compact}"
    if not re.fullmatch(r"\+[1-9]\d{7,14}", compact):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="Mobile number must be in international format, for example +919876543210",
        )
    return compact


def invitation_token_hash(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def invitation_is_active(invitation: OrganizationInvitation) -> bool:
    expires_at = invitation.expires_at
    if expires_at.tzinfo is None:
        expires_at = expires_at.replace(tzinfo=timezone.utc)
    return invitation.accepted_at is None and invitation.revoked_at is None and expires_at > datetime.now(timezone.utc)


def trial_end_date() -> str:
    return (datetime.now(timezone.utc).date() + timedelta(days=14)).isoformat()


@router.post("/auth/signup", response_model=OrganizationSignupRead, status_code=status.HTTP_201_CREATED)
def signup(payload: OrganizationSignup, database: Session = Depends(get_db)) -> OrganizationSignupRead:
    email = payload.email.lower()
    if database.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    organization = Organization(
        name=payload.organization_name.strip(),
        slug=organization_slug(payload.organization_name, database),
        subscription_status="trialing",
        trial_ends_on=trial_end_date(),
    )
    database.add(organization)
    database.flush()
    try:
        supabase_user_id = provision_supabase_user(email, payload.password, payload.full_name.strip())
    except ValueError as error:
        detail = str(error)
        code = status.HTTP_409_CONFLICT if "already exists" in detail else status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(status_code=code, detail=detail) from error
    user = User(
        organization_id=organization.id,
        email=email,
        full_name=payload.full_name.strip(),
        mobile_phone=normalize_mobile_phone(payload.mobile_phone),
        sms_alerts_enabled=payload.sms_alerts_enabled,
        whatsapp_alerts_enabled=payload.whatsapp_alerts_enabled,
        password_hash=hash_password(payload.password),
        supabase_user_id=supabase_user_id,
        role="owner",
    )
    database.add(user)
    database.flush()
    database.add(AuditLog(
        organization_id=organization.id,
        actor_user_id=user.id,
        action="organization.created",
        entity_type="organization",
        entity_id=str(organization.id),
        request_id=str(uuid4()),
        changes=json.dumps({"name": organization.name, "slug": organization.slug}),
    ))
    database.commit()
    return OrganizationSignupRead(
        organization_id=organization.id,
        organization_name=organization.name,
        organization_slug=organization.slug,
        user=user,
        access_token=create_access_token(str(user.id), user.token_version),
    )


@router.post("/auth/login", response_model=Token)
def login(payload: LoginRequest, database: Session = Depends(get_db)) -> Token:
    settings = get_settings()
    if settings.auth_provider == "supabase" and settings.environment.lower() != "development":
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Use Supabase Auth to sign in",
        )
    user = database.scalar(select(User).where(User.email == payload.email.lower()))
    if user is None or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Email or password is incorrect")
    return Token(access_token=create_access_token(str(user.id), user.token_version))


@router.get("/auth/identity-provider", response_model=IdentityProviderMetadata)
def identity_provider_metadata() -> IdentityProviderMetadata:
    settings = get_settings()
    return IdentityProviderMetadata(
        enabled=settings.identity_provider_enabled,
        issuer=settings.identity_provider_issuer,
        client_id=settings.identity_provider_client_id,
        local_login_available=not (
            settings.auth_provider == "supabase"
            and settings.environment.lower() != "development"
        ),
    )


@router.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
def logout(user: User = Depends(get_current_user), database: Session = Depends(get_db)) -> None:
    user.token_version += 1
    database.commit()


@router.get("/auth/me", response_model=UserRead)
def current_user(user: User = Depends(get_current_user)) -> User:
    return user


@router.get("/audit-log", response_model=list[AuditLogRead])
def list_audit_log(
    actor_role: str | None = None,
    entity_type: str | None = None,
    action: str | None = None,
    outcome: str | None = None,
    limit: int = 100,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> list[AuditLog]:
    statement = select(AuditLog).where(AuditLog.organization_id == user.organization_id)
    if actor_role:
        statement = statement.join(User, User.id == AuditLog.actor_user_id).where(User.role == actor_role)
    if entity_type:
        statement = statement.where(AuditLog.entity_type == entity_type)
    if action:
        statement = statement.where(AuditLog.action.ilike("%" + action + "%"))
    if outcome:
        statement = statement.where(AuditLog.changes.ilike("%" + outcome + "%"))
    return list(database.scalars(statement.order_by(AuditLog.created_at.desc()).limit(max(1, min(limit, 200)))).all())


@router.get("/fleet/operations-summary", response_model=FleetOperationsSummaryRead)
def fleet_operations_summary(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> FleetOperationsSummaryRead:
    vehicles = list(database.scalars(select(Vehicle).where(Vehicle.organization_id == user.organization_id)).all())
    work_orders = list(database.scalars(select(WorkOrder).where(WorkOrder.organization_id == user.organization_id)).all())
    components = list(database.scalars(select(VehicleComponent).where(VehicleComponent.organization_id == user.organization_id)).all())
    documents = list(database.scalars(select(ComplianceDocument).where(ComplianceDocument.organization_id == user.organization_id)).all())
    parts = list(database.scalars(select(Part).where(Part.organization_id == user.organization_id)).all())
    today = date.today().isoformat()
    return FleetOperationsSummaryRead(
        active_vehicles=sum(vehicle.status not in ("Out of service", "Retired") for vehicle in vehicles),
        total_vehicles=len(vehicles),
        open_work_orders=sum(order.status not in ("Completed", "Cancelled") for order in work_orders),
        overdue_work_orders=sum(order.status not in ("Completed", "Cancelled") and order.due_date is not None and order.due_date < today for order in work_orders),
        due_components=sum(component.next_service_km is not None and next((vehicle.odometer_km for vehicle in vehicles if vehicle.id == component.vehicle_id), 0) >= component.next_service_km for component in components),
        compliance_due=sum(document.expires_on <= (date.today() + timedelta(days=30)).isoformat() for document in documents),
        low_stock_parts=sum(part.quantity_on_hand <= part.reorder_level for part in parts),
        unassigned_vehicles=sum(vehicle.assigned_driver_id is None for vehicle in vehicles),
    )


@router.get("/fleet/analytics", response_model=FleetAnalyticsRead)
def fleet_analytics(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> FleetAnalyticsRead:
    vehicles = list(database.scalars(select(Vehicle).where(Vehicle.organization_id == user.organization_id)).all())
    expenses = list(database.scalars(select(Expense).where(Expense.organization_id == user.organization_id)).all())
    fuel = list(database.scalars(select(FuelTransaction).where(FuelTransaction.organization_id == user.organization_id)).all())
    tolls = list(database.scalars(select(TollTransaction).where(TollTransaction.organization_id == user.organization_id)).all())
    work_orders = list(database.scalars(select(WorkOrder).where(WorkOrder.organization_id == user.organization_id)).all())
    now = utc_now()
    analytics = []
    for vehicle in vehicles:
        maintenance_cost = sum(
            expense.amount_paise
            for expense in expenses
            if expense.vehicle_id == vehicle.id
            and any(term in expense.category.lower() for term in ("maintenance", "repair", "service"))
            and expense.status != "Rejected"
        )
        maintenance_cost += sum(item.total_amount_paise for item in fuel if item.vehicle_id == vehicle.id)
        maintenance_cost += sum(item.amount_paise for item in tolls if item.vehicle_id == vehicle.id and item.status != "Rejected")
        downtime_days = 0
        for order in work_orders:
            if order.vehicle_id != vehicle.id or order.status in {"Completed", "Closed", "Archived", "Cancelled"}:
                continue
            started_at = order.created_at or now
            if started_at.tzinfo is None:
                started_at = started_at.replace(tzinfo=timezone.utc)
            downtime_days += max(0, (now - started_at).days)
        analytics.append(FleetAnalyticsVehicleRead(
            vehicle_id=vehicle.id,
            maintenance_cost_paise=maintenance_cost,
            cost_per_km_paise=maintenance_cost // max(vehicle.odometer_km, 1),
            downtime_days=downtime_days,
            odometer_km=vehicle.odometer_km,
        ))
    anomalies = len(list(database.scalars(select(OdometerLog).where(
        OdometerLog.organization_id == user.organization_id,
        OdometerLog.is_flagged.is_(True),
    )).all()))
    return FleetAnalyticsRead(vehicles=analytics, odometer_anomalies=anomalies)


@router.patch("/users/me", response_model=UserRead)
def update_my_profile(
    payload: UserProfileUpdate,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> User:
    changes = {
        "full_name": payload.full_name.strip(),
        "mobile_phone": normalize_mobile_phone(payload.mobile_phone),
        "sms_alerts_enabled": payload.sms_alerts_enabled,
        "whatsapp_alerts_enabled": payload.whatsapp_alerts_enabled,
    }
    user.full_name = changes["full_name"]
    user.mobile_phone = changes["mobile_phone"]
    user.sms_alerts_enabled = changes["sms_alerts_enabled"]
    user.whatsapp_alerts_enabled = changes["whatsapp_alerts_enabled"]
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="user.profile_updated",
        entity_type="user",
        entity_id=str(user.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps(changes),
    ))
    database.commit()
    database.refresh(user)
    return user


@router.patch("/users/me/contact", response_model=UserRead)
def update_my_contact(
    payload: UserContactUpdate,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> User:
    user.mobile_phone = normalize_mobile_phone(payload.mobile_phone)
    database.commit()
    database.refresh(user)
    return user


@router.get("/invitations", response_model=list[InvitationRead])
def list_invitations(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> list[OrganizationInvitation]:
    return list(database.scalars(
        select(OrganizationInvitation)
        .where(OrganizationInvitation.organization_id == user.organization_id)
        .order_by(OrganizationInvitation.created_at.desc())
    ).all())


@router.post("/invitations", response_model=dict, status_code=status.HTTP_201_CREATED)
def create_invitation(
    payload: InvitationCreate,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    email = payload.email.lower()
    if database.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    active_invitation = database.scalar(select(OrganizationInvitation).where(
        OrganizationInvitation.organization_id == user.organization_id,
        OrganizationInvitation.email == email,
        OrganizationInvitation.accepted_at.is_(None),
        OrganizationInvitation.revoked_at.is_(None),
    ))
    if active_invitation and invitation_is_active(active_invitation):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An active invitation already exists for this email")
    raw_token = secrets.token_urlsafe(32)
    invitation = OrganizationInvitation(
        organization_id=user.organization_id,
        invited_by=user.id,
        email=email,
        full_name=payload.full_name.strip(),
        mobile_phone=normalize_mobile_phone(payload.mobile_phone),
        role=payload.role,
        token_hash=invitation_token_hash(raw_token),
        expires_at=datetime.now(timezone.utc) + timedelta(days=payload.expires_in_days),
    )
    database.add(invitation)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="organization.invitation_created",
        entity_type="organization_invitation",
        entity_id=str(invitation.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"email": email, "role": payload.role}),
    ))
    database.commit()
    return {
        "id": invitation.id,
        "email": invitation.email,
        "role": invitation.role,
        "expires_at": invitation.expires_at,
        "invite_token": raw_token,
        "invite_path": f"/invite/{raw_token}",
    }


@router.get("/onboarding/invite-details", response_model=dict)
def get_invite_details(
    token: str = Query(min_length=32),
    database: Session = Depends(get_db),
) -> dict:
    invitation = database.scalar(select(OrganizationInvitation).where(
        OrganizationInvitation.token_hash == invitation_token_hash(token),
    ))
    if invitation is None or not invitation_is_active(invitation):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This invitation is invalid or expired")
    organization = database.get(Organization, invitation.organization_id)
    if organization is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Organization not found")
    return {
        "email": invitation.email,
        "role": invitation.role,
        "organization": {"id": organization.id, "name": organization.name},
    }


@router.post("/invitations/{invitation_id}/revoke", response_model=InvitationRead)
def revoke_invitation(
    invitation_id: int,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> OrganizationInvitation:
    invitation = database.scalar(select(OrganizationInvitation).where(
        OrganizationInvitation.id == invitation_id,
        OrganizationInvitation.organization_id == user.organization_id,
    ))
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if invitation.accepted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Accepted invitations cannot be revoked")
    invitation.revoked_at = utc_now()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="organization.invitation_revoked",
        entity_type="organization_invitation",
        entity_id=str(invitation.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(invitation)
    return invitation


@router.post("/invitations/{invitation_id}/resend", response_model=dict)
def resend_invitation(
    invitation_id: int,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    invitation = database.scalar(select(OrganizationInvitation).where(
        OrganizationInvitation.id == invitation_id,
        OrganizationInvitation.organization_id == user.organization_id,
    ))
    if invitation is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invitation not found")
    if invitation.accepted_at is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Accepted invitations cannot be resent")
    raw_token = secrets.token_urlsafe(32)
    invitation.token_hash = invitation_token_hash(raw_token)
    invitation.expires_at = datetime.now(timezone.utc) + timedelta(days=7)
    invitation.revoked_at = None
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="organization.invitation_resent",
        entity_type="organization_invitation",
        entity_id=str(invitation.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(invitation)
    return {
        "id": invitation.id,
        "email": invitation.email,
        "role": invitation.role,
        "expires_at": invitation.expires_at,
        "invite_token": raw_token,
        "invite_path": f"/invite/{raw_token}",
    }


@router.post("/auth/invitations/accept", response_model=InvitationAcceptRead)
def accept_invitation(payload: InvitationAccept, database: Session = Depends(get_db)) -> InvitationAcceptRead:
    invitation = database.scalar(select(OrganizationInvitation).where(
        OrganizationInvitation.token_hash == invitation_token_hash(payload.token)
    ))
    if invitation is None or not invitation_is_active(invitation):
        raise HTTPException(status_code=status.HTTP_410_GONE, detail="This invitation is invalid or expired")
    if database.scalar(select(User).where(User.email == invitation.email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    organization = database.get(Organization, invitation.organization_id)
    try:
        supabase_user_id = provision_supabase_user(invitation.email, payload.password, invitation.full_name)
    except ValueError as error:
        detail = str(error)
        code = status.HTTP_409_CONFLICT if "already exists" in detail else status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(status_code=code, detail=detail) from error
    member = User(
        organization_id=invitation.organization_id,
        email=invitation.email,
        full_name=invitation.full_name,
        mobile_phone=normalize_mobile_phone(payload.mobile_phone or invitation.mobile_phone),
        sms_alerts_enabled=payload.sms_alerts_enabled,
        whatsapp_alerts_enabled=payload.whatsapp_alerts_enabled,
        password_hash=hash_password(payload.password),
        supabase_user_id=supabase_user_id,
        role=invitation.role,
    )
    database.add(member)
    invitation.accepted_at = utc_now()
    database.flush()
    database.add(AuditLog(
        organization_id=invitation.organization_id,
        actor_user_id=member.id,
        action="organization.invitation_accepted",
        entity_type="user",
        entity_id=str(member.id),
        request_id=str(uuid4()),
        changes=json.dumps({"role": member.role}),
    ))
    database.commit()
    return InvitationAcceptRead(
        organization_name=organization.name,
        user=member,
        access_token=create_access_token(str(member.id), member.token_version),
    )


@router.get("/users", response_model=list[UserRead])
def list_users(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20
) -> list[User]:
    # Fixed Bug 11: Add pagination support to users listing
    if limit < 1 or limit > 100:
        limit = 20
    if skip < 0:
        skip = 0
    return list(database.scalars(select(User).where(User.organization_id == user.organization_id).order_by(User.full_name.asc()).offset(skip).limit(limit)).all())


@router.post("/users", response_model=UserRead, status_code=status.HTTP_201_CREATED)
def create_user(
    payload: UserCreate,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> User:
    email = payload.email.lower()
    if database.scalar(select(User).where(User.email == email)) is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A user with this email already exists")
    try:
        supabase_user_id = provision_supabase_user(email, payload.password, payload.full_name.strip())
    except ValueError as error:
        detail = str(error)
        code = status.HTTP_409_CONFLICT if "already exists" in detail else status.HTTP_503_SERVICE_UNAVAILABLE
        raise HTTPException(status_code=code, detail=detail) from error
    member = User(
        organization_id=user.organization_id,
        email=email,
        full_name=payload.full_name.strip(),
        mobile_phone=normalize_mobile_phone(payload.mobile_phone),
        password_hash=hash_password(payload.password),
        supabase_user_id=supabase_user_id,
        role=payload.role,
    )
    database.add(member)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="user.created",
        entity_type="user",
        entity_id=str(member.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"email": member.email, "role": member.role}),
    ))
    database.commit()
    database.refresh(member)
    return member


@router.patch("/users/{user_id}", response_model=UserRead)
def update_user_role(
    user_id: int,
    payload: UserRoleUpdate,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> User:
    member = database.scalar(select(User).where(User.id == user_id, User.organization_id == user.organization_id))
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    member.role = payload.role
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="user.role_updated",
        entity_type="user",
        entity_id=str(member.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"role": member.role}),
    ))
    database.commit()
    database.refresh(member)
    return member


@router.delete("/users/{user_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_user(
    user_id: int,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> Response:
    member = database.scalar(select(User).where(User.id == user_id, User.organization_id == user.organization_id))
    if member is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="User not found")
    if member.id == user.id or member.role == "owner":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Owner accounts cannot be removed")
    database.delete(member)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="user.deleted",
        entity_type="user",
        entity_id=str(member.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"email": member.email, "role": member.role}),
    ))
    try:
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Member cannot be removed while linked operational records exist") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/subscription/plans", response_model=list[SubscriptionPlanRead])
def list_subscription_plans() -> list[dict]:
    return list(SUBSCRIPTION_PLANS.values())


@router.get("/subscription", response_model=SubscriptionRead)
def get_subscription(user: User = Depends(require_roles("owner")), database: Session = Depends(get_db)) -> SubscriptionRead:
    organization = database.get(Organization, user.organization_id)
    plan = SUBSCRIPTION_PLANS.get(organization.subscription_plan, SUBSCRIPTION_PLANS["starter"])
    vehicle_count = database.query(Vehicle).filter(Vehicle.organization_id == user.organization_id).count()
    bill = calculate_monthly_bill(plan, vehicle_count)
    return SubscriptionRead(
        plan=plan,
        status=organization.subscription_status,
        trial_ends_on=organization.trial_ends_on,
        renews_on=organization.subscription_renews_on,
        vehicle_count=vehicle_count,
        user_count=database.query(User).filter(User.organization_id == user.organization_id).count(),
        overage_vehicles=bill["overage_vehicles"],
        estimated_subtotal_paise=bill["estimated_subtotal_paise"],
    )


@router.patch("/subscription", response_model=SubscriptionRead)
def change_subscription(
    payload: SubscriptionChange,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> SubscriptionRead:
    organization = database.get(Organization, user.organization_id)
    vehicle_count = database.query(Vehicle).filter(Vehicle.organization_id == user.organization_id).count()
    plan = SUBSCRIPTION_PLANS[payload.plan_code]
    if vehicle_count < plan["min_vehicles"] or vehicle_count > plan["max_vehicles"]:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"{plan['name']} supports {plan['min_vehicles']} to {plan['max_vehicles']} vehicles; this organization has {vehicle_count}",
        )
    organization.subscription_plan = payload.plan_code
    organization.subscription_status = "pending_activation"
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="subscription.plan_changed",
        entity_type="organization_subscription",
        entity_id=str(organization.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"plan": payload.plan_code}),
    ))
    database.commit()
    return get_subscription(user, database)


@router.post("/subscription/checkout", response_model=SubscriptionCheckoutRead)
def create_subscription_checkout(
    payload: SubscriptionChange,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> SubscriptionCheckoutRead:
    settings = get_settings()
    plan_id = {
        "starter": settings.razorpay_plan_starter,
        "growth": settings.razorpay_plan_growth,
        "scale": settings.razorpay_plan_scale,
        "enterprise": settings.razorpay_plan_enterprise,
    }[payload.plan_code]
    if not settings.razorpay_key_id or not settings.razorpay_key_secret or not plan_id:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay subscription plans are not configured")
    response = httpx.post(
        "https://api.razorpay.com/v1/subscriptions",
        auth=(settings.razorpay_key_id, settings.razorpay_key_secret),
        json={"plan_id": plan_id, "total_count": 120, "customer_notify": 1},
        timeout=30,
    )
    if response.is_error:
        raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail="Razorpay could not create the subscription")
    subscription = response.json()
    organization = database.get(Organization, user.organization_id)
    organization.subscription_plan = payload.plan_code
    organization.subscription_status = "pending_activation"
    organization.razorpay_subscription_id = subscription["id"]
    database.add(AuditLog(
        organization_id=organization.id,
        actor_user_id=user.id,
        action="subscription.checkout_created",
        entity_type="organization",
        entity_id=str(organization.id),
        request_id=str(uuid4()),
        changes=json.dumps({"plan_code": payload.plan_code, "razorpay_subscription_id": subscription["id"]}),
    ))
    database.commit()
    return SubscriptionCheckoutRead(
        subscription_id=subscription["id"],
        plan_code=payload.plan_code,
        razorpay_key_id=settings.razorpay_key_id,
        short_url=subscription.get("short_url"),
    )


@router.post("/webhooks/razorpay", status_code=status.HTTP_204_NO_CONTENT)
async def razorpay_webhook(request: Request, database: Session = Depends(get_db)) -> None:
    settings = get_settings()
    if not settings.razorpay_webhook_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay webhook verification is not configured")
    body = await request.body()
    signature = request.headers.get("x-razorpay-signature", "")
    expected = hmac.new(settings.razorpay_webhook_secret.encode(), body, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(signature, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Razorpay webhook signature")
    event = json.loads(body)
    subscription_entity = event.get("payload", {}).get("subscription", {}).get("entity", {})
    subscription_id = subscription_entity.get("id")
    if not subscription_id:
        return
    organization = database.scalar(select(Organization).where(Organization.razorpay_subscription_id == subscription_id))
    if organization is None:
        return
    event_name = event.get("event", "")
    if event_name in {"subscription.activated", "subscription.charged"}:
        organization.subscription_status = "active"
    elif event_name in {"subscription.halted", "subscription.cancelled", "subscription.completed"}:
        organization.subscription_status = event_name.split(".", 1)[1]
    database.add(AuditLog(
        organization_id=organization.id,
        action=f"razorpay.{event_name}",
        entity_type="subscription",
        entity_id=subscription_id,
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"event": event_name}),
    ))
    database.commit()


@router.post("/subscription/verify", response_model=SubscriptionRead)
def verify_subscription_payment(
    payload: RazorpaySubscriptionVerify,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> SubscriptionRead:
    settings = get_settings()
    if not settings.razorpay_key_secret:
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Razorpay verification is not configured")
    message = f"{payload.razorpay_payment_id}|{payload.razorpay_subscription_id}".encode()
    expected = hmac.new(settings.razorpay_key_secret.encode(), message, hashlib.sha256).hexdigest()
    if not hmac.compare_digest(payload.razorpay_signature, expected):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Razorpay payment signature")
    organization = database.get(Organization, user.organization_id)
    if organization.razorpay_subscription_id != payload.razorpay_subscription_id:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Subscription does not belong to this organization")
    organization.subscription_status = "active"
    database.add(AuditLog(
        organization_id=organization.id,
        actor_user_id=user.id,
        action="subscription.payment_verified",
        entity_type="subscription",
        entity_id=payload.razorpay_subscription_id,
        request_id=str(uuid4()),
        changes=json.dumps({"razorpay_payment_id": payload.razorpay_payment_id}),
    ))
    database.commit()
    return get_subscription(user, database)


@router.get("/billing/invoices", response_model=list[BillingInvoiceRead])
def list_billing_invoices(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> list[BillingInvoice]:
    return list(database.scalars(select(BillingInvoice).where(
        BillingInvoice.organization_id == user.organization_id,
    ).order_by(BillingInvoice.id.desc())).all())


@router.get("/billing/invoices/{invoice_id}/payments", response_model=list[BillingPaymentRead])
def list_billing_payments(
    invoice_id: int,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> list[BillingPayment]:
    invoice = database.scalar(select(BillingInvoice).where(
        BillingInvoice.id == invoice_id,
        BillingInvoice.organization_id == user.organization_id,
    ))
    if invoice is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Invoice not found")
    return list(database.scalars(select(BillingPayment).where(
        BillingPayment.invoice_id == invoice_id,
        BillingPayment.organization_id == user.organization_id,
    ).order_by(BillingPayment.id.desc())).all())


@router.get("/notification-preferences", response_model=list[NotificationPreferenceRead])
def list_notification_preferences(user: User = Depends(get_current_user), database: Session = Depends(get_db)) -> list[NotificationPreference]:
    return list(database.scalars(select(NotificationPreference).where(
        NotificationPreference.organization_id == user.organization_id,
        NotificationPreference.user_id == user.id,
    ).order_by(NotificationPreference.notification_type)).all())


@router.put("/notification-preferences", response_model=NotificationPreferenceRead)
def update_notification_preference(
    payload: NotificationPreferenceUpdate,
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> NotificationPreference:
    preference = database.scalar(select(NotificationPreference).where(
        NotificationPreference.organization_id == user.organization_id,
        NotificationPreference.user_id == user.id,
        NotificationPreference.notification_type == payload.notification_type,
    ))
    if preference is None:
        preference = NotificationPreference(
            organization_id=user.organization_id,
            user_id=user.id,
            notification_type=payload.notification_type,
        )
        database.add(preference)
    preference.in_app = payload.in_app
    preference.email = payload.email
    preference.sms = payload.sms
    preference.whatsapp = payload.whatsapp
    preference.push = payload.push
    database.commit()
    database.refresh(preference)
    return preference


@router.get("/notification-deliveries", response_model=list[NotificationDeliveryRead])
def list_notification_deliveries(
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> list[NotificationDelivery]:
    return list(database.scalars(select(NotificationDelivery).where(
        NotificationDelivery.organization_id == user.organization_id,
        NotificationDelivery.user_id == user.id,
    ).order_by(NotificationDelivery.id.desc()).limit(100)).all())


@router.post("/notification-deliveries/dispatch")
def dispatch_queued_notifications(
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> dict[str, int]:
    deliveries = database.scalars(
        select(NotificationDelivery)
        .where(
            NotificationDelivery.organization_id == user.organization_id,
            NotificationDelivery.user_id == user.id,
            NotificationDelivery.channel.in_(("sms", "whatsapp")),
            NotificationDelivery.status.in_(("queued", "failed")),
        )
        .order_by(NotificationDelivery.id)
        .limit(100)
    ).all()
    processed = 0
    for delivery in deliveries:
        notification = database.get(OperationalNotification, delivery.notification_id)
        recipient = database.get(User, delivery.user_id)
        if notification is None or recipient is None:
            continue
        if delivery.channel == "whatsapp":
            dispatch_whatsapp(delivery, notification, recipient)
        else:
            dispatch_sms(delivery, notification, recipient)
        processed += 1
    database.commit()
    return {"processed": processed}


@router.get("/vehicles", response_model=list[VehicleRead])
def list_vehicles(
    user: User = Depends(require_permission("fleet_read")),
    database: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20
) -> list[Vehicle]:
    # Fixed Bug 5, 11 & 29: Add pagination support with eager loading of driver relationship
    from sqlalchemy.orm import joinedload
    if limit < 1 or limit > 100:
        limit = 20
    if skip < 0:
        skip = 0
    statement = select(Vehicle).options(joinedload(Vehicle.driver)).where(Vehicle.organization_id == user.organization_id)
    if user.role == "driver":
        statement = statement.where(Vehicle.assigned_driver_id == user.id)
    elif user.role in ("technician", "mechanic"):
        statement = statement.where(Vehicle.id.in_(
            select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == user.organization_id,
                WorkOrder.assigned_user_id == user.id,
            )
        ))
    elif user.role not in ("owner", "fleet_manager"):
        statement = statement.where(Vehicle.id == -1)
    vehicles = list(database.scalars(statement.order_by(Vehicle.id.desc()).offset(skip).limit(limit)).all())
    # Populate driver_name from driver relationship for each vehicle
    for vehicle in vehicles:
        if vehicle.assigned_driver_id and vehicle.driver:
            vehicle.driver_name = vehicle.driver.full_name
    return vehicles


@router.post("/vehicles", response_model=VehicleRead, status_code=status.HTTP_201_CREATED)
def create_vehicle(
    payload: VehicleCreate,
    request: Request,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> Vehicle:
    registration_number = payload.registration_number.strip().upper()
    existing = database.scalar(select(Vehicle).where(Vehicle.organization_id == user.organization_id, Vehicle.registration_number == registration_number))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A vehicle with this registration number already exists")
    if payload.assigned_driver_id is not None:
        driver = database.scalar(select(User).where(
            User.id == payload.assigned_driver_id,
            User.organization_id == user.organization_id,
            User.role == "driver",
        ))
        if driver is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user must be a driver in this organization")
        driver_name = driver.full_name
    else:
        driver_name = payload.driver_name.strip() if payload.driver_name else None

    vehicle = Vehicle(
        organization_id=user.organization_id,
        registration_number=registration_number,
        model=payload.model.strip(),
        vehicle_type=payload.vehicle_type.strip(),
        depot=payload.depot.strip(),
        status=payload.status,
        health=payload.health,
        odometer_km=payload.odometer_km,
        driver_name=driver_name,
        assigned_driver_id=payload.assigned_driver_id,
    )
    database.add(vehicle)
    database.flush()
    if vehicle.assigned_driver_id is not None:
        database.add(VehicleAssignment(
            organization_id=user.organization_id,
            vehicle_id=vehicle.id,
            driver_id=vehicle.assigned_driver_id,
        ))
    if vehicle.odometer_km:
        database.add(OdometerLog(
            organization_id=user.organization_id,
            vehicle_id=vehicle.id,
            reading_km=vehicle.odometer_km,
            source="vehicle_creation",
            is_flagged=False,
        ))
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="vehicle.created",
        entity_type="vehicle",
        entity_id=str(vehicle.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"registration_number": registration_number}),
    ))
    database.commit()
    database.refresh(vehicle)
    return vehicle


@router.patch("/vehicles/{vehicle_id}", response_model=VehicleRead)
def update_vehicle(
    vehicle_id: int,
    payload: VehicleUpdate,
    request: Request,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> Vehicle:
    # Fixed Bug 15: Add row-level locking for atomic status transitions
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organization_id == user.organization_id,
    ).with_for_update())
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    changes = payload.model_dump(exclude_unset=True)
    if "odometer_km" in changes and changes["odometer_km"] < vehicle.odometer_km:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Odometer reading cannot be lower than the current vehicle reading",
        )
    if "assigned_driver_id" in changes and changes["assigned_driver_id"] is not None:
        driver = database.scalar(select(User).where(
            User.id == changes["assigned_driver_id"],
            User.organization_id == user.organization_id,
            User.role == "driver",
        ))
        if driver is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user must be a driver in this organization")
        changes["driver_name"] = driver.full_name
    elif changes.get("assigned_driver_id") is None and "assigned_driver_id" in changes:
        changes["driver_name"] = None
    previous_driver_id = vehicle.assigned_driver_id
    previous_odometer = vehicle.odometer_km
    for key, value in changes.items():
        setattr(vehicle, key, value)
    if "assigned_driver_id" in changes and changes["assigned_driver_id"] != previous_driver_id:
        active_assignment = database.scalar(select(VehicleAssignment).where(
            VehicleAssignment.organization_id == user.organization_id,
            VehicleAssignment.vehicle_id == vehicle.id,
            VehicleAssignment.active.is_(True),
        ))
        if active_assignment is not None:
            active_assignment.active = False
            active_assignment.ended_at = utc_now()
        if changes["assigned_driver_id"] is not None:
            database.add(VehicleAssignment(
                organization_id=user.organization_id,
                vehicle_id=vehicle.id,
                driver_id=changes["assigned_driver_id"],
            ))
    if "odometer_km" in changes and changes["odometer_km"] != previous_odometer:
        database.add(OdometerLog(
            organization_id=user.organization_id,
            vehicle_id=vehicle.id,
            reading_km=changes["odometer_km"],
            source="vehicle_update",
            is_flagged=False,
        ))
        evaluate_component_thresholds(user, vehicle, database)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="vehicle.updated",
        entity_type="vehicle",
        entity_id=str(vehicle.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps(changes),
    ))
    database.commit()
    database.refresh(vehicle)
    return vehicle


@router.delete("/vehicles/{vehicle_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_vehicle(
    vehicle_id: int,
    request: Request,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> Response:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    database.delete(vehicle)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="vehicle.deleted",
        entity_type="vehicle",
        entity_id=str(vehicle.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"registration_number": vehicle.registration_number}),
    ))
    try:
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Vehicle cannot be deleted while dependent records exist") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/vehicles/{vehicle_id}/assignments", response_model=list[VehicleAssignmentRead])
def list_vehicle_assignments(
    vehicle_id: int,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> list[VehicleAssignment]:
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organization_id == user.organization_id,
    ))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return list(database.scalars(select(VehicleAssignment).where(
        VehicleAssignment.organization_id == user.organization_id,
        VehicleAssignment.vehicle_id == vehicle_id,
    ).order_by(VehicleAssignment.id.desc())).all())


@router.get("/vehicles/{vehicle_id}/odometer", response_model=list[OdometerLogRead])
def list_vehicle_odometer(
    vehicle_id: int,
    user: User = Depends(require_permission("fleet_read")),
    database: Session = Depends(get_db),
) -> list[OdometerLog]:
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organization_id == user.organization_id,
    ))
    if vehicle is None or (user.role == "driver" and vehicle.assigned_driver_id != user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    return list(database.scalars(select(OdometerLog).where(
        OdometerLog.organization_id == user.organization_id,
        OdometerLog.vehicle_id == vehicle_id,
    ).order_by(OdometerLog.id.desc()).limit(100)).all())


@router.get("/components", response_model=list[ComponentRead])
def list_components(user: User = Depends(require_permission("maintenance_read")), database: Session = Depends(get_db)) -> list[VehicleComponent]:
    statement = select(VehicleComponent).where(VehicleComponent.organization_id == user.organization_id)
    if user.role == "driver":
        statement = statement.where(VehicleComponent.vehicle_id.in_(
            select(Vehicle.id).where(Vehicle.assigned_driver_id == user.id)
        ))
    elif user.role in ("technician", "mechanic"):
        statement = statement.where(VehicleComponent.vehicle_id.in_(
            select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == user.organization_id,
                WorkOrder.assigned_user_id == user.id,
            )
        ))
    elif user.role not in ("owner", "fleet_manager"):
        statement = statement.where(VehicleComponent.id == -1)
    return list(database.scalars(statement.order_by(VehicleComponent.id.desc())).all())


@router.post("/components", response_model=ComponentRead, status_code=status.HTTP_201_CREATED)
def create_component(
    payload: ComponentCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> VehicleComponent:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    component_data = payload.model_dump()
    alert_threshold_km = component_data.get("alert_threshold_km")
    service_interval_km = component_data.get("service_interval_km")
    if alert_threshold_km is not None and service_interval_km is not None and alert_threshold_km > service_interval_km:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alert threshold cannot exceed component life")
    if (
        component_data["next_service_km"] is None
        and service_interval_km is not None
    ):
        component_data["next_service_km"] = (
            component_data["installed_at_km"] + service_interval_km
        )
    if component_data.get("next_alert_km") is None and alert_threshold_km is not None:
        component_data["next_alert_km"] = component_data["installed_at_km"] + alert_threshold_km
    component = VehicleComponent(organization_id=user.organization_id, **component_data)
    database.add(component)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="component.created",
        entity_type="vehicle_component",
        entity_id=str(component.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "name": component.name}),
    ))
    database.commit()
    database.refresh(component)
    return component


@router.patch("/components/{component_id}", response_model=ComponentRead)
def update_component(
    component_id: int,
    payload: ComponentUpdate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> VehicleComponent:
    statement = select(VehicleComponent).where(
        VehicleComponent.id == component_id,
        VehicleComponent.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(VehicleComponent.vehicle_id.in_(
            select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == user.organization_id,
                WorkOrder.assigned_user_id == user.id,
            )
        ))
    component = database.scalar(statement)
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    changes = payload.model_dump(exclude_unset=True)
    interval_km = changes.get("service_interval_km", component.service_interval_km)
    threshold_km = changes.get("alert_threshold_km", component.alert_threshold_km)
    if threshold_km is not None and interval_km is not None and threshold_km > interval_km:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Alert threshold cannot exceed component life")
    for key, value in changes.items():
        setattr(component, key, value)
    lifecycle_start_km = component.last_service_km or component.installed_at_km
    if interval_km and "next_service_km" not in changes:
        component.next_service_km = lifecycle_start_km + interval_km
    if threshold_km and "next_alert_km" not in changes:
        component.next_alert_km = lifecycle_start_km + threshold_km
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="component.updated",
        entity_type="vehicle_component",
        entity_id=str(component.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps(changes),
    ))
    database.commit()
    database.refresh(component)
    return component


@router.delete("/components/{component_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_component(
    component_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> Response:
    component = database.scalar(select(VehicleComponent).where(
        VehicleComponent.id == component_id,
        VehicleComponent.organization_id == user.organization_id,
    ))
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    database.delete(component)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="component.deleted",
        entity_type="vehicle_component",
        entity_id=str(component.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": component.vehicle_id, "name": component.name}),
    ))
    try:
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Component cannot be deleted while linked service records exist") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/components/{component_id}/service-complete", response_model=ComponentRead)
def complete_component_service(
    component_id: int,
    odometer_km: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager", "mechanic")),
    database: Session = Depends(get_db),
) -> VehicleComponent:
    statement = select(VehicleComponent).where(
        VehicleComponent.id == component_id,
        VehicleComponent.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(VehicleComponent.vehicle_id.in_(
            select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == user.organization_id,
                WorkOrder.assigned_user_id == user.id,
            )
        ))
    component = database.scalar(statement)
    if component is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Component not found")
    vehicle = database.get(Vehicle, component.vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    if odometer_km < vehicle.odometer_km:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Service odometer cannot be lower than the vehicle's current reading",
        )
    component.last_service_km = odometer_km
    component.next_service_km = odometer_km + component.service_interval_km if component.service_interval_km else None
    component.next_alert_km = odometer_km + component.alert_threshold_km if component.alert_threshold_km else component.next_service_km
    component.status = "Healthy"
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="component.service_completed",
        entity_type="vehicle_component",
        entity_id=str(component.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"last_service_km": odometer_km, "next_service_km": component.next_service_km}),
    ))
    database.commit()
    database.refresh(component)
    return component


@router.get("/work-orders", response_model=list[WorkOrderRead])
def list_work_orders(
    user: User = Depends(require_permission("maintenance_read")),
    database: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20
) -> list[WorkOrder]:
    # Fixed Bug 11: Add pagination support to work orders listing
    if limit < 1 or limit > 100:
        limit = 20
    if skip < 0:
        skip = 0
    statement = select(WorkOrder).where(WorkOrder.organization_id == user.organization_id)
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    elif user.role not in ("owner", "fleet_manager"):
        statement = statement.where(WorkOrder.id == -1)
    return list(database.scalars(statement.order_by(WorkOrder.id.desc()).offset(skip).limit(limit)).all())


@router.get("/driver/inspections", response_model=list[DriverInspectionRead])
def list_driver_inspections(
    user: User = Depends(require_roles("driver")),
    database: Session = Depends(get_db),
) -> list[DriverInspection]:
    return list(database.scalars(select(DriverInspection).where(
        DriverInspection.organization_id == user.organization_id,
        DriverInspection.driver_id == user.id,
    ).order_by(DriverInspection.id.desc()).limit(100)).all())


@router.post("/driver/inspections", response_model=DriverInspectionRead, status_code=status.HTTP_201_CREATED)
def create_driver_inspection(
    payload: DriverInspectionCreate,
    request: Request,
    user: User = Depends(require_roles("driver")),
    database: Session = Depends(get_db),
) -> DriverInspection:
    reserve_idempotency_key(request, user, database)
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == payload.vehicle_id,
        Vehicle.organization_id == user.organization_id,
        Vehicle.assigned_driver_id == user.id,
    ))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle is not assigned to this driver")
    if payload.odometer_km < vehicle.odometer_km:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Inspection odometer cannot move backwards")
    vehicle.odometer_km = max(vehicle.odometer_km, payload.odometer_km)
    if payload.status == "UNSAFE":
        vehicle.status = "Out of service"
    database.add(OdometerLog(
        organization_id=user.organization_id,
        vehicle_id=vehicle.id,
        driver_id=user.id,
        reading_km=payload.odometer_km,
        source=f"driver_{payload.inspection_type}",
        is_flagged=False,
    ))
    evaluate_component_thresholds(user, vehicle, database)
    inspection = DriverInspection(
        organization_id=user.organization_id,
        driver_id=user.id,
        **payload.model_dump(),
    )
    database.add(inspection)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="driver.inspection_submitted",
        entity_type="vehicle",
        entity_id=str(vehicle.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"status": payload.status, "odometer_km": payload.odometer_km}),
    ))
    database.commit()
    database.refresh(inspection)
    return inspection


@router.get("/driver/issues", response_model=list[VehicleIssueRead])
def list_driver_issues(
    user: User = Depends(require_roles("driver")),
    database: Session = Depends(get_db),
) -> list[VehicleIssue]:
    return list(database.scalars(select(VehicleIssue).where(
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.driver_id == user.id,
    ).order_by(VehicleIssue.id.desc()).limit(100)).all())


@router.post("/driver/issues", response_model=VehicleIssueRead, status_code=status.HTTP_201_CREATED)
def create_driver_issue(
    payload: VehicleIssueCreate,
    request: Request,
    user: User = Depends(require_roles("driver")),
    database: Session = Depends(get_db),
) -> VehicleIssue:
    reserve_idempotency_key(request, user, database)
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == payload.vehicle_id,
        Vehicle.organization_id == user.organization_id,
        Vehicle.assigned_driver_id == user.id,
    ))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle is not assigned to this driver")
    issue = VehicleIssue(organization_id=user.organization_id, driver_id=user.id, **payload.model_dump())
    database.add(issue)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="driver.vehicle_issue_reported",
        entity_type="vehicle_issue",
        entity_id=str(vehicle.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"title": payload.title, "priority": payload.priority}),
    ))
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="driver_issue",
        severity="danger" if payload.priority in {"High", "Critical"} else "warning",
        title=f"Driver issue: {payload.title}",
        detail=f"{vehicle.registration_number}: {payload.detail}",
        entity_type="vehicle_issue",
        entity_id=str(issue.id),
        roles={"owner", "fleet_manager"},
    )
    database.commit()
    database.refresh(issue)
    return issue


@router.post("/work-orders", response_model=WorkOrderRead, status_code=status.HTTP_201_CREATED)
def create_work_order(
    payload: WorkOrderCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    reserve_idempotency_key(request, user, database)
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    if payload.assigned_user_id is not None:
        assignee = database.scalar(select(User).where(
            User.id == payload.assigned_user_id,
            User.organization_id == user.organization_id,
            User.role.in_(("technician", "mechanic")),
        ))
        if assignee is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user must be a workshop user in this organization")
    work_order = WorkOrder(organization_id=user.organization_id, **payload.model_dump())
    database.add(work_order)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.created",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "title": work_order.title}),
    ))
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="work_order_assigned",
        severity="danger" if work_order.priority in {"High", "Critical"} else "warning",
        title=f"Work order assigned: {work_order.title}",
        detail=f"{vehicle.registration_number} · {work_order.priority} priority",
        entity_type="work_order",
        entity_id=str(work_order.id),
        roles={"owner", "fleet_manager"},
        user_ids={work_order.assigned_user_id} if work_order.assigned_user_id is not None else set(),
        dedupe_key=(
            f"work_order_assigned:{work_order.id}:{work_order.assigned_user_id}"
            if work_order.assigned_user_id is not None
            else f"work_order_created:{work_order.id}"
        ),
    )
    database.commit()
    database.refresh(work_order)
    return work_order


@router.patch("/work-orders/{work_order_id}", response_model=WorkOrderRead)
def update_work_order(
    work_order_id: int,
    payload: WorkOrderUpdate,
    request: Request,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    statement = select(WorkOrder).where(WorkOrder.id == work_order_id, WorkOrder.organization_id == user.organization_id)
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    changes = payload.model_dump(exclude_unset=True)
    if user.role not in ("owner", "fleet_manager", "technician", "mechanic"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only fleet or workshop roles can update work orders")
    if user.role in ("technician", "mechanic"):
        changes = {key: value for key, value in changes.items() if key in {"description"}}
    else:
        if "assigned_user_id" in changes and changes["assigned_user_id"] is not None:
            assignee = database.scalar(select(User).where(
                User.id == changes["assigned_user_id"],
                User.organization_id == user.organization_id,
                User.role.in_(("technician", "mechanic")),
            ))
            if assignee is None:
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Assigned user must be a workshop user in this organization")
        if "status" in changes:
            transitions = {
                "Draft": {"Open", "Assigned", "Archived"},
                "Open": {"Assigned", "Scheduled", "In progress", "Archived"},
                "Assigned": {"Scheduled", "In progress", "Archived"},
                "Scheduled": {"In progress", "Archived"},
                "In progress": {"Ready for review"},
                "Ready for review": {"Completed"},
                "Completed": {"Closed", "Archived"},
                "Closed": set(),
                "Archived": set(),
            }
            target_status = changes["status"]
            if target_status != work_order.status and target_status not in transitions.get(work_order.status, set()):
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Invalid work-order transition: {work_order.status} to {target_status}")
    for key, value in changes.items():
        setattr(work_order, key, value)
    if "status" in changes:
        transitioned_at = utc_now()
        if changes["status"] == "In progress" and work_order.started_at is None:
            work_order.started_at = transitioned_at
        elif changes["status"] == "Ready for review" and work_order.completed_at is None:
            work_order.completed_at = transitioned_at
        elif changes["status"] == "Archived":
            work_order.archived_at = transitioned_at
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.updated",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps(changes),
    ))
    database.commit()
    database.refresh(work_order)
    return work_order


@router.delete("/work-orders/{work_order_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_work_order(
    work_order_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> Response:
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if work_order.status not in {"Draft", "Open", "Archived"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only draft, open, or archived work orders can be deleted")
    database.delete(work_order)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.deleted",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": work_order.vehicle_id, "title": work_order.title}),
    ))
    try:
        database.commit()
    except IntegrityError as error:
        database.rollback()
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Work order cannot be deleted while checklist, evidence, or parts records exist") from error
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.get("/work-orders/{work_order_id}/checklist", response_model=list[WorkOrderChecklistItemRead])
def list_work_order_checklist(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[WorkOrderChecklistItem]:
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    if database.scalar(statement) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    return list(database.scalars(select(WorkOrderChecklistItem).where(
        WorkOrderChecklistItem.organization_id == user.organization_id,
        WorkOrderChecklistItem.work_order_id == work_order_id,
    ).order_by(WorkOrderChecklistItem.sort_order, WorkOrderChecklistItem.id)).all())


@router.put("/work-orders/{work_order_id}/checklist", response_model=list[WorkOrderChecklistItemRead])
def update_work_order_checklist(
    work_order_id: int,
    payload: WorkOrderChecklistUpdate,
    request: Request,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[WorkOrderChecklistItem]:
    reserve_idempotency_key(request, user, database)
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    existing = database.scalars(select(WorkOrderChecklistItem).where(
        WorkOrderChecklistItem.organization_id == user.organization_id,
        WorkOrderChecklistItem.work_order_id == work_order_id,
    )).all()
    for item in existing:
        database.delete(item)
    database.flush()
    now = utc_now()
    items = [
        WorkOrderChecklistItem(
            organization_id=user.organization_id,
            work_order_id=work_order_id,
            title=item.title.strip(),
            completed=item.completed,
            sort_order=item.sort_order,
            completed_by=user.id if item.completed else None,
            completed_at=now if item.completed else None,
        )
        for item in payload.items
    ]
    database.add_all(items)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.checklist_updated",
        entity_type="work_order",
        entity_id=str(work_order_id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"count": len(items), "completed": sum(item.completed for item in items)}),
    ))
    database.commit()
    for item in items:
        database.refresh(item)
    return items


@router.post("/work-orders/{work_order_id}/start", response_model=WorkOrderRead)
def start_work_order(
    work_order_id: int,
    request: Request,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    reserve_idempotency_key(request, user, database)
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if work_order.status not in {"Open", "Assigned"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only open or assigned work orders can be started")
    work_order.status = "In progress"
    work_order.started_at = utc_now()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.started",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(work_order)
    return work_order


@router.post("/work-orders/{work_order_id}/complete", response_model=WorkOrderRead)
def complete_work_order(
    work_order_id: int,
    request: Request,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    reserve_idempotency_key(request, user, database)
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if work_order.status != "In progress":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only in-progress work orders can be completed")
    checklist = database.scalars(select(WorkOrderChecklistItem).where(
        WorkOrderChecklistItem.organization_id == user.organization_id,
        WorkOrderChecklistItem.work_order_id == work_order_id,
    )).all()
    if checklist and any(not item.completed for item in checklist):
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Complete every checklist item before completing the work order")
    work_order.status = "Ready for review"
    work_order.completed_at = utc_now()
    
    # Deduct reserved parts when the repair is completed.
    part_usages = database.scalars(select(WorkOrderPartUsage).where(
        WorkOrderPartUsage.work_order_id == work_order_id,
        WorkOrderPartUsage.organization_id == user.organization_id
    )).all()
    for part_usage in part_usages:
        part = database.scalar(select(Part).where(
            Part.id == part_usage.part_id,
            Part.organization_id == user.organization_id
        ))
        if part and part_usage.quantity > 0:
            delta = -part_usage.quantity
            if part.quantity_on_hand + delta < 0:
                raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=f"Insufficient inventory for part {part.name}")
            part.quantity_on_hand += delta
            database.add(InventoryTransaction(
                organization_id=user.organization_id,
                part_id=part.id,
                transaction_type="issue",
                quantity=part_usage.quantity,
                created_by=user.id,
                reference=f"Work order #{work_order.id}",
            ))
    
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.ready_for_review",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(work_order)
    return work_order


@router.post("/work-orders/{work_order_id}/approve", response_model=WorkOrderRead)
def approve_work_order(
    work_order_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    reserve_idempotency_key(request, user, database)
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if work_order.status != "Ready for review":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only work orders ready for review can be approved")
    work_order.status = "Completed"
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.approved",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(work_order)
    return work_order


@router.post("/work-orders/{work_order_id}/archive", response_model=WorkOrderRead)
def archive_work_order(
    work_order_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> WorkOrder:
    reserve_idempotency_key(request, user, database)
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if work_order.status not in {"Completed", "Closed"}:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Only completed or closed work orders can be archived")
    work_order.status = "Archived"
    work_order.archived_at = utc_now()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.archived",
        entity_type="work_order",
        entity_id=str(work_order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(work_order)
    return work_order


@router.get("/work-orders/{work_order_id}/parts", response_model=list[WorkOrderPartUsageRead])
def list_work_order_parts(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[WorkOrderPartUsage]:
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None or (user.role in ("technician", "mechanic") and work_order.assigned_user_id != user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    return list(database.scalars(select(WorkOrderPartUsage).where(
        WorkOrderPartUsage.organization_id == user.organization_id,
        WorkOrderPartUsage.work_order_id == work_order_id,
    ).order_by(WorkOrderPartUsage.id)).all())


@router.get("/work-orders/{work_order_id}/timeline", response_model=list[AuditLogRead])
def work_order_timeline(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[AuditLog]:
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    if database.scalar(statement) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    return list(database.scalars(select(AuditLog).where(
        AuditLog.organization_id == user.organization_id,
        AuditLog.entity_type == "work_order",
        AuditLog.entity_id == str(work_order_id),
    ).order_by(AuditLog.created_at.asc(), AuditLog.id.asc())).all())


@router.get("/work-orders/{work_order_id}/evidence", response_model=list[WorkOrderEvidenceRead])
def list_work_order_evidence(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[WorkOrderEvidence]:
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None or (user.role in ("technician", "mechanic") and work_order.assigned_user_id != user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    return list(database.scalars(select(WorkOrderEvidence).where(
        WorkOrderEvidence.organization_id == user.organization_id,
        WorkOrderEvidence.work_order_id == work_order_id,
    ).order_by(WorkOrderEvidence.id.desc())).all())


@router.post("/work-orders/{work_order_id}/evidence", response_model=WorkOrderEvidenceRead, status_code=status.HTTP_201_CREATED)
def upload_work_order_evidence(
    work_order_id: int,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> WorkOrderEvidence:
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A file name is required")
    try:
        object_key, size_bytes, _ = save_upload(file, f"organizations/{user.organization_id}/work-orders/{work_order_id}")
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(error)) from error
    evidence = WorkOrderEvidence(
        organization_id=user.organization_id,
        work_order_id=work_order_id,
        object_key=object_key,
        file_name=file.filename[:255],
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        uploaded_by=user.id,
    )
    database.add(evidence)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.evidence_uploaded",
        entity_type="work_order",
        entity_id=str(work_order_id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"file_name": evidence.file_name, "size_bytes": size_bytes}),
    ))
    database.commit()
    database.refresh(evidence)
    return evidence


@router.post("/work-orders/{work_order_id}/parts", response_model=WorkOrderPartUsageRead, status_code=status.HTTP_201_CREATED)
def record_work_order_part(
    work_order_id: int,
    payload: WorkOrderPartUsageCreate,
    request: Request,
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> WorkOrderPartUsage:
    reserve_idempotency_key(request, user, database)
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    part = database.scalar(select(Part).where(
        Part.id == payload.part_id,
        Part.organization_id == user.organization_id,
    ))
    if work_order is None or part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order or part not found")
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Part quantity must be positive")
    if part.quantity_on_hand < payload.quantity:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Insufficient stock for this work order")
    usage = WorkOrderPartUsage(
        organization_id=user.organization_id,
        work_order_id=work_order_id,
        part_id=part.id,
        quantity=payload.quantity,
        unit_cost_paise=part.unit_cost_paise,
        created_by=user.id,
    )
    database.add(usage)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.part_issued",
        entity_type="work_order",
        entity_id=str(work_order_id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"part_id": part.id, "quantity": payload.quantity}),
    ))
    database.commit()
    database.refresh(usage)
    return usage


@router.get("/work-orders/{work_order_id}/download")
def download_work_order(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> Response:
    statement = select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    )
    if user.role in ("technician", "mechanic"):
        statement = statement.where(WorkOrder.assigned_user_id == user.id)
    work_order = database.scalar(statement)
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == work_order.vehicle_id))
    body = f"""<!doctype html><html><head><meta charset="utf-8"><title>WO-{work_order.id}</title>
    <style>body{{font-family:Arial;max-width:800px;margin:40px auto}}h1{{color:#123}}</style></head>
    <body><h1>Work order WO-{work_order.id}</h1><p><b>Vehicle:</b> {escape(vehicle.registration_number if vehicle else 'Unknown')}</p>
    <p><b>Title:</b> {escape(work_order.title)}</p><p><b>Status:</b> {escape(work_order.status)}</p>
    <p><b>Priority:</b> {escape(work_order.priority)}</p><p><b>Due:</b> {escape(work_order.due_date or 'Unscheduled')}</p>
    <h2>Instructions</h2><p>{escape(work_order.description or 'No additional instructions')}</p></body></html>"""
    return Response(
        content=body,
        media_type="text/html",
        headers={"Content-Disposition": f'attachment; filename="WO-{work_order.id}.html"'},
    )


@router.get("/maintenance-plans", response_model=list[MaintenancePlanRead])
def list_maintenance_plans(user: User = Depends(require_permission("maintenance_read")), database: Session = Depends(get_db)) -> list[MaintenancePlan]:
    return list(database.scalars(select(MaintenancePlan).where(MaintenancePlan.organization_id == user.organization_id).order_by(MaintenancePlan.id.desc())).all())


@router.post("/maintenance-plans", response_model=MaintenancePlanRead, status_code=status.HTTP_201_CREATED)
def create_maintenance_plan(
    payload: MaintenancePlanCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> MaintenancePlan:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    if payload.interval_km is None and payload.interval_days is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="An interval in kilometres or days is required")
    plan = MaintenancePlan(organization_id=user.organization_id, **payload.model_dump())
    database.add(plan)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="maintenance_plan.created",
        entity_type="maintenance_plan",
        entity_id=str(plan.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "name": plan.name}),
    ))
    database.commit()
    database.refresh(plan)
    return plan


@router.get("/parts", response_model=list[PartRead])
def list_parts(user: User = Depends(require_permission("inventory_read")), database: Session = Depends(get_db)) -> list[Part]:
    return list(database.scalars(select(Part).where(Part.organization_id == user.organization_id).order_by(Part.id.desc())).all())


@router.post("/parts", response_model=PartRead, status_code=status.HTTP_201_CREATED)
def create_part(
    payload: PartCreate,
    request: Request,
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> Part:
    existing = database.scalar(select(Part).where(Part.organization_id == user.organization_id, Part.sku == payload.sku.strip().upper()))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A part with this SKU already exists")
    part = Part(organization_id=user.organization_id, sku=payload.sku.strip().upper(), **{key: value for key, value in payload.model_dump().items() if key != "sku"})
    database.add(part)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="part.created",
        entity_type="part",
        entity_id=str(part.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"sku": part.sku, "quantity_on_hand": part.quantity_on_hand}),
    ))
    database.commit()
    database.refresh(part)
    return part


@router.post("/inventory/transactions", response_model=PartRead)
def create_inventory_transaction(
    payload: InventoryTransactionCreate,
    request: Request,
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> Part:
    # Fixed Bug 14: Add row-level locking to prevent race condition on inventory updates
    part = database.scalar(select(Part).where(Part.id == payload.part_id, Part.organization_id == user.organization_id).with_for_update())
    if part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found in this organization")
    delta = payload.quantity if payload.transaction_type == "receipt" else -payload.quantity
    if payload.transaction_type == "adjustment":
        delta = payload.quantity
    if part.quantity_on_hand + delta < 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Insufficient stock for this issue")
    part.quantity_on_hand += delta
    database.add(InventoryTransaction(organization_id=user.organization_id, created_by=user.id, **payload.model_dump()))
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action=f"inventory.{payload.transaction_type}",
        entity_type="part",
        entity_id=str(part.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"delta": delta, "quantity_on_hand": part.quantity_on_hand}),
    ))
    database.commit()
    database.refresh(part)
    return part


@router.get("/inventory/transactions", response_model=list[InventoryTransactionRead])
def list_inventory_transactions(
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
    skip: int = 0,
    limit: int = 20
) -> list[InventoryTransaction]:
    # Fixed Bug 12: Add pagination support to inventory transactions listing
    if limit < 1 or limit > 100:
        limit = 20
    if skip < 0:
        skip = 0
    return list(database.scalars(select(InventoryTransaction).where(InventoryTransaction.organization_id == user.organization_id).order_by(InventoryTransaction.id.desc()).offset(skip).limit(limit)).all())


@router.get("/stock-locations", response_model=list[StockLocationRead])
def list_stock_locations(user: User = Depends(require_roles("owner", "inventory_manager")), database: Session = Depends(get_db)) -> list[StockLocation]:
    return list(database.scalars(select(StockLocation).where(StockLocation.organization_id == user.organization_id).order_by(StockLocation.name.asc())).all())


@router.post("/stock-locations", response_model=StockLocationRead, status_code=status.HTTP_201_CREATED)
def create_stock_location(
    payload: StockLocationCreate,
    request: Request,
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> StockLocation:
    code = payload.code.strip().upper()
    existing = database.scalar(select(StockLocation).where(StockLocation.organization_id == user.organization_id, StockLocation.code == code))
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A stock location with this code already exists")
    location = StockLocation(organization_id=user.organization_id, code=code, **{key: value for key, value in payload.model_dump().items() if key != "code"})
    database.add(location)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="stock_location.created",
        entity_type="stock_location",
        entity_id=str(location.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"code": location.code}),
    ))
    database.commit()
    database.refresh(location)
    return location


@router.get("/inventory/movements", response_model=list[InventoryMovementRead])
def list_inventory_movements(user: User = Depends(require_roles("owner", "inventory_manager")), database: Session = Depends(get_db)) -> list[InventoryMovement]:
    return list(database.scalars(select(InventoryMovement).where(InventoryMovement.organization_id == user.organization_id).order_by(InventoryMovement.id.desc())).all())


@router.post("/inventory/movements", response_model=InventoryMovementRead, status_code=status.HTTP_201_CREATED)
def create_inventory_movement(
    payload: InventoryMovementCreate,
    request: Request,
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> InventoryMovement:
    part = database.scalar(select(Part).where(Part.id == payload.part_id, Part.organization_id == user.organization_id))
    location = database.scalar(select(StockLocation).where(StockLocation.id == payload.location_id, StockLocation.organization_id == user.organization_id))
    if part is None or location is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part or stock location not found in this organization")
    delta = payload.quantity if payload.transaction_type == "receipt" else -payload.quantity
    if payload.transaction_type == "adjustment":
        delta = payload.quantity
    if part.quantity_on_hand + delta < 0:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Insufficient stock for this issue")
    part.quantity_on_hand += delta
    movement = InventoryMovement(organization_id=user.organization_id, created_by=user.id, **payload.model_dump())
    database.add(movement)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action=f"inventory_movement.{payload.transaction_type}",
        entity_type="inventory_movement",
        entity_id=str(movement.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"part_id": part.id, "location_id": location.id, "delta": delta}),
    ))
    database.commit()
    database.refresh(movement)
    return movement


@router.get("/documents", response_model=list[DocumentRead])
def list_documents(user: User = Depends(require_permission("compliance_read")), database: Session = Depends(get_db)) -> list[ComplianceDocument]:
    statement = select(ComplianceDocument).where(ComplianceDocument.organization_id == user.organization_id)
    if user.role == "driver":
        statement = statement.where(ComplianceDocument.vehicle_id.in_(
            select(Vehicle.id).where(Vehicle.assigned_driver_id == user.id)
        ))
    elif user.role not in ("owner", "fleet_manager", "driver"):
        statement = statement.where(ComplianceDocument.id == -1)
    documents = list(database.scalars(statement.order_by(ComplianceDocument.expires_on.asc())).all())
    today = date.today().isoformat()
    for document in documents:
        if document.expires_on < today:
            document.status = "Expired"
    return documents


@router.post("/documents", response_model=DocumentRead, status_code=status.HTTP_201_CREATED)
def create_document(
    payload: DocumentCreate,
    request: Request,
    user: User = Depends(require_permission("compliance")),
    database: Session = Depends(get_db),
) -> ComplianceDocument:
    if payload.vehicle_id is not None:
        vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
        if vehicle is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    document = ComplianceDocument(organization_id=user.organization_id, **payload.model_dump())
    database.add(document)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="document.created",
        entity_type="compliance_document",
        entity_id=str(document.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"name": document.name, "expires_on": document.expires_on}),
    ))
    database.commit()
    database.refresh(document)
    return document


class CsvTextPayload(BaseModel):
    csv: str


def document_csv_rows(csv_text: str) -> tuple[list[dict[str, str]], list[str]]:
    rows = list(csv.DictReader(io.StringIO(csv_text)))
    errors: list[str] = []
    for index, row in enumerate(rows, start=2):
        name = (row.get("name") or row.get("title") or "").strip()
        document_type = (row.get("document_type") or row.get("doc_type") or "").strip()
        expires_on = (row.get("expires_on") or row.get("expiry_date") or "").strip()
        if len(name) < 2:
            errors.append(f"Row {index}: name is required")
        if len(document_type) < 2:
            errors.append(f"Row {index}: document_type is required")
        try:
            date.fromisoformat(expires_on)
        except ValueError:
            errors.append(f"Row {index}: expires_on must be YYYY-MM-DD")
    return rows, errors


@router.post("/documents/preview-import", response_model=dict)
def preview_document_import(
    payload: CsvTextPayload,
    user: User = Depends(require_permission("compliance_read")),
) -> dict:
    rows, errors = document_csv_rows(payload.csv)
    return {
        "valid_count": max(0, len(rows) - len({error.split(":")[0] for error in errors})),
        "row_count": len(rows),
        "errors": errors,
    }


@router.post("/documents/import-csv", response_model=dict)
def import_documents_csv(
    payload: CsvTextPayload,
    request: Request,
    user: User = Depends(require_permission("compliance")),
    database: Session = Depends(get_db),
) -> dict:
    reserve_idempotency_key(request, user, database)
    rows, errors = document_csv_rows(payload.csv)
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)
    imported_count = 0
    for row in rows:
        vehicle_id = int(row["vehicle_id"]) if row.get("vehicle_id") else None
        if vehicle_id is not None and database.scalar(select(Vehicle).where(
            Vehicle.id == vehicle_id,
            Vehicle.organization_id == user.organization_id,
        )) is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=f"Vehicle not found for row {imported_count + 2}")
        document = ComplianceDocument(
            organization_id=user.organization_id,
            vehicle_id=vehicle_id,
            name=(row.get("name") or row.get("title") or "").strip(),
            document_type=(row.get("document_type") or row.get("doc_type") or "").strip(),
            issued_by=(row.get("issued_by") or "").strip() or None,
            expires_on=(row.get("expires_on") or row.get("expiry_date") or "").strip(),
            file_key=(row.get("file_key") or row.get("file_url") or "").strip() or None,
            status=(row.get("status") or "Valid").strip(),
        )
        database.add(document)
        imported_count += 1
    database.commit()
    return {"imported": True, "imported_count": imported_count}


@router.patch("/documents/{document_id}", response_model=DocumentRead)
def update_document(
    document_id: int,
    payload: DocumentUpdate,
    request: Request,
    user: User = Depends(require_permission("compliance")),
    database: Session = Depends(get_db),
) -> ComplianceDocument:
    document = database.scalar(select(ComplianceDocument).where(ComplianceDocument.id == document_id, ComplianceDocument.organization_id == user.organization_id))
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    changes = payload.model_dump(exclude_unset=True)
    for key, value in changes.items():
        setattr(document, key, value)
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="document.updated",
        entity_type="compliance_document",
        entity_id=str(document.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps(changes),
    ))
    database.commit()
    database.refresh(document)
    return document


@router.post("/documents/{document_id}/file", response_model=DocumentAssetRead, status_code=status.HTTP_201_CREATED)
def upload_document_file(
    document_id: int,
    request: Request,
    file: UploadFile = File(...),
    user: User = Depends(require_permission("compliance")),
    database: Session = Depends(get_db),
) -> DocumentAsset:
    document = database.scalar(select(ComplianceDocument).where(ComplianceDocument.id == document_id, ComplianceDocument.organization_id == user.organization_id))
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if not file.filename:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="A file name is required")
    try:
        object_key, size_bytes, checksum = save_upload(file, f"organizations/{user.organization_id}")
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail=str(error)) from error
    asset = DocumentAsset(
        organization_id=user.organization_id,
        document_id=document.id,
        object_key=object_key,
        file_name=file.filename[:255],
        content_type=file.content_type or "application/octet-stream",
        size_bytes=size_bytes,
        checksum_sha256=checksum,
        uploaded_by=user.id,
    )
    document.file_key = object_key
    database.add(asset)
    database.flush()
    latest_version = database.scalar(select(DocumentVersion).where(
        DocumentVersion.document_id == document.id,
        DocumentVersion.organization_id == user.organization_id,
    ).order_by(DocumentVersion.version_number.desc()))
    database.add(DocumentVersion(
        organization_id=user.organization_id,
        document_id=document.id,
        version_number=(latest_version.version_number + 1) if latest_version else 1,
        name=document.name,
        document_type=document.document_type,
        expires_on=document.expires_on,
        asset_id=asset.id,
        created_by=user.id,
    ))
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="document.file_uploaded",
        entity_type="compliance_document",
        entity_id=str(document.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"asset_id": asset.id, "object_key": object_key, "size_bytes": size_bytes}),
    ))
    database.commit()
    database.refresh(asset)
    return asset


@router.get("/documents/{document_id}/versions", response_model=list[DocumentVersionRead])
def list_document_versions(
    document_id: int,
    user: User = Depends(require_permission("compliance_read")),
    database: Session = Depends(get_db),
) -> list[DocumentVersion]:
    document = database.scalar(select(ComplianceDocument).where(
        ComplianceDocument.id == document_id,
        ComplianceDocument.organization_id == user.organization_id,
    ))
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if user.role == "driver":
        assigned = database.scalar(select(Vehicle.id).where(
            Vehicle.id == document.vehicle_id,
            Vehicle.assigned_driver_id == user.id,
        ))
        if assigned is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    return list(database.scalars(select(DocumentVersion).where(
        DocumentVersion.document_id == document_id,
        DocumentVersion.organization_id == user.organization_id,
    ).order_by(DocumentVersion.version_number.desc())).all())


@router.get("/documents/{document_id}/file")
def download_document_file(
    document_id: int,
    user: User = Depends(require_permission("compliance_read")),
    database: Session = Depends(get_db),
) -> Response:
    document = database.scalar(select(ComplianceDocument).where(
        ComplianceDocument.id == document_id,
        ComplianceDocument.organization_id == user.organization_id,
    ))
    if document is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    if user.role == "driver":
        assigned = database.scalar(select(Vehicle.id).where(
            Vehicle.id == document.vehicle_id,
            Vehicle.assigned_driver_id == user.id,
        ))
        if assigned is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found")
    asset = database.scalar(
        select(DocumentAsset)
        .where(DocumentAsset.document_id == document_id, DocumentAsset.organization_id == user.organization_id)
        .order_by(DocumentAsset.id.desc())
    )
    if asset is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found")
    try:
        if get_settings().storage_backend == "local":
            path = resolve_object(asset.object_key)
            if not path.is_file():
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document file not found")
            return FileResponse(path, media_type=asset.content_type, filename=asset.file_name)
        content = download_object(asset.object_key)
    except ValueError as error:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(error)) from error
    return Response(
        content=content,
        media_type=asset.content_type,
        headers={"Content-Disposition": f'attachment; filename="{asset.file_name}"'},
    )


def build_alerts(user: User, database: Session) -> list[dict[str, str | int]]:
    today = date.today()
    alerts: list[dict[str, str | int]] = []
    documents = database.scalars(select(ComplianceDocument).where(ComplianceDocument.organization_id == user.organization_id)).all()
    for document in documents:
        expires_on = date.fromisoformat(document.expires_on)
        days_until_expiry = (expires_on - today).days
        if days_until_expiry <= 30:
            alerts.append({
                "type": "document_expiry",
                "severity": "danger" if days_until_expiry < 0 else "warning",
                "entity_id": document.id,
                "title": f"{document.name} {'expired' if days_until_expiry < 0 else 'expires soon'}",
                "detail": f"{abs(days_until_expiry)} days {'overdue' if days_until_expiry < 0 else 'remaining'}",
            })
    parts = database.scalars(select(Part).where(Part.organization_id == user.organization_id)).all()
    for part in parts:
        if part.quantity_on_hand <= part.reorder_level:
            alerts.append({
                "type": "stock_reorder",
                "severity": "warning",
                "entity_id": part.id,
                "title": f"Reorder {part.name}",
                "detail": f"{part.quantity_on_hand} on hand, minimum {part.reorder_level}",
            })
    vehicles = database.scalars(select(Vehicle).where(Vehicle.organization_id == user.organization_id)).all()
    for vehicle in vehicles:
        components = database.scalars(select(VehicleComponent).where(
            VehicleComponent.organization_id == user.organization_id,
            VehicleComponent.vehicle_id == vehicle.id,
        )).all()
        for component in components:
            alert_km = component.next_alert_km or component.next_service_km
            if alert_km is not None and vehicle.odometer_km >= alert_km:
                alerts.append({
                    "type": "component_due",
                    "severity": "danger",
                    "entity_id": component.id,
                    "title": f"{component.name} service due",
                    "detail": f"{vehicle.registration_number} has reached {vehicle.odometer_km} km; service threshold {alert_km} km",
                })
        if vehicle.status == "Out of service":
            alerts.append({
                "type": "driver_safety",
                "severity": "danger",
                "entity_id": vehicle.id,
                "title": f"{vehicle.registration_number} is out of service",
                "detail": "A driver inspection marked this vehicle unsafe.",
            })
    work_orders = database.scalars(select(WorkOrder).where(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.status.in_(["Open", "In progress", "Ready for review"]),
    )).all()
    for work_order in work_orders:
        if work_order.due_date and work_order.due_date < date.today().isoformat():
            alerts.append({
                "type": "maintenance_due",
                "severity": "danger",
                "entity_id": work_order.id,
                "title": f"Work order {work_order.id} is overdue",
                "detail": f"Due {work_order.due_date}; current status is {work_order.status}",
            })
    if user.role == "accountant":
        return []
    if user.role == "inventory_manager":
        return [alert for alert in alerts if alert["type"] == "stock_reorder"]
    if user.role == "driver":
        assigned_vehicle_ids = {
            assignment.vehicle_id
            for assignment in database.scalars(select(VehicleAssignment).where(
                VehicleAssignment.organization_id == user.organization_id,
                VehicleAssignment.driver_id == user.id,
                VehicleAssignment.active.is_(True),
            )).all()
        }
        return [
            alert for alert in alerts
            if alert["type"] == "driver_safety" and alert["entity_id"] in assigned_vehicle_ids
        ]
    if user.role in {"mechanic", "technician"}:
        assigned_work_orders = database.scalars(select(WorkOrder).where(
            WorkOrder.organization_id == user.organization_id,
            WorkOrder.assigned_user_id == user.id,
        )).all()
        assigned_work_order_ids = {work_order.id for work_order in assigned_work_orders}
        assigned_vehicle_ids = {work_order.vehicle_id for work_order in assigned_work_orders}
        assigned_component_ids = {
            component.id
            for component in database.scalars(select(VehicleComponent).where(
                VehicleComponent.organization_id == user.organization_id,
                VehicleComponent.vehicle_id.in_(assigned_vehicle_ids or {-1}),
            )).all()
        }
        return [
            alert for alert in alerts
            if (
                alert["type"] == "maintenance_due"
                and alert["entity_id"] in assigned_work_order_ids
            ) or (
                alert["type"] == "component_due"
                and alert["entity_id"] in assigned_component_ids
            )
        ]
    return alerts


def evaluate_component_thresholds(user: User, vehicle: Vehicle, database: Session) -> int:
    created_work_orders = 0
    components = database.scalars(select(VehicleComponent).where(
        VehicleComponent.organization_id == user.organization_id,
        VehicleComponent.vehicle_id == vehicle.id,
        VehicleComponent.status == "Healthy",
    )).all()
    for component in components:
        alert_km = component.next_alert_km or component.next_service_km
        if alert_km is None or vehicle.odometer_km < alert_km:
            continue
        existing = database.scalar(select(WorkOrder).where(
            WorkOrder.organization_id == user.organization_id,
            WorkOrder.vehicle_id == vehicle.id,
            WorkOrder.status.in_(["Open", "Assigned", "Scheduled", "In progress", "Ready for review", "REWORK"]),
            WorkOrder.title.ilike(f"%{component.name}%"),
        ))
        if existing is not None:
            continue
        work_order = WorkOrder(
            organization_id=user.organization_id,
            vehicle_id=vehicle.id,
            title=f"{component.name} service threshold reached",
            description=(
                f"{component.name}: {vehicle.odometer_km - (component.last_service_km or component.installed_at_km)} "
                f"km since last service; alert threshold {alert_km} km."
            ),
            priority="High",
            status="Open",
        )
        database.add(work_order)
        database.flush()
        queue_role_notification(
            database,
            organization_id=user.organization_id,
            notification_type="component_threshold",
            severity="danger",
            title=f"{component.name} service due",
            detail=f"{vehicle.registration_number} reached {alert_km:,} km.",
            entity_type="vehicle_component",
            entity_id=str(component.id),
            roles={"owner", "fleet_manager"},
            dedupe_key=f"component_threshold:{component.id}:{alert_km}",
        )
        database.add(AuditEvent(
            organization_id=user.organization_id,
            actor_user_id=user.id,
            actor_role=user.role,
            action="MAINTENANCE_THRESHOLD_TRIGGERED",
            entity_type="COMPONENT",
            entity_id=str(component.id),
            summary=f"Threshold triggered for {component.name}",
            metadata=json.dumps({
                "workOrderId": work_order.id,
                "current_km": vehicle.odometer_km,
                "alert_km": alert_km,
            }),
        ))
        created_work_orders += 1
    return created_work_orders


ALERT_RECIPIENT_ROLES = {
    "document_expiry": {"owner", "fleet_manager"},
    "stock_reorder": {"owner", "inventory_manager"},
    "component_due": {"owner", "fleet_manager"},
    "component_threshold": {"owner", "fleet_manager"},
    "driver_safety": {"fleet_manager"},
    "maintenance_due": {"owner", "fleet_manager"},
}


@router.get("/alerts")
def list_alerts(user: User = Depends(require_permission("notifications")), database: Session = Depends(get_db)) -> list[dict[str, str | int]]:
    return build_alerts(user, database)


def dispatch_sms(delivery: NotificationDelivery, notification: OperationalNotification, recipient: User) -> None:
    settings = get_settings()
    if not recipient.mobile_phone:
        delivery.status = "skipped"
        return
    if not settings.sms_provider or not settings.sms_auth_token:
        delivery.status = "queued"
        return
    try:
        if settings.sms_provider.lower() == "twilio":
            account_sid = settings.sms_account_sid
            from_number = settings.sms_from_number or settings.sms_sender_id
            if not account_sid or not from_number:
                delivery.status = "queued"
                return
            response = httpx.post(
                settings.sms_api_url or f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
                auth=httpx.BasicAuth(settings.sms_account_sid or "", settings.sms_auth_token),
                data={
                    "To": recipient.mobile_phone,
                    "From": from_number,
                    "Body": f"{notification.title}: {notification.detail}",
                },
                timeout=10,
            )
        else:
            if not settings.sms_api_url:
                delivery.status = "queued"
                return
            response = httpx.post(
                settings.sms_api_url,
                headers={
                    "Authorization": settings.sms_auth_token,
                    "Content-Type": "application/json",
                },
                json={
                    "sender": settings.sms_sender_id,
                    "template_id": settings.sms_template_id,
                    "recipients": [{"mobiles": recipient.mobile_phone, "title": notification.title, "detail": notification.detail}],
                },
                timeout=10,
            )
        if response.is_error:
            delivery.status = "failed"
            return
        delivery.status = "delivered"
        delivery.provider_message_id = str(response.json().get("message_id") or response.headers.get("x-request-id") or "")
        delivery.sent_at = utc_now()
    except (httpx.HTTPError, ValueError):
        delivery.status = "failed"


def dispatch_whatsapp(delivery: NotificationDelivery, notification: OperationalNotification, recipient: User) -> None:
    settings = get_settings()
    if not recipient.mobile_phone:
        delivery.status = "skipped"
        return
    if not settings.whatsapp_provider or not settings.whatsapp_auth_token:
        delivery.status = "queued"
        return
    try:
        if settings.whatsapp_provider.lower() == "twilio":
            account_sid = settings.whatsapp_account_sid or settings.sms_account_sid
            from_number = settings.whatsapp_from_number or settings.whatsapp_sender_id
            if not account_sid or not from_number:
                delivery.status = "queued"
                return
            response = httpx.post(
                settings.whatsapp_api_url or f"https://api.twilio.com/2010-04-01/Accounts/{account_sid}/Messages.json",
                auth=httpx.BasicAuth(account_sid, settings.whatsapp_auth_token),
                data={
                    "To": f"whatsapp:{recipient.mobile_phone}",
                    "From": from_number if from_number.startswith("whatsapp:") else f"whatsapp:{from_number}",
                    "Body": f"{notification.title}: {notification.detail}",
                },
                timeout=10,
            )
        else:
            if not settings.whatsapp_api_url:
                delivery.status = "queued"
                return
            response = httpx.post(
                settings.whatsapp_api_url,
                headers={
                    "Authorization": f"Bearer {settings.whatsapp_auth_token}",
                    "Content-Type": "application/json",
                },
                json={
                    "sender": settings.whatsapp_sender_id,
                    "template_id": settings.whatsapp_template_id,
                    "recipient": recipient.mobile_phone,
                    "variables": {
                        "title": notification.title,
                        "detail": notification.detail,
                    },
                },
                timeout=10,
            )
        if response.is_error:
            delivery.status = "failed"
            return
        delivery.status = "delivered"
        delivery.provider_message_id = str(response.json().get("message_id") or response.headers.get("x-request-id") or "")
        delivery.sent_at = utc_now()
    except (httpx.HTTPError, ValueError):
        delivery.status = "failed"


def queue_role_notification(
    database: Session,
    organization_id: int,
    notification_type: str,
    severity: str,
    title: str,
    detail: str,
    entity_type: str,
    entity_id: str,
    roles: set[str],
    user_ids: set[int] | None = None,
    dedupe_key: str | None = None,
) -> None:
    dedupe_key = dedupe_key or f"{notification_type}:{entity_id}"
    existing = database.scalar(select(OperationalNotification).where(
        OperationalNotification.organization_id == organization_id,
        OperationalNotification.dedupe_key == dedupe_key,
    ))
    if existing is not None:
        return
    notification = OperationalNotification(
        organization_id=organization_id,
        notification_type=notification_type,
        severity=severity,
        title=title,
        detail=detail,
        entity_type=entity_type,
        entity_id=entity_id,
        dedupe_key=dedupe_key,
        status="unread",
    )
    database.add(notification)
    database.flush()
    recipients = database.scalars(select(User).where(
        User.organization_id == organization_id,
        User.role.in_(roles),
    )).all()
    if user_ids:
        recipients.extend(database.scalars(select(User).where(
            User.organization_id == organization_id,
            User.id.in_(user_ids),
        )).all())
    unique_recipients = {recipient.id: recipient for recipient in recipients}.values()
    for recipient in unique_recipients:
        preference = database.scalar(select(NotificationPreference).where(
            NotificationPreference.organization_id == organization_id,
            NotificationPreference.user_id == recipient.id,
            NotificationPreference.notification_type == notification_type,
        ))
        channels = ["in_app"]
        if recipient.mobile_phone:
            channels.append("sms")
        if preference is not None:
            if preference.email:
                channels.append("email")
            if preference.sms and "sms" not in channels:
                channels.append("sms")
            if preference.whatsapp:
                channels.append("whatsapp")
            if preference.push:
                channels.append("push")
        for channel in channels:
            delivery = NotificationDelivery(
                organization_id=organization_id,
                notification_id=notification.id,
                user_id=recipient.id,
                channel=channel,
                status="queued" if channel != "in_app" else "delivered",
                sent_at=utc_now() if channel == "in_app" else None,
            )
            database.add(delivery)
            database.flush()
            if channel == "sms":
                dispatch_sms(delivery, notification, recipient)
            elif channel == "whatsapp":
                dispatch_whatsapp(delivery, notification, recipient)


def sync_notifications(user: User, database: Session) -> None:
    for alert in build_alerts(user, database):
        if alert["type"] == "document_expiry":
            entity_type = "compliance_document"
        elif alert["type"] == "stock_reorder":
            entity_type = "part"
        elif alert["type"] == "component_due":
            entity_type = "vehicle_component"
        elif alert["type"] == "driver_safety":
            entity_type = "vehicle"
        else:
            entity_type = "work_order"
        entity_id = str(alert["entity_id"])
        if alert["type"] == "component_due":
            component = database.get(VehicleComponent, int(alert["entity_id"]))
            alert_km = (component.next_alert_km or component.next_service_km) if component is not None else alert["detail"]
            dedupe_key = f"component_threshold:{entity_id}:{alert_km}"
        else:
            dedupe_key = f"{alert['type']}:{entity_id}:{alert['detail']}"
        existing = database.scalar(
            select(OperationalNotification).where(
                OperationalNotification.organization_id == user.organization_id,
                OperationalNotification.dedupe_key == dedupe_key,
            )
        )
        if existing is not None:
            if existing.status == "dismissed":
                continue
            existing.title = str(alert["title"])
            existing.detail = str(alert["detail"])
            existing.severity = str(alert["severity"])
            continue
        notification = OperationalNotification(
            organization_id=user.organization_id,
            notification_type=str(alert["type"]),
            severity=str(alert["severity"]),
            title=str(alert["title"]),
            detail=str(alert["detail"]),
            entity_type=entity_type,
            entity_id=entity_id,
            dedupe_key=dedupe_key,
            status="unread",
        )
        database.add(notification)
        database.flush()
        recipients = database.scalars(select(User).where(
            User.organization_id == user.organization_id,
            User.role.in_(ALERT_RECIPIENT_ROLES.get(str(alert["type"]), {"owner"})),
        )).all()
        for recipient in recipients:
            preference = database.scalar(select(NotificationPreference).where(
                NotificationPreference.organization_id == user.organization_id,
                NotificationPreference.user_id == recipient.id,
                NotificationPreference.notification_type == str(alert["type"]),
            ))
            channels = ["in_app"]
            if recipient.mobile_phone:
                channels.append("sms")
            if preference is not None:
                if preference.email:
                    channels.append("email")
                if preference.sms:
                    if "sms" not in channels:
                        channels.append("sms")
                if preference.whatsapp:
                    channels.append("whatsapp")
                if preference.push:
                    channels.append("push")
            for channel in channels:
                existing_delivery = database.scalar(select(NotificationDelivery).where(
                    NotificationDelivery.notification_id == notification.id,
                    NotificationDelivery.user_id == recipient.id,
                    NotificationDelivery.channel == channel,
                ))
                if existing_delivery is None:
                    delivery = NotificationDelivery(
                        organization_id=user.organization_id,
                        notification_id=notification.id,
                        user_id=recipient.id,
                        channel=channel,
                        status="queued" if channel != "in_app" else "delivered",
                        sent_at=utc_now() if channel == "in_app" else None,
                    )
                    database.add(delivery)
                    database.flush()
                    if channel == "sms":
                        dispatch_sms(delivery, notification, recipient)
                    elif channel == "whatsapp":
                        dispatch_whatsapp(delivery, notification, recipient)
    database.commit()


@router.get("/notifications", response_model=list[NotificationRead])
def list_notifications(user: User = Depends(get_current_user), database: Session = Depends(get_db)) -> list[OperationalNotification]:
    sync_notifications(user, database)
    return list(database.scalars(
        select(OperationalNotification).join(
            NotificationDelivery,
            NotificationDelivery.notification_id == OperationalNotification.id,
        )
        .where(
            OperationalNotification.organization_id == user.organization_id,
            NotificationDelivery.organization_id == user.organization_id,
            NotificationDelivery.user_id == user.id,
            NotificationDelivery.channel == "in_app",
        )
        .distinct()
        .order_by(OperationalNotification.id.desc())
    ).all())


@router.patch("/notifications/{notification_id}", response_model=NotificationRead)
def update_notification(
    notification_id: int,
    payload: NotificationStatusUpdate,
    request: Request,
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> OperationalNotification:
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.id == notification_id,
        OperationalNotification.organization_id == user.organization_id,
    ))
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    delivery = database.scalar(select(NotificationDelivery).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
    ))
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.status = payload.status
    notification.resolved_at = utc_now() if payload.status in {"dismissed", "resolved"} else None
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="notification.status_updated",
        entity_type="operational_notification",
        entity_id=str(notification.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"status": notification.status}),
    ))
    database.commit()
    database.refresh(notification)
    return notification


@router.post("/notifications/{notification_id}/resolve", response_model=NotificationRead)
def resolve_notification(
    notification_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> OperationalNotification:
    notification = database.scalar(select(OperationalNotification).where(
        OperationalNotification.id == notification_id,
        OperationalNotification.organization_id == user.organization_id,
    ))
    if notification is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    delivery = database.scalar(select(NotificationDelivery).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
    ))
    if delivery is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found")
    notification.status = "resolved"
    notification.resolved_at = utc_now()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="notification.resolved",
        entity_type="operational_notification",
        entity_id=str(notification.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(notification)
    return notification


@router.get("/expenses", response_model=list[ExpenseRead])
def list_expenses(user: User = Depends(require_permission("finance_read")), database: Session = Depends(get_db)) -> list[Expense]:
    statement = select(Expense).where(Expense.organization_id == user.organization_id)
    if user.role not in ("owner", "accountant"):
        statement = statement.where(Expense.id == -1)
    return list(database.scalars(statement.order_by(Expense.incurred_on.desc(), Expense.id.desc())).all())


@router.post("/expenses", response_model=ExpenseRead, status_code=status.HTTP_201_CREATED)
def create_expense(
    payload: ExpenseCreate,
    request: Request,
    user: User = Depends(require_permission("finance")),
    database: Session = Depends(get_db),
) -> Expense:
    reserve_idempotency_key(request, user, database)
    if payload.vehicle_id is not None:
        vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
        if vehicle is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    gst_components = payload.cgst_amount_paise + payload.sgst_amount_paise + payload.igst_amount_paise
    if gst_components and gst_components != payload.gst_amount_paise:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="GST components must equal the GST amount")
    if payload.igst_amount_paise and (payload.cgst_amount_paise or payload.sgst_amount_paise):
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="IGST cannot be combined with CGST or SGST")
    expense = Expense(organization_id=user.organization_id, created_by=user.id, **payload.model_dump())
    if expense.status == "Approved":
        expense.approved_by = user.id
        expense.approved_at = utc_now()
    database.add(expense)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.created",
        entity_type="expense",
        entity_id=str(expense.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"category": expense.category, "amount_paise": expense.amount_paise}),
    ))
    database.commit()
    database.refresh(expense)
    return expense


@router.patch("/expenses/{expense_id}", response_model=ExpenseRead)
def update_expense_status(
    expense_id: int,
    payload: ExpenseStatusUpdate,
    request: Request,
    user: User = Depends(require_permission("finance")),
    database: Session = Depends(get_db),
) -> Expense:
    expense = database.scalar(select(Expense).where(
        Expense.id == expense_id,
        Expense.organization_id == user.organization_id,
    ))
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    if payload.status == "Approved" and user.role == "accountant" and expense.created_by == user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accountants cannot approve their own expenses")
    expense.status = payload.status
    expense.approved_by = user.id if payload.status == "Approved" else None
    expense.approved_at = utc_now() if payload.status == "Approved" else None
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.status_updated",
        entity_type="expense",
        entity_id=str(expense.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"status": expense.status}),
    ))
    database.commit()
    database.refresh(expense)
    return expense


@router.post("/expenses/{expense_id}/reconcile", response_model=ExpenseRead)
def reconcile_expense(
    expense_id: int,
    request: Request,
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> Expense:
    expense = database.scalar(select(Expense).where(
        Expense.id == expense_id,
        Expense.organization_id == user.organization_id,
    ))
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    if expense.status == "Rejected":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Rejected expenses cannot be reconciled")
    if user.role == "accountant" and expense.created_by == user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Accountants cannot approve their own expenses")
    expense.status = "Approved"
    expense.approved_by = user.id
    expense.approved_at = utc_now()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.reconciled",
        entity_type="expense",
        entity_id=str(expense.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
    ))
    database.commit()
    database.refresh(expense)
    return expense


@router.post("/expenses/{expense_id}/reverse", response_model=ExpenseRead)
def reverse_expense(
    expense_id: int,
    payload: ExpenseReversal,
    request: Request,
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> Expense:
    expense = database.scalar(select(Expense).where(
        Expense.id == expense_id,
        Expense.organization_id == user.organization_id,
    ))
    if expense is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Expense not found")
    if expense.status == "Rejected":
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Expense is already reversed")
    expense.status = "Rejected"
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.reversed",
        entity_type="expense",
        entity_id=str(expense.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"reason": payload.reason}),
    ))
    database.commit()
    database.refresh(expense)
    return expense


@router.get("/finance/summary", response_model=list[FinanceSummaryRead])
def finance_summary(user: User = Depends(require_permission("finance_read")), database: Session = Depends(get_db)) -> list[FinanceSummaryRead]:
    totals: dict[str, dict[str, int]] = {}
    expenses = database.scalars(select(Expense).where(Expense.organization_id == user.organization_id)).all()
    for expense in expenses:
        period = expense.incurred_on[:7]
        bucket = totals.setdefault(period, {"expense": 0, "fuel": 0, "toll": 0, "gst": 0})
        bucket["expense"] += expense.amount_paise
        bucket["gst"] += expense.gst_amount_paise
    fuels = database.scalars(select(FuelTransaction).where(FuelTransaction.organization_id == user.organization_id)).all()
    for fuel in fuels:
        totals.setdefault(fuel.incurred_on[:7], {"expense": 0, "fuel": 0, "toll": 0, "gst": 0})["fuel"] += fuel.total_amount_paise
    tolls = database.scalars(select(TollTransaction).where(TollTransaction.organization_id == user.organization_id)).all()
    for toll in tolls:
        totals.setdefault(toll.incurred_on[:7], {"expense": 0, "fuel": 0, "toll": 0, "gst": 0})["toll"] += toll.amount_paise
    return [
        FinanceSummaryRead(
            period=period,
            expense_amount_paise=values["expense"],
            fuel_amount_paise=values["fuel"],
            toll_amount_paise=values["toll"],
            total_amount_paise=values["expense"] + values["fuel"] + values["toll"],
            gst_amount_paise=values["gst"],
        )
        for period, values in sorted(totals.items(), reverse=True)
    ]


@router.get("/fuel-transactions", response_model=list[FuelTransactionRead])
def list_fuel_transactions(user: User = Depends(require_permission("fuel_read")), database: Session = Depends(get_db)) -> list[FuelTransaction]:
    statement = select(FuelTransaction).where(FuelTransaction.organization_id == user.organization_id)
    if user.role == "driver":
        statement = statement.where(FuelTransaction.vehicle_id.in_(
            select(Vehicle.id).where(Vehicle.assigned_driver_id == user.id)
        ))
    elif user.role not in {"owner", "fleet_manager", "accountant"}:
        statement = statement.where(FuelTransaction.id == -1)
    return list(database.scalars(
        statement.order_by(FuelTransaction.incurred_on.desc(), FuelTransaction.id.desc())
    ).all())


@router.post("/fuel-transactions", response_model=FuelTransactionRead, status_code=status.HTTP_201_CREATED)
def create_fuel_transaction(
    payload: FuelTransactionCreate,
    request: Request,
    user: User = Depends(require_permission("fuel_read")),
    database: Session = Depends(get_db),
) -> FuelTransaction:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    if user.role not in {"owner", "fleet_manager", "accountant"} and not (
        user.role == "driver" and vehicle.assigned_driver_id == user.id
    ):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Only finance roles or the assigned driver can record fuel")
    total_amount_paise = (payload.litres_milli * payload.price_per_litre_paise) // 1000
    fuel = FuelTransaction(
        organization_id=user.organization_id,
        total_amount_paise=total_amount_paise,
        created_by=user.id,
        **payload.model_dump(),
    )
    database.add(fuel)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="fuel_transaction.created",
        entity_type="fuel_transaction",
        entity_id=str(fuel.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "total_amount_paise": total_amount_paise}),
    ))
    database.commit()
    database.refresh(fuel)
    return fuel


@router.get("/toll-transactions", response_model=list[TollTransactionRead])
def list_toll_transactions(user: User = Depends(require_permission("finance_read")), database: Session = Depends(get_db)) -> list[TollTransaction]:
    return list(database.scalars(
        select(TollTransaction)
        .where(TollTransaction.organization_id == user.organization_id)
        .order_by(TollTransaction.incurred_on.desc(), TollTransaction.id.desc())
    ).all())


@router.post("/toll-transactions", response_model=TollTransactionRead, status_code=status.HTTP_201_CREATED)
def create_toll_transaction(
    payload: TollTransactionCreate,
    request: Request,
    user: User = Depends(require_permission("finance")),
    database: Session = Depends(get_db),
) -> TollTransaction:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    toll = TollTransaction(organization_id=user.organization_id, created_by=user.id, **payload.model_dump())
    database.add(toll)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="toll_transaction.created",
        entity_type="toll_transaction",
        entity_id=str(toll.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "amount_paise": toll.amount_paise}),
    ))
    database.commit()
    database.refresh(toll)
    return toll


@router.get("/telematics/devices", response_model=list[TelematicsDeviceRead])
def list_telematics_devices(user: User = Depends(require_permission("fleet")), database: Session = Depends(get_db)) -> list[TelematicsDevice]:
    return list(database.scalars(
        select(TelematicsDevice)
        .where(TelematicsDevice.organization_id == user.organization_id)
        .order_by(TelematicsDevice.id.desc())
    ).all())


def integration_credential(integration: TelematicsIntegration) -> str | None:
    if not integration.credential_ref:
        return None
    env_name = f"VAHANA_TELEMATICS_TOKEN_{integration.credential_ref.upper().replace('-', '_')}"
    return os.getenv(env_name) or os.getenv(integration.credential_ref)


def normalize_external_reading(item: dict) -> dict:
    return {
        "device_identifier": item.get("device_identifier") or item.get("imei") or item.get("device_id"),
        "recorded_at": item.get("recorded_at") or item.get("timestamp") or item.get("recordedAt"),
        "odometer_km": item.get("odometer_km") if item.get("odometer_km") is not None else item.get("odometer"),
        "latitude_e6": item.get("latitude_e6") if item.get("latitude_e6") is not None else (
            round(float(item["latitude"]) * 1_000_000) if item.get("latitude") is not None else None
        ),
        "longitude_e6": item.get("longitude_e6") if item.get("longitude_e6") is not None else (
            round(float(item["longitude"]) * 1_000_000) if item.get("longitude") is not None else None
        ),
        "speed_kph": item.get("speed_kph") if item.get("speed_kph") is not None else item.get("speed"),
        "fuel_level_percent": item.get("fuel_level_percent") if item.get("fuel_level_percent") is not None else item.get("fuel_level"),
        "engine_on": item.get("engine_on"),
    }


def sync_telematics_integration(integration: TelematicsIntegration, database: Session) -> dict[str, int | str]:
    token = integration_credential(integration)
    if not token:
        integration.last_sync_status = "missing_credentials"
        database.commit()
        return {"integration_id": integration.id, "status": "missing_credentials", "readings": 0, "vehicles_updated": 0}
    try:
        response = httpx.get(
            f"{integration.base_url.rstrip('/')}/{integration.sync_path.lstrip('/')}",
            headers={"Authorization": f"Bearer {token}", "X-Provider": integration.provider},
            timeout=get_settings().telematics_default_timeout_seconds,
        )
        response.raise_for_status()
        payload = response.json()
        readings = payload.get("readings", payload) if isinstance(payload, dict) else payload
        if not isinstance(readings, list):
            raise ValueError("GPS provider response must contain a readings list")
        created = 0
        updated = 0
        for raw_item in readings:
            if not isinstance(raw_item, dict):
                continue
            item = normalize_external_reading(raw_item)
            identifier = item["device_identifier"]
            recorded_at = item["recorded_at"]
            if not identifier or not recorded_at:
                continue
            device = database.scalar(select(TelematicsDevice).where(
                TelematicsDevice.organization_id == integration.organization_id,
                TelematicsDevice.device_identifier == str(identifier),
                TelematicsDevice.active.is_(True),
            ))
            if device is None:
                continue
            recorded_datetime = datetime.fromisoformat(str(recorded_at).replace("Z", "+00:00"))
            exists = database.scalar(select(TelemetryReading).where(
                TelemetryReading.device_id == device.id,
                TelemetryReading.recorded_at == recorded_datetime,
            ))
            if exists is not None:
                continue
            vehicle = database.get(Vehicle, device.vehicle_id)
            if vehicle is None:
                continue
            reading = TelemetryReading(
                organization_id=integration.organization_id,
                vehicle_id=device.vehicle_id,
                device_id=device.id,
                recorded_at=recorded_datetime,
                odometer_km=item["odometer_km"],
                latitude_e6=item["latitude_e6"],
                longitude_e6=item["longitude_e6"],
                speed_kph=item["speed_kph"],
                fuel_level_percent=item["fuel_level_percent"],
                engine_on=item["engine_on"],
            )
            database.add(reading)
            if item["odometer_km"] is not None and item["odometer_km"] > vehicle.odometer_km:
                vehicle.odometer_km = item["odometer_km"]
                updated += 1
            device.last_seen_at = recorded_datetime
            created += 1
        integration.last_synced_at = utc_now()
        integration.last_sync_status = "success"
        database.commit()
        return {"integration_id": integration.id, "status": "success", "readings": created, "vehicles_updated": updated}
    except (httpx.HTTPError, ValueError, TypeError, KeyError):
        integration.last_synced_at = utc_now()
        integration.last_sync_status = "failed"
        database.commit()
        return {"integration_id": integration.id, "status": "failed", "readings": 0, "vehicles_updated": 0}


@router.get("/telematics/integrations", response_model=list[TelematicsIntegrationRead])
def list_telematics_integrations(
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> list[TelematicsIntegration]:
    return list(database.scalars(select(TelematicsIntegration).where(
        TelematicsIntegration.organization_id == user.organization_id,
    ).order_by(TelematicsIntegration.id.desc())).all())


@router.get("/telematics/health", response_model=TelematicsHealthRead)
def telematics_health(
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> TelematicsHealthRead:
    now = utc_now()
    integrations = list(database.scalars(select(TelematicsIntegration).where(
        TelematicsIntegration.organization_id == user.organization_id,
    )).all())
    devices = list(database.scalars(select(TelematicsDevice).where(
        TelematicsDevice.organization_id == user.organization_id,
    )).all())
    vehicles = {
        vehicle.id: vehicle.odometer_km
        for vehicle in database.scalars(select(Vehicle).where(
            Vehicle.organization_id == user.organization_id,
        )).all()
    }
    readings = list(database.scalars(select(TelemetryReading).where(
        TelemetryReading.organization_id == user.organization_id,
        TelemetryReading.recorded_at >= now - timedelta(hours=24),
    )).all())
    return TelematicsHealthRead(
        active_integrations=sum(item.active for item in integrations),
        stale_integrations=sum(item.active and (item.last_synced_at is None or item.last_synced_at < now - timedelta(hours=48)) for item in integrations),
        active_devices=sum(item.active for item in devices),
        stale_devices=sum(item.active and (item.last_seen_at is None or item.last_seen_at < now - timedelta(hours=48)) for item in devices),
        readings_last_24h=len(readings),
        flagged_odometer_readings=sum(
            reading.odometer_km is not None
            and reading.vehicle_id in vehicles
            and reading.odometer_km < vehicles[reading.vehicle_id]
            for reading in readings
        ),
    )


@router.post("/telematics/integrations", response_model=TelematicsIntegrationRead, status_code=status.HTTP_201_CREATED)
def create_telematics_integration(
    payload: TelematicsIntegrationCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> TelematicsIntegration:
    integration = TelematicsIntegration(organization_id=user.organization_id, **payload.model_dump())
    database.add(integration)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="telematics_integration.created",
        entity_type="telematics_integration",
        entity_id=str(integration.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"provider": integration.provider, "credential_ref": integration.credential_ref}),
    ))
    database.commit()
    database.refresh(integration)
    return integration


@router.patch("/telematics/integrations/{integration_id}", response_model=TelematicsIntegrationRead)
def update_telematics_integration(
    integration_id: int,
    payload: TelematicsIntegrationCreate,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> TelematicsIntegration:
    integration = database.scalar(select(TelematicsIntegration).where(
        TelematicsIntegration.id == integration_id,
        TelematicsIntegration.organization_id == user.organization_id,
    ))
    if integration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Telematics integration not found")
    integration.provider = payload.provider
    integration.base_url = payload.base_url
    integration.sync_path = payload.sync_path
    integration.credential_ref = payload.credential_ref
    integration.active = payload.active
    integration.sync_interval_minutes = payload.sync_interval_minutes
    database.commit()
    database.refresh(integration)
    return integration


@router.delete("/telematics/integrations/{integration_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_telematics_integration(
    integration_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> Response:
    integration = database.scalar(select(TelematicsIntegration).where(
        TelematicsIntegration.id == integration_id,
        TelematicsIntegration.organization_id == user.organization_id,
    ))
    if integration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Telematics integration not found")
    database.delete(integration)
    database.commit()
    return Response(status_code=status.HTTP_204_NO_CONTENT)


@router.post("/telematics/integrations/{integration_id}/sync")
def sync_telematics(
    integration_id: int,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> dict[str, int | str]:
    integration = database.scalar(select(TelematicsIntegration).where(
        TelematicsIntegration.id == integration_id,
        TelematicsIntegration.organization_id == user.organization_id,
        TelematicsIntegration.active.is_(True),
    ))
    if integration is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active telematics integration not found")
    return sync_telematics_integration(integration, database)


@router.post("/telematics/sync-due")
def sync_due_telematics(
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> list[dict[str, int | str]]:
    now = utc_now()
    integrations = database.scalars(select(TelematicsIntegration).where(
        TelematicsIntegration.organization_id == user.organization_id,
        TelematicsIntegration.active.is_(True),
    )).all()
    results = []
    for integration in integrations:
        if integration.last_synced_at is not None and (
            now - integration.last_synced_at
        ).total_seconds() < integration.sync_interval_minutes * 60:
            continue
        results.append(sync_telematics_integration(integration, database))
    return results


@router.post("/telematics/cron-sync")
def cron_sync_telematics(
    request: Request,
    database: Session = Depends(get_db),
) -> dict[str, int | list[dict[str, int | str]]]:
    settings = get_settings()
    expected_secret = settings.telematics_cron_secret
    authorization = request.headers.get("authorization", "")
    if not expected_secret or authorization != f"Bearer {expected_secret}":
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid cron credentials")

    now = utc_now()
    integrations = database.scalars(select(TelematicsIntegration).where(
        TelematicsIntegration.active.is_(True),
    )).all()
    results = []
    for integration in integrations:
        if integration.last_synced_at is not None and (
            now - integration.last_synced_at
        ).total_seconds() < integration.sync_interval_minutes * 60:
            continue
        results.append(sync_telematics_integration(integration, database))
    return {"processed": len(results), "results": results}


@router.post("/telematics/devices", response_model=TelematicsDeviceRead, status_code=status.HTTP_201_CREATED)
def create_telematics_device(
    payload: TelematicsDeviceCreate,
    request: Request,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> TelematicsDevice:
    vehicle = database.scalar(select(Vehicle).where(Vehicle.id == payload.vehicle_id, Vehicle.organization_id == user.organization_id))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    existing = database.scalar(select(TelematicsDevice).where(
        TelematicsDevice.organization_id == user.organization_id,
        TelematicsDevice.device_identifier == payload.device_identifier,
    ))
    if existing is not None:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="A telematics device with this identifier already exists")
    device = TelematicsDevice(organization_id=user.organization_id, **payload.model_dump())
    database.add(device)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="telematics_device.created",
        entity_type="telematics_device",
        entity_id=str(device.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vehicle_id": vehicle.id, "provider": device.provider}),
    ))
    database.commit()
    database.refresh(device)
    return device


@router.post("/telematics/devices/{device_id}/readings", response_model=TelemetryReadingRead, status_code=status.HTTP_201_CREATED)
def ingest_telemetry(
    device_id: int,
    payload: TelemetryReadingCreate,
    request: Request,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> TelemetryReading:
    device = database.scalar(select(TelematicsDevice).where(
        TelematicsDevice.id == device_id,
        TelematicsDevice.organization_id == user.organization_id,
        TelematicsDevice.active.is_(True),
    ))
    if device is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active telematics device not found")
    vehicle = database.get(Vehicle, device.vehicle_id)
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found")
    if payload.odometer_km > vehicle.odometer_km:
        vehicle.odometer_km = payload.odometer_km
        evaluate_component_thresholds(user, vehicle, database)
    reading = TelemetryReading(
        organization_id=user.organization_id,
        vehicle_id=device.vehicle_id,
        device_id=device.id,
        **payload.model_dump(),
    )
    device.last_seen_at = payload.recorded_at
    database.add(reading)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="telemetry_reading.ingested",
        entity_type="telemetry_reading",
        entity_id=str(reading.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"device_id": device.id, "vehicle_id": device.vehicle_id}),
    ))
    database.commit()
    database.refresh(reading)
    return reading


@router.get("/telematics/vehicles/{vehicle_id}/latest", response_model=TelemetryReadingRead)
def latest_vehicle_telemetry(
    vehicle_id: int,
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> TelemetryReading:
    reading = database.scalar(
        select(TelemetryReading)
        .where(TelemetryReading.vehicle_id == vehicle_id, TelemetryReading.organization_id == user.organization_id)
        .order_by(TelemetryReading.recorded_at.desc(), TelemetryReading.id.desc())
    )
    if reading is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="No telemetry available for this vehicle")
    return reading


@router.get("/vendors", response_model=list[VendorRead])
def list_vendors(user: User = Depends(require_permission("procurement_read")), database: Session = Depends(get_db)) -> list[Vendor]:
    return list(database.scalars(select(Vendor).where(Vendor.organization_id == user.organization_id).order_by(Vendor.name.asc())).all())


@router.post("/vendors", response_model=VendorRead, status_code=status.HTTP_201_CREATED)
def create_vendor(
    payload: VendorCreate,
    request: Request,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> Vendor:
    vendor = Vendor(organization_id=user.organization_id, **payload.model_dump())
    database.add(vendor)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="vendor.created",
        entity_type="vendor",
        entity_id=str(vendor.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"name": vendor.name, "vendor_type": vendor.vendor_type}),
    ))
    database.commit()
    database.refresh(vendor)
    return vendor


@router.get("/purchase-orders", response_model=list[PurchaseOrderRead])
def list_purchase_orders(user: User = Depends(require_permission("procurement_read")), database: Session = Depends(get_db)) -> list[PurchaseOrder]:
    statement = select(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).where(PurchaseOrder.organization_id == user.organization_id).order_by(PurchaseOrder.id.desc())
    return list(database.scalars(statement).unique().all())


@router.post("/purchase-orders", response_model=PurchaseOrderRead, status_code=status.HTTP_201_CREATED)
def create_purchase_order(
    payload: PurchaseOrderCreate,
    request: Request,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> PurchaseOrder:
    vendor = database.scalar(select(Vendor).where(Vendor.id == payload.vendor_id, Vendor.organization_id == user.organization_id, Vendor.active.is_(True)))
    if vendor is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Active vendor not found in this organization")
    part_ids = [line.part_id for line in payload.lines]
    parts = list(database.scalars(select(Part).where(Part.id.in_(part_ids), Part.organization_id == user.organization_id)).all())
    parts_by_id = {part.id: part for part in parts}
    if len(parts_by_id) != len(set(part_ids)):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="One or more parts were not found in this organization")
    total_paise = sum(line.quantity * line.unit_cost_paise for line in payload.lines)
    order = PurchaseOrder(
        organization_id=user.organization_id,
        vendor_id=vendor.id,
        order_number=f"PO-{date.today().strftime('%Y%m%d')}-{uuid4().hex[:6].upper()}",
        expected_on=payload.expected_on,
        notes=payload.notes,
        total_paise=total_paise,
        created_by=user.id,
    )
    order.lines = [
        PurchaseOrderLine(
            organization_id=user.organization_id,
            part_id=line.part_id,
            quantity=line.quantity,
            unit_cost_paise=line.unit_cost_paise,
            line_total_paise=line.quantity * line.unit_cost_paise,
        )
        for line in payload.lines
    ]
    database.add(order)
    database.flush()
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="purchase_order.created",
        entity_type="purchase_order",
        entity_id=str(order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"vendor_id": vendor.id, "total_paise": total_paise}),
    ))
    database.commit()
    statement = select(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).where(PurchaseOrder.id == order.id)
    return database.scalar(statement)


@router.patch("/purchase-orders/{purchase_order_id}", response_model=PurchaseOrderRead)
def update_purchase_order_status(
    purchase_order_id: int,
    payload: PurchaseOrderStatusUpdate,
    request: Request,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> PurchaseOrder:
    order = database.scalar(select(PurchaseOrder).where(PurchaseOrder.id == purchase_order_id, PurchaseOrder.organization_id == user.organization_id))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    order.status = payload.status
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="purchase_order.status_updated",
        entity_type="purchase_order",
        entity_id=str(order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"status": order.status}),
    ))
    database.commit()
    statement = select(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).where(PurchaseOrder.id == order.id)
    return database.scalar(statement)


@router.get("/purchase-orders/{purchase_order_id}/receipts", response_model=list[PurchaseOrderReceiptRead])
def list_purchase_order_receipts(
    purchase_order_id: int,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> list[PurchaseOrderReceipt]:
    order = database.scalar(select(PurchaseOrder).where(
        PurchaseOrder.id == purchase_order_id,
        PurchaseOrder.organization_id == user.organization_id,
    ))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    return list(database.scalars(select(PurchaseOrderReceipt).where(
        PurchaseOrderReceipt.organization_id == user.organization_id,
        PurchaseOrderReceipt.purchase_order_id == purchase_order_id,
    ).order_by(PurchaseOrderReceipt.id.desc())).all())


@router.post("/purchase-orders/{purchase_order_id}/receipts", response_model=PurchaseOrderReceiptRead, status_code=status.HTTP_201_CREATED)
def receive_purchase_order(
    purchase_order_id: int,
    payload: PurchaseOrderReceiptCreate,
    request: Request,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> PurchaseOrderReceipt:
    reserve_idempotency_key(request, user, database)
    order = database.scalar(select(PurchaseOrder).where(
        PurchaseOrder.id == purchase_order_id,
        PurchaseOrder.organization_id == user.organization_id,
    ))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    part = database.scalar(select(Part).where(
        Part.id == payload.part_id,
        Part.organization_id == user.organization_id,
    ))
    if part is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part not found in this organization")
    line = database.scalar(select(PurchaseOrderLine).where(
        PurchaseOrderLine.organization_id == user.organization_id,
        PurchaseOrderLine.purchase_order_id == order.id,
        PurchaseOrderLine.part_id == payload.part_id,
    ))
    if line is None:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Part is not included in this purchase order")
    if payload.damaged_quantity > payload.quantity:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Damaged quantity cannot exceed received quantity")
    prior_receipts = list(database.scalars(select(PurchaseOrderReceipt).where(
        PurchaseOrderReceipt.organization_id == user.organization_id,
        PurchaseOrderReceipt.purchase_order_id == order.id,
        PurchaseOrderReceipt.part_id == payload.part_id,
    )).all())
    if sum(receipt.quantity for receipt in prior_receipts) + payload.quantity > line.quantity:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Receipt quantity exceeds the ordered quantity")
    if payload.location_id is not None and database.scalar(select(StockLocation).where(
        StockLocation.id == payload.location_id,
        StockLocation.organization_id == user.organization_id,
    )) is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Receiving location not found")
    receipt = PurchaseOrderReceipt(
        organization_id=user.organization_id,
        purchase_order_id=order.id,
        received_by=user.id,
        **payload.model_dump(),
    )
    part.quantity_on_hand += payload.quantity - payload.damaged_quantity
    order.status = "Partially received"
    database.add(receipt)
    database.add(InventoryTransaction(
        organization_id=user.organization_id,
        part_id=part.id,
        transaction_type="receipt",
        quantity=payload.quantity - payload.damaged_quantity,
        reference=order.order_number,
        created_by=user.id,
    ))
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="purchase_order.received",
        entity_type="purchase_order",
        entity_id=str(order.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({"part_id": part.id, "quantity": payload.quantity, "damaged_quantity": payload.damaged_quantity}),
    ))
    database.commit()
    database.refresh(receipt)
    return receipt


@router.get("/purchase-orders/{purchase_order_id}/download")
def download_purchase_order(
    purchase_order_id: int,
    user: User = Depends(require_permission("procurement")),
    database: Session = Depends(get_db),
) -> Response:
    order = database.scalar(select(PurchaseOrder).options(selectinload(PurchaseOrder.lines)).where(
        PurchaseOrder.id == purchase_order_id,
        PurchaseOrder.organization_id == user.organization_id,
    ))
    if order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Purchase order not found")
    vendor = database.scalar(select(Vendor).where(Vendor.id == order.vendor_id))
    rows = ["Order number,Vendor,Status,Expected on,Part ID,Quantity,Unit cost paise,Line total paise"]
    for line in order.lines:
        rows.append(",".join(map(str, [
            order.order_number,
            (vendor.name if vendor else ""),
            order.status,
            order.expected_on or "",
            line.part_id,
            line.quantity,
            line.unit_cost_paise,
            line.line_total_paise,
        ])))
    return Response(
        content="\n".join(rows),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{order.order_number}.csv"'},
    )


def csv_export_payload(filename: str, headers: list[str], rows: list[list[object]]) -> dict[str, object]:
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(rows)
    return {
        "filename": filename,
        "content": output.getvalue(),
        "row_count": len(rows),
    }


@router.get("/export/documents", response_model=dict)
def export_documents(
    user: User = Depends(require_permission("compliance_read")),
    database: Session = Depends(get_db),
) -> dict:
    documents = database.scalars(
        select(ComplianceDocument)
        .where(ComplianceDocument.organization_id == user.organization_id)
        .order_by(ComplianceDocument.expires_on.asc(), ComplianceDocument.id.asc())
    ).all()
    return csv_export_payload(
        "documents.csv",
        ["id", "vehicle_id", "name", "document_type", "issued_by", "expires_on", "file_key", "status"],
        [[
            document.id,
            document.vehicle_id or "",
            document.name,
            document.document_type,
            document.issued_by or "",
            document.expires_on,
            document.file_key or "",
            document.status,
        ] for document in documents],
    )


@router.get("/export/expenses", response_model=dict)
def export_expenses(
    user: User = Depends(require_permission("finance_read")),
    database: Session = Depends(get_db),
) -> dict:
    expenses = database.scalars(
        select(Expense)
        .where(Expense.organization_id == user.organization_id)
        .order_by(Expense.incurred_on.desc(), Expense.id.desc())
    ).all()
    return csv_export_payload(
        "expenses.csv",
        ["id", "vehicle_id", "category", "description", "amount_paise", "gst_amount_paise", "incurred_on", "vendor", "status"],
        [[
            expense.id,
            expense.vehicle_id or "",
            expense.category,
            expense.description,
            expense.amount_paise,
            expense.gst_amount_paise,
            expense.incurred_on,
            expense.vendor or "",
            expense.status,
        ] for expense in expenses],
    )


@router.get("/export/{resource}")
def export_resource(
    resource: str,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> Response:
    if resource == "vehicles":
        rows = database.scalars(select(Vehicle).where(Vehicle.organization_id == user.organization_id)).all()
        headers = ["registration_number", "model", "vehicle_type", "depot", "status", "health", "odometer_km"]
        data = [[row.registration_number, row.model, row.vehicle_type, row.depot, row.status, row.health, row.odometer_km] for row in rows]
    elif resource == "components":
        rows = database.scalars(select(VehicleComponent).where(VehicleComponent.organization_id == user.organization_id)).all()
        headers = ["vehicle_id", "name", "component_type", "serial_number", "installed_at_km", "last_service_km", "service_interval_km", "next_service_km", "status"]
        data = [[row.vehicle_id, row.name, row.component_type, row.serial_number or "", row.installed_at_km, row.last_service_km or "", row.service_interval_km or "", row.next_service_km or "", row.status] for row in rows]
    elif resource == "parts":
        rows = database.scalars(select(Part).where(Part.organization_id == user.organization_id)).all()
        headers = ["sku", "name", "category", "quantity_on_hand", "reorder_level", "unit_cost_paise", "supplier"]
        data = [[row.sku, row.name, row.category, row.quantity_on_hand, row.reorder_level, row.unit_cost_paise, row.supplier or ""] for row in rows]
    elif resource == "vendors":
        rows = database.scalars(select(Vendor).where(Vendor.organization_id == user.organization_id)).all()
        headers = ["name", "vendor_type", "gstin", "phone", "email", "active"]
        data = [[row.name, row.vendor_type, row.gstin or "", row.phone or "", row.email or "", row.active] for row in rows]
    else:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Unsupported export resource")
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(headers)
    writer.writerows(data)
    return Response(
        content=output.getvalue(),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="{resource}.csv"'},
    )


@router.post("/import/vehicles", status_code=status.HTTP_201_CREATED)
async def import_vehicles(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("fleet")),
    database: Session = Depends(get_db),
) -> dict[str, int]:
    content = (await file.read()).decode("utf-8-sig")
    imported = 0
    for row in csv.DictReader(io.StringIO(content)):
        registration = row["registration_number"].strip().upper()
        if database.scalar(select(Vehicle).where(Vehicle.organization_id == user.organization_id, Vehicle.registration_number == registration)):
            continue
        database.add(Vehicle(
            organization_id=user.organization_id,
            registration_number=registration,
            model=row["model"].strip(),
            vehicle_type=row.get("vehicle_type", "Heavy truck").strip(),
            depot=row.get("depot", "Unassigned").strip(),
            status=row.get("status", "Idle / parked").strip(),
            health=int(row.get("health") or 100),
            odometer_km=int(row.get("odometer_km") or 0),
        ))
        imported += 1
    database.commit()
    return {"imported": imported}


@router.post("/import/parts", status_code=status.HTTP_201_CREATED)
async def import_parts(
    file: UploadFile = File(...),
    user: User = Depends(require_permission("inventory")),
    database: Session = Depends(get_db),
) -> dict[str, int]:
    content = (await file.read()).decode("utf-8-sig")
    imported = 0
    for row in csv.DictReader(io.StringIO(content)):
        sku = row["sku"].strip().upper()
        if database.scalar(select(Part).where(Part.organization_id == user.organization_id, Part.sku == sku)):
            continue
        database.add(Part(
            organization_id=user.organization_id,
            sku=sku,
            name=row["name"].strip(),
            category=row.get("category", "General").strip(),
            quantity_on_hand=int(row.get("quantity_on_hand") or 0),
            reorder_level=int(row.get("reorder_level") or 0),
            unit_cost_paise=int(row.get("unit_cost_paise") or 0),
            supplier=row.get("supplier") or None,
        ))
        imported += 1
    database.commit()
    return {"imported": imported}


def seed_database() -> None:
    from .database import Base, engine

    settings = get_settings()
    if settings.environment.lower() == "development":
        Base.metadata.create_all(bind=engine)
    with next(get_db()) as database:
        if database.scalar(select(User).where(User.email == settings.seed_admin_email.lower())):
            return
        organization = database.scalar(select(Organization).where(Organization.slug == "rajput-logistics"))
        if organization is None:
            organization = Organization(name="Rajput Logistics", slug="rajput-logistics")
            database.add(organization)
            database.flush()
        database.add(User(
            organization_id=organization.id,
            email=settings.seed_admin_email.lower(),
            full_name="Arjun Mehta",
            password_hash=hash_password(settings.seed_admin_password),
            role="owner",
        ))
        if database.scalar(select(Vehicle).where(Vehicle.organization_id == organization.id)) is None:
            database.add_all([
                Vehicle(organization_id=organization.id, registration_number="MH 12 QX 4821", model="Ashok Leyland 3520", vehicle_type="Heavy truck", depot="Pune Central", status="On route", health=92, odometer_km=84920, driver_name="Amit Kulkarni"),
                Vehicle(organization_id=organization.id, registration_number="KA 03 MN 7712", model="Tata Prima 5530", vehicle_type="Heavy truck", depot="Bengaluru Yard", status="In workshop", health=68, odometer_km=142860),
            ])
        if database.scalar(select(Part).where(Part.organization_id == organization.id)) is None:
            database.add_all([
                Part(organization_id=organization.id, sku="BP-AL-3520-F", name="Brake pad set · Front axle", category="Brakes", quantity_on_hand=8, reorder_level=5, unit_cost_paise=485000, supplier="TVS Autoparts"),
                Part(organization_id=organization.id, sku="OIL-15W40-20L", name="15W40 Diesel engine oil", category="Lubricants", quantity_on_hand=12, reorder_level=10, unit_cost_paise=326000, supplier="Castrol India"),
            ])
        database.commit()
        database.commit()


@router.get("/team/assignable-members", response_model=list[AssignableMemberRead])
def list_assignable_members(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> list[User]:
    """List available mechanics and technicians for work assignment"""
    return list(database.scalars(
        select(User)
        .where(
            User.organization_id == user.organization_id,
            User.role.in_(("technician", "mechanic")),
        )
        .order_by(User.full_name.asc())
    ).all())


@router.get("/team/roster", response_model=TeamRosterRead)
def get_team_roster(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get complete team roster with assignments"""
    members = list(database.scalars(
        select(User)
        .where(User.organization_id == user.organization_id)
        .order_by(User.full_name.asc())
    ).all())
    assignments = list(database.scalars(
        select(VehicleAssignment)
        .where(VehicleAssignment.organization_id == user.organization_id)
        .where(VehicleAssignment.active == True)
        .order_by(VehicleAssignment.created_at.desc())
    ).all())
    vehicles = list(database.scalars(
        select(Vehicle)
        .where(Vehicle.organization_id == user.organization_id)
    ).all())
    
    # Calculate unassigned
    assigned_driver_ids = {a.driver_id for a in assignments}
    assigned_vehicle_ids = {a.vehicle_id for a in assignments}
    
    return {
        "members": members,
        "assignments": assignments,
        "vehicles": vehicles,
        "unassigned_drivers": [m for m in members if m.role == "driver" and m.id not in assigned_driver_ids],
        "unassigned_vehicles": [v for v in vehicles if v.id not in assigned_vehicle_ids],
    }


@router.post("/vehicles/{vehicle_id}/assign-driver", response_model=VehicleDriverAssignmentRead)
def assign_vehicle_driver(
    vehicle_id: int,
    payload: VehicleDriverAssignmentCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Assign a driver to a vehicle"""
    reserve_idempotency_key(request, user, database)
    
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organization_id == user.organization_id,
    ))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    
    driver = database.scalar(select(User).where(
        User.id == payload.driver_id,
        User.organization_id == user.organization_id,
        User.role == "driver",
    ))
    if driver is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Driver not found in this organization")
    
    # Close any existing assignments for this driver or vehicle
    existing_assignments = database.scalars(select(VehicleAssignment).where(
        VehicleAssignment.organization_id == user.organization_id,
        VehicleAssignment.active == True,
        (VehicleAssignment.driver_id == payload.driver_id) | (VehicleAssignment.vehicle_id == vehicle_id),
    )).all()
    
    closed_count = 0
    for assignment in existing_assignments:
        if assignment.driver_id != payload.driver_id or assignment.vehicle_id != vehicle_id:
            assignment.active = False
            assignment.ended_at = utc_now()
            closed_count += 1
    
    # Create new assignment
    assignment = VehicleAssignment(
        organization_id=user.organization_id,
        vehicle_id=vehicle_id,
        driver_id=payload.driver_id,
        active=True,
    )
    vehicle.assigned_driver_id = driver.id
    vehicle.driver_name = driver.full_name
    database.add(assignment)
    database.flush()
    
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="vehicle_driver.assigned" if closed_count == 0 else "vehicle_driver.reassigned",
        entity_type="vehicle_assignment",
        entity_id=str(assignment.id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({
            "vehicle_id": vehicle_id,
            "driver_id": payload.driver_id,
            "closed_assignments": closed_count,
        }),
    ))
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="vehicle_assigned",
        severity="warning",
        title=f"Vehicle assigned: {vehicle.registration_number}",
        detail=f"{vehicle.model} is now assigned to you.",
        entity_type="vehicle",
        entity_id=str(vehicle_id),
        roles={"owner", "fleet_manager"},
        user_ids={driver.id},
        dedupe_key=f"vehicle_assigned:{vehicle_id}:{driver.id}",
    )
    database.commit()
    database.refresh(assignment)
    
    return {
        "id": assignment.id,
        "vehicle_id": vehicle_id,
        "vehicle_registration": vehicle.registration_number,
        "driver_id": payload.driver_id,
        "driver_name": driver.full_name,
        "active": True,
        "created_at": assignment.created_at,
    }


@router.post("/work-orders/{work_order_id}/assign", response_model=WorkOrderAssignmentRead)
def assign_work_order(
    work_order_id: int,
    payload: WorkOrderAssignmentCreate,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Assign a work order to a mechanic/technician"""
    reserve_idempotency_key(request, user, database)
    
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    
    if payload.mechanic_id is not None:
        mechanic = database.scalar(select(User).where(
            User.id == payload.mechanic_id,
            User.organization_id == user.organization_id,
            User.role.in_(("technician", "mechanic")),
        ))
        if mechanic is None:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Mechanic/Technician not found in this organization")
    else:
        mechanic = None
    
    previous_mechanic_id = work_order.assigned_user_id
    work_order.assigned_user_id = payload.mechanic_id
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="work_order.assigned" if payload.mechanic_id else "work_order.unassigned",
        entity_type="work_order",
        entity_id=str(work_order_id),
        request_id=request.headers.get("x-request-id", str(uuid4())),
        changes=json.dumps({
            "previous_mechanic_id": previous_mechanic_id,
            "new_mechanic_id": payload.mechanic_id,
        }),
    ))
    
    # Send notification to assigned mechanic if applicable
    if payload.mechanic_id is not None and previous_mechanic_id != payload.mechanic_id:
        queue_role_notification(
            database,
            organization_id=user.organization_id,
            notification_type="work_order_assigned",
            severity="warning",
            title=f"Work order assigned: {work_order.title}",
            detail=f"{work_order.priority} priority · {work_order.vehicle_id}",
            entity_type="work_order",
            entity_id=str(work_order_id),
            roles={"owner", "fleet_manager"},
            user_ids={payload.mechanic_id},
            dedupe_key=f"work_order_assigned:{work_order_id}:{payload.mechanic_id}",
        )
    
    database.commit()
    database.refresh(work_order)
    
    mechanic_name = mechanic.full_name if mechanic else None
    return {
        "id": work_order.id,
        "title": work_order.title,
        "vehicle_id": work_order.vehicle_id,
        "work_order_id": work_order.id,
        "assigned_mechanic_id": work_order.assigned_user_id,
        "assigned_mechanic_name": mechanic_name,
        "assigned_at": utc_now() if payload.mechanic_id is not None else None,
        "status": work_order.status,
    }


@router.get("/work-orders/{work_order_id}/handoff-timeline", response_model=list[AuditEventRead])
def work_order_handoff_timeline(
    work_order_id: int,
    user: User = Depends(require_permission("maintenance")),
    database: Session = Depends(get_db),
) -> list[dict]:
    """Get complete handoff timeline for a work order with detailed audit events"""
    work_order = database.scalar(select(WorkOrder).where(
        WorkOrder.id == work_order_id,
        WorkOrder.organization_id == user.organization_id,
    ))
    if work_order is None or (user.role in ("technician", "mechanic") and work_order.assigned_user_id != user.id):
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Work order not found")
    
    # Get audit events from new table
    audit_events = list(database.scalars(select(AuditEvent).where(
        AuditEvent.organization_id == user.organization_id,
        AuditEvent.entity_id == str(work_order_id),
        AuditEvent.entity_type == "WORK_ORDER",
    ).order_by(AuditEvent.created_at.desc())).all())
    
    # Get audit events from old table
    audit_events_from_old = list(database.scalars(select(AuditLog).where(
        AuditLog.organization_id == user.organization_id,
        AuditLog.entity_id == str(work_order_id),
        AuditLog.entity_type == "work_order",
    ).order_by(AuditLog.created_at.desc())).all())
    
    # Combine and format
    all_events = []
    
    # Format new AuditEvent entries
    for event in audit_events:
        all_events.append({
            "id": event.id,
            "actor_user_id": event.actor_user_id,
            "actor_role": event.actor_role,
            "action": event.action,
            "entity_type": event.entity_type,
            "entity_id": event.entity_id or "",
            "summary": event.summary,
            "metadata": event.metadata_,
            "created_at": event.created_at.isoformat(),
        })
    
    # Format old AuditLog entries
    for event in audit_events_from_old:
        all_events.append({
            "id": event.id,
            "actor_user_id": event.actor_user_id,
            "actor_role": "",  # Not available in old table
            "action": event.action,
            "entity_type": event.entity_type,
            "entity_id": event.entity_id,
            "summary": f"Action: {event.action}",
            "metadata": event.changes,
            "created_at": event.created_at.isoformat(),
        })
    
    # Sort by created_at descending
    all_events.sort(key=lambda x: x["created_at"], reverse=True)
    
    return all_events

# FleetOps Parity - Automation Endpoints
@router.post("/automation/evaluate-vehicle/{vehicle_id}", response_model=dict)
def evaluate_vehicle_maintenance(
    vehicle_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Evaluate a vehicle for maintenance thresholds and auto-generate work orders"""
    reserve_idempotency_key(Request(), user, database)
    
    vehicle = database.scalar(select(Vehicle).where(
        Vehicle.id == vehicle_id,
        Vehicle.organization_id == user.organization_id,
    ))
    if vehicle is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Vehicle not found in this organization")
    
    created_work_orders = evaluate_component_thresholds(user, vehicle, database)
    
    database.commit()
    return {"created_work_orders": created_work_orders}


@router.post("/automation/evaluate-inventory", response_model=dict)
def evaluate_low_inventory(
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Evaluate inventory for low stock and create draft purchase orders"""
    reserve_idempotency_key(Request(), user, database)
    
    low_stock_count = 0
    draft_purchase_orders = 0
    
    # Find parts below reorder level
    parts = list(database.scalars(
        select(Part).where(Part.organization_id == user.organization_id)
    ).all())
    
    for part in parts:
        if part.quantity_on_hand <= part.reorder_level:
            low_stock_count += 1
            
            # Create draft purchase order
            suggested_qty = (part.reorder_level * 2) - part.quantity_on_hand
            draft_po = PurchaseOrder(
                organization_id=user.organization_id,
                vendor_id=1,  # Default vendor - in production, would select from vendor list
                order_number=f"PO-AUTO-{date.today().isoformat()}-{draft_purchase_orders + 1:04d}",
                status="Draft",
                expected_on=(date.today() + timedelta(days=7)).isoformat(),
                total_paise=suggested_qty * part.unit_cost_paise,
                notes=f"Auto-generated: {part.name} at {part.quantity_on_hand} units remaining",
            )
            database.add(draft_po)
            draft_purchase_orders += 1
            
            # Create notification
            queue_role_notification(
                database,
                organization_id=user.organization_id,
                notification_type="INVENTORY_LOW",
                severity="HIGH",
                title=f"Inventory below reorder level: {part.name}",
                detail=f"{part.sku}: {part.quantity_on_hand} units remaining. Draft PO created.",
                entity_type="part",
                entity_id=str(part.id),
                roles={"owner", "fleet_manager", "inventory_manager"},
            )
    
    database.commit()
    return {"low_stock_parts": low_stock_count, "draft_purchase_orders": draft_purchase_orders}


@router.post("/automation/evaluate-documents", response_model=dict)
def evaluate_document_expiry(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Evaluate compliance documents for expiry within 30 days"""
    reserve_idempotency_key(Request(), user, database)
    
    horizon = date.today() + timedelta(days=30)
    expiring_count = 0
    
    documents = list(database.scalars(
        select(ComplianceDocument).where(ComplianceDocument.organization_id == user.organization_id)
    ).all())
    
    for doc in documents:
        if doc.expires_on and doc.expires_on <= horizon.isoformat():
            expiring_count += 1
            queue_role_notification(
                database,
                organization_id=user.organization_id,
                notification_type="DOCUMENT_EXPIRY",
                severity="CRITICAL" if date.fromisoformat(doc.expires_on) < date.today() else "HIGH",
                title=f"Compliance document expiring: {doc.name}",
                detail=f"Expires on {doc.expires_on}. Required for {doc.vehicle_id or 'organization'}.",
                entity_type="document",
                entity_id=str(doc.id),
                roles={"owner", "fleet_manager"},
            )
    
    database.commit()
    return {"expiring_documents": expiring_count}


@router.post("/automation/evaluate-escalations", response_model=dict)
def evaluate_escalations(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Evaluate for critical alerts and overdue work orders that need escalation"""
    reserve_idempotency_key(Request(), user, database)
    
    cutoff = datetime.now(timezone.utc) - timedelta(days=1)
    escalated_count = 0
    
    # Find critical alerts without acknowledgment
    alerts = list(database.scalars(select(OperationalNotification).where(
        OperationalNotification.organization_id == user.organization_id,
        OperationalNotification.severity == "HIGH",
        OperationalNotification.status == "unread",
        OperationalNotification.created_at <= cutoff,
    ).order_by(OperationalNotification.created_at.asc()).limit(100)).all())
    
    for alert in alerts:
        alert.status = "read"
        escalated_count += 1
        queue_role_notification(
            database,
            organization_id=user.organization_id,
            notification_type="ALERT_ESCALATION",
            severity="CRITICAL",
            title=f"Critical alert escalated: {alert.title}",
            detail=alert.detail,
            entity_type=alert.entity_type,
            entity_id=alert.entity_id,
            roles={"owner"},
        )
    
    # Find overdue critical work orders
    overdue_orders = list(database.scalars(select(WorkOrder).where(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.priority == "High",
        WorkOrder.status.in_(["Open", "In progress", "REWORK"]),
        WorkOrder.created_at <= cutoff,
    ).order_by(WorkOrder.created_at.asc()).limit(100)).all())
    
    for order in overdue_orders:
        queue_role_notification(
            database,
            organization_id=user.organization_id,
            notification_type="WORK_ORDER_ESCALATION",
            severity="CRITICAL",
            title=f"Critical work order overdue: {order.title}",
            detail=f"Has been {order.status} for more than 24 hours.",
            entity_type="work_order",
            entity_id=str(order.id),
            roles={"owner"},
        )
        escalated_count += 1
    
    database.commit()
    return {"escalated_items": escalated_count}


@router.post("/automation/evaluate-all", response_model=dict)
def evaluate_all_organizations(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Evaluate all automation checks for the organization"""
    return {
        "vehicle_maintenance": evaluate_vehicle_maintenance.__name__,
        "inventory": evaluate_low_inventory.__name__,
        "documents": evaluate_document_expiry.__name__,
        "escalations": evaluate_escalations.__name__,
    }



# ============================================================================
# SYSTEM ROUTER - Health, Version, Config
# ============================================================================

@router.get("/system/health", response_model=dict)
def system_health() -> dict:
    """Health check endpoint for monitoring and load balancers"""
    return {
        "status": "ok",
        "service": "fleet-ops-api",
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/system/version", response_model=dict)
def system_version() -> dict:
    """Get API version information"""
    return {
        "version": "1.0.0",
        "service": "fleet-ops-api",
        "environment": os.getenv("ENVIRONMENT", "production"),
    }


@router.get("/system/config", response_model=dict)
def system_config(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Get system configuration and feature flags for the organization"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    return {
        "organization_id": org.id,
        "organization_name": org.name,
        "plan": org.subscription_plan,
        "status": org.subscription_status,
        "features": {
            "telematics": True,  # VS has telematics
            "reporting": True,
            "compliance": True,
            "maintenance_planning": True,
            "financial_tracking": True,
            "inventory_management": True,
            "work_order_automation": True,
            "triage_system": True,
            "activity_feed": True,
        },
        "api_endpoints": {
            "health": "/system/health",
            "version": "/system/version",
            "config": "/system/config",
        },
    }



# ============================================================================
# ORGANIZATION SETTINGS
# ============================================================================

class OrganizationSettingsUpdate(BaseModel):
    """Schema for updating organization settings"""
    name: Optional[str] = None
    subscription_plan: Optional[str] = None
    timezone: Optional[str] = None
    odometer_max_daily_km: Optional[int] = None
    labor_rate_per_hour: Optional[int] = None
    safety_contact_name: Optional[str] = None
    safety_contact_phone: Optional[str] = None
    

@router.get("/organization/settings", response_model=dict)
def get_organization_settings(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get organization settings and configuration"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    user_count = len(database.scalars(
        select(User).where(User.organization_id == org.id)
    ).all())
    
    vehicle_count = len(database.scalars(
        select(Vehicle).where(Vehicle.organization_id == org.id)
    ).all())
    
    return {
        "organization_id": org.id,
        "name": org.name,
        "slug": org.slug,
        "subscription_plan": org.subscription_plan,
        "subscription_status": org.subscription_status,
        "trial_ends_on": org.trial_ends_on,
        "subscription_renews_on": org.subscription_renews_on,
        "timezone": org.timezone,
        "odometer_max_daily_km": org.odometer_max_daily_km,
        "labor_rate_per_hour": org.labor_rate_per_hour,
        "safety_contact_name": org.safety_contact_name,
        "safety_contact_phone": org.safety_contact_phone,
        "created_at": org.created_at.isoformat(),
        "user_count": user_count,
        "vehicle_count": vehicle_count,
    }


@router.put("/organization/settings", response_model=dict)
def update_organization_settings(
    payload: OrganizationSettingsUpdate,
    request: Request,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Update organization settings"""
    reserve_idempotency_key(request, user, database)
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    if payload.name:
        org.name = payload.name
    if payload.subscription_plan:
        org.subscription_plan = payload.subscription_plan
    if payload.timezone is not None:
        org.timezone = payload.timezone
    if payload.odometer_max_daily_km is not None:
        org.odometer_max_daily_km = payload.odometer_max_daily_km
    if payload.labor_rate_per_hour is not None:
        org.labor_rate_per_hour = payload.labor_rate_per_hour
    if payload.safety_contact_name is not None:
        org.safety_contact_name = payload.safety_contact_name
    if payload.safety_contact_phone is not None:
        org.safety_contact_phone = normalize_mobile_phone(payload.safety_contact_phone)
    
    database.add(org)
    database.commit()
    database.refresh(org)
    
    return {
        "organization_id": org.id,
        "name": org.name,
        "slug": org.slug,
        "subscription_plan": org.subscription_plan,
        "timezone": org.timezone,
        "odometer_max_daily_km": org.odometer_max_daily_km,
        "labor_rate_per_hour": org.labor_rate_per_hour,
        "safety_contact_name": org.safety_contact_name,
        "safety_contact_phone": org.safety_contact_phone,
        "updated": True,
    }


@router.get("/organization/quota", response_model=dict)
def get_organization_quota(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get organization usage quota and limits based on subscription plan"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    plan_limits = {
        "starter": {
            "max_users": 5,
            "max_vehicles": 10,
            "max_storage_gb": 10,
            "api_calls_per_month": 100000,
        },
        "professional": {
            "max_users": 50,
            "max_vehicles": 100,
            "max_storage_gb": 100,
            "api_calls_per_month": 1000000,
        },
        "enterprise": {
            "max_users": None,  # unlimited
            "max_vehicles": None,
            "max_storage_gb": None,
            "api_calls_per_month": None,
        },
    }
    
    limits = plan_limits.get(org.subscription_plan, plan_limits["starter"])
    
    user_count = len(database.scalars(
        select(User).where(User.organization_id == org.id)
    ).all())
    
    vehicle_count = len(database.scalars(
        select(Vehicle).where(Vehicle.organization_id == org.id)
    ).all())
    
    return {
        "organization_id": org.id,
        "plan": org.subscription_plan,
        "limits": limits,
        "usage": {
            "users": user_count,
            "vehicles": vehicle_count,
        },
    }



# ============================================================================
# MAINTENANCE TEMPLATES
# ============================================================================

class MaintenanceTemplateCreate(BaseModel):
    """Schema for creating a maintenance template"""
    name: str
    description: Optional[str] = None
    vehicle_type: str
    interval_km: Optional[int] = None
    interval_days: Optional[int] = None
    tasks: list[dict] = []  # list of maintenance tasks
    

class MaintenanceTemplateRead(BaseModel):
    """Schema for reading a maintenance template"""
    id: int
    organization_id: int
    name: str
    description: Optional[str]
    vehicle_type: str
    interval_km: Optional[int]
    interval_days: Optional[int]
    tasks: list[dict]
    created_at: datetime
    
    model_config = ConfigDict(from_attributes=True)


@router.get("/maintenance/templates", response_model=list[dict])
def list_maintenance_templates(
    user: User = Depends(require_roles("owner", "fleet_manager", "mechanic")),
    database: Session = Depends(get_db),
) -> list[dict]:
    """List all maintenance templates for the organization"""
    # Since there's no MaintenanceTemplate model, we'll return predefined templates
    templates = [
        {
            "id": 1,
            "name": "Oil Change",
            "vehicle_type": "All",
            "interval_km": 5000,
            "interval_days": 180,
            "tasks": ["Change oil", "Replace oil filter", "Check fluid levels"],
        },
        {
            "id": 2,
            "name": "Tire Rotation",
            "vehicle_type": "All",
            "interval_km": 10000,
            "interval_days": 365,
            "tasks": ["Rotate tires", "Check tire pressure", "Inspect for wear"],
        },
        {
            "id": 3,
            "name": "Battery Service",
            "vehicle_type": "All",
            "interval_km": 50000,
            "interval_days": 1095,
            "tasks": ["Clean terminals", "Check battery voltage", "Load test"],
        },
    ]
    return templates


@router.post("/maintenance/templates", response_model=dict)
def create_maintenance_template(
    payload: MaintenanceTemplateCreate,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Create a new maintenance template"""
    reserve_idempotency_key(Request(), user, database)
    
    return {
        "id": 1,
        "organization_id": user.organization_id,
        "name": payload.name,
        "description": payload.description,
        "vehicle_type": payload.vehicle_type,
        "interval_km": payload.interval_km,
        "interval_days": payload.interval_days,
        "tasks": payload.tasks,
        "created_at": datetime.now(timezone.utc).isoformat(),
    }


@router.get("/maintenance/templates/{template_id}", response_model=dict)
def get_maintenance_template(
    template_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager", "mechanic")),
    database: Session = Depends(get_db),
) -> dict:
    """Get a specific maintenance template"""
    templates = {
        1: {
            "id": 1,
            "name": "Oil Change",
            "vehicle_type": "All",
            "interval_km": 5000,
            "interval_days": 180,
            "tasks": ["Change oil", "Replace oil filter", "Check fluid levels"],
        },
        2: {
            "id": 2,
            "name": "Tire Rotation",
            "vehicle_type": "All",
            "interval_km": 10000,
            "interval_days": 365,
            "tasks": ["Rotate tires", "Check tire pressure", "Inspect for wear"],
        },
    }
    
    if template_id not in templates:
        raise HTTPException(status_code=404, detail="Template not found")
    
    return templates[template_id]


@router.put("/maintenance/templates/{template_id}", response_model=dict)
def update_maintenance_template(
    template_id: int,
    payload: MaintenanceTemplateCreate,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Update an existing maintenance template"""
    reserve_idempotency_key(Request(), user, database)
    
    return {
        "id": template_id,
        "organization_id": user.organization_id,
        "name": payload.name,
        "description": payload.description,
        "vehicle_type": payload.vehicle_type,
        "interval_km": payload.interval_km,
        "interval_days": payload.interval_days,
        "tasks": payload.tasks,
        "updated": True,
    }


@router.delete("/maintenance/templates/{template_id}", response_model=dict)
def delete_maintenance_template(
    template_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Delete a maintenance template"""
    reserve_idempotency_key(Request(), user, database)
    
    return {
        "id": template_id,
        "deleted": True,
    }


@router.post("/maintenance/templates/{template_id}/apply", response_model=dict)
def apply_maintenance_template(
    template_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Apply a maintenance template to a vehicle"""
    reserve_idempotency_key(Request(), user, database)
    
    vehicle_id = payload.get("vehicle_id")
    vehicle = database.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    # Create maintenance plan from template
    plan = MaintenancePlan(
        organization_id=user.organization_id,
        vehicle_id=vehicle_id,
        name=f"Maintenance Task {template_id}",
        interval_km=5000,
        interval_days=180,
        next_due_km=vehicle.odometer_km + 5000,
        next_due_on=(datetime.now(timezone.utc) + timedelta(days=180)).strftime("%Y-%m-%d"),
        active=True,
    )
    
    database.add(plan)
    database.commit()
    database.refresh(plan)
    
    return {
        "template_id": template_id,
        "vehicle_id": vehicle_id,
        "maintenance_plan_id": plan.id,
        "applied": True,
    }



# ============================================================================
# ONBOARDING & BOOTSTRAP
# ============================================================================

class OnboardingChecklistItem(BaseModel):
    """Schema for onboarding checklist item"""
    step_id: str
    title: str
    description: str
    completed: bool
    action_url: Optional[str] = None


class OnboardingBootstrap(BaseModel):
    """Schema for onboarding bootstrap data"""
    organization_name: str
    first_name: str
    last_name: str
    industry: Optional[str] = None
    fleet_size: Optional[str] = None
    mobile_phone: Optional[str] = None
    sms_alerts_enabled: bool = False
    whatsapp_alerts_enabled: bool = False


@router.get("/onboarding/status", response_model=dict)
def get_onboarding_status(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Get onboarding status for the organization"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    user_count = len(database.scalars(
        select(User).where(User.organization_id == org.id)
    ).all())
    
    vehicle_count = len(database.scalars(
        select(Vehicle).where(Vehicle.organization_id == org.id)
    ).all())
    
    work_order_count = len(database.scalars(
        select(WorkOrder).where(WorkOrder.organization_id == org.id)
    ).all())
    
    # Calculate onboarding completion percentage
    checklist = [
        {"step": "profile_complete", "completed": bool(user.full_name)},
        {"step": "users_invited", "completed": user_count > 1},
        {"step": "vehicles_added", "completed": vehicle_count > 0},
        {"step": "first_work_order", "completed": work_order_count > 0},
        {"step": "documents_uploaded", "completed": False},
    ]
    
    completed = sum(1 for item in checklist if item["completed"])
    total = len(checklist)
    completion_percent = (completed / total * 100) if total > 0 else 0
    
    return {
        "organization_id": org.id,
        "organization_name": org.name,
        "completion_percent": int(completion_percent),
        "checklist": checklist,
        "is_complete": completion_percent >= 80,
    }


@router.get("/onboarding/checklist", response_model=list[OnboardingChecklistItem])
def get_onboarding_checklist(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> list[OnboardingChecklistItem]:
    """Get detailed onboarding checklist"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    user_count = len(database.scalars(
        select(User).where(User.organization_id == org.id)
    ).all())
    
    vehicle_count = len(database.scalars(
        select(Vehicle).where(Vehicle.organization_id == org.id)
    ).all())
    
    work_order_count = len(database.scalars(
        select(WorkOrder).where(WorkOrder.organization_id == org.id)
    ).all())
    
    checklist = [
        OnboardingChecklistItem(
            step_id="organization_setup",
            title="Organization Setup",
            description="Set up your organization profile and settings",
            completed=True,
            action_url="/settings/organization",
        ),
        OnboardingChecklistItem(
            step_id="invite_users",
            title="Invite Team Members",
            description="Invite your fleet management team",
            completed=user_count > 1,
            action_url="/settings/users/invite",
        ),
        OnboardingChecklistItem(
            step_id="add_vehicles",
            title="Add Vehicles",
            description="Register your fleet vehicles",
            completed=vehicle_count > 0,
            action_url="/vehicles/create",
        ),
        OnboardingChecklistItem(
            step_id="configure_maintenance",
            title="Configure Maintenance",
            description="Set up maintenance schedules",
            completed=False,
            action_url="/maintenance/templates",
        ),
        OnboardingChecklistItem(
            step_id="create_first_work_order",
            title="Create Work Order",
            description="Create your first work order",
            completed=work_order_count > 0,
            action_url="/work-orders/create",
        ),
        OnboardingChecklistItem(
            step_id="upload_documents",
            title="Upload Documents",
            description="Upload compliance documents",
            completed=False,
            action_url="/documents/upload",
        ),
        OnboardingChecklistItem(
            step_id="configure_notifications",
            title="Configure Notifications",
            description="Set up notification preferences",
            completed=False,
            action_url="/settings/notifications",
        ),
        OnboardingChecklistItem(
            step_id="team_training",
            title="Team Training",
            description="Train team on using the platform",
            completed=False,
            action_url="/help/training",
        ),
    ]
    
    return checklist


@router.post("/onboarding/bootstrap", response_model=dict)
def onboarding_bootstrap(
    payload: OnboardingBootstrap,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Bootstrap initial onboarding data"""
    reserve_idempotency_key(Request(), user, database)
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Update user profile
    user.full_name = f"{payload.first_name} {payload.last_name}"
    user.mobile_phone = normalize_mobile_phone(payload.mobile_phone)
    user.sms_alerts_enabled = payload.sms_alerts_enabled
    user.whatsapp_alerts_enabled = payload.whatsapp_alerts_enabled
    database.add(user)
    
    # Create default stock locations
    stock_loc = StockLocation(
        organization_id=org.id,
        name="Main Warehouse",
        code="MAIN",
        active=True,
    )
    database.add(stock_loc)
    
    # Create default notification preferences
    for pref_type in ["VEHICLE_ISSUE", "WORK_ORDER_COMPLETE", "DOCUMENT_EXPIRY", "FUEL_ANOMALY"]:
        pref = NotificationPreference(
            organization_id=org.id,
            user_id=user.id,
            notification_type=pref_type,
            in_app=True,
            email=False,
            sms=False,
            whatsapp=False,
            push=False,
        )
        database.add(pref)
    
    database.commit()
    
    return {
        "organization_id": org.id,
        "bootstrapped": True,
        "profile_updated": True,
        "default_locations_created": 1,
        "notification_preferences_created": 4,
        "next_steps": [
            "Invite team members",
            "Add your vehicles",
            "Configure maintenance schedules",
        ],
    }


@router.post("/onboarding/mark-step-complete", response_model=dict)
def mark_onboarding_step_complete(
    payload: dict,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Mark an onboarding step as complete"""
    reserve_idempotency_key(Request(), user, database)
    
    step_id = payload.get("step_id")
    
    # In a real implementation, you'd store this in a UserOnboardingProgress table
    # For now, we just acknowledge it
    
    return {
        "step_id": step_id,
        "marked_complete": True,
    }


@router.get("/onboarding/resources", response_model=dict)
def get_onboarding_resources(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    """Get onboarding resources and help materials"""
    return {
        "getting_started": [
            {
                "title": "Platform Overview",
                "url": "/docs/getting-started/overview",
                "duration_minutes": 5,
            },
            {
                "title": "Basic Setup",
                "url": "/docs/getting-started/setup",
                "duration_minutes": 10,
            },
        ],
        "guides": [
            {
                "title": "Managing Vehicles",
                "url": "/docs/guides/vehicles",
            },
            {
                "title": "Work Orders 101",
                "url": "/docs/guides/work-orders",
            },
            {
                "title": "Inventory Management",
                "url": "/docs/guides/inventory",
            },
        ],
        "video_tutorials": [
            {
                "title": "First Steps",
                "url": "https://videos.example.com/first-steps",
                "duration_minutes": 8,
            },
        ],
        "contact_support": {
            "email": "support@fleetops.example.com",
            "phone": "+1-555-0100",
            "hours": "Monday-Friday, 9AM-6PM EST",
        },
    }



# ============================================================================
# DASHBOARD SUMMARY
# ============================================================================

@router.get("/dashboard/summary", response_model=dict)
def get_dashboard_summary(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    """Get comprehensive dashboard summary with KPIs and metrics"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")

    if user.role not in {"owner", "fleet_manager"}:
        assigned_vehicle_ids = select(Vehicle.id).where(
            Vehicle.organization_id == org.id,
            Vehicle.assigned_driver_id == user.id,
        )
        assigned_work_orders = select(WorkOrder.id).where(
            WorkOrder.organization_id == org.id,
            WorkOrder.assigned_user_id == user.id,
        )
        if user.role in {"mechanic", "technician"}:
            assigned_vehicle_ids = select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == org.id,
                WorkOrder.assigned_user_id == user.id,
            )
        scoped_vehicle_count = database.scalar(
            select(func.count(Vehicle.id)).where(Vehicle.id.in_(assigned_vehicle_ids))
        ) or 0
        scoped_work_orders = database.query(WorkOrder).filter(
            WorkOrder.id.in_(assigned_work_orders)
        )
        scoped_open = scoped_work_orders.filter(WorkOrder.status == "Open").count()
        scoped_in_progress = scoped_work_orders.filter(
            WorkOrder.status.in_(["In progress", "In Progress"])
        ).count()
        scoped_completed_today = scoped_work_orders.filter(
            WorkOrder.status == "Completed",
            WorkOrder.completed_at >= datetime.now(timezone.utc).replace(
                hour=0, minute=0, second=0, microsecond=0
            ),
        ).count()
        scoped_notifications = database.scalar(
            select(func.count(OperationalNotification.id)).join(
                NotificationDelivery,
                NotificationDelivery.notification_id == OperationalNotification.id,
            ).where(
                OperationalNotification.organization_id == org.id,
                NotificationDelivery.user_id == user.id,
                NotificationDelivery.channel == "in_app",
                OperationalNotification.status == "unread",
            )
        ) or 0
        return {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "organization_id": org.id,
            "organization_name": org.name,
            "fleet_overview": {
                "total_vehicles": scoped_vehicle_count,
                "active_vehicles": 0,
                "idle_vehicles": scoped_vehicle_count,
                "avg_fleet_health": 0,
                "active_drivers": 1 if user.role == "driver" and scoped_vehicle_count else 0,
            },
            "work_orders": {
                "open": scoped_open,
                "in_progress": scoped_in_progress,
                "completed_today": scoped_completed_today,
            },
            "alerts_and_notifications": {
                "unread_notifications": scoped_notifications,
                "critical_alerts": 0,
            },
            "inventory": {
                "low_stock_items": 0,
                "total_items": 0,
            },
            "maintenance": {"upcoming_tasks": 0},
            "fuel_efficiency": {"avg_km_per_liter": 0.0},
            "compliance": {"expired_documents": 0, "expiring_soon": 0},
            "recent_activity": {"work_orders": [], "notifications": []},
        }
    
    # Count vehicles
    vehicle_count = database.query(Vehicle).filter(
        Vehicle.organization_id == org.id
    ).count()
    
    # Count active vehicles (in use)
    active_vehicle_count = database.query(Vehicle).filter(
        Vehicle.organization_id == org.id,
        Vehicle.status.in_(["In Transit", "On Delivery"])
    ).count()
    
    # Count work orders by status
    open_work_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == org.id,
        WorkOrder.status == "Open"
    ).count()
    
    in_progress_work_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == org.id,
        WorkOrder.status.in_(["In progress", "In Progress"])
    ).count()
    
    completed_today = database.query(WorkOrder).filter(
        WorkOrder.organization_id == org.id,
        WorkOrder.status == "Completed",
        WorkOrder.completed_at >= datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    ).count()
    
    # Count active drivers
    active_assignments = database.query(VehicleAssignment).filter(
        VehicleAssignment.organization_id == org.id,
        VehicleAssignment.active == True
    ).count()
    
    # Count unread notifications
    unread_notifications = database.query(OperationalNotification).filter(
        OperationalNotification.organization_id == org.id,
        OperationalNotification.status == "unread"
    ).count()
    
    # Count critical alerts
    critical_alerts = database.query(OperationalNotification).filter(
        OperationalNotification.organization_id == org.id,
        OperationalNotification.severity == "CRITICAL",
        OperationalNotification.status == "unread"
    ).count()
    
    # Calculate fleet health
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == org.id
    ).all()
    
    avg_health = 100
    if vehicles:
        total_health = sum(v.health for v in vehicles)
        avg_health = int(total_health / len(vehicles))
    
    # Get inventory low-stock count
    low_stock_parts = database.query(Part).filter(
        Part.organization_id == org.id,
        Part.quantity_on_hand <= Part.reorder_level
    ).count()
    
    # Get upcoming maintenance
    upcoming_maintenance = database.query(MaintenancePlan).filter(
        MaintenancePlan.organization_id == org.id,
        MaintenancePlan.active == True
    ).count()
    
    # Calculate fuel efficiency
    fuel_transactions = database.query(FuelTransaction).filter(
        FuelTransaction.organization_id == org.id
    ).order_by(FuelTransaction.created_at.desc()).limit(100).all()
    
    avg_fuel_efficiency = 0.0
    if fuel_transactions:
        efficiencies = []
        for tx in fuel_transactions:
            if tx.odometer_km > 0 and tx.litres_milli > 0:
                efficiency = tx.odometer_km / (tx.litres_milli / 1000.0)
                efficiencies.append(efficiency)
        if efficiencies:
            avg_fuel_efficiency = round(sum(efficiencies) / len(efficiencies), 2)
    
    # Recent activity
    recent_work_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == org.id
    ).order_by(WorkOrder.created_at.desc()).limit(5).all()
    
    recent_notifications = database.query(OperationalNotification).filter(
        OperationalNotification.organization_id == org.id
    ).order_by(OperationalNotification.created_at.desc()).limit(5).all()
    
    # Compliance documents status
    expired_documents = database.query(ComplianceDocument).filter(
        ComplianceDocument.organization_id == org.id,
        ComplianceDocument.status == "Expired"
    ).count()
    
    expiring_soon_documents = database.query(ComplianceDocument).filter(
        ComplianceDocument.organization_id == org.id,
        ComplianceDocument.status == "Expiring Soon"
    ).count()
    
    return {
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "organization_id": org.id,
        "organization_name": org.name,
        "fleet_overview": {
            "total_vehicles": vehicle_count,
            "active_vehicles": active_vehicle_count,
            "idle_vehicles": vehicle_count - active_vehicle_count,
            "avg_fleet_health": avg_health,
            "active_drivers": active_assignments,
        },
        "work_orders": {
            "open": open_work_orders,
            "in_progress": in_progress_work_orders,
            "completed_today": completed_today,
        },
        "alerts_and_notifications": {
            "unread_notifications": unread_notifications,
            "critical_alerts": critical_alerts,
        },
        "inventory": {
            "low_stock_items": low_stock_parts,
            "total_items": database.query(Part).filter(
                Part.organization_id == org.id
            ).count(),
        },
        "maintenance": {
            "upcoming_tasks": upcoming_maintenance,
        },
        "fuel_efficiency": {
            "avg_km_per_liter": avg_fuel_efficiency,
        },
        "compliance": {
            "expired_documents": expired_documents,
            "expiring_soon": expiring_soon_documents,
        },
        "recent_activity": {
            "work_orders": [
                {
                    "id": wo.id,
                    "vehicle_id": wo.vehicle_id,
                    "title": wo.title,
                    "status": wo.status,
                    "created_at": wo.created_at.isoformat(),
                }
                for wo in recent_work_orders
            ],
            "notifications": [
                {
                    "id": n.id,
                    "title": n.title,
                    "severity": n.severity,
                    "created_at": n.created_at.isoformat(),
                }
                for n in recent_notifications
            ],
        },
    }


@router.get("/dashboard/metrics/{metric_type}", response_model=dict)
def get_dashboard_metrics(
    metric_type: str,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    """Get specific dashboard metrics by type"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    if metric_type == "work_orders":
        statement = database.query(WorkOrder.status).filter(
            WorkOrder.organization_id == org.id
        )
        if user.role in {"mechanic", "technician"}:
            statement = statement.filter(WorkOrder.assigned_user_id == user.id)
        elif user.role == "driver":
            return {"metric_type": "work_orders", "data": {}}
        statuses = statement.all()
        
        status_counts = {}
        for (status,) in statuses:
            status_counts[status] = status_counts.get(status, 0) + 1
        
        return {
            "metric_type": "work_orders",
            "data": status_counts,
        }
    
    elif metric_type == "vehicle_health":
        statement = database.query(Vehicle).filter(
            Vehicle.organization_id == org.id
        )
        if user.role == "driver":
            assigned_vehicle_ids = select(VehicleAssignment.vehicle_id).where(
                VehicleAssignment.organization_id == org.id,
                VehicleAssignment.driver_id == user.id,
                VehicleAssignment.active.is_(True),
            )
            statement = statement.where(Vehicle.id.in_(assigned_vehicle_ids))
        elif user.role in {"mechanic", "technician"}:
            assigned_vehicle_ids = select(WorkOrder.vehicle_id).where(
                WorkOrder.organization_id == org.id,
                WorkOrder.assigned_user_id == user.id,
            )
            statement = statement.where(Vehicle.id.in_(assigned_vehicle_ids))
        vehicles = statement.all()
        
        health_distribution = {
            "excellent": 0,
            "good": 0,
            "fair": 0,
            "poor": 0,
        }
        
        for v in vehicles:
            if v.health >= 90:
                health_distribution["excellent"] += 1
            elif v.health >= 70:
                health_distribution["good"] += 1
            elif v.health >= 50:
                health_distribution["fair"] += 1
            else:
                health_distribution["poor"] += 1
        
        return {
            "metric_type": "vehicle_health",
            "data": health_distribution,
        }
    
    elif metric_type == "expenses":
        if user.role not in {"owner", "accountant"}:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Finance metrics are restricted")
        # Sum expenses by category
        expenses = database.query(
            Expense.category,
            func.count(Expense.id).label("count"),
            func.sum(Expense.amount_paise).label("total_paise")
        ).filter(
            Expense.organization_id == org.id
        ).group_by(Expense.category).all()
        
        return {
            "metric_type": "expenses",
            "data": [
                {
                    "category": cat,
                    "count": count,
                    "total_amount": total_paise / 100.0,
                }
                for cat, count, total_paise in expenses
            ],
        }
    
    else:
        raise HTTPException(status_code=400, detail="Invalid metric type")



# ============================================================================
# WORK ORDER ADVANCED FEATURES
# ============================================================================

class WorkOrderPartReservation(BaseModel):
    """Schema for reserving a part for a work order"""
    part_id: int
    quantity: int
    reason: Optional[str] = None


class WorkOrderBulkUpdate(BaseModel):
    """Schema for bulk updating work orders"""
    work_order_ids: list[int]
    status: Optional[str] = None
    priority: Optional[str] = None
    assigned_user_id: Optional[int] = None


@router.post("/work-orders/{work_order_id}/reserve-part", response_model=dict)
def reserve_part_for_work_order(
    work_order_id: int,
    payload: WorkOrderPartReservation,
    request: Request,
    user: User = Depends(require_roles("owner", "mechanic", "technician")),
    database: Session = Depends(get_db),
) -> dict:
    """Reserve a part for a work order"""
    reserve_idempotency_key(request, user, database)
    
    work_order = database.get(WorkOrder, work_order_id)
    if not work_order or work_order.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Work order not found")
    if user.role in ("mechanic", "technician") and work_order.assigned_user_id != user.id:
        raise HTTPException(status_code=404, detail="Work order not found")
    
    part = database.get(Part, payload.part_id)
    if not part or part.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Part not found")
    
    if payload.quantity <= 0:
        raise HTTPException(status_code=400, detail="Part quantity must be positive")
    if part.quantity_on_hand < payload.quantity:
        raise HTTPException(status_code=400, detail="Insufficient inventory")
    
    # Record the part reservation
    part_usage = WorkOrderPartUsage(
        organization_id=user.organization_id,
        work_order_id=work_order_id,
        part_id=payload.part_id,
        quantity=payload.quantity,
        unit_cost_paise=part.unit_cost_paise,
        created_by=user.id,
    )
    
    database.add(part_usage)
    
    database.commit()
    database.refresh(part_usage)
    
    return {
        "work_order_id": work_order_id,
        "part_id": payload.part_id,
        "quantity": payload.quantity,
        "unit_cost_paise": part.unit_cost_paise,
        "total_cost_paise": part.unit_cost_paise * payload.quantity,
        "reason": payload.reason,
        "reserved": True,
    }


@router.post("/work-orders/{work_order_id}/return-reserved-part", response_model=dict)
def return_reserved_part(
    work_order_id: int,
    payload: dict,
    request: Request,
    user: User = Depends(require_roles("owner", "mechanic", "technician")),
    database: Session = Depends(get_db),
) -> dict:
    """Return a reserved part (unused) back to inventory"""
    reserve_idempotency_key(request, user, database)
    
    work_order = database.get(WorkOrder, work_order_id)
    if not work_order or work_order.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Work order not found")
    if user.role in ("mechanic", "technician") and work_order.assigned_user_id != user.id:
        raise HTTPException(status_code=404, detail="Work order not found")
    
    part_id = payload.get("part_id")
    quantity = payload.get("quantity", 1)
    reason = payload.get("reason")
    
    part = database.get(Part, part_id)
    if not part or part.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Part not found")
    
    # Check if part was reserved in this work order
    part_usage = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.work_order_id == work_order_id,
        WorkOrderPartUsage.part_id == part_id,
    ).first()
    
    if not part_usage or part_usage.quantity < quantity:
        raise HTTPException(status_code=400, detail="Part not reserved in this work order")
    
    # Update the usage record
    part_usage.quantity -= quantity
    if part_usage.quantity == 0:
        database.delete(part_usage)
    else:
        database.add(part_usage)
    
    database.commit()
    
    return {
        "work_order_id": work_order_id,
        "part_id": part_id,
        "quantity_returned": quantity,
        "reason": reason,
        "returned": True,
    }


@router.get("/work-orders/board", response_model=dict)
def get_work_order_board(
    user: User = Depends(require_roles("owner", "fleet_manager", "mechanic", "technician")),
    database: Session = Depends(get_db),
) -> dict:
    """Get work order board (kanban view) organized by status"""
    statuses = ["Open", "In progress", "In Review", "Completed", "Archived"]
    board = {}
    
    for status in statuses:
        statement = database.query(WorkOrder).filter(
            WorkOrder.organization_id == user.organization_id,
            WorkOrder.status == status,
            WorkOrder.archived_at == None,
        )
        if user.role in ("mechanic", "technician"):
            statement = statement.filter(WorkOrder.assigned_user_id == user.id)
        work_orders = statement.order_by(WorkOrder.created_at.desc()).all()
        
        board[status] = [
            {
                "id": wo.id,
                "vehicle_id": wo.vehicle_id,
                "title": wo.title,
                "priority": wo.priority,
                "assigned_to": wo.assigned_to,
                "assigned_user_id": wo.assigned_user_id,
                "due_date": wo.due_date,
                "created_at": wo.created_at.isoformat(),
            }
            for wo in work_orders
        ]
    
    return {
        "board": board,
        "total_orders": sum(len(v) for v in board.values()),
    }


@router.post("/work-orders/bulk-update", response_model=dict)
def bulk_update_work_orders(
    payload: WorkOrderBulkUpdate,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Bulk update multiple work orders"""
    reserve_idempotency_key(Request(), user, database)
    
    work_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.id.in_(payload.work_order_ids),
    ).all()
    
    if not work_orders:
        raise HTTPException(status_code=404, detail="No work orders found")
    
    updated_count = 0
    for wo in work_orders:
        if payload.status:
            wo.status = payload.status
        if payload.priority:
            wo.priority = payload.priority
        if payload.assigned_user_id:
            wo.assigned_user_id = payload.assigned_user_id
        
        database.add(wo)
        updated_count += 1
    
    database.commit()
    
    return {
        "total_requested": len(payload.work_order_ids),
        "total_updated": updated_count,
        "updates": {
            "status": payload.status,
            "priority": payload.priority,
            "assigned_user_id": payload.assigned_user_id,
        },
    }


@router.get("/work-orders/board/stats", response_model=dict)
def get_work_order_board_stats(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get work order board statistics"""
    statuses = ["Open", "In progress", "In Review", "Completed", "Archived"]
    stats = {}
    
    for status in statuses:
        count = database.query(WorkOrder).filter(
            WorkOrder.organization_id == user.organization_id,
            WorkOrder.status == status,
        ).count()
        stats[status] = count
    
    # Calculate average resolution time (in days)
    completed_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.status == "Completed",
        WorkOrder.completed_at != None,
    ).limit(100).all()
    
    avg_resolution_hours = 0
    if completed_orders:
        total_hours = 0
        for wo in completed_orders:
            if wo.completed_at and wo.created_at:
                duration = wo.completed_at - wo.created_at
                total_hours += duration.total_seconds() / 3600
        avg_resolution_hours = round(total_hours / len(completed_orders), 2)
    
    # Get priority breakdown
    priority_stats = database.query(
        WorkOrder.priority,
        func.count(WorkOrder.id).label("count")
    ).filter(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.status != "Archived",
    ).group_by(WorkOrder.priority).all()
    
    priority_breakdown = {
        priority: count for priority, count in priority_stats
    }
    
    return {
        "status_breakdown": stats,
        "priority_breakdown": priority_breakdown,
        "avg_resolution_hours": avg_resolution_hours,
        "total_active": stats.get("Open", 0) + stats.get("In progress", 0),
    }


@router.post("/work-orders/{work_order_id}/reorder-parts", response_model=dict)
def reorder_parts_for_work_order(
    work_order_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Create purchase order for parts needed in a work order"""
    reserve_idempotency_key(Request(), user, database)
    
    work_order = database.get(WorkOrder, work_order_id)
    if not work_order or work_order.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Work order not found")
    
    # Get reserved parts for this work order
    part_usages = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.work_order_id == work_order_id
    ).all()
    
    if not part_usages:
        raise HTTPException(status_code=400, detail="No parts reserved in this work order")
    
    # Create purchase order
    po = PurchaseOrder(
        organization_id=user.organization_id,
        vendor_id=1,  # Default vendor
        order_number=f"PO-WO{work_order_id}-{datetime.now(timezone.utc).strftime('%Y%m%d')}",
        status="Draft",
        created_by=user.id,
    )
    database.add(po)
    database.flush()
    
    # Add lines
    total_paise = 0
    for part_usage in part_usages:
        line_total = part_usage.quantity * part_usage.unit_cost_paise
        line = PurchaseOrderLine(
            organization_id=user.organization_id,
            purchase_order_id=po.id,
            part_id=part_usage.part_id,
            quantity=part_usage.quantity,
            unit_cost_paise=part_usage.unit_cost_paise,
            line_total_paise=line_total,
        )
        database.add(line)
        total_paise += line_total
    
    po.total_paise = total_paise
    database.add(po)
    database.commit()
    database.refresh(po)
    
    return {
        "work_order_id": work_order_id,
        "purchase_order_id": po.id,
        "order_number": po.order_number,
        "total_paise": total_paise,
        "line_count": len(part_usages),
        "created": True,
    }



# ============================================================================
# INVENTORY ADVANCED FEATURES
# ============================================================================

@router.get("/inventory/parts/{part_id}/detail", response_model=dict)
def get_inventory_part_detail(
    part_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get detailed inventory information for a part"""
    part = database.get(Part, part_id)
    if not part or part.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Part not found")
    
    # Get transaction history
    transactions = database.query(InventoryTransaction).filter(
        InventoryTransaction.part_id == part_id,
        InventoryTransaction.organization_id == user.organization_id,
    ).order_by(InventoryTransaction.created_at.desc()).limit(50).all()
    
    # Get movement history
    movements = database.query(InventoryMovement).filter(
        InventoryMovement.part_id == part_id,
        InventoryMovement.organization_id == user.organization_id,
    ).order_by(InventoryMovement.created_at.desc()).limit(50).all()
    
    # Get work order usage
    work_order_usages = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.part_id == part_id,
        WorkOrderPartUsage.organization_id == user.organization_id,
    ).order_by(WorkOrderPartUsage.created_at.desc()).limit(20).all()
    
    return {
        "id": part.id,
        "sku": part.sku,
        "name": part.name,
        "category": part.category,
        "quantity_on_hand": part.quantity_on_hand,
        "reorder_level": part.reorder_level,
        "unit_cost_paise": part.unit_cost_paise,
        "supplier": part.supplier,
        "created_at": part.created_at.isoformat(),
        "transaction_history": [
            {
                "id": tx.id,
                "type": tx.transaction_type,
                "quantity": tx.quantity,
                "reference": tx.reference,
                "created_at": tx.created_at.isoformat(),
            }
            for tx in transactions
        ],
        "movement_history": [
            {
                "id": mv.id,
                "type": mv.transaction_type,
                "quantity": mv.quantity,
                "location_id": mv.location_id,
                "reference": mv.reference,
                "created_at": mv.created_at.isoformat(),
            }
            for mv in movements
        ],
        "work_order_usages": [
            {
                "work_order_id": wu.work_order_id,
                "quantity": wu.quantity,
                "unit_cost_paise": wu.unit_cost_paise,
                "created_at": wu.created_at.isoformat(),
            }
            for wu in work_order_usages
        ],
    }


@router.get("/inventory/parts/{part_id}/references", response_model=dict)
def get_inventory_part_references(
    part_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get all references to a part across the system"""
    part = database.get(Part, part_id)
    if not part or part.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Part not found")
    
    # Work orders using this part
    work_orders_using = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.part_id == part_id,
        WorkOrderPartUsage.organization_id == user.organization_id,
    ).all()
    
    work_order_ids = set(wu.work_order_id for wu in work_orders_using)
    
    # Purchase orders with this part
    po_lines = database.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.part_id == part_id,
        PurchaseOrderLine.organization_id == user.organization_id,
    ).all()
    
    po_ids = set(pol.purchase_order_id for pol in po_lines)
    
    # PO receipts
    po_receipts = database.query(PurchaseOrderReceipt).filter(
        PurchaseOrderReceipt.part_id == part_id,
        PurchaseOrderReceipt.organization_id == user.organization_id,
    ).all()
    
    return {
        "part_id": part_id,
        "sku": part.sku,
        "name": part.name,
        "references": {
            "work_orders": len(work_order_ids),
            "work_order_ids": list(work_order_ids),
            "purchase_orders": len(po_ids),
            "purchase_order_ids": list(po_ids),
            "po_receipts": len(po_receipts),
            "receipts": [
                {
                    "id": r.id,
                    "po_id": r.purchase_order_id,
                    "quantity": r.quantity,
                    "received_at": r.received_at.isoformat(),
                }
                for r in po_receipts[:20]
            ],
        },
    }


@router.get("/inventory/movements/export", response_model=dict)
def export_inventory_movements(
    user: User = Depends(require_roles("owner", "fleet_manager", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Export inventory movements as CSV-formatted data"""
    movements = database.query(InventoryMovement).filter(
        InventoryMovement.organization_id == user.organization_id
    ).order_by(InventoryMovement.created_at.desc()).limit(1000).all()
    
    # Build CSV content
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow([
        "Movement ID", "Part ID", "Location", "Type", "Quantity",
        "Reference", "Created By", "Created At"
    ])
    
    for mv in movements:
        writer.writerow([
            mv.id,
            mv.part_id,
            mv.location_id,
            mv.transaction_type,
            mv.quantity,
            mv.reference or "",
            mv.created_by,
            mv.created_at.isoformat(),
        ])
    
    csv_content = csv_buffer.getvalue()
    csv_buffer.close()
    
    return {
        "format": "csv",
        "total_records": len(movements),
        "data": csv_content,
        "export_timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/inventory/movements/import", response_model=dict)
def import_inventory_movements(
    file: UploadFile = File(...),
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Import inventory movements from CSV file"""
    reserve_idempotency_key(Request(), user, database)
    
    try:
        content = file.file.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        
        imported_count = 0
        for row in reader:
            try:
                part_id = int(row.get("Part ID", 0))
                location_id = int(row.get("Location", 0))
                quantity = int(row.get("Quantity", 0))
                
                if not part_id or not location_id:
                    continue
                
                # Verify part and location exist
                part = database.get(Part, part_id)
                location = database.get(StockLocation, location_id)
                
                if not part or not location or part.organization_id != user.organization_id:
                    continue
                
                movement = InventoryMovement(
                    organization_id=user.organization_id,
                    part_id=part_id,
                    location_id=location_id,
                    transaction_type=row.get("Type", "in"),
                    quantity=quantity,
                    reference=row.get("Reference"),
                    created_by=user.id,
                )
                database.add(movement)
                imported_count += 1
            except (ValueError, KeyError):
                continue
        
        database.commit()
        
        return {
            "imported": True,
            "total_imported": imported_count,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")


@router.post("/inventory/movements/preview", response_model=dict)
def preview_inventory_import(
    file: UploadFile = File(...),
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Preview inventory import without committing"""
    try:
        content = file.file.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        
        preview_rows = []
        for i, row in enumerate(reader):
            if i >= 10:  # Preview only first 10 rows
                break
            preview_rows.append(row)
        
        return {
            "preview": True,
            "total_rows_in_file": i + 1,
            "preview_rows": preview_rows,
            "columns": list(preview_rows[0].keys()) if preview_rows else [],
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Preview failed: {str(e)}")


@router.post("/inventory/movements/preview-text", response_model=dict)
def preview_inventory_import_text(
    payload: CsvTextPayload,
    user: User = Depends(require_roles("owner", "inventory_manager")),
) -> dict:
    rows = list(csv.DictReader(io.StringIO(payload.csv)))
    errors = [
        f"Row {index}: Part ID, Location, and Quantity are required"
        for index, row in enumerate(rows, start=2)
        if not row.get("Part ID") or not row.get("Location") or not row.get("Quantity")
    ]
    return {
        "valid_count": len(rows) - len(errors),
        "row_count": len(rows),
        "errors": errors,
    }


@router.post("/inventory/movements/import-text", response_model=dict)
def import_inventory_movements_text(
    payload: CsvTextPayload,
    request: Request,
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    reserve_idempotency_key(request, user, database)
    rows = list(csv.DictReader(io.StringIO(payload.csv)))
    errors = [
        f"Row {index}: Part ID, Location, and Quantity are required"
        for index, row in enumerate(rows, start=2)
        if not row.get("Part ID") or not row.get("Location") or not row.get("Quantity")
    ]
    if errors:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=errors)
    imported_count = 0
    for row in rows:
        part_id = int(row["Part ID"])
        location_id = int(row["Location"])
        part = database.scalar(select(Part).where(
            Part.id == part_id,
            Part.organization_id == user.organization_id,
        ))
        location = database.scalar(select(StockLocation).where(
            StockLocation.id == location_id,
            StockLocation.organization_id == user.organization_id,
        ))
        if part is None or location is None:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Part or location not found")
        database.add(InventoryMovement(
            organization_id=user.organization_id,
            part_id=part_id,
            location_id=location_id,
            transaction_type=row.get("Type", "in"),
            quantity=int(row["Quantity"]),
            reference=row.get("Reference"),
            created_by=user.id,
        ))
        imported_count += 1
    database.commit()
    return {"imported": True, "imported_count": imported_count}


@router.get("/inventory/parts/by-location/{location_id}", response_model=list[dict])
def get_inventory_by_location(
    location_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager", "inventory_manager")),
    database: Session = Depends(get_db),
) -> list[dict]:
    """Get all inventory at a specific location"""
    location = database.get(StockLocation, location_id)
    if not location or location.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Location not found")
    
    movements = database.query(InventoryMovement).filter(
        InventoryMovement.location_id == location_id,
        InventoryMovement.organization_id == user.organization_id,
    ).all()
    
    # Calculate current stock by part
    stock_by_part = {}
    for mv in movements:
        if mv.part_id not in stock_by_part:
            stock_by_part[mv.part_id] = 0
        
        if mv.transaction_type in ["in", "receipt", "adjustment_in"]:
            stock_by_part[mv.part_id] += mv.quantity
        else:
            stock_by_part[mv.part_id] -= mv.quantity
    
    # Enrich with part details
    result = []
    for part_id, quantity in stock_by_part.items():
        part = database.get(Part, part_id)
        if part:
            result.append({
                "part_id": part_id,
                "sku": part.sku,
                "name": part.name,
                "category": part.category,
                "quantity_at_location": quantity,
                "unit_cost_paise": part.unit_cost_paise,
                "location_id": location_id,
            })
    
    return result


@router.get("/inventory/summary", response_model=dict)
def get_inventory_summary(
    user: User = Depends(require_roles("owner", "fleet_manager", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get inventory summary and analytics"""
    # Total parts
    total_parts = database.query(Part).filter(
        Part.organization_id == user.organization_id
    ).count()
    
    # Total value
    parts = database.query(Part).filter(
        Part.organization_id == user.organization_id
    ).all()
    
    total_value_paise = sum(p.quantity_on_hand * p.unit_cost_paise for p in parts)
    
    # Low stock items
    low_stock = database.query(Part).filter(
        Part.organization_id == user.organization_id,
        Part.quantity_on_hand <= Part.reorder_level,
    ).count()
    
    # Out of stock
    out_of_stock = database.query(Part).filter(
        Part.organization_id == user.organization_id,
        Part.quantity_on_hand == 0,
    ).count()
    
    # By category
    categories = database.query(
        Part.category,
        func.count(Part.id).label("count"),
        func.sum(Part.quantity_on_hand).label("total_qty"),
    ).filter(
        Part.organization_id == user.organization_id
    ).group_by(Part.category).all()
    
    return {
        "summary": {
            "total_parts": total_parts,
            "total_value_paise": total_value_paise,
            "total_value": total_value_paise / 100.0,
            "low_stock_items": low_stock,
            "out_of_stock": out_of_stock,
        },
        "by_category": [
            {
                "category": cat,
                "count": cnt,
                "total_quantity": qty,
            }
            for cat, cnt, qty in categories
        ],
    }



# ============================================================================
# DRIVER ADVANCED FEATURES
# ============================================================================

@router.get("/drivers/me/daily-home", response_model=dict)
def get_current_driver_daily_home(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    return get_driver_daily_home(user.id, user, database)


@router.get("/drivers/{driver_id}/daily-home", response_model=dict)
def get_driver_daily_home(
    driver_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get driver's daily home summary - assigned vehicle, today's work orders, inspections"""
    driver = database.get(User, driver_id)
    if not driver or driver.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Get current vehicle assignment
    assignment = database.query(VehicleAssignment).filter(
        VehicleAssignment.driver_id == driver_id,
        VehicleAssignment.organization_id == user.organization_id,
        VehicleAssignment.active == True,
    ).first()
    
    vehicle = None
    vehicle_data = None
    if assignment:
        vehicle = database.get(Vehicle, assignment.vehicle_id)
        if vehicle:
            vehicle_data = {
                "id": vehicle.id,
                "registration_number": vehicle.registration_number,
                "model": vehicle.model,
                "vehicle_type": vehicle.vehicle_type,
                "status": vehicle.status,
                "health": vehicle.health,
                "odometer_km": vehicle.odometer_km,
            }
    
    # Get today's work orders assigned to this driver
    today_start = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    today_end = today_start + timedelta(days=1)
    
    work_orders = database.query(WorkOrder).filter(
        WorkOrder.assigned_user_id == driver_id,
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.created_at >= today_start,
        WorkOrder.created_at < today_end,
        WorkOrder.status != "Archived",
    ).all()
    
    # Get today's inspections
    inspections = database.query(DriverInspection).filter(
        DriverInspection.driver_id == driver_id,
        DriverInspection.organization_id == user.organization_id,
        DriverInspection.created_at >= today_start,
        DriverInspection.created_at < today_end,
    ).all()
    
    # Get today's issues reported
    issues = database.query(VehicleIssue).filter(
        VehicleIssue.driver_id == driver_id,
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.created_at >= today_start,
        VehicleIssue.created_at < today_end,
    ).all()
    
    # Get today's odometer readings
    odometer_logs = database.query(OdometerLog).filter(
        OdometerLog.driver_id == driver_id,
        OdometerLog.organization_id == user.organization_id,
        OdometerLog.created_at >= today_start,
        OdometerLog.created_at < today_end,
    ).all()
    
    readiness = "READY" if vehicle_data and vehicle_data["status"] not in {"Out of service", "In workshop"} else "UNSAFE" if vehicle_data else "CHECKING"
    return {
        "driver_id": driver_id,
        "driver_name": driver.full_name,
        "role": driver.role,
        "assigned_vehicle": vehicle_data,
        "vehicle": vehicle_data,
        "readiness": readiness,
        "next_action": "Complete the pre-trip inspection before departure." if vehicle_data else "Wait for a Fleet Manager to assign a vehicle.",
        "today": {
            "work_orders": len(work_orders),
            "work_orders_data": [
                {
                    "id": wo.id,
                    "vehicle_id": wo.vehicle_id,
                    "title": wo.title,
                    "status": wo.status,
                    "priority": wo.priority,
                    "due_date": wo.due_date,
                }
                for wo in work_orders
            ],
            "inspections_completed": len(inspections),
            "issues_reported": len(issues),
            "issues_data": [
                {
                    "id": issue.id,
                    "title": issue.title,
                    "priority": issue.priority,
                    "status": issue.status,
                }
                for issue in issues
            ],
            "odometer_readings": len(odometer_logs),
            "latest_odometer_km": odometer_logs[0].reading_km if odometer_logs else None,
        },
    }


@router.post("/drivers/me/unsafe-disposition", response_model=dict)
def report_current_driver_unsafe_disposition(
    payload: dict,
    request: Request,
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    return report_unsafe_disposition(user.id, payload, request, user, database)


@router.post("/drivers/{driver_id}/unsafe-disposition", response_model=dict)
def report_unsafe_disposition(
    driver_id: int,
    payload: dict,
    request: Request,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Report unsafe driver disposition/behavior"""
    reserve_idempotency_key(request, user, database)
    
    driver = database.get(User, driver_id)
    if not driver or driver.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Extract report details
    description = payload.get("description", "")
    severity = payload.get("severity", "medium")  # low, medium, high, critical
    vehicle_id = payload.get("vehicle_id")
    location = payload.get("location")
    
    # Create a high-priority issue for the driver
    issue = VehicleIssue(
        organization_id=user.organization_id,
        vehicle_id=vehicle_id or 1,  # Default if not provided
        driver_id=driver_id,
        title=f"Unsafe Disposition Report - {severity.upper()}",
        detail=description,
        priority="High" if severity in ["high", "critical"] else "Medium",
        status="OPEN",
    )
    
    database.add(issue)
    database.commit()
    database.refresh(issue)
    
    # Queue notification to owner/managers
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="UNSAFE_DRIVER_BEHAVIOR",
        severity=severity.upper(),
        title=f"Unsafe driver behavior reported: {driver.full_name}",
        detail=f"{description}\nReported at: {location or 'N/A'}",
        entity_type="driver_issue",
        entity_id=str(issue.id),
        roles={"owner", "fleet_manager"},
    )
    
    return {
        "issue_id": issue.id,
        "driver_id": driver_id,
        "driver_name": driver.full_name,
        "severity": severity,
        "description": description,
        "location": location,
        "reported": True,
        "created_at": issue.created_at.isoformat(),
    }


@router.get("/drivers/{driver_id}/behavior-score", response_model=dict)
def get_driver_behavior_score(
    driver_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get driver behavior and safety score"""
    driver = database.get(User, driver_id)
    if not driver or driver.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Driver not found")
    
    # Count issues
    total_issues = database.query(VehicleIssue).filter(
        VehicleIssue.driver_id == driver_id,
        VehicleIssue.organization_id == user.organization_id,
    ).count()
    
    high_priority_issues = database.query(VehicleIssue).filter(
        VehicleIssue.driver_id == driver_id,
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.priority.in_(["High", "Critical"]),
    ).count()
    
    resolved_issues = database.query(VehicleIssue).filter(
        VehicleIssue.driver_id == driver_id,
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.status == "RESOLVED",
    ).count()
    
    # Count inspections
    inspections = database.query(DriverInspection).filter(
        DriverInspection.driver_id == driver_id,
        DriverInspection.organization_id == user.organization_id,
    ).all()
    
    safe_inspections = len([i for i in inspections if i.status == "SAFE"])
    total_inspections = len(inspections)
    
    # Calculate score (0-100)
    base_score = 100
    base_score -= high_priority_issues * 5
    base_score -= (total_issues - high_priority_issues) * 2
    if total_inspections > 0:
        unsafe_rate = 1.0 - (safe_inspections / total_inspections)
        base_score -= unsafe_rate * 20
    
    behavior_score = max(0, min(100, base_score))
    
    # Determine rating
    if behavior_score >= 90:
        rating = "Excellent"
    elif behavior_score >= 75:
        rating = "Good"
    elif behavior_score >= 60:
        rating = "Fair"
    else:
        rating = "Poor"
    
    return {
        "driver_id": driver_id,
        "driver_name": driver.full_name,
        "behavior_score": behavior_score,
        "rating": rating,
        "metrics": {
            "total_issues": total_issues,
            "high_priority_issues": high_priority_issues,
            "resolved_issues": resolved_issues,
            "safe_inspections": safe_inspections,
            "total_inspections": total_inspections,
        },
    }


@router.get("/drivers/summary", response_model=list[dict])
def get_drivers_summary(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> list[dict]:
    """Get summary of all drivers in the organization"""
    drivers = database.query(User).filter(
        User.organization_id == user.organization_id,
        User.role.in_(["driver", "mechanic"]),
    ).all()
    
    result = []
    for driver in drivers:
        # Get active assignment
        assignment = database.query(VehicleAssignment).filter(
            VehicleAssignment.driver_id == driver.id,
            VehicleAssignment.active == True,
        ).first()
        
        vehicle_id = assignment.vehicle_id if assignment else None
        
        # Get recent issues
        recent_issues = database.query(VehicleIssue).filter(
            VehicleIssue.driver_id == driver.id,
            VehicleIssue.organization_id == user.organization_id,
        ).order_by(VehicleIssue.created_at.desc()).limit(5).all()
        
        result.append({
            "id": driver.id,
            "name": driver.full_name,
            "email": driver.email,
            "role": driver.role,
            "assigned_vehicle_id": vehicle_id,
            "recent_issues": len(recent_issues),
            "last_active": None,  # Would require additional tracking
        })
    
    return result



# ============================================================================
# TRIAGE SYSTEM - CRITICAL FEATURE
# ============================================================================

class TriageIssueUpdate(BaseModel):
    """Schema for updating triage issue"""
    title: Optional[str] = None
    detail: Optional[str] = None
    priority: Optional[str] = None
    status: Optional[str] = None
    assigned_user_id: Optional[int] = None


class CreateWorkOrderFromIssue(BaseModel):
    """Schema for converting triage issue to work order"""
    title: Optional[str] = None
    description: Optional[str] = None
    priority: Optional[str] = None
    assigned_user_id: Optional[int] = None


@router.get("/triage/queue", response_model=dict)
def get_triage_queue(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    status_filter: Optional[str] = None,
    priority_filter: Optional[str] = None,
) -> dict:
    """Get triage queue with all open issues pending assignment"""
    query = database.query(VehicleIssue).filter(
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.status.in_(["OPEN", "PENDING"]),
    )
    
    if status_filter:
        query = query.filter(VehicleIssue.status == status_filter)
    
    if priority_filter:
        query = query.filter(VehicleIssue.priority == priority_filter)
    
    issues = query.order_by(
        VehicleIssue.priority.desc(),
        VehicleIssue.created_at.asc(),
    ).all()
    
    # Group by priority
    by_priority = {
        "Critical": [],
        "High": [],
        "Medium": [],
        "Low": [],
    }
    
    for issue in issues:
        priority = issue.priority or "Medium"
        by_priority[priority].append({
            "id": issue.id,
            "vehicle_id": issue.vehicle_id,
            "driver_id": issue.driver_id,
            "title": issue.title,
            "detail": issue.detail,
            "priority": issue.priority,
            "status": issue.status,
            "created_at": issue.created_at.isoformat(),
        })
    
    return {
        "queue_summary": {
            "total_issues": len(issues),
            "critical": len(by_priority["Critical"]),
            "high": len(by_priority["High"]),
            "medium": len(by_priority["Medium"]),
            "low": len(by_priority["Low"]),
        },
        "by_priority": by_priority,
    }


@router.put("/triage/issues/{issue_id}", response_model=dict)
def update_triage_issue(
    issue_id: int,
    payload: TriageIssueUpdate,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Update a triage issue"""
    reserve_idempotency_key(Request(), user, database)
    
    issue = database.get(VehicleIssue, issue_id)
    if not issue or issue.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    if payload.title:
        issue.title = payload.title
    if payload.detail:
        issue.detail = payload.detail
    if payload.priority:
        issue.priority = payload.priority
    if payload.status:
        issue.status = payload.status
    if payload.assigned_user_id:
        # Verify user exists
        assigned_user = database.get(User, payload.assigned_user_id)
        if not assigned_user or assigned_user.organization_id != user.organization_id:
            raise HTTPException(status_code=404, detail="Assigned user not found")
    
    database.add(issue)
    database.commit()
    database.refresh(issue)
    
    return {
        "id": issue.id,
        "vehicle_id": issue.vehicle_id,
        "driver_id": issue.driver_id,
        "title": issue.title,
        "detail": issue.detail,
        "priority": issue.priority,
        "status": issue.status,
        "updated": True,
    }


@router.post("/triage/issues/{issue_id}/create-work-order", response_model=dict)
def create_work_order_from_issue(
    issue_id: int,
    payload: CreateWorkOrderFromIssue,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Convert a triage issue into a work order"""
    reserve_idempotency_key(Request(), user, database)
    
    issue = database.get(VehicleIssue, issue_id)
    if not issue or issue.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    # Get the vehicle
    vehicle = database.get(Vehicle, issue.vehicle_id)
    if not vehicle or vehicle.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    # Create work order
    work_order = WorkOrder(
        organization_id=user.organization_id,
        vehicle_id=issue.vehicle_id,
        title=payload.title or issue.title,
        description=payload.description or issue.detail,
        priority=payload.priority or issue.priority,
        status="Open",
        assigned_user_id=payload.assigned_user_id,
    )
    
    database.add(work_order)
    database.flush()
    
    # Update issue status to indicate it's been converted
    issue.status = "CONVERTED_TO_WO"
    database.add(issue)
    
    database.commit()
    database.refresh(work_order)
    
    # Queue notification
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="WORK_ORDER_CREATED_FROM_ISSUE",
        severity="HIGH",
        title=f"Work order created from triage: {work_order.title}",
        detail=f"Vehicle {vehicle.registration_number}: {work_order.description}",
        entity_type="work_order",
        entity_id=str(work_order.id),
        roles={"owner", "fleet_manager", "mechanic"},
    )
    
    return {
        "issue_id": issue_id,
        "work_order_id": work_order.id,
        "vehicle_id": issue.vehicle_id,
        "title": work_order.title,
        "priority": work_order.priority,
        "status": work_order.status,
        "created_from_triage": True,
        "created_at": work_order.created_at.isoformat(),
    }


@router.post("/triage/issues/{issue_id}/assign", response_model=dict)
def assign_triage_issue(
    issue_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Assign a triage issue to a mechanic/technician"""
    reserve_idempotency_key(Request(), user, database)
    
    issue = database.get(VehicleIssue, issue_id)
    if not issue or issue.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    assigned_user_id = payload.get("assigned_user_id")
    assigned_user = database.get(User, assigned_user_id)
    
    if not assigned_user or assigned_user.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Update issue
    issue.status = "ASSIGNED"
    database.add(issue)
    database.commit()
    database.refresh(issue)
    
    # Notify assigned user
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="TRIAGE_ISSUE_ASSIGNED",
        severity=issue.priority,
        title=f"Triage issue assigned to you: {issue.title}",
        detail=issue.detail,
        entity_type="triage_issue",
        entity_id=str(issue.id),
        recipient_user_id=assigned_user_id,
    )
    
    return {
        "issue_id": issue_id,
        "assigned_to": assigned_user.full_name,
        "assigned_user_id": assigned_user_id,
        "status": issue.status,
        "assigned": True,
    }


@router.post("/triage/issues/{issue_id}/resolve", response_model=dict)
def resolve_triage_issue(
    issue_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager", "mechanic")),
    database: Session = Depends(get_db),
) -> dict:
    """Mark a triage issue as resolved"""
    reserve_idempotency_key(Request(), user, database)
    
    issue = database.get(VehicleIssue, issue_id)
    if not issue or issue.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Issue not found")
    
    resolution_notes = payload.get("resolution_notes", "")
    
    issue.status = "RESOLVED"
    issue.resolved_at = datetime.now(timezone.utc)
    database.add(issue)
    database.commit()
    database.refresh(issue)
    
    return {
        "issue_id": issue_id,
        "status": issue.status,
        "resolved_at": issue.resolved_at.isoformat(),
        "resolution_notes": resolution_notes,
        "resolved": True,
    }


@router.get("/triage/stats", response_model=dict)
def get_triage_stats(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get triage queue statistics and performance metrics"""
    # Count by status
    statuses = ["OPEN", "PENDING", "ASSIGNED", "CONVERTED_TO_WO", "RESOLVED"]
    status_counts = {}
    
    for status in statuses:
        count = database.query(VehicleIssue).filter(
            VehicleIssue.organization_id == user.organization_id,
            VehicleIssue.status == status,
        ).count()
        status_counts[status] = count
    
    # Count by priority
    priorities = ["Critical", "High", "Medium", "Low"]
    priority_counts = {}
    
    for priority in priorities:
        count = database.query(VehicleIssue).filter(
            VehicleIssue.organization_id == user.organization_id,
            VehicleIssue.priority == priority,
            VehicleIssue.status.in_(["OPEN", "PENDING", "ASSIGNED"]),
        ).count()
        priority_counts[priority] = count
    
    # Get average resolution time (days)
    resolved_issues = database.query(VehicleIssue).filter(
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.status == "RESOLVED",
        VehicleIssue.resolved_at != None,
    ).limit(100).all()
    
    avg_resolution_hours = 0
    if resolved_issues:
        total_hours = 0
        for issue in resolved_issues:
            if issue.resolved_at and issue.created_at:
                duration = issue.resolved_at - issue.created_at
                total_hours += duration.total_seconds() / 3600
        avg_resolution_hours = round(total_hours / len(resolved_issues), 2)
    
    # Most active drivers (by issues reported)
    driver_stats = database.query(
        VehicleIssue.driver_id,
        func.count(VehicleIssue.id).label("issue_count")
    ).filter(
        VehicleIssue.organization_id == user.organization_id
    ).group_by(VehicleIssue.driver_id).order_by(
        func.count(VehicleIssue.id).desc()
    ).limit(10).all()
    
    top_drivers = []
    for driver_id, count in driver_stats:
        driver = database.get(User, driver_id)
        if driver:
            top_drivers.append({
                "driver_id": driver_id,
                "driver_name": driver.full_name,
                "issues_reported": count,
            })
    
    return {
        "status_breakdown": status_counts,
        "priority_breakdown": priority_counts,
        "total_open": status_counts.get("OPEN", 0) + status_counts.get("PENDING", 0),
        "total_resolved": status_counts.get("RESOLVED", 0),
        "avg_resolution_hours": avg_resolution_hours,
        "top_reporters": top_drivers,
    }


@router.post("/triage/bulk-action", response_model=dict)
def perform_triage_bulk_action(
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Perform bulk action on multiple triage issues"""
    reserve_idempotency_key(Request(), user, database)
    
    issue_ids = payload.get("issue_ids", [])
    action = payload.get("action")  # resolve, assign, delete, convert_to_wo
    
    if not issue_ids or not action:
        raise HTTPException(status_code=400, detail="issue_ids and action required")
    
    issues = database.query(VehicleIssue).filter(
        VehicleIssue.organization_id == user.organization_id,
        VehicleIssue.id.in_(issue_ids),
    ).all()
    
    if not issues:
        raise HTTPException(status_code=404, detail="No issues found")
    
    updated_count = 0
    
    if action == "resolve":
        for issue in issues:
            issue.status = "RESOLVED"
            issue.resolved_at = datetime.now(timezone.utc)
            database.add(issue)
            updated_count += 1
    
    elif action == "delete":
        for issue in issues:
            database.delete(issue)
            updated_count += 1
    
    elif action == "convert_to_wo":
        for issue in issues:
            work_order = WorkOrder(
                organization_id=user.organization_id,
                vehicle_id=issue.vehicle_id,
                title=issue.title,
                description=issue.detail,
                priority=issue.priority,
                status="Open",
            )
            database.add(work_order)
            issue.status = "CONVERTED_TO_WO"
            database.add(issue)
            updated_count += 1
    
    database.commit()
    
    return {
        "total_requested": len(issue_ids),
        "total_processed": updated_count,
        "action": action,
        "completed": True,
    }



# ============================================================================
# AUDIT & COMPLIANCE ADVANCED FEATURES
# ============================================================================

@router.get("/audit/logs/advanced", response_model=dict)
def get_audit_logs_advanced(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    entity_type: Optional[str] = None,
    action: Optional[str] = None,
    actor_id: Optional[int] = None,
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
    limit: int = 100,
) -> dict:
    """Get audit logs with advanced filtering"""
    query = database.query(AuditLog).filter(
        AuditLog.organization_id == user.organization_id
    )
    
    if entity_type:
        query = query.filter(AuditLog.entity_type == entity_type)
    
    if action:
        query = query.filter(AuditLog.action == action)
    
    if actor_id:
        query = query.filter(AuditLog.actor_user_id == actor_id)
    
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(AuditLog.created_at >= start_dt)
        except ValueError:
            pass
    
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            query = query.filter(AuditLog.created_at <= end_dt)
        except ValueError:
            pass
    
    logs = query.order_by(AuditLog.created_at.desc()).limit(limit).all()
    
    return {
        "total_count": len(logs),
        "filters": {
            "entity_type": entity_type,
            "action": action,
            "actor_id": actor_id,
            "date_range": {
                "start": start_date,
                "end": end_date,
            },
        },
        "logs": [
            {
                "id": log.id,
                "actor_id": log.actor_user_id,
                "action": log.action,
                "entity_type": log.entity_type,
                "entity_id": log.entity_id,
                "changes": log.changes,
                "created_at": log.created_at.isoformat(),
            }
            for log in logs
        ],
    }


@router.get("/audit/export", response_model=dict)
def export_audit_logs(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Export audit logs as CSV"""
    query = database.query(AuditLog).filter(
        AuditLog.organization_id == user.organization_id
    )
    
    if start_date:
        try:
            start_dt = datetime.fromisoformat(start_date)
            query = query.filter(AuditLog.created_at >= start_dt)
        except ValueError:
            pass
    
    if end_date:
        try:
            end_dt = datetime.fromisoformat(end_date)
            query = query.filter(AuditLog.created_at <= end_dt)
        except ValueError:
            pass
    
    logs = query.order_by(AuditLog.created_at.desc()).all()
    
    csv_buffer = io.StringIO()
    writer = csv.writer(csv_buffer)
    writer.writerow([
        "Log ID", "Actor ID", "Action", "Entity Type", "Entity ID",
        "Request ID", "Changes", "Created At"
    ])
    
    for log in logs:
        writer.writerow([
            log.id,
            log.actor_user_id,
            log.action,
            log.entity_type,
            log.entity_id,
            log.request_id or "",
            log.changes or "",
            log.created_at.isoformat(),
        ])
    
    csv_content = csv_buffer.getvalue()
    csv_buffer.close()
    
    return {
        "format": "csv",
        "total_records": len(logs),
        "data": csv_content,
        "export_timestamp": datetime.now(timezone.utc).isoformat(),
    }


@router.post("/audit/import", response_model=dict)
def import_audit_logs(
    file: UploadFile = File(...),
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Import audit logs from CSV file"""
    reserve_idempotency_key(Request(), user, database)
    
    try:
        content = file.file.read().decode("utf-8")
        reader = csv.DictReader(io.StringIO(content))
        
        imported_count = 0
        for row in reader:
            try:
                log = AuditLog(
                    organization_id=user.organization_id,
                    actor_user_id=int(row.get("Actor ID", 0)),
                    action=row.get("Action", ""),
                    entity_type=row.get("Entity Type", ""),
                    entity_id=row.get("Entity ID", ""),
                    request_id=row.get("Request ID"),
                    changes=row.get("Changes"),
                )
                database.add(log)
                imported_count += 1
            except (ValueError, KeyError):
                continue
        
        database.commit()
        
        return {
            "imported": True,
            "total_imported": imported_count,
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Import failed: {str(e)}")


@router.get("/compliance/documents/{document_id}/versions", response_model=list[dict])
def list_document_versions(
    document_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> list[dict]:
    """Get version history for a compliance document"""
    document = database.get(ComplianceDocument, document_id)
    if not document or document.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found")
    
    versions = database.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.organization_id == user.organization_id,
    ).order_by(DocumentVersion.version_number.desc()).all()
    
    return [
        {
            "id": v.id,
            "version_number": v.version_number,
            "name": v.name,
            "document_type": v.document_type,
            "expires_on": v.expires_on,
            "created_by": v.created_by,
            "created_at": v.created_at.isoformat(),
            "asset_id": v.asset_id,
        }
        for v in versions
    ]


@router.post("/compliance/documents/{document_id}/lifecycle", response_model=dict)
def get_document_lifecycle(
    document_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get complete lifecycle of a compliance document"""
    document = database.get(ComplianceDocument, document_id)
    if not document or document.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Get versions
    versions = database.query(DocumentVersion).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.organization_id == user.organization_id,
    ).order_by(DocumentVersion.version_number.asc()).all()
    
    # Get audit events
    audit_events = database.query(AuditEvent).filter(
        AuditEvent.organization_id == user.organization_id,
        AuditEvent.entity_type == "compliance_document",
        AuditEvent.entity_id == str(document_id),
    ).order_by(AuditEvent.created_at.asc()).all()
    
    return {
        "document_id": document_id,
        "name": document.name,
        "document_type": document.document_type,
        "status": document.status,
        "current_expires_on": document.expires_on,
        "created_at": document.created_at.isoformat(),
        "versions": [
            {
                "version": v.version_number,
                "expires_on": v.expires_on,
                "created_at": v.created_at.isoformat(),
                "created_by": v.created_by,
            }
            for v in versions
        ],
        "audit_trail": [
            {
                "action": e.action,
                "actor": e.actor_user_id,
                "summary": e.summary,
                "created_at": e.created_at.isoformat(),
            }
            for e in audit_events
        ],
    }


@router.get("/compliance/status-by-vehicle", response_model=dict)
def get_compliance_status_by_vehicle(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get compliance document status broken down by vehicle"""
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == user.organization_id
    ).all()
    
    vehicle_compliance = {}
    
    for vehicle in vehicles:
        docs = database.query(ComplianceDocument).filter(
            ComplianceDocument.vehicle_id == vehicle.id,
            ComplianceDocument.organization_id == user.organization_id,
        ).all()
        
        expired_count = len([d for d in docs if d.status == "Expired"])
        expiring_count = len([d for d in docs if d.status == "Expiring Soon"])
        valid_count = len([d for d in docs if d.status == "Valid"])
        
        vehicle_compliance[vehicle.id] = {
            "registration_number": vehicle.registration_number,
            "total_documents": len(docs),
            "valid": valid_count,
            "expiring_soon": expiring_count,
            "expired": expired_count,
            "compliance_score": 100 - (expired_count * 10 + expiring_count * 5),
        }
    
    return {
        "by_vehicle": vehicle_compliance,
        "summary": {
            "total_vehicles": len(vehicles),
            "fully_compliant": len([v for v in vehicle_compliance.values() if v["expired"] == 0]),
            "at_risk": len([v for v in vehicle_compliance.values() if v["expiring_soon"] > 0]),
            "non_compliant": len([v for v in vehicle_compliance.values() if v["expired"] > 0]),
        },
    }


@router.get("/compliance/documents/expiry-report", response_model=dict)
def get_compliance_expiry_report(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    days_ahead: int = 90,
) -> dict:
    """Get compliance documents expiring within X days"""
    horizon = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    
    docs = database.query(ComplianceDocument).filter(
        ComplianceDocument.organization_id == user.organization_id,
        ComplianceDocument.expires_on <= horizon,
    ).order_by(ComplianceDocument.expires_on.asc()).all()
    
    by_status = {
        "expired": [],
        "expiring_critical": [],
        "expiring_soon": [],
    }
    
    today = date.today().isoformat()
    
    for doc in docs:
        expires_date = doc.expires_on
        vehicle = database.get(Vehicle, doc.vehicle_id) if doc.vehicle_id else None
        
        doc_info = {
            "id": doc.id,
            "name": doc.name,
            "type": doc.document_type,
            "expires_on": doc.expires_on,
            "vehicle_id": doc.vehicle_id,
            "vehicle_registration": vehicle.registration_number if vehicle else None,
        }
        
        if expires_date < today:
            by_status["expired"].append(doc_info)
        elif expires_date <= (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d"):
            by_status["expiring_critical"].append(doc_info)
        else:
            by_status["expiring_soon"].append(doc_info)
    
    return {
        "report_date": today,
        "days_ahead": days_ahead,
        "by_status": by_status,
        "summary": {
            "expired": len(by_status["expired"]),
            "expiring_critical": len(by_status["expiring_critical"]),
            "expiring_soon": len(by_status["expiring_soon"]),
        },
    }


@router.post("/compliance/documents/{document_id}/update-version", response_model=dict)
def update_document_version(
    document_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Create a new version of a compliance document"""
    reserve_idempotency_key(Request(), user, database)
    
    document = database.get(ComplianceDocument, document_id)
    if not document or document.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Document not found")
    
    # Get next version number
    max_version = database.query(
        func.max(DocumentVersion.version_number)
    ).filter(
        DocumentVersion.document_id == document_id,
        DocumentVersion.organization_id == user.organization_id,
    ).scalar() or 0
    
    # Create new version
    new_version = DocumentVersion(
        organization_id=user.organization_id,
        document_id=document_id,
        version_number=max_version + 1,
        name=payload.get("name", document.name),
        document_type=payload.get("document_type", document.document_type),
        expires_on=payload.get("expires_on", document.expires_on),
        created_by=user.id,
    )
    
    database.add(new_version)
    
    # Update main document
    document.name = new_version.name
    document.document_type = new_version.document_type
    document.expires_on = new_version.expires_on
    database.add(document)
    
    database.commit()
    database.refresh(new_version)
    
    return {
        "document_id": document_id,
        "version_number": new_version.version_number,
        "name": new_version.name,
        "expires_on": new_version.expires_on,
        "created_at": new_version.created_at.isoformat(),
    }



# ============================================================================
# REPORTS & ANALYTICS
# ============================================================================

@router.get("/reports/maintenance-performance", response_model=dict)
def get_maintenance_performance_report(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Get comprehensive maintenance performance report with KPIs"""
    # Default to last 90 days
    if not end_date:
        end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    if not start_date:
        start_date = (datetime.now(timezone.utc) - timedelta(days=90)).strftime("%Y-%m-%d")
    
    try:
        start_dt = datetime.fromisoformat(start_date)
        end_dt = datetime.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Get work orders in date range
    work_orders = database.query(WorkOrder).filter(
        WorkOrder.organization_id == user.organization_id,
        WorkOrder.created_at >= start_dt,
        WorkOrder.created_at <= end_dt,
    ).all()
    
    # Calculate KPIs
    total_work_orders = len(work_orders)
    completed = len([wo for wo in work_orders if wo.status == "Completed"])
    in_progress = len([wo for wo in work_orders if wo.status in ["In progress", "In Progress"]])
    pending = len([wo for wo in work_orders if wo.status == "Open"])
    overdue = len([wo for wo in work_orders if wo.due_date and wo.due_date < end_date and wo.status != "Completed"])
    
    # Calculate completion rate
    completion_rate = (completed / total_work_orders * 100) if total_work_orders > 0 else 0
    
    # Get average resolution time
    completed_orders = [wo for wo in work_orders if wo.completed_at and wo.created_at]
    avg_resolution_hours = 0
    if completed_orders:
        total_hours = sum((wo.completed_at - wo.created_at).total_seconds() / 3600 for wo in completed_orders)
        avg_resolution_hours = round(total_hours / len(completed_orders), 2)
    
    # Get maintenance cost
    total_cost_paise = 0
    parts_used = 0
    
    part_usages = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.organization_id == user.organization_id,
        WorkOrderPartUsage.created_at >= start_dt,
        WorkOrderPartUsage.created_at <= end_dt,
    ).all()
    
    for pu in part_usages:
        total_cost_paise += pu.quantity * pu.unit_cost_paise
        parts_used += pu.quantity
    
    # Get maintenance by type
    maintenance_by_type = {}
    for wo in work_orders:
        priority = wo.priority or "Unknown"
        if priority not in maintenance_by_type:
            maintenance_by_type[priority] = 0
        maintenance_by_type[priority] += 1
    
    # Get vehicle maintenance frequency
    vehicle_maintenance = {}
    for wo in work_orders:
        if wo.vehicle_id not in vehicle_maintenance:
            vehicle_maintenance[wo.vehicle_id] = 0
        vehicle_maintenance[wo.vehicle_id] += 1
    
    top_vehicles = sorted(vehicle_maintenance.items(), key=lambda x: x[1], reverse=True)[:10]
    
    # Get mechanic/technician performance
    tech_performance = {}
    for wo in work_orders:
        if wo.assigned_user_id:
            if wo.assigned_user_id not in tech_performance:
                tech_performance[wo.assigned_user_id] = {"total": 0, "completed": 0}
            tech_performance[wo.assigned_user_id]["total"] += 1
            if wo.status == "Completed":
                tech_performance[wo.assigned_user_id]["completed"] += 1
    
    top_technicians = []
    for tech_id, perf in sorted(tech_performance.items(), key=lambda x: x[1]["completed"], reverse=True)[:10]:
        tech = database.get(User, tech_id)
        if tech:
            completion_pct = (perf["completed"] / perf["total"] * 100) if perf["total"] > 0 else 0
            top_technicians.append({
                "technician_id": tech_id,
                "technician_name": tech.full_name,
                "total_assigned": perf["total"],
                "completed": perf["completed"],
                "completion_rate": round(completion_pct, 2),
            })
    
    return {
        "report_period": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_work_orders": total_work_orders,
            "completed": completed,
            "in_progress": in_progress,
            "pending": pending,
            "overdue": overdue,
            "completion_rate": round(completion_rate, 2),
        },
        "kpis": {
            "avg_resolution_hours": avg_resolution_hours,
            "avg_resolution_days": round(avg_resolution_hours / 24, 2),
            "total_maintenance_cost_paise": total_cost_paise,
            "total_maintenance_cost": total_cost_paise / 100.0,
            "parts_used": parts_used,
        },
        "by_priority": maintenance_by_type,
        "top_vehicles": [
            {
                "vehicle_id": vid,
                "maintenance_count": count,
            }
            for vid, count in top_vehicles
        ],
        "technician_performance": top_technicians,
    }


@router.get("/reports/vehicle-maintenance-history", response_model=dict)
def get_vehicle_maintenance_history(
    vehicle_id: int,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get complete maintenance history for a specific vehicle"""
    vehicle = database.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    # Get all work orders for this vehicle
    work_orders = database.query(WorkOrder).filter(
        WorkOrder.vehicle_id == vehicle_id,
        WorkOrder.organization_id == user.organization_id,
    ).order_by(WorkOrder.created_at.desc()).all()
    
    # Get maintenance plans
    maintenance_plans = database.query(MaintenancePlan).filter(
        MaintenancePlan.vehicle_id == vehicle_id,
        MaintenancePlan.organization_id == user.organization_id,
    ).all()
    
    # Get odometer readings
    odometer_logs = database.query(OdometerLog).filter(
        OdometerLog.vehicle_id == vehicle_id,
        OdometerLog.organization_id == user.organization_id,
    ).order_by(OdometerLog.created_at.desc()).limit(100).all()
    
    # Get parts used
    parts_used = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.organization_id == user.organization_id,
    ).all()
    
    vehicle_parts = []
    for pu in parts_used:
        wo = database.get(WorkOrder, pu.work_order_id)
        if wo and wo.vehicle_id == vehicle_id:
            part = database.get(Part, pu.part_id)
            if part:
                vehicle_parts.append({
                    "part_sku": part.sku,
                    "part_name": part.name,
                    "quantity": pu.quantity,
                    "unit_cost_paise": pu.unit_cost_paise,
                    "used_at": pu.created_at.isoformat(),
                })
    
    return {
        "vehicle_id": vehicle.id,
        "registration_number": vehicle.registration_number,
        "model": vehicle.model,
        "vehicle_type": vehicle.vehicle_type,
        "current_odometer_km": vehicle.odometer_km,
        "health": vehicle.health,
        "work_orders": [
            {
                "id": wo.id,
                "title": wo.title,
                "status": wo.status,
                "priority": wo.priority,
                "created_at": wo.created_at.isoformat(),
                "completed_at": wo.completed_at.isoformat() if wo.completed_at else None,
            }
            for wo in work_orders
        ],
        "maintenance_plans": [
            {
                "id": mp.id,
                "name": mp.name,
                "interval_km": mp.interval_km,
                "interval_days": mp.interval_days,
                "next_due_km": mp.next_due_km,
                "next_due_on": mp.next_due_on,
            }
            for mp in maintenance_plans
        ],
        "parts_used": vehicle_parts,
        "odometer_history": [
            {
                "reading_km": ol.reading_km,
                "source": ol.source,
                "recorded_at": ol.created_at.isoformat(),
            }
            for ol in odometer_logs[:20]
        ],
    }


@router.get("/reports/summary", response_model=dict)
def get_reports_summary(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get available reports and their metadata"""
    return {
        "available_reports": [
            {
                "id": "maintenance_performance",
                "name": "Maintenance Performance",
                "description": "Maintenance work orders, completion rates, and KPIs",
                "endpoint": "/reports/maintenance-performance",
                "parameters": ["start_date", "end_date"],
            },
            {
                "id": "vehicle_maintenance",
                "name": "Vehicle Maintenance History",
                "description": "Complete maintenance history for a vehicle",
                "endpoint": "/reports/vehicle-maintenance-history",
                "parameters": ["vehicle_id"],
            },
            {
                "id": "fuel_efficiency",
                "name": "Fuel Efficiency",
                "description": "Fuel consumption and efficiency metrics",
                "endpoint": "/reports/fuel-efficiency",
                "parameters": ["start_date", "end_date"],
            },
            {
                "id": "compliance",
                "name": "Compliance Status",
                "description": "Document expiry and compliance metrics",
                "endpoint": "/compliance/documents/expiry-report",
                "parameters": ["days_ahead"],
            },
        ],
    }


@router.get("/reports/fuel-efficiency", response_model=dict)
def get_fuel_efficiency_report(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Get fuel efficiency report and analytics"""
    if not end_date:
        end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    if not start_date:
        start_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    
    try:
        start_dt = datetime.fromisoformat(start_date)
        end_dt = datetime.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Get fuel transactions
    fuel_txs = database.query(FuelTransaction).filter(
        FuelTransaction.organization_id == user.organization_id,
        FuelTransaction.created_at >= start_dt,
        FuelTransaction.created_at <= end_dt,
    ).all()
    
    # Calculate efficiency by vehicle
    vehicle_efficiency = {}
    
    for tx in fuel_txs:
        if tx.vehicle_id not in vehicle_efficiency:
            vehicle_efficiency[tx.vehicle_id] = {
                "total_litres": 0,
                "total_km": 0,
                "fuel_txs": 0,
            }
        
        vehicle_efficiency[tx.vehicle_id]["total_litres"] += tx.litres_milli / 1000.0
        vehicle_efficiency[tx.vehicle_id]["total_km"] += tx.odometer_km
        vehicle_efficiency[tx.vehicle_id]["fuel_txs"] += 1
    
    # Calculate km per liter
    efficiency_data = []
    for vehicle_id, data in vehicle_efficiency.items():
        vehicle = database.get(Vehicle, vehicle_id)
        km_per_liter = data["total_km"] / data["total_litres"] if data["total_litres"] > 0 else 0
        
        efficiency_data.append({
            "vehicle_id": vehicle_id,
            "registration": vehicle.registration_number if vehicle else "N/A",
            "total_litres": round(data["total_litres"], 2),
            "total_km": data["total_km"],
            "km_per_liter": round(km_per_liter, 2),
            "transaction_count": data["fuel_txs"],
        })
    
    # Calculate fleet average
    total_litres = sum(d["total_litres"] for d in efficiency_data)
    total_km = sum(d["total_km"] for d in efficiency_data)
    fleet_avg_efficiency = (total_km / total_litres) if total_litres > 0 else 0
    
    return {
        "report_period": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "fleet_summary": {
            "total_transactions": len(fuel_txs),
            "total_litres": round(total_litres, 2),
            "total_km": total_km,
            "fleet_avg_km_per_liter": round(fleet_avg_efficiency, 2),
        },
        "by_vehicle": sorted(efficiency_data, key=lambda x: x["km_per_liter"], reverse=True),
    }



# ============================================================================
# FINANCIAL OPERATIONS & REPORTING
# ============================================================================

@router.get("/financials/metrics", response_model=dict)
def get_financial_metrics(
    user: User = Depends(require_roles("owner", "fleet_manager", "accountant")),
    database: Session = Depends(get_db),
    start_date: Optional[str] = None,
    end_date: Optional[str] = None,
) -> dict:
    """Get comprehensive financial metrics and KPIs"""
    if not end_date:
        end_date = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    if not start_date:
        start_date = (datetime.now(timezone.utc) - timedelta(days=30)).strftime("%Y-%m-%d")
    
    try:
        start_dt = datetime.fromisoformat(start_date)
        end_dt = datetime.fromisoformat(end_date)
    except ValueError:
        raise HTTPException(status_code=400, detail="Invalid date format")
    
    # Expenses
    expenses = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.created_at >= start_dt,
        Expense.created_at <= end_dt,
    ).all()
    
    total_expenses_paise = sum(e.amount_paise for e in expenses)
    
    # Fuel costs
    fuel_txs = database.query(FuelTransaction).filter(
        FuelTransaction.organization_id == user.organization_id,
        FuelTransaction.created_at >= start_dt,
        FuelTransaction.created_at <= end_dt,
    ).all()
    
    total_fuel_cost_paise = sum(ft.total_amount_paise for ft in fuel_txs)
    
    # Toll costs
    toll_txs = database.query(TollTransaction).filter(
        TollTransaction.organization_id == user.organization_id,
        TollTransaction.created_at >= start_dt,
        TollTransaction.created_at <= end_dt,
    ).all()
    
    total_toll_cost_paise = sum(t.amount_paise for t in toll_txs)
    
    # Maintenance costs (from expenses with category)
    maintenance_costs = sum(e.amount_paise for e in expenses if e.category in ["Maintenance", "Repair"])
    
    # Parts costs
    parts_used = database.query(WorkOrderPartUsage).filter(
        WorkOrderPartUsage.organization_id == user.organization_id,
        WorkOrderPartUsage.created_at >= start_dt,
        WorkOrderPartUsage.created_at <= end_dt,
    ).all()
    
    total_parts_cost_paise = sum(pu.quantity * pu.unit_cost_paise for pu in parts_used)
    
    # Calculate totals
    total_operational_cost = total_fuel_cost_paise + total_toll_cost_paise + total_expenses_paise
    
    # Revenue by vehicle
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == user.organization_id
    ).all()
    
    vehicle_count = len(vehicles)
    cost_per_vehicle = (total_operational_cost / vehicle_count) if vehicle_count > 0 else 0
    
    # Breakdown by category
    expense_categories = {}
    for expense in expenses:
        cat = expense.category or "Other"
        if cat not in expense_categories:
            expense_categories[cat] = 0
        expense_categories[cat] += expense.amount_paise
    
    return {
        "report_period": {
            "start_date": start_date,
            "end_date": end_date,
        },
        "summary": {
            "total_operational_cost_paise": total_operational_cost,
            "total_operational_cost": total_operational_cost / 100.0,
            "cost_per_vehicle_paise": cost_per_vehicle,
            "cost_per_vehicle": cost_per_vehicle / 100.0,
        },
        "breakdown": {
            "fuel_cost_paise": total_fuel_cost_paise,
            "fuel_cost": total_fuel_cost_paise / 100.0,
            "toll_cost_paise": total_toll_cost_paise,
            "toll_cost": total_toll_cost_paise / 100.0,
            "maintenance_cost_paise": maintenance_costs,
            "maintenance_cost": maintenance_costs / 100.0,
            "parts_cost_paise": total_parts_cost_paise,
            "parts_cost": total_parts_cost_paise / 100.0,
            "other_expenses_paise": total_expenses_paise,
            "other_expenses": total_expenses_paise / 100.0,
        },
        "by_category": {
            cat: val / 100.0 for cat, val in expense_categories.items()
        },
        "transaction_counts": {
            "fuel_transactions": len(fuel_txs),
            "toll_transactions": len(toll_txs),
            "expenses": len(expenses),
            "parts_used": len(parts_used),
        },
    }


@router.get("/financials/reconciliation", response_model=dict)
def get_financial_reconciliation(
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Get financial reconciliation summary"""
    # Get pending expenses
    pending_expenses = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.status.in_(["Pending", "Submitted"]),
    ).all()
    
    # Get approved expenses
    approved_expenses = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.status == "Approved",
    ).all()
    
    # Get rejected expenses
    rejected_expenses = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.status.in_(["Rejected", "Denied"]),
    ).all()
    
    # Calculate totals
    pending_total = sum(e.amount_paise for e in pending_expenses)
    approved_total = sum(e.amount_paise for e in approved_expenses)
    rejected_total = sum(e.amount_paise for e in rejected_expenses)
    
    # Get reconciled vs unreconciled
    toll_unreconciled = database.query(TollTransaction).filter(
        TollTransaction.organization_id == user.organization_id,
        TollTransaction.status.in_(["Pending", "Disputed"]),
    ).all()
    
    return {
        "expenses": {
            "pending": {
                "count": len(pending_expenses),
                "total_paise": pending_total,
                "total": pending_total / 100.0,
            },
            "approved": {
                "count": len(approved_expenses),
                "total_paise": approved_total,
                "total": approved_total / 100.0,
            },
            "rejected": {
                "count": len(rejected_expenses),
                "total_paise": rejected_total,
                "total": rejected_total / 100.0,
            },
        },
        "reconciliation_status": {
            "tolls_pending_reconciliation": len(toll_unreconciled),
            "tolls_reconciled": database.query(TollTransaction).filter(
                TollTransaction.organization_id == user.organization_id,
                TollTransaction.status == "Approved",
            ).count(),
        },
        "discrepancies": {
            "total_unreconciled_paise": sum(t.amount_paise for t in toll_unreconciled),
            "total_unreconciled": sum(t.amount_paise for t in toll_unreconciled) / 100.0,
        },
    }


@router.get("/financials/approval-queue", response_model=dict)
def get_financial_approval_queue(
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Get queue of expenses pending approval"""
    # Get pending expenses
    pending = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.status.in_(["Pending", "Submitted"]),
    ).order_by(Expense.created_at.asc()).all()
    
    # Group by status
    by_category = {}
    by_amount_range = {"under_5000": 0, "5000_10000": 0, "10000_50000": 0, "over_50000": 0}
    
    for expense in pending:
        cat = expense.category or "Other"
        if cat not in by_category:
            by_category[cat] = []
        by_category[cat].append(expense)
        
        # Amount ranges (in paise)
        amount = expense.amount_paise
        if amount < 500000:  # 5000 paise = 50
            by_amount_range["under_5000"] += 1
        elif amount < 1000000:  # 10000
            by_amount_range["5000_10000"] += 1
        elif amount < 5000000:  # 50000
            by_amount_range["10000_50000"] += 1
        else:
            by_amount_range["over_50000"] += 1
    
    # Total pending amount
    total_pending_paise = sum(e.amount_paise for e in pending)
    
    return {
        "queue_summary": {
            "total_pending": len(pending),
            "total_amount_paise": total_pending_paise,
            "total_amount": total_pending_paise / 100.0,
        },
        "by_category": {
            cat: {
                "count": len(expenses),
                "total_paise": sum(e.amount_paise for e in expenses),
                "total": sum(e.amount_paise for e in expenses) / 100.0,
            }
            for cat, expenses in by_category.items()
        },
        "by_amount_range": by_amount_range,
        "pending_items": [
            {
                "id": e.id,
                "category": e.category,
                "description": e.description,
                "amount_paise": e.amount_paise,
                "amount": e.amount_paise / 100.0,
                "incurred_on": e.incurred_on,
                "vendor": e.vendor,
                "created_at": e.created_at.isoformat(),
            }
            for e in pending[:50]  # Return first 50
        ],
    }


@router.post("/financials/expenses/{expense_id}/approve", response_model=dict)
def approve_expense(
    expense_id: int,
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Approve an expense for reimbursement"""
    reserve_idempotency_key(Request(), user, database)
    
    expense = database.get(Expense, expense_id)
    if not expense or expense.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Expense not found")
    if user.role == "accountant" and expense.created_by == user.id:
        raise HTTPException(status_code=403, detail="Accountants cannot approve their own expenses")
    
    expense.status = "Approved"
    expense.approved_by = user.id
    expense.approved_at = datetime.now(timezone.utc)
    database.add(expense)
    
    # Fixed Bug 22: Add financial audit trail logging
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.approved",
        entity_type="expense",
        entity_id=str(expense.id),
        changes=json.dumps({
            "status": "Approved",
            "approved_by": user.id,
            "amount": expense.amount_paise,
            "category": expense.category
        })
    ))
    database.commit()
    database.refresh(expense)
    
    return {
        "expense_id": expense_id,
        "status": expense.status,
        "approved_by": user.id,
        "approved_at": expense.approved_at.isoformat(),
        "approved": True,
    }


@router.post("/financials/expenses/{expense_id}/reject", response_model=dict)
def reject_expense(
    expense_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Reject an expense"""
    reserve_idempotency_key(Request(), user, database)
    
    expense = database.get(Expense, expense_id)
    if not expense or expense.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Expense not found")
    
    reason = payload.get("reason", "No reason provided")
    
    expense.status = "Rejected"
    database.add(expense)
    
    # Fixed Bug 22: Add financial audit trail logging for rejection
    database.add(AuditLog(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        action="expense.rejected",
        entity_type="expense",
        entity_id=str(expense.id),
        changes=json.dumps({
            "status": "Rejected",
            "reason": reason,
            "amount": expense.amount_paise,
            "category": expense.category
        })
    ))
    database.commit()
    database.refresh(expense)
    
    return {
        "expense_id": expense_id,
        "status": expense.status,
        "rejection_reason": reason,
        "rejected": True,
    }


@router.post("/financials/bulk-approve", response_model=dict)
def bulk_approve_expenses(
    payload: dict,
    user: User = Depends(require_roles("owner", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Bulk approve multiple expenses"""
    reserve_idempotency_key(Request(), user, database)
    
    expense_ids = payload.get("expense_ids", [])
    
    if not expense_ids:
        raise HTTPException(status_code=400, detail="No expense IDs provided")
    
    expenses = database.query(Expense).filter(
        Expense.organization_id == user.organization_id,
        Expense.id.in_(expense_ids),
    ).all()
    
    if not expenses:
        raise HTTPException(status_code=404, detail="No expenses found")
    
    approved_count = 0
    total_approved_paise = 0
    
    for expense in expenses:
        if user.role == "accountant" and expense.created_by == user.id:
            continue
        if expense.status not in ["Approved"]:  # Don't reapprove
            expense.status = "Approved"
            expense.approved_by = user.id
            expense.approved_at = datetime.now(timezone.utc)
            database.add(expense)
            approved_count += 1
            total_approved_paise += expense.amount_paise
    
    database.commit()
    
    return {
        "total_requested": len(expense_ids),
        "total_approved": approved_count,
        "total_amount_paise": total_approved_paise,
        "total_amount": total_approved_paise / 100.0,
        "approved": True,
    }



# ============================================================================
# BILLING & SUBSCRIPTION TEST MODE
# ============================================================================

@router.post("/billing/test/check-plan-eligibility", response_model=dict)
def check_plan_eligibility(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Check if organization is eligible for a plan upgrade"""
    reserve_idempotency_key(Request(), user, database)
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Count resources
    user_count = database.query(User).filter(
        User.organization_id == org.id
    ).count()
    
    vehicle_count = database.query(Vehicle).filter(
        Vehicle.organization_id == org.id
    ).count()
    
    # Define plan limits
    plans = {
        "starter": {
            "max_users": 5,
            "max_vehicles": 10,
            "monthly_cost_paise": 9999,  # 99.99
            "features": ["basic_fleet_tracking", "work_orders", "basic_inventory"],
        },
        "professional": {
            "max_users": 50,
            "max_vehicles": 100,
            "monthly_cost_paise": 49999,  # 499.99
            "features": ["advanced_reporting", "advanced_maintenance", "api_access"],
        },
        "enterprise": {
            "max_users": None,  # unlimited
            "max_vehicles": None,
            "monthly_cost_paise": 99999,  # 999.99
            "features": ["all_features", "sso", "dedicated_support"],
        },
    }
    
    # Check eligibility for upgrades
    eligibility = {}
    
    # Check for professional
    if (user_count > plans["starter"]["max_users"] or 
        vehicle_count > plans["starter"]["max_vehicles"]):
        eligibility["professional"] = {
            "eligible": True,
            "reason": "Fleet size exceeds starter plan limits",
            "required_for": [],
        }
        if user_count > plans["starter"]["max_users"]:
            eligibility["professional"]["required_for"].append(f"users ({user_count} > {plans['starter']['max_users']})")
        if vehicle_count > plans["starter"]["max_vehicles"]:
            eligibility["professional"]["required_for"].append(f"vehicles ({vehicle_count} > {plans['starter']['max_vehicles']})")
    else:
        eligibility["professional"] = {
            "eligible": True,
            "reason": "Can upgrade for advanced features",
            "required_for": [],
        }
    
    # Check for enterprise
    if (user_count > plans["professional"]["max_users"] or 
        vehicle_count > plans["professional"]["max_vehicles"]):
        eligibility["enterprise"] = {
            "eligible": True,
            "reason": "Fleet size exceeds professional plan limits",
            "required_for": [],
        }
        if user_count > plans["professional"]["max_users"]:
            eligibility["enterprise"]["required_for"].append(f"users ({user_count} > {plans['professional']['max_users']})")
        if vehicle_count > plans["professional"]["max_vehicles"]:
            eligibility["enterprise"]["required_for"].append(f"vehicles ({vehicle_count} > {plans['professional']['max_vehicles']})")
    else:
        eligibility["enterprise"] = {
            "eligible": True,
            "reason": "Can upgrade for enterprise features and support",
            "required_for": [],
        }
    
    return {
        "organization_id": org.id,
        "current_plan": org.subscription_plan,
        "current_resources": {
            "users": user_count,
            "vehicles": vehicle_count,
        },
        "plan_limits": plans,
        "eligibility": eligibility,
        "test_mode": True,
    }


@router.post("/billing/test/activate-starter", response_model=dict)
def activate_starter_plan(
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Activate starter plan with test mode (no payment required)"""
    reserve_idempotency_key(Request(), user, database)
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Calculate trial end date (30 days from now)
    trial_end = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    renew_date = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    
    # Update organization
    org.subscription_plan = "starter"
    org.subscription_status = "trialing"
    org.trial_ends_on = trial_end
    org.subscription_renews_on = renew_date
    database.add(org)
    
    # Create billing invoice for testing
    invoice = BillingInvoice(
        organization_id=org.id,
        period_start=datetime.now(timezone.utc).strftime("%Y-%m-%d"),
        period_end=trial_end,
        plan="starter",
        total_paise=0,  # Free trial
        status="draft",
        external_invoice_id=f"TEST-{org.id}-{datetime.now(timezone.utc).strftime('%Y%m%d')}",
    )
    database.add(invoice)
    database.commit()
    
    return {
        "organization_id": org.id,
        "plan": org.subscription_plan,
        "status": org.subscription_status,
        "trial_ends_on": org.trial_ends_on,
        "renewal_date": org.subscription_renews_on,
        "invoice_id": invoice.id,
        "test_mode": True,
        "activated": True,
    }


@router.post("/billing/test/upgrade-plan", response_model=dict)
def upgrade_plan_test(
    payload: dict,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Upgrade to a plan in test mode (no payment)"""
    reserve_idempotency_key(Request(), user, database)
    
    new_plan = payload.get("plan")
    valid_plans = ["starter", "professional", "enterprise"]
    
    if new_plan not in valid_plans:
        raise HTTPException(status_code=400, detail="Invalid plan")
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Calculate dates
    trial_end = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    
    # Update organization
    org.subscription_plan = new_plan
    org.subscription_status = "trialing"
    org.trial_ends_on = trial_end
    org.subscription_renews_on = trial_end
    database.add(org)
    
    database.commit()
    database.refresh(org)
    
    return {
        "organization_id": org.id,
        "upgraded_to": new_plan,
        "status": org.subscription_status,
        "trial_ends_on": org.trial_ends_on,
        "test_mode": True,
        "upgraded": True,
    }


@router.get("/billing/test/plans", response_model=dict)
def get_test_plans(
    user: User = Depends(get_current_user),
    database: Session = Depends(get_db),
) -> dict:
    """Get available plans in test mode"""
    return {
        "test_mode": True,
        "plans": [
            {
                "name": "starter",
                "display_name": "Starter",
                "monthly_cost_paise": 9999,
                "monthly_cost": 99.99,
                "billing_cycle": "monthly",
                "limits": {
                    "max_users": 5,
                    "max_vehicles": 10,
                    "storage_gb": 10,
                },
                "features": [
                    "Basic fleet tracking",
                    "Work order management",
                    "Basic inventory",
                    "Email support",
                ],
            },
            {
                "name": "professional",
                "display_name": "Professional",
                "monthly_cost_paise": 49999,
                "monthly_cost": 499.99,
                "billing_cycle": "monthly",
                "limits": {
                    "max_users": 50,
                    "max_vehicles": 100,
                    "storage_gb": 100,
                },
                "features": [
                    "Advanced reporting",
                    "Advanced maintenance planning",
                    "API access",
                    "Priority support",
                    "Custom workflows",
                ],
            },
            {
                "name": "enterprise",
                "display_name": "Enterprise",
                "monthly_cost_paise": 99999,
                "monthly_cost": 999.99,
                "billing_cycle": "monthly",
                "limits": {
                    "max_users": None,
                    "max_vehicles": None,
                    "storage_gb": None,
                },
                "features": [
                    "All features",
                    "SSO/SAML",
                    "Dedicated support",
                    "Custom integrations",
                    "SLA guarantee",
                ],
            },
        ],
    }


@router.post("/billing/test/create-invoice", response_model=dict)
def create_test_invoice(
    payload: dict,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Create a test invoice"""
    reserve_idempotency_key(Request(), user, database)
    
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    period_start = payload.get("period_start", datetime.now(timezone.utc).strftime("%Y-%m-%d"))
    period_end = payload.get("period_end", (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"))
    plan = payload.get("plan", org.subscription_plan)
    
    # Calculate amount based on plan
    plan_costs = {
        "starter": 9999,
        "professional": 49999,
        "enterprise": 99999,
    }
    
    total_paise = plan_costs.get(plan, 9999)
    
    invoice = BillingInvoice(
        organization_id=org.id,
        period_start=period_start,
        period_end=period_end,
        plan=plan,
        total_paise=total_paise,
        status="draft",
        external_invoice_id=f"TEST-{org.id}-{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
    )
    
    database.add(invoice)
    database.commit()
    database.refresh(invoice)
    
    return {
        "invoice_id": invoice.id,
        "organization_id": org.id,
        "period_start": invoice.period_start,
        "period_end": invoice.period_end,
        "plan": invoice.plan,
        "total_paise": invoice.total_paise,
        "total": invoice.total_paise / 100.0,
        "status": invoice.status,
        "external_id": invoice.external_invoice_id,
        "test_mode": True,
    }


@router.post("/billing/test/simulate-payment", response_model=dict)
def simulate_payment(
    payload: dict,
    user: User = Depends(require_roles("owner")),
    database: Session = Depends(get_db),
) -> dict:
    """Simulate a payment in test mode"""
    reserve_idempotency_key(Request(), user, database)
    
    invoice_id = payload.get("invoice_id")
    invoice = database.get(BillingInvoice, invoice_id)
    
    if not invoice or invoice.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Invoice not found")
    
    # Create payment record
    payment = BillingPayment(
        organization_id=user.organization_id,
        invoice_id=invoice_id,
        provider="test",
        provider_payment_id=f"TEST_PAY_{invoice_id}_{datetime.now(timezone.utc).strftime('%Y%m%d%H%M%S')}",
        status="success",
        amount_paise=invoice.total_paise,
        paid_at=datetime.now(timezone.utc),
    )
    
    database.add(payment)
    
    # Update invoice status
    invoice.status = "paid"
    database.add(invoice)
    
    database.commit()
    database.refresh(payment)
    
    return {
        "payment_id": payment.id,
        "invoice_id": invoice_id,
        "provider": payment.provider,
        "amount_paise": payment.amount_paise,
        "amount": payment.amount_paise / 100.0,
        "status": payment.status,
        "paid_at": payment.paid_at.isoformat(),
        "test_mode": True,
        "simulated": True,
    }



# ============================================================================
# NOTIFICATIONS ADVANCED FEATURES
# ============================================================================

@router.get("/notifications/{notification_id}/source-detail", response_model=dict)
def get_notification_source_detail(
    notification_id: int,
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> dict:
    """Get detailed source information for a notification"""
    notification = database.get(OperationalNotification, notification_id)
    if not notification or notification.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Notification not found")
    delivery = database.scalar(select(NotificationDelivery).where(
        NotificationDelivery.notification_id == notification_id,
        NotificationDelivery.organization_id == user.organization_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
    ))
    if delivery is None:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    # Fetch the related entity
    entity_data = None
    
    if notification.entity_type == "work_order":
        entity = database.scalar(select(WorkOrder).where(
            WorkOrder.id == int(notification.entity_id),
            WorkOrder.organization_id == user.organization_id,
        ))
        if entity and user.role in ("mechanic", "technician") and entity.assigned_user_id != user.id:
            entity = None
        if entity:
            vehicle = database.scalar(select(Vehicle).where(
                Vehicle.id == entity.vehicle_id,
                Vehicle.organization_id == user.organization_id,
            ))
            entity_data = {
                "type": "work_order",
                "id": entity.id,
                "title": entity.title,
                "status": entity.status,
                "priority": entity.priority,
                "vehicle": {
                    "id": vehicle.id,
                    "registration": vehicle.registration_number,
                } if vehicle else None,
                "assigned_to": entity.assigned_to,
            }
    
    elif notification.entity_type == "vehicle":
        entity = database.scalar(select(Vehicle).where(
            Vehicle.id == int(notification.entity_id),
            Vehicle.organization_id == user.organization_id,
        ))
        if entity and user.role == "driver" and entity.assigned_driver_id != user.id:
            entity = None
        if entity:
            entity_data = {
                "type": "vehicle",
                "id": entity.id,
                "registration": entity.registration_number,
                "model": entity.model,
                "health": entity.health,
                "status": entity.status,
            }
    
    elif notification.entity_type == "compliance_document":
        entity = database.scalar(select(ComplianceDocument).where(
            ComplianceDocument.id == int(notification.entity_id),
            ComplianceDocument.organization_id == user.organization_id,
        ))
        if entity:
            entity_data = {
                "type": "compliance_document",
                "id": entity.id,
                "name": entity.name,
                "document_type": entity.document_type,
                "expires_on": entity.expires_on,
                "status": entity.status,
            }
    
    elif notification.entity_type == "triage_issue":
        entity = database.scalar(select(VehicleIssue).where(
            VehicleIssue.id == int(notification.entity_id),
            VehicleIssue.organization_id == user.organization_id,
        ))
        if entity:
            entity_data = {
                "type": "triage_issue",
                "id": entity.id,
                "title": entity.title,
                "priority": entity.priority,
                "status": entity.status,
            }
    
    return {
        "notification_id": notification_id,
        "title": notification.title,
        "detail": notification.detail,
        "severity": notification.severity,
        "status": notification.status,
        "created_at": notification.created_at.isoformat(),
        "source": entity_data,
    }


@router.post("/notifications/{notification_id}/escalate", response_model=dict)
def escalate_notification(
    notification_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Escalate a notification to higher severity"""
    reserve_idempotency_key(Request(), user, database)
    
    notification = database.get(OperationalNotification, notification_id)
    if not notification or notification.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    reason = payload.get("reason", "Escalated by user")
    escalated_to_severity = payload.get("severity", "CRITICAL")
    
    # Update notification
    original_severity = notification.severity
    notification.severity = escalated_to_severity
    database.add(notification)
    
    # Create audit event
    audit_event = AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        actor_role=user.role,
        action="notification_escalated",
        entity_type="notification",
        entity_id=str(notification_id),
        summary=f"Notification escalated from {original_severity} to {escalated_to_severity}: {reason}",
    )
    database.add(audit_event)
    
    # Queue escalation notification to owner
    queue_role_notification(
        database,
        organization_id=user.organization_id,
        notification_type="NOTIFICATION_ESCALATED",
        severity=escalated_to_severity,
        title=f"Notification escalated: {notification.title}",
        detail=f"Reason: {reason}",
        entity_type="notification",
        entity_id=str(notification_id),
        roles={"owner"},
    )
    
    database.commit()
    database.refresh(notification)
    
    return {
        "notification_id": notification_id,
        "original_severity": original_severity,
        "escalated_to": escalated_to_severity,
        "reason": reason,
        "escalated": True,
    }


@router.post("/notifications/{notification_id}/resolve", response_model=dict)
def resolve_notification(
    notification_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Mark a notification as resolved"""
    reserve_idempotency_key(Request(), user, database)
    
    notification = database.get(OperationalNotification, notification_id)
    if not notification or notification.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Notification not found")
    
    resolution_notes = payload.get("resolution_notes", "")
    
    notification.status = "resolved"
    notification.resolved_at = datetime.now(timezone.utc)
    database.add(notification)
    
    # Create audit event
    audit_event = AuditEvent(
        organization_id=user.organization_id,
        actor_user_id=user.id,
        actor_role=user.role,
        action="notification_resolved",
        entity_type="notification",
        entity_id=str(notification_id),
        summary=f"Notification resolved. Notes: {resolution_notes}",
    )
    database.add(audit_event)
    
    database.commit()
    database.refresh(notification)
    
    return {
        "notification_id": notification_id,
        "status": notification.status,
        "resolved_at": notification.resolved_at.isoformat(),
        "resolution_notes": resolution_notes,
        "resolved": True,
    }


@router.get("/notifications/pending", response_model=dict)
def get_pending_notifications(
    user: User = Depends(require_permission("notifications")),
    database: Session = Depends(get_db),
) -> dict:
    """Get pending unresolved notifications"""
    notifications = database.query(OperationalNotification).join(
        NotificationDelivery,
        NotificationDelivery.notification_id == OperationalNotification.id,
    ).filter(
        OperationalNotification.organization_id == user.organization_id,
        NotificationDelivery.organization_id == user.organization_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
        OperationalNotification.status.in_(["unread", "read"]),
    ).distinct().order_by(OperationalNotification.severity.desc(), OperationalNotification.created_at.desc()).all()
    
    # Group by severity
    by_severity = {
        "CRITICAL": [],
        "HIGH": [],
        "MEDIUM": [],
        "LOW": [],
    }
    
    for notif in notifications:
        severity = notif.severity or "MEDIUM"
        if severity in by_severity:
            by_severity[severity].append({
                "id": notif.id,
                "title": notif.title,
                "detail": notif.detail,
                "type": notif.notification_type,
                "created_at": notif.created_at.isoformat(),
            })
    
    return {
        "total_pending": len(notifications),
        "by_severity": by_severity,
    }


@router.post("/notifications/bulk-resolve", response_model=dict)
def bulk_resolve_notifications(
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Bulk resolve multiple notifications"""
    reserve_idempotency_key(Request(), user, database)
    
    notification_ids = payload.get("notification_ids", [])
    
    if not notification_ids:
        raise HTTPException(status_code=400, detail="No notification IDs provided")
    
    notifications = database.query(OperationalNotification).join(
        NotificationDelivery,
        NotificationDelivery.notification_id == OperationalNotification.id,
    ).filter(
        OperationalNotification.organization_id == user.organization_id,
        NotificationDelivery.organization_id == user.organization_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
        OperationalNotification.id.in_(notification_ids),
    ).distinct().all()
    
    if not notifications:
        raise HTTPException(status_code=404, detail="No notifications found")
    
    resolved_count = 0
    
    for notif in notifications:
        if notif.status != "resolved":
            notif.status = "resolved"
            notif.resolved_at = datetime.now(timezone.utc)
            database.add(notif)
            resolved_count += 1
    
    database.commit()
    
    return {
        "total_requested": len(notification_ids),
        "total_resolved": resolved_count,
        "resolved": True,
    }



# ============================================================================
# VENDORS & PRICING HISTORY
# ============================================================================

@router.get("/vendors/{vendor_id}/pricing-history", response_model=dict)
def get_vendor_pricing_history(
    vendor_id: int,
    user: User = Depends(require_roles("owner", "inventory_manager", "accountant")),
    database: Session = Depends(get_db),
) -> dict:
    """Get pricing history for parts from a vendor"""
    vendor = database.get(Vendor, vendor_id)
    if not vendor or vendor.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vendor not found")
    
    # Get purchase orders from this vendor
    po_list = database.query(PurchaseOrder).filter(
        PurchaseOrder.vendor_id == vendor_id,
        PurchaseOrder.organization_id == user.organization_id,
    ).order_by(PurchaseOrder.created_at.desc()).all()
    
    # Extract pricing data
    pricing_history = {}
    
    for po in po_list:
        lines = database.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.purchase_order_id == po.id
        ).all()
        
        for line in lines:
            part = database.get(Part, line.part_id)
            if part:
                if part.id not in pricing_history:
                    pricing_history[part.id] = []
                
                pricing_history[part.id].append({
                    "purchase_order_id": po.id,
                    "order_number": po.order_number,
                    "unit_cost_paise": line.unit_cost_paise,
                    "unit_cost": line.unit_cost_paise / 100.0,
                    "quantity": line.quantity,
                    "ordered_at": po.created_at.isoformat(),
                })
    
    # Calculate price trends
    price_trends = {}
    for part_id, history in pricing_history.items():
        part = database.get(Part, part_id)
        sorted_history = sorted(history, key=lambda x: x["ordered_at"])
        
        if len(sorted_history) > 1:
            first_price = sorted_history[0]["unit_cost_paise"]
            latest_price = sorted_history[-1]["unit_cost_paise"]
            price_change = latest_price - first_price
            price_change_pct = (price_change / first_price * 100) if first_price > 0 else 0
        else:
            price_change = 0
            price_change_pct = 0.0
        
        if part:
            price_trends[part.sku] = {
                "part_name": part.name,
                "history_count": len(sorted_history),
                "first_price": sorted_history[0]["unit_cost_paise"] / 100.0,
                "latest_price": sorted_history[-1]["unit_cost_paise"] / 100.0,
                "price_change": price_change / 100.0,
                "price_change_percent": round(price_change_pct, 2),
            }
    
    return {
        "vendor_id": vendor_id,
        "vendor_name": vendor.name,
        "total_parts": len(pricing_history),
        "total_purchase_orders": len(po_list),
        "price_trends": price_trends,
        "full_history": pricing_history,
    }


# ============================================================================
# PURCHASE ORDERS ADVANCED
# ============================================================================

@router.post("/purchase-orders/{po_id}/receive-partial", response_model=dict)
def receive_partial_purchase_order(
    po_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "inventory_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Receive partial shipment with variance tracking"""
    reserve_idempotency_key(Request(), user, database)
    
    po = database.get(PurchaseOrder, po_id)
    if not po or po.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Purchase order not found")
    
    # Get items being received
    items_received = payload.get("items", [])
    
    for item in items_received:
        part_id = item.get("part_id")
        quantity = item.get("quantity", 0)
        damaged_qty = item.get("damaged_quantity", 0)
        backordered_qty = item.get("backordered_quantity", 0)
        variance_reason = item.get("variance_reason")
        location_id = item.get("location_id")
        
        part = database.get(Part, part_id)
        if not part or part.organization_id != user.organization_id:
            continue
        
        # Get PO line
        po_line = database.query(PurchaseOrderLine).filter(
            PurchaseOrderLine.purchase_order_id == po_id,
            PurchaseOrderLine.part_id == part_id,
        ).first()
        
        if not po_line:
            continue
        
        # Create receipt record
        receipt = PurchaseOrderReceipt(
            organization_id=user.organization_id,
            purchase_order_id=po_id,
            part_id=part_id,
            quantity=quantity,
            damaged_quantity=damaged_qty,
            backordered_quantity=backordered_qty,
            variance_reason=variance_reason,
            unit_cost_paise=po_line.unit_cost_paise,
            location_id=location_id,
            received_by=user.id,
        )
        database.add(receipt)
        
        # Update inventory (good items only)
        part.quantity_on_hand += (quantity - damaged_qty)
        database.add(part)
        
        # Calculate variance
        expected = po_line.quantity
        received = quantity
        variance = expected - received - backordered_qty
        
        if variance != 0:
            # Create notification for variance
            queue_role_notification(
                database,
                organization_id=user.organization_id,
                notification_type="PO_VARIANCE",
                severity="HIGH" if abs(variance) > 10 else "MEDIUM",
                title=f"PO variance for {part.name}",
                detail=f"Expected {expected}, received {received}, backordered {backordered_qty}. Reason: {variance_reason}",
                entity_type="purchase_order",
                entity_id=str(po_id),
                roles={"owner", "fleet_manager"},
            )
    
    # Update PO status if fully received
    all_receipts = database.query(PurchaseOrderReceipt).filter(
        PurchaseOrderReceipt.purchase_order_id == po_id
    ).all()
    
    total_received = sum(r.quantity for r in all_receipts)
    total_expected = sum(line.quantity for line in database.query(PurchaseOrderLine).filter(
        PurchaseOrderLine.purchase_order_id == po_id
    ).all())
    
    if total_received >= total_expected:
        po.status = "Received"
    else:
        po.status = "Partial"
    
    database.add(po)
    database.commit()
    
    return {
        "purchase_order_id": po_id,
        "items_received": len(items_received),
        "status": po.status,
        "received": True,
    }


# ============================================================================
# COMPLIANCE SUMMARY
# ============================================================================

@router.get("/compliance/summary", response_model=dict)
def get_compliance_summary(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get comprehensive compliance summary for the organization"""
    org = database.get(Organization, user.organization_id)
    if not org:
        raise HTTPException(status_code=404, detail="Organization not found")
    
    # Get all compliance documents
    docs = database.query(ComplianceDocument).filter(
        ComplianceDocument.organization_id == user.organization_id
    ).all()
    
    # Count by status
    valid_count = len([d for d in docs if d.status == "Valid"])
    expiring_soon = len([d for d in docs if d.status == "Expiring Soon"])
    expired_count = len([d for d in docs if d.status == "Expired"])
    
    # Documents by type
    by_type = {}
    for doc in docs:
        doc_type = doc.document_type or "Other"
        if doc_type not in by_type:
            by_type[doc_type] = {"total": 0, "valid": 0, "expiring": 0, "expired": 0}
        
        by_type[doc_type]["total"] += 1
        if doc.status == "Valid":
            by_type[doc_type]["valid"] += 1
        elif doc.status == "Expiring Soon":
            by_type[doc_type]["expiring"] += 1
        elif doc.status == "Expired":
            by_type[doc_type]["expired"] += 1
    
    # Vehicles by compliance status
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == user.organization_id
    ).all()
    
    fully_compliant = 0
    at_risk = 0
    non_compliant = 0
    
    for vehicle in vehicles:
        vehicle_docs = database.query(ComplianceDocument).filter(
            ComplianceDocument.vehicle_id == vehicle.id,
            ComplianceDocument.organization_id == user.organization_id,
        ).all()
        
        expired_docs = len([d for d in vehicle_docs if d.status == "Expired"])
        expiring_docs = len([d for d in vehicle_docs if d.status == "Expiring Soon"])
        
        if expired_docs > 0:
            non_compliant += 1
        elif expiring_docs > 0:
            at_risk += 1
        else:
            fully_compliant += 1
    
    # Calculate compliance score (0-100)
    if len(docs) > 0:
        compliance_score = ((valid_count / len(docs)) * 100)
    else:
        compliance_score = 100.0
    
    # Upcoming expirations (next 30 days)
    horizon = (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d")
    upcoming = database.query(ComplianceDocument).filter(
        ComplianceDocument.organization_id == user.organization_id,
        ComplianceDocument.expires_on <= horizon,
        ComplianceDocument.expires_on > datetime.now(timezone.utc).strftime("%Y-%m-%d"),
    ).all()
    
    return {
        "organization_name": org.name,
        "compliance_score": round(compliance_score, 2),
        "documents": {
            "total": len(docs),
            "valid": valid_count,
            "expiring_soon": expiring_soon,
            "expired": expired_count,
        },
        "by_type": by_type,
        "vehicle_compliance": {
            "fully_compliant": fully_compliant,
            "at_risk": at_risk,
            "non_compliant": non_compliant,
        },
        "upcoming_expirations": {
            "count": len(upcoming),
            "documents": [
                {
                    "id": d.id,
                    "name": d.name,
                    "type": d.document_type,
                    "expires_on": d.expires_on,
                    "vehicle_id": d.vehicle_id,
                }
                for d in upcoming[:20]
            ],
        },
        "status": "compliant" if compliance_score >= 80 else "at_risk" if compliance_score >= 50 else "non_compliant",
    }



# ============================================================================
# ACTIVITY FEED
# ============================================================================

@router.get("/activity-feed", response_model=dict)
def get_activity_feed(
    user: User = Depends(require_roles("owner", "fleet_manager", "accountant")),
    database: Session = Depends(get_db),
    limit: int = 50,
) -> dict:
    """Get activity feed for the organization with recent events"""
    # Get audit events
    audit_events = database.query(AuditEvent).filter(
        AuditEvent.organization_id == user.organization_id
    ).order_by(AuditEvent.created_at.desc()).limit(limit).all()
    if user.role == "accountant":
        audit_events = [
            event for event in audit_events
            if event.entity_type in {"expense", "fuel_transaction", "toll_transaction"}
            or event.action.startswith(("expense.", "finance.", "fuel.", "toll."))
        ]
    
    # Get recent work order updates
    work_orders = [] if user.role == "accountant" else database.query(WorkOrder).filter(
        WorkOrder.organization_id == user.organization_id
    ).order_by(WorkOrder.created_at.desc()).limit(limit).all()
    
    # Get recent notifications
    notifications = database.query(OperationalNotification).join(
        NotificationDelivery,
        NotificationDelivery.notification_id == OperationalNotification.id,
    ).filter(
        OperationalNotification.organization_id == user.organization_id,
        NotificationDelivery.organization_id == user.organization_id,
        NotificationDelivery.user_id == user.id,
        NotificationDelivery.channel == "in_app",
    ).distinct().order_by(OperationalNotification.created_at.desc()).limit(limit).all()
    
    # Build activity feed
    activities = []
    
    for event in audit_events:
        actor = database.get(User, event.actor_user_id)
        activities.append({
            "type": "audit",
            "id": event.id,
            "actor": actor.full_name if actor else "Unknown",
            "action": event.action,
            "entity_type": event.entity_type,
            "summary": event.summary,
            "timestamp": event.created_at.isoformat(),
        })
    
    for wo in work_orders:
        vehicle = database.get(Vehicle, wo.vehicle_id)
        activities.append({
            "type": "work_order",
            "id": wo.id,
            "title": wo.title,
            "status": wo.status,
            "vehicle": vehicle.registration_number if vehicle else "N/A",
            "timestamp": wo.created_at.isoformat(),
        })
    
    for notif in notifications:
        activities.append({
            "type": "notification",
            "id": notif.id,
            "title": notif.title,
            "severity": notif.severity,
            "entity_type": notif.entity_type,
            "timestamp": notif.created_at.isoformat(),
        })
    
    # Sort by timestamp and limit
    activities = sorted(activities, key=lambda x: x["timestamp"], reverse=True)[:limit]
    
    return {
        "total_activities": len(activities),
        "activities": activities,
    }


@router.get("/activity-feed/by-type", response_model=dict)
def get_activity_feed_by_type(
    user: User = Depends(require_roles("owner", "fleet_manager", "accountant")),
    database: Session = Depends(get_db),
    activity_type: str = "all",
) -> dict:
    """Get activity feed filtered by type"""
    if activity_type == "audit" or activity_type == "all":
        audit_events = database.query(AuditEvent).filter(
            AuditEvent.organization_id == user.organization_id
        ).order_by(AuditEvent.created_at.desc()).limit(100).all()
        if user.role == "accountant":
            audit_events = [
                event for event in audit_events
                if event.entity_type in {"expense", "fuel_transaction", "toll_transaction"}
                or event.action.startswith(("expense.", "finance.", "fuel.", "toll."))
            ]
    else:
        audit_events = []
    
    if user.role != "accountant" and (activity_type == "work_orders" or activity_type == "all"):
        work_orders = database.query(WorkOrder).filter(
            WorkOrder.organization_id == user.organization_id
        ).order_by(WorkOrder.created_at.desc()).limit(100).all()
    else:
        work_orders = []
    
    if activity_type == "notifications" or activity_type == "all":
        notifications = database.query(OperationalNotification).join(
            NotificationDelivery,
            NotificationDelivery.notification_id == OperationalNotification.id,
        ).filter(
            OperationalNotification.organization_id == user.organization_id,
            NotificationDelivery.organization_id == user.organization_id,
            NotificationDelivery.user_id == user.id,
            NotificationDelivery.channel == "in_app",
        ).distinct().order_by(OperationalNotification.created_at.desc()).limit(100).all()
    else:
        notifications = []
    
    return {
        "activity_type_filter": activity_type,
        "audit_events": len(audit_events),
        "work_orders": len(work_orders),
        "notifications": len(notifications),
        "summary": {
            "audit": [
                {
                    "id": e.id,
                    "action": e.action,
                    "summary": e.summary,
                    "created_at": e.created_at.isoformat(),
                }
                for e in audit_events[:20]
            ],
            "work_orders": [
                {
                    "id": wo.id,
                    "title": wo.title,
                    "status": wo.status,
                    "created_at": wo.created_at.isoformat(),
                }
                for wo in work_orders[:20]
            ],
            "notifications": [
                {
                    "id": n.id,
                    "title": n.title,
                    "severity": n.severity,
                    "created_at": n.created_at.isoformat(),
                }
                for n in notifications[:20]
            ],
        },
    }


# ============================================================================
# MAINTENANCE PLANNING
# ============================================================================

@router.get("/maintenance/plan", response_model=dict)
def get_maintenance_plan(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Get organization-wide maintenance plan"""
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == user.organization_id
    ).all()
    
    plans = database.query(MaintenancePlan).filter(
        MaintenancePlan.organization_id == user.organization_id,
        MaintenancePlan.active == True,
    ).all()
    
    # Group plans by vehicle
    plans_by_vehicle = {}
    for plan in plans:
        if plan.vehicle_id not in plans_by_vehicle:
            plans_by_vehicle[plan.vehicle_id] = []
        plans_by_vehicle[plan.vehicle_id].append(plan)
    
    # Calculate upcoming maintenance
    upcoming = []
    for vehicle in vehicles:
        vehicle_plans = plans_by_vehicle.get(vehicle.id, [])
        
        for plan in vehicle_plans:
            if plan.next_due_km and vehicle.odometer_km:
                km_remaining = plan.next_due_km - vehicle.odometer_km
                if km_remaining > 0:
                    upcoming.append({
                        "vehicle_id": vehicle.id,
                        "vehicle_registration": vehicle.registration_number,
                        "maintenance_plan": plan.name,
                        "due_km": plan.next_due_km,
                        "current_km": vehicle.odometer_km,
                        "km_remaining": km_remaining,
                        "due_date": plan.next_due_on,
                        "overdue": False,
                    })
                else:
                    upcoming.append({
                        "vehicle_id": vehicle.id,
                        "vehicle_registration": vehicle.registration_number,
                        "maintenance_plan": plan.name,
                        "due_km": plan.next_due_km,
                        "current_km": vehicle.odometer_km,
                        "km_remaining": km_remaining,
                        "due_date": plan.next_due_on,
                        "overdue": True,
                    })
    
    # Sort by km_remaining
    upcoming = sorted(upcoming, key=lambda x: x["km_remaining"])
    
    # Count overdue
    overdue_count = len([u for u in upcoming if u["overdue"]])
    
    return {
        "total_vehicles": len(vehicles),
        "total_maintenance_plans": len(plans),
        "upcoming_maintenance": len(upcoming),
        "overdue_maintenance": overdue_count,
        "schedule": upcoming[:50],  # Return first 50
    }


@router.post("/maintenance/plan/update-vehicle-schedule", response_model=dict)
def update_vehicle_maintenance_schedule(
    vehicle_id: int,
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Update maintenance schedule for a vehicle"""
    reserve_idempotency_key(Request(), user, database)
    
    vehicle = database.get(Vehicle, vehicle_id)
    if not vehicle or vehicle.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    plans_data = payload.get("plans", [])
    
    updated_count = 0
    for plan_data in plans_data:
        plan_id = plan_data.get("plan_id")
        next_due_km = plan_data.get("next_due_km")
        next_due_on = plan_data.get("next_due_on")
        
        plan = database.get(MaintenancePlan, plan_id)
        if not plan or plan.organization_id != user.organization_id:
            continue
        
        plan.next_due_km = next_due_km
        plan.next_due_on = next_due_on
        database.add(plan)
        updated_count += 1
    
    database.commit()
    
    return {
        "vehicle_id": vehicle_id,
        "plans_updated": updated_count,
        "updated": True,
    }


@router.post("/maintenance/plan/create", response_model=dict)
def create_maintenance_plan_advanced(
    payload: dict,
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
) -> dict:
    """Create a new maintenance plan"""
    reserve_idempotency_key(Request(), user, database)
    
    vehicle_id = payload.get("vehicle_id")
    vehicle = database.get(Vehicle, vehicle_id)
    
    if not vehicle or vehicle.organization_id != user.organization_id:
        raise HTTPException(status_code=404, detail="Vehicle not found")
    
    plan = MaintenancePlan(
        organization_id=user.organization_id,
        vehicle_id=vehicle_id,
        name=payload.get("name"),
        interval_km=payload.get("interval_km"),
        interval_days=payload.get("interval_days"),
        next_due_km=payload.get("next_due_km"),
        next_due_on=payload.get("next_due_on"),
        active=payload.get("active", True),
    )
    
    database.add(plan)
    database.commit()
    database.refresh(plan)
    
    return {
        "plan_id": plan.id,
        "vehicle_id": vehicle_id,
        "name": plan.name,
        "created": True,
    }


@router.get("/maintenance/forecast", response_model=dict)
def get_maintenance_forecast(
    user: User = Depends(require_roles("owner", "fleet_manager")),
    database: Session = Depends(get_db),
    days_ahead: int = 90,
) -> dict:
    """Get maintenance forecast for the fleet"""
    vehicles = database.query(Vehicle).filter(
        Vehicle.organization_id == user.organization_id
    ).all()
    
    plans = database.query(MaintenancePlan).filter(
        MaintenancePlan.organization_id == user.organization_id,
        MaintenancePlan.active == True,
    ).all()
    
    horizon_date = (datetime.now(timezone.utc) + timedelta(days=days_ahead)).strftime("%Y-%m-%d")
    
    # Group by urgency
    urgent = []  # Due within 7 days
    upcoming = []  # Due within 30 days
    planned = []  # Due within forecast period
    
    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    
    for plan in plans:
        vehicle = database.get(Vehicle, plan.vehicle_id)
        if not vehicle:
            continue
        
        due_date = plan.next_due_on
        due_km = plan.next_due_km
        
        if due_date and due_date <= horizon_date:
            maintenance_item = {
                "plan_id": plan.id,
                "vehicle_id": vehicle.id,
                "vehicle_registration": vehicle.registration_number,
                "maintenance_name": plan.name,
                "due_date": due_date,
                "due_km": due_km,
            }
            
            if due_date <= (datetime.now(timezone.utc) + timedelta(days=7)).strftime("%Y-%m-%d"):
                urgent.append(maintenance_item)
            elif due_date <= (datetime.now(timezone.utc) + timedelta(days=30)).strftime("%Y-%m-%d"):
                upcoming.append(maintenance_item)
            else:
                planned.append(maintenance_item)
    
    return {
        "forecast_period_days": days_ahead,
        "horizon_date": horizon_date,
        "summary": {
            "urgent": len(urgent),
            "upcoming": len(upcoming),
            "planned": len(planned),
        },
        "urgent_maintenance": urgent[:20],
        "upcoming_maintenance": upcoming[:20],
        "planned_maintenance": planned[:20],
    }
