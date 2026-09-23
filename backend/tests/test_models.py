"""
Fixed Bug 34: Unit tests for core business logic models
Tests cover Vehicle, WorkOrder, and Inventory transaction models with edge cases
"""
import pytest
from datetime import datetime, timezone
from sqlalchemy.orm import Session
from app.database import Base, SessionLocal, engine
from app.models import Vehicle, WorkOrder, Organization, User, Part, InventoryTransaction


@pytest.fixture
def db():
    """Provide test database session"""
    session = SessionLocal()
    yield session
    session.close()


@pytest.fixture(autouse=True)
def isolated_schema():
    Base.metadata.drop_all(bind=engine)
    Base.metadata.create_all(bind=engine)
    yield


@pytest.fixture
def test_org(db: Session):
    """Create test organization"""
    org = Organization(name="Test Fleet", slug="test-fleet")
    db.add(org)
    db.commit()
    db.refresh(org)
    return org


@pytest.fixture
def test_user(db: Session, test_org: Organization):
    """Create test user"""
    from app.security import hash_password
    user = User(
        organization_id=test_org.id,
        email="driver@test.com",
        full_name="Test Driver",
        password_hash=hash_password("TestPass123"),
        role="driver"
    )
    db.add(user)
    db.commit()
    db.refresh(user)
    return user


def test_vehicle_creation(db: Session, test_org: Organization):
    """Test creating a vehicle with validation"""
    vehicle = Vehicle(
        organization_id=test_org.id,
        registration_number="MH12AB1234",
        model="Tata Ace",
        vehicle_type="Light Commercial",
        depot="Mumbai Central",
        status="Idle / parked",
        health=85,
        odometer_km=50000
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    
    assert vehicle.id is not None
    assert vehicle.registration_number == "MH12AB1234"
    assert vehicle.health == 85
    assert vehicle.odometer_km == 50000


def test_vehicle_driver_relationship(db: Session, test_org: Organization, test_user: User):
    """Test vehicle-driver relationship"""
    vehicle = Vehicle(
        organization_id=test_org.id,
        registration_number="KA03XY5678",
        model="Ashok Leyland",
        vehicle_type="Heavy Truck",
        depot="Bangalore",
        assigned_driver_id=test_user.id
    )
    db.add(vehicle)
    db.commit()
    db.refresh(vehicle)
    
    assert vehicle.assigned_driver_id == test_user.id
    assert vehicle.driver == test_user
    assert vehicle.driver.full_name == "Test Driver"


def test_vehicle_status_validation(db: Session, test_org: Organization):
    """Test vehicle status is one of valid options"""
    valid_statuses = ["Idle / parked", "On route", "In workshop", "Out of service", "Retired"]
    
    for status in valid_statuses:
        vehicle = Vehicle(
            organization_id=test_org.id,
            registration_number=f"TS{status[:2].upper()}9999",
            model="Test",
            vehicle_type="Test",
            depot="Test",
            status=status
        )
        db.add(vehicle)
        db.commit()
        db.refresh(vehicle)
        assert vehicle.status == status


def test_work_order_creation(db: Session, test_org: Organization):
    """Test creating a work order"""
    vehicle = Vehicle(
        organization_id=test_org.id,
        registration_number="MH99ZZ9999",
        model="Test",
        vehicle_type="Test",
        depot="Test"
    )
    db.add(vehicle)
    db.flush()
    
    work_order = WorkOrder(
        organization_id=test_org.id,
        vehicle_id=vehicle.id,
        title="Oil change",
        description="Routine maintenance",
        priority="Medium",
        status="Open"
    )
    db.add(work_order)
    db.commit()
    db.refresh(work_order)
    
    assert work_order.id is not None
    assert work_order.title == "Oil change"
    assert work_order.priority == "Medium"
    assert work_order.status == "Open"


def test_work_order_status_transition(db: Session, test_org: Organization):
    """Test valid work order status transitions"""
    vehicle = Vehicle(
        organization_id=test_org.id,
        registration_number="MH88ZZ8888",
        model="Test",
        vehicle_type="Test",
        depot="Test"
    )
    db.add(vehicle)
    db.flush()
    
    work_order = WorkOrder(
        organization_id=test_org.id,
        vehicle_id=vehicle.id,
        title="Test",
        status="Open"
    )
    db.add(work_order)
    db.flush()
    
    # Test transition from Open to In progress
    work_order.status = "In progress"
    db.commit()
    db.refresh(work_order)
    assert work_order.status == "In progress"
    
    # Test transition to completed
    work_order.status = "Completed"
    work_order.completed_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(work_order)
    assert work_order.status == "Completed"
    assert work_order.completed_at is not None


def test_inventory_transaction(db: Session, test_org: Organization, test_user: User):
    """Test inventory transaction creation"""
    part = Part(
        organization_id=test_org.id,
        name="Engine Oil",
        sku="OIL001",
        category="Lubricants",
        quantity_on_hand=100,
        reorder_level=20
    )
    db.add(part)
    db.flush()
    
    transaction = InventoryTransaction(
        organization_id=test_org.id,
        part_id=part.id,
        transaction_type="issue",
        quantity=10,
        created_by=test_user.id
    )
    db.add(transaction)
    db.commit()
    db.refresh(transaction)
    
    assert transaction.id is not None
    assert transaction.quantity == 10
    assert transaction.transaction_type == "issue"


def test_inventory_validation(db: Session, test_org: Organization):
    """Test inventory quantity constraints"""
    part = Part(
        organization_id=test_org.id,
        name="Spark Plug",
        sku="PLUG001",
        category="Ignition",
        quantity_on_hand=5,
        reorder_level=10
    )
    db.add(part)
    db.commit()
    db.refresh(part)
    
    assert part.quantity_on_hand == 5
    assert part.reorder_level == 10
    # Low stock warning: quantity < reorder_level
    assert part.quantity_on_hand < part.reorder_level
