# Dharma Future Scope – UI/UX Design Guide

## Design System Extension
- Keep existing Dharma base (assume dark theme, green/blue accents).
- New additions: card components for connectors, status badges, severity indicators, and a chat interface.

## Key Screens & Components

### Marketplace
- **Browse view**: Grid of framework cards (logo, name, short desc, rating stars, price/free).
- **Detail view**: Full description, control count, reviews, "Import" button.
- **Publisher dashboard**: List of published frameworks, edit, analytics.

### Cloud Connectors
- **Connectors list**: Cards per service (AWS, Azure, GitHub) with status (connected/disconnected).
- **Configuration modal**: Step-by-step wizard for entering credentials, testing connection.
- **Evidence mapping**: Drag & drop collected evidence types to framework controls.

### Pentest Dashboard
- **Test list**: Table of past/active tests with status (running, completed, failed).
- **Test detail**: Target info, timeline, list of vulnerabilities (severity, CVSS, control mapping).
- **Vulnerability card**: Expandable with description, remediation, evidence screenshot upload.

### AI Chat Interface
- **Chat panel**: Slide-over from right, resizable.
- **Message bubbles**: User messages right-aligned, AI left-aligned with avatar. Citations as clickable chips.
- **Typing indicator**, streaming text.
- **Context bar**: Shows what documents/frameworks are loaded.

### Enterprise Settings
- **SSO configuration**: Tabs SAML / OIDC, with input fields and test button.
- **Audit log viewer**: Filterable table of events, date range picker, export CSV.
- **White-label**: Live preview pane next to inputs (logo, colors, domain).

### MSSP Dashboard
- **Multi-org health tiles**: Each client org shown as a card with compliance score, open vulnerabilities, last audit date.
- **Global map**: Not required but could be nice-to-have.

## Accessibility & Responsiveness
- All new views support keyboard navigation, ARIA labels.
- Tablet-friendly for evidence review, not full admin work.

## Micro-interactions
- Connector status pulsating dot.
- Evidence auto-collection success toast with undo option.
- Scan progress bar with step labels.