# Dharma Future Scope – Product Requirements Document (PRD)

## Overview
This document defines the product requirements for the full future evolution of Dharma beyond the single-org MVP and multi-tenant foundation. It covers all planned capabilities across six major phases, turning Dharma from a compliance tracker into a complete compliance operations platform with marketplace, automation, AI, and enterprise features.

## Phase 3: Multi-Tenant SaaS & Marketplace (remaining parts)
### Part 2: Billing & Subscription
- As an org owner, I can select a plan (Free/Pro/Enterprise), enter payment details, and upgrade/downgrade.
- As an org owner, I can view invoices and billing history.
- Free tier limitations: 5 users, 3 frameworks, 100 MB evidence storage.
- Stripe integration with webhooks for plan enforcement.

### Part 3: Marketplace (Framework & Plugin Store)
- As any user, I can browse a public marketplace of compliance frameworks (SOC2, ISO 27001, HIPAA, etc.) and import them into my org with one click.
- As a compliance expert, I can publish a framework (with controls & evidence templates) and set a price.
- Marketplace listings support reviews, ratings, and versioning.
- Free official frameworks provided by Dharma, paid community frameworks with revenue share.

## Phase 4: Advanced Automation & Cloud Connectors
- As a security engineer, I can connect Dharma to my AWS/Azure/GCP account (read-only) and auto-collect evidence (e.g., config snapshots, logging status, IAM policies).
- As a compliance manager, I can define automated control tests: every 24h check if S3 buckets are encrypted, if MFA is enforced, etc., and automatically update control status.
- As a user, I can create custom webhooks to trigger external workflows when evidence is updated or a control fails.
- Pre-built connectors: AWS (Config, CloudTrail), GitHub (repo settings, branch protection), Okta (MFA status), Jira (policy approvals).

## Phase 5: Penetration Testing & Vulnerability Scanning
- As an org admin, I can request an automated external network penetration test (lightweight, safe) on my defined assets, with a scheduled cadence.
- As a security tester, I can manually log findings (vulnerabilities) linked to controls or assets, with CVSS scoring.
- Vulnerability dashboard showing trends, open/closed, risk heatmap.
- Integration with OWASP ZAP/Burp (via connectors) to import results.

## Phase 6: Advanced Compliance Frameworks & Cross-Walking
- Support for custom frameworks with arbitrary control hierarchies.
- Cross-walking: map controls between frameworks (e.g., SOC2 CC6.1 ↔  ISO 27001 A.9.2.1) and see overlap heatmaps.
- Audit readiness score per framework with actionable recommendations.

## Phase 7: AI-Powered Compliance Advisor
- Chat interface that understands the organization's compliance data.
- Capabilities: "Generate a gap assessment against SOC2", "Draft a policy for access control", "Explain why this control failed and how to fix it".
- Document ingestion: upload security docs (policies, incident reports), ask questions about them.
- Evidence auto-tagging using NLP when uploading screenshots/files.

## Phase 8: Enterprise Features & White-Label
- SSO (SAML/OIDC), SCIM provisioning.
- Audit logs (every action in org), exportable to SIEM.
- RBAC with custom roles, team scoping.
- White-label: custom domain, logo, email templates, CSS overrides.
- Compliance Operations Dashboard for MSSPs – manage multiple client orgs from a single pane.

## Phase 9 (Bonus): Compliance Operations Platform
- Agent installation on endpoints for continuous compliance monitoring (EDR-lite).
- Advanced reporting (custom PDF reports, board summaries).
- Regulatory change monitoring – alerts when frameworks update.
- Full API for third-party integrations.

## Out of Scope (for now)
- On-premise deployment
- Blockchain-based audit logs
- Built-in pentest execution engine (we integrate, don't build a full scanner)

## Success Metrics
- Time to first framework import < 5 min
- Automated evidence collection saves 10h/month per org
- AI advisor answers correctly in >80% of test cases
- Enterprise deals closed within 2 weeks of trial}