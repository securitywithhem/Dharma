# Dharma Future Scope – App Flow (User Journeys)

## 1. Organization Setup & Billing
1. User signs up, creates org (Phase 3a).
2. From dashboard, sees banner "Upgrade your plan" →  clicks →  enters Stripe Checkout.
3. After successful payment, plan updated immediately, banner disappears, features unlock.

## 2. Marketplace Import
1. User navigates to "Marketplace" from sidebar.
2. Browses frameworks by category, sees ratings.
3. Clicks "Import" on SOC2 →  confirmation modal →  framework and all controls copied into org.
4. Redirected to framework detail page, ready to assign evidence.

## 3. Connecting AWS for Automated Evidence
1. User goes to Settings →  Connectors →  "Add Connector" →  selects AWS.
2. Instructions: create an IAM role with read-only policy, enter ARN & external ID.
3. Dharma validates connection, then shows a list of available evidence types (S3 encryption, CloudTrail enabled, etc.).
4. User selects ones to auto-collect, sets schedule (daily).
5. Evidence appears automatically in the relevant control's evidence list, marked "auto-collected".

## 4. Requesting a Pentest
1. User opens "Pentests" module →  "New Test" →  enters target domain/IP, selects test type (external network).
2. System runs a safe scan in background, displays progress.
3. When done, findings appear as vulnerabilities linked to the "Vulnerability Management" control in the active framework.
4. User can accept/close each finding and generate a report.

## 5. AI Advisor Interaction
1. User opens AI chat (floating button or sidebar).
2. Types: "Do we have any controls related to encryption at rest?"
3. Advisor searches vector store, returns a list of relevant controls with status and links.
4. User: "Generate a gap analysis against SOC2 CC6."
5. Advisor returns a structured breakdown with passing/failing evidence, references.
6. User can click to navigate to each control directly.

## 6. Enterprise SSO & White-Label Setup
1. Enterprise admin goes to Settings →  Enterprise →  SSO.
2. Enters SAML metadata URL or uploads XML.
3. Dharma validates, provides callback URL.
4. Enforces SSO-only login for that org.
5. White-label tab: upload logo, set primary color, custom domain CNAME record.
6. Changes reflected immediately across all org pages.

## 7. MSSP Operations Dashboard
1. Partner user (with "MSSP Admin" role) logs in, sees org selector plus a "Client Overview" screen.
2. Dashboard shows aggregated compliance scores across all managed clients, with drill-down into any org.
3. Can generate consolidated report for all clients.}