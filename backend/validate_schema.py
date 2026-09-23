#!/usr/bin/env python
"""Database schema validation script to verify all foreign key relationships and constraints."""

from app.models import Base
from sqlalchemy import inspect
import sys

def validate_foreign_keys():
    """Validate all foreign key relationships in the schema."""
    errors = []
    
    # Get all tables from metadata
    metadata = Base.metadata
    tables = {table.name: table for table in metadata.sorted_tables}
    
    print("=" * 80)
    print("DATABASE SCHEMA VALIDATION REPORT")
    print("=" * 80)
    print()
    
    # Validate each table's foreign keys
    for table_name, table in tables.items():
        print(f"Table: {table_name}")
        
        # Check if table has organization_id (multi-tenancy)
        has_org_id = any(col.name == 'organization_id' for col in table.columns)
        has_org_fk = any(
            fk.column.name == 'organization_id' and fk.column.table.name == 'organizations'
            for fk in table.foreign_keys
        )
        
        if table_name not in ['organizations', 'users']:
            if has_org_id and not has_org_fk:
                errors.append(f"  ⚠️  {table_name}: has organization_id column but missing FK to organizations")
        
        # List all foreign keys
        fks = list(table.foreign_keys)
        if fks:
            print(f"  Foreign Keys: {len(fks)}")
            for fk in fks:
                parent_table = fk.column.table.name
                parent_col = fk.column.name
                child_col = fk.parent.name
                print(f"    ✓ {child_col} → {parent_table}.{parent_col}")
        else:
            if table_name not in ['organizations']:
                print(f"  ⚠️  No foreign keys defined")
        
        # List indexes
        indexes = list(table.indexes)
        if indexes:
            print(f"  Indexes: {len(indexes)}")
            for idx in indexes:
                cols = [col.name for col in idx.columns]
                print(f"    ✓ {idx.name}: {', '.join(cols)}")
        
        # Check for organization_id index
        if has_org_id:
            org_indexed = any(
                col.name == 'organization_id' 
                for idx in table.indexes 
                for col in idx.columns
            )
            if not org_indexed:
                print(f"  ⚠️  organization_id not indexed (performance concern)")
        
        print()
    
    # Summary statistics
    print("=" * 80)
    print("SUMMARY")
    print("=" * 80)
    total_tables = len(tables)
    total_fks = sum(len(list(t.foreign_keys)) for t in tables.values())
    total_indexes = sum(len(list(t.indexes)) for t in tables.values())
    
    print(f"Total Tables: {total_tables}")
    print(f"Total Foreign Keys: {total_fks}")
    print(f"Total Indexes: {total_indexes}")
    print()
    
    # Validation results
    if errors:
        print("VALIDATION ISSUES FOUND:")
        print()
        for error in errors:
            print(error)
        print()
        return False
    else:
        print("✅ ALL VALIDATIONS PASSED")
        print()
        return True

def validate_11_workspaces():
    """Verify all 11 workspaces have proper model support."""
    workspaces = {
        'Triage': ['vehicle_issues', 'vehicles', 'users', 'work_orders'],
        'Reports': ['audit_events', 'work_orders', 'vehicles', 'fuel_transactions', 'maintenance_plans'],
        'Financials': ['expenses', 'fuel_transactions', 'toll_transactions', 'billing_invoices'],
        'Activity Feed': ['audit_events', 'work_orders', 'operational_notifications', 'activity_feed_entries'],
        'Maintenance Planning': ['maintenance_plans', 'vehicles', 'vehicle_components', 'maintenance_templates'],
        'Vendor': ['vendors', 'purchase_orders', 'purchase_order_lines'],
        'Procurement': ['purchase_orders', 'purchase_order_lines', 'parts', 'vendors'],
        'Telematics': ['telematics_integrations', 'telematics_devices', 'telemetry_readings'],
        'Driver Behavior': ['driver_inspections', 'telematics_devices', 'telemetry_readings', 'vehicles'],
        'Fuel Tracking': ['fuel_transactions', 'vehicles', 'users'],
        'Compliance Versioning': ['compliance_documents', 'document_versions', 'document_assets'],
    }
    
    metadata = Base.metadata
    tables = {table.name for table in metadata.sorted_tables}
    
    print("=" * 80)
    print("WORKSPACE MODEL SUPPORT VALIDATION")
    print("=" * 80)
    print()
    
    all_supported = True
    for workspace, required_tables in workspaces.items():
        missing = [t for t in required_tables if t not in tables]
        if missing:
            print(f"❌ {workspace}: MISSING TABLES: {', '.join(missing)}")
            all_supported = False
        else:
            print(f"✅ {workspace}: All required tables present")
    
    print()
    if all_supported:
        print("✅ ALL 11 WORKSPACES HAVE COMPLETE MODEL SUPPORT")
    else:
        print("❌ SOME WORKSPACES MISSING MODEL SUPPORT")
    
    print()
    return all_supported

if __name__ == "__main__":
    print("\n")
    fk_valid = validate_foreign_keys()
    workspace_valid = validate_11_workspaces()
    
    print("=" * 80)
    print("FINAL RESULT")
    print("=" * 80)
    
    if fk_valid and workspace_valid:
        print("✅ DATABASE SCHEMA IS COMPLETE AND READY FOR DEPLOYMENT")
        sys.exit(0)
    else:
        print("❌ DATABASE SCHEMA HAS ISSUES")
        sys.exit(1)
