# Bugfix Requirements: SQL Injection in Audit Log Filtering

## Introduction

The `/audit-log` endpoint in the backend API contains a critical SQL injection vulnerability in its filtering parameters. The `action` and `outcome` query parameters are interpolated directly into SQL LIKE clauses without proper parameterization, allowing authenticated users to inject arbitrary SQL code. This vulnerability compromises data confidentiality, integrity, and could enable privilege escalation within the organization's audit records.

## Bug Analysis

### Current Behavior (Defect)

1.1 WHEN an authenticated owner user provides a malicious `action` parameter (e.g., `action="%' OR '1'='1`) THEN the system executes the injected SQL clause without sanitization, potentially exposing audit logs from other organizations

1.2 WHEN an authenticated owner user provides a malicious `outcome` parameter (e.g., `outcome="%' UNION SELECT * FROM users --`) THEN the system constructs an unsafe SQL LIKE clause that allows attackers to extract sensitive data beyond audit logs

1.3 WHEN the `action` or `outcome` parameters contain SQL metacharacters THEN the system concatenates them directly into the SQLAlchemy `ilike()` filter expressions using f-string interpolation, bypassing parameter binding protection

### Expected Behavior (Correct)

2.1 WHEN an authenticated owner user provides an `action` parameter THEN the system SHALL treat it as a literal string and perform a case-insensitive substring match without interpreting any SQL metacharacters

2.2 WHEN an authenticated owner user provides an `outcome` parameter THEN the system SHALL treat it as a literal string and perform a case-insensitive substring match without allowing SQL injection

2.3 WHEN the `action` or `outcome` parameters contain SQL metacharacters THEN the system SHALL escape or parameterize the values automatically through SQLAlchemy's ORM parameter binding, preventing SQL interpretation

### Unchanged Behavior (Regression Prevention)

3.1 WHEN a valid `action` filter value is provided (e.g., `action=create`) THEN the system SHALL CONTINUE TO return audit logs whose `action` field contains the substring "create" (case-insensitive)

3.2 WHEN a valid `outcome` filter value is provided (e.g., `outcome=success`) THEN the system SHALL CONTINUE TO return audit logs whose `changes` field contains the substring "success" (case-insensitive)

3.3 WHEN an authenticated owner user queries the `/audit-log` endpoint with valid `actor_role`, `entity_type`, `action`, and `outcome` filters THEN the system SHALL CONTINUE TO combine multiple filters with AND logic and return only records matching all non-null filter criteria

3.4 WHEN an authenticated owner user queries the `/audit-log` endpoint THEN the system SHALL CONTINUE TO return only audit logs belonging to the user's organization (filtered by `organization_id`)

3.5 WHEN an authenticated owner user queries the `/audit-log` endpoint without an `action` or `outcome` parameter THEN the system SHALL CONTINUE TO return audit logs without these filters applied
