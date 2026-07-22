---
title: User Personas
folder: 01_BUSINESS
tags: [dharma, business, personas]
source_docs: [1_PRD.md]
last_updated: 2026-07-23
status: draft
---

# User Personas

No dedicated persona documents (names, quotes, day-in-the-life detail) exist in the source docs. What follows is the PRD's role breakdown, not a researched persona set — see [[Target_Customers]] for the source.

- **Founder/CTO** — role: ADMIN. Primary jobs-to-be-done: pass a customer's security questionnaire, close an enterprise deal gated on SOC 2/ISO 27001.
- **Compliance Manager** — role: COMPLIANCE_MANAGER. JTBD: keep control status current, draft policies, prepare for the annual audit.
- **Viewer** — role: VIEWER. JTBD: read-only visibility into org compliance posture.
- **Auditor** — external, time-limited token access. JTBD: verify evidence and audit-log integrity without write access.

See [[Authorization]] for how these map to the `Role` enum and, in the live schema, `CustomRole`.

## Open Questions

- No MSSP-admin or enterprise-buyer persona documented, despite those roles existing in the schema (`MsspGrant`, `OrganizationSettings`). Flag for founder input.
