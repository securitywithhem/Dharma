*




---

##  DOCUMENT 6: future-scope-ImplementationPlan.md

```markdown
# Dharma Future Scope – Implementation Plan

## Overall Timeline (relative to Phase 3a completion)
- **Phase 3b (Billing)**: 2 weeks
- **Phase 3c (Marketplace)**: 3 weeks
- **Phase 4 (Automation & Connectors)**: 4 weeks
- **Phase 5 (Pentest & Vulns)**: 3 weeks
- **Phase 6 (Advanced Frameworks)**: 2 weeks
- **Phase 7 (AI Advisor)**: 4 weeks
- **Phase 8 (Enterprise & White-Label)**: 3 weeks
- **Integration, hardening, testing overlap**: +3 weeks

Total ~24 weeks (6 months) from a solid Phase 3a base.

## Detailed Task Breakdown

### Phase 3b: Billing & Subscription
1. Set up Stripe products/prices in dashboard.
2. Add `Plan` model and seed DB with free/pro/enterprise.
3. Create checkout session API endpoint, webhook handler.
4. Implement entitlement middleware (check plan limits on user invite, framework creation, file uploads).
5. Build billing page UI (plan selection, current usage, invoice history).

### Phase 3c: Marketplace
1. Create `MarketplaceItem` CRUD for global (admin) catalog.
2. Import flow: copy framework/controls/templates to org, track via `ImportedItem`.
3. Publishing flow (community): submit item, admin review (future) or auto-publish.
4. Rating and review system.
5. Marketplace UI screens (browse, detail, publisher dashboard).

### Phase 4: Automation & Cloud Connectors
1. Design connector interface and implement AWS connector using SDK.
2. Secure credential storage (encrypted JSON).
3. Connection testing and status display.
4. Evidence mapping UI + backend.
5. BullMQ scheduler for periodic evidence collection.
6. Implement webhook dispatcher with manual trigger and secret signing.

### Phase 5: Penetration Testing & Vulns
1. Containerize nuclei or similar scanner with safe options.
2. Build scan queue: create `PenTest`, push job, capture output.
3. Parse results into `Vulnerability` records, map to control if configured.
4. Vulnerability management UI (list, filter, status transitions, manual add).
5. CVSS calculator and severity badges.

### Phase 6: Advanced Frameworks
1. Allow unlimited nesting in control hierarchy (recursive component or path field).
2. Cross-walk mapping UI: side-by-side picker, mapping table.
3. Readiness score algorithm (weighted by evidence and mapping).
4. Score dashboard and recommendation engine (rule-based, later AI).

### Phase 7: AI Advisor
1. Set up pgvector, create embeddings for existing controls and evidence docs.
2. Build ingestion pipeline: on document upload, chunk and embed.
3. RAG chat endpoint: retrieve relevant chunks, compose prompt, stream response.
4. Guardrails: system prompt to restrict scope, output validation.
5. Chat UI with streaming and citation chips.
6. Rate limiting and token cost tracking per org.

### Phase 8: Enterprise & White-Label
1. SAML/OIDC implementation, SCIM server.
2. Audit event logging and viewer.
3. RBAC with custom roles (extend `MemberRole` to permissions JSON).
4. White-label settings and server-side theming.
5. MSSP dashboard: aggregate queries across org group, role-based access.

### Integration & Testing
- Full regression on tenant isolation after each phase.
- Load testing for AI and scan endpoints.
- Security review for connector credential handling.

## Dependencies
- AI advisor depends on Phase 6 (advanced frameworks) for rich context.
- Marketplace can run parallel to billing.
- Enterprise SSO independent but benefits from billing plan enforcement.

## Milestones
| Milestone | Deliverable | ETA from start |
|-----------|-------------|----------------|
| M1 | Billing + Marketplace live | Week 5 |
| M2 | First cloud connector (AWS) working | Week 9 |
| M3 | Automated pentest MVP | Week 12 |
| M4 | AI advisor beta | Week 16 |
| M5 | Enterprise ready (SSO, audit) | Week 19 |
| M6 | Full platform release | Week 24 |