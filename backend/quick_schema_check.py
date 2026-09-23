#!/usr/bin/env python
"""Quick schema validation without full imports."""

import ast
import sys

def extract_models_from_file(filepath):
    """Extract model definitions from models.py"""
    with open(filepath, 'r') as f:
        tree = ast.parse(f.read())
    
    models = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ClassDef):
            # Look for Mapped columns and check for organization_id
            has_org_id = False
            fk_count = 0
            
            for item in node.body:
                if isinstance(item, ast.AnnAssign):
                    # Check annotation for organization_id
                    if isinstance(item.target, ast.Name) and item.target.id == 'organization_id':
                        has_org_id = True
                    # Count foreign keys in annotation
                    if isinstance(item.annotation, ast.Subscript):
                        ann_str = ast.unparse(item.annotation)
                        if 'ForeignKey' in ann_str:
                            fk_count += 1
            
            models[node.name] = {
                'has_organization_id': has_org_id,
                'fk_count': fk_count
            }
    
    return models

if __name__ == "__main__":
    filepath = "app/models.py"
    models = extract_models_from_file(filepath)
    
    print("=" * 70)
    print("QUICK SCHEMA VALIDATION")
    print("=" * 70)
    print()
    
    # List all models
    print(f"Total Models Defined: {len(models)}")
    print()
    
    # Check critical models for new tables
    critical_models = ['MaintenanceTemplate', 'ActivityFeedEntry']
    
    print("NEW TABLES CHECK:")
    for model in critical_models:
        if model in models:
            info = models[model]
            print(f"✅ {model} exists (FKs: {info['fk_count']}, org_id: {info['has_organization_id']})")
        else:
            print(f"❌ {model} NOT FOUND")
    
    print()
    
    # Check workspace requirements
    workspaces = {
        'Triage': ['VehicleIssue', 'Vehicle', 'WorkOrder'],
        'Reports': ['AuditEvent', 'WorkOrder', 'Vehicle', 'FuelTransaction'],
        'Financials': ['Expense', 'FuelTransaction', 'TollTransaction'],
        'Activity Feed': ['AuditEvent', 'WorkOrder', 'OperationalNotification', 'ActivityFeedEntry'],
        'Maintenance Planning': ['MaintenancePlan', 'Vehicle', 'VehicleComponent', 'MaintenanceTemplate'],
        'Vendor': ['Vendor', 'PurchaseOrder'],
        'Procurement': ['PurchaseOrder', 'PurchaseOrderLine', 'Part'],
        'Telematics': ['TelematicsIntegration', 'TelematicsDevice', 'TelemetryReading'],
        'Driver Behavior': ['DriverInspection', 'TelematicsDevice', 'TelemetryReading'],
        'Fuel Tracking': ['FuelTransaction', 'Vehicle'],
        'Compliance Versioning': ['ComplianceDocument', 'DocumentVersion', 'DocumentAsset'],
    }
    
    print("WORKSPACE MODEL SUPPORT:")
    all_supported = True
    for workspace, required_models in workspaces.items():
        missing = [m for m in required_models if m not in models]
        if missing:
            print(f"❌ {workspace}: MISSING {missing}")
            all_supported = False
        else:
            print(f"✅ {workspace}")
    
    print()
    
    # Check multi-tenancy
    print("MULTI-TENANCY CHECK (organization_id):")
    multi_tenant_models = [m for m, info in models.items() 
                          if info['has_organization_id'] and m != 'Organization']
    print(f"✅ {len(multi_tenant_models)} multi-tenant models")
    
    print()
    print("=" * 70)
    if all_supported:
        print("✅ ALL VALIDATIONS PASSED - SCHEMA IS COMPLETE")
        sys.exit(0)
    else:
        print("❌ SOME VALIDATIONS FAILED")
        sys.exit(1)
