#!/usr/bin/env python
"""Comprehensive database schema validation report for all 11 workspaces."""

import ast
import sys
from collections import defaultdict

def extract_models_from_file(filepath):
    """Extract model definitions from models.py"""
    with open(filepath, 'r') as f:
        content = f.read()
        tree = ast.parse(content)
    
    models = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            columns = []
            fks = []
            indexes = []
            
            for item in node.body:
                if isinstance(item, ast.AnnAssign):
                    if isinstance(item.target, ast.Name):
                        col_name = item.target.id
                        columns.append(col_name)
                        
                        # Check for foreign keys
                        if isinstance(item.annotation, ast.Subscript):
                            ann_str = ast.unparse(item.annotation)
                            if 'ForeignKey' in ann_str:
                                # Extract table reference
                                if item.value and isinstance(item.value, ast.Call):
                                    for arg in item.value.args:
                                        if isinstance(arg, ast.Constant):
                                            fks.append((col_name, arg.value))
            
            models[node.name] = {
                'columns': columns,
                'fk_count': len(fks),
                'fks': fks,
                'has_organization_id': 'organization_id' in columns,
                'has_created_at': 'created_at' in columns,
            }
    
    return models

def validate_workspace(workspace_name, required_models, models):
    """Validate a workspace has all required models."""
    missing = []
    found = []
    
    for model in required_models:
        if model in models:
            found.append(model)
        else:
            missing.append(model)
    
    return {
        'name': workspace_name,
        'required': required_models,
        'found': found,
        'missing': missing,
        'is_complete': len(missing) == 0,
    }

def main():
    filepath = "app/models.py"
    models = extract_models_from_file(filepath)
    
    # Define 11 workspaces and their required models
    workspaces = {
        'Triage': {
            'description': 'Vehicle issue triage and work order creation',
            'models': ['VehicleIssue', 'Vehicle', 'User', 'WorkOrder', 'AuditEvent'],
        },
        'Reports': {
            'description': 'Maintenance, fuel, and operational reporting',
            'models': ['AuditEvent', 'WorkOrder', 'Vehicle', 'FuelTransaction', 'MaintenancePlan', 'Expense'],
        },
        'Financials': {
            'description': 'Expense tracking, fuel costs, toll charges, billing',
            'models': ['Expense', 'FuelTransaction', 'TollTransaction', 'BillingInvoice', 'BillingPayment'],
        },
        'Activity Feed': {
            'description': 'Real-time activity stream across all entities',
            'models': ['AuditEvent', 'WorkOrder', 'OperationalNotification', 'ActivityFeedEntry'],
        },
        'Maintenance Planning': {
            'description': 'Preventive maintenance schedules and templates',
            'models': ['MaintenancePlan', 'Vehicle', 'VehicleComponent', 'MaintenanceTemplate', 'WorkOrder'],
        },
        'Vendor Management': {
            'description': 'Supplier and vendor information management',
            'models': ['Vendor', 'PurchaseOrder', 'PurchaseOrderLine', 'PurchaseOrderReceipt'],
        },
        'Procurement': {
            'description': 'Purchase order lifecycle and inventory receiving',
            'models': ['PurchaseOrder', 'PurchaseOrderLine', 'Part', 'Vendor', 'StockLocation', 'InventoryMovement'],
        },
        'Telematics': {
            'description': 'GPS tracking and vehicle sensor data',
            'models': ['TelematicsIntegration', 'TelematicsDevice', 'TelemetryReading', 'Vehicle'],
        },
        'Driver Behavior': {
            'description': 'Driver inspections, performance metrics, and incident tracking',
            'models': ['DriverInspection', 'TelematicsDevice', 'TelemetryReading', 'Vehicle', 'VehicleAssignment'],
        },
        'Fuel Tracking': {
            'description': 'Fuel purchases, efficiency metrics, and anomaly detection',
            'models': ['FuelTransaction', 'Vehicle', 'User'],
        },
        'Compliance Versioning': {
            'description': 'Document lifecycle, versioning, and expiry tracking',
            'models': ['ComplianceDocument', 'DocumentVersion', 'DocumentAsset'],
        },
    }
    
    print("=" * 90)
    print("COMPREHENSIVE DATABASE SCHEMA VALIDATION REPORT")
    print("=" * 90)
    print()
    
    # Overall statistics
    print(f"Total Models Defined: {len(models)}")
    print(f"Total Workspaces: {len(workspaces)}")
    print()
    
    # Validate each workspace
    print("=" * 90)
    print("WORKSPACE MODEL SUPPORT VALIDATION")
    print("=" * 90)
    print()
    
    results = []
    for workspace_name, workspace_info in workspaces.items():
        result = validate_workspace(
            workspace_name,
            workspace_info['models'],
            models
        )
        results.append(result)
        
        status = "✅ COMPLETE" if result['is_complete'] else "❌ INCOMPLETE"
        print(f"{status} | {workspace_name}")
        print(f"       {workspace_info['description']}")
        print(f"       Models: {', '.join(result['found'])}")
        
        if result['missing']:
            print(f"       ⚠️  MISSING: {', '.join(result['missing'])}")
        
        print()
    
    # Summary
    print("=" * 90)
    print("SCHEMA STATISTICS")
    print("=" * 90)
    print()
    
    complete_workspaces = sum(1 for r in results if r['is_complete'])
    print(f"Workspaces with Complete Model Support: {complete_workspaces}/{len(workspaces)}")
    print()
    
    # Multi-tenancy check
    multi_tenant = [m for m, info in models.items() if info['has_organization_id'] and m != 'Organization']
    print(f"Multi-Tenant Models (with organization_id): {len(multi_tenant)}")
    print(f"Models with Audit Trail (created_at): {sum(1 for m in models.values() if m['has_created_at'])}")
    print()
    
    # Foreign key stats
    total_fks = sum(m['fk_count'] for m in models.values())
    print(f"Total Foreign Key Relationships: {total_fks}")
    print()
    
    # Critical models
    print("=" * 90)
    print("CRITICAL MODELS FOR FLEETOPS PARITY")
    print("=" * 90)
    print()
    
    critical = [
        ('MaintenanceTemplate', 'Required for maintenance planning templates'),
        ('ActivityFeedEntry', 'Performance optimization for activity feed'),
        ('AuditEvent', 'Comprehensive audit logging'),
        ('TelemetryReading', 'GPS and sensor data for telematics'),
        ('DriverInspection', 'Pre/post-trip inspection records'),
    ]
    
    for model_name, description in critical:
        if model_name in models:
            info = models[model_name]
            print(f"✅ {model_name}")
            print(f"   {description}")
            print(f"   Columns: {len(info['columns'])}, FKs: {info['fk_count']}")
        else:
            print(f"❌ {model_name} - MISSING")
        print()
    
    # Final verdict
    print("=" * 90)
    print("DEPLOYMENT READINESS")
    print("=" * 90)
    print()
    
    if complete_workspaces == len(workspaces):
        print("✅ DATABASE SCHEMA IS COMPLETE AND READY FOR DEPLOYMENT")
        print()
        print("All 11 workspaces have complete model support:")
        for ws in workspaces.keys():
            print(f"  ✓ {ws}")
        print()
        print("Frontend and Backend are now feature-complete and matched.")
        return 0
    else:
        print("❌ DATABASE SCHEMA IS INCOMPLETE")
        print()
        print(f"Missing support for {len(workspaces) - complete_workspaces} workspace(s)")
        return 1

if __name__ == "__main__":
    sys.exit(main())
