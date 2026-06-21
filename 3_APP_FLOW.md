# 3. App Flow — User Navigation & Screen Flows

## Dharma — User Navigation

---

## 1. Overall User Journey

The navigation flow is divided into an unauthenticated landing/auth space, an organization onboarding space, and a multi-tenant dashboard layout. All client actions communicate with the backend via type-safe `tRPC v11` procedures.

```
┌──────────────────┐
│   Landing Page   │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   Sign-In Page   │◄──────── Google OAuth or Magic Link Email
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│   New Org?       ├─────YES────► [ Onboarding Page: Create Org ]
└────────┬─────────┘
         │
         NO
         ▼
┌─────────────────────────────────────────────────────────────────┐
│                       MAIN DASHBOARD CONTAINER                  │
│  ├─ /dashboard (Home Score & heatmap)                          │
│  ├─ /dashboard/frameworks (Track DPDP, ISO 27001, SOC 2)        │
│  ├─ /dashboard/policies (AI Stepper & TipTap Editor)           │
│  ├─ /dashboard/evidence (Local uploads & AI pgvector mapping)   │
│  ├─ /dashboard/settings (Admin configuration & Auditor Access) │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Page Structure & Hierarchy

```
Root (layout.tsx)
├── / (Landing page)
├── /auth/signin (Sign-in form)
├── /onboarding (Organization setup - single organization per workspace)
└── /dashboard (Dashboard Layout containing Sidebar + Top Navigation)
    ├── page.tsx (Active stats, heatmaps, recent logs)
    ├── /frameworks
    │   ├── page.tsx (Framework cards grid)
    │   └── /[id] (Requirements and progress tracking list)
    ├── /policies
    │   ├── page.tsx (Policies list)
    │   └── /new (AI RAG generation form and editor workspace)
    ├── /evidence
    │   ├── page.tsx (Evidence lists with verification filter tabs)
    │   └── /[id] (Evidence details & AI pgvector matching panel)
    └── /settings
        └── page.tsx (Profile management, Google Client configuration, Auditor portal key creator)
```

---

## 3. Screen Flows & User Workflows

### Workflow 1: Direct File Upload to MinIO & Database Linking
```
CURRENT LOCATION: /dashboard/evidence
  │
  ├─→ Click "Upload Evidence" button
  │
  ├─→ Modal opens with form: Title, Type (SCREENSHOT, etc.), Framework Selector
  │
  ├─→ User drops a file (e.g., pdf or png)
  │
  ├─→ Client calls tRPC mutation 'evidence.getUploadUrl'
  │     └─ Returns { uploadUrl (MinIO presigned URL), filePath (storage key) }
  │
  ├─→ Client uploads file directly to MinIO using HTTP PUT to 'uploadUrl'
  │     └─ File bytes bypass Next.js API server, maximizing upload speed
  │
  ├─→ Client calls tRPC mutation 'evidence.create' with form data and 'filePath'
  │     ├─ Creates Evidence record in DB with status = pending
  │     └─ Enqueues a 'process-evidence' background job in BullMQ
  │
  ├─→ Client closes modal, toast notifies: "Evidence uploaded. AI is analyzing in the background."
  │
  └─→ In Background (BullMQ Worker):
        ├─ Extracts text/metadata from file
        ├─ Sends text to local Ollama to generate summary and 384-dimensional vector embedding
        ├─ Saves summary and embedding to the database Evidence row
        └─ Client page automatically updates status from pending to analyzed via subscription or poll
```

### Workflow 2: AI Evidence-to-Control pgvector Mapping
```
CURRENT LOCATION: /dashboard/evidence/[id]
  │
  ├─→ Page displays evidence details, MinIO file preview, and "AI Recommendations" panel
  │
  ├─→ Client queries tRPC procedure 'evidence.getAIRecommendations'
  │     └─ Backend runs pgvector raw cosine similarity search against 'ComplianceRequirement' table
  │
  ├─→ Panel renders top 3 recommended control requirements
  │     ├─ e.g. "Control 1: Access Control Policy Mapping (Match: 92%)"
  │     ├─ e.g. "Control 2: Data Encryption Keys (Match: 81%)"
  │     └─ Action: [Map to Control] button next to each recommendation
  │
  ├─→ User clicks "Map to Control"
  │     ├─ Calls tRPC mutation 'control.linkEvidence'
  │     ├─ Updates control status to compliant or in_progress depending on verification rules
  │     └─ Appends a new entry to the cryptographic AuditLog
  │
  └─→ Toast notification: "Evidence successfully mapped to Control."
```

### Workflow 3: AI Policy Generation with Local RAG
```
CURRENT LOCATION: /dashboard/policies/new
  │
  ├─→ Step 1: User enters Title (e.g., Privacy Policy), category, and answers 4 context prompts
  │
  ├─→ User clicks "Generate Policy Draft"
  │
  ├─→ Client calls tRPC mutation 'policy.triggerAIGeneration'
  │     ├─ Backend fetches relevant snippets from 'RegulationSnippet' table (via pgvector search)
  │     ├─ Backend enqueues a 'generate-policy' job in BullMQ and returns { jobId }
  │     └─ Client displays overlay showing "AI is drafting policy... (BullMQ job in queue)"
  │
  ├─→ Client polls tRPC query 'job.getStatus' with 'jobId'
  │     ├─ Renders loader micro-animations indicating Ollama pipeline step
  │     └─ Worker completes: local Llama 3 compiles retrieved DPDP snippets and drafts markdown
  │
  ├─→ Client receives generated markdown and renders the editor layout
  │     ├─ Top panel shows: TipTap Editor loaded with the markdown draft
  │     └─ Bottom panel shows: "Reference DPDP Act Clauses utilized by RAG" (citations)
  │
  ├─→ User reviews, edits text, and clicks "Save Draft" or "Publish Policy"
  │     ├─ Calls tRPC mutation 'policy.create'
  │     └─ If Published: Enqueues entry to cryptographic AuditLog hash-chain
```

### Workflow 4: Cryptographic Audit Log Verification
```
CURRENT LOCATION: /dashboard/page (Home Dashboard) or /dashboard/settings
  │
  ├─→ User scrolls to Audit History section and clicks "Verify Log Integrity"
  │
  ├─→ Client invokes tRPC query 'audit.verifyIntegrity'
  │     ├─ Backend fetches all AuditLog rows for organization ordered by timestamp ASC
  │     ├─ Backend loops through rows, computing SHA-256(fields + previousHash)
  │     ├─ Compares recalculated hash with stored 'currentHash'
  │     └─ Returns { isValid: true/false, brokenLogId: String | null }
  │
  ├─→ If isValid === true:
  │     └─ Toast displays green checkmark: "Audit log integrity verified mathematically. No modifications detected."
  │
  └─→ If isValid === false:
        └─ Toast displays critical warning: "Verification failed. Chain broken at Log ID: [brokenLogId]!"
```

### Workflow 5: Time-Limited Auditor Access Portal
```
CURRENT LOCATION: /dashboard/settings
  │
  ├─→ Section: "Generate Auditor Link"
  │
  ├─→ User selects Duration dropdown (1 Day, 7 Days, 30 Days) and clicks "Generate Link"
  │
  ├─→ Client calls tRPC mutation 'settings.createAuditorKey'
  │     ├─ Generates unique secure token and registers in 'AuditorAccess' database table
  │     └─ Returns unique access URL: https://dharma.local/audit/portal?token=xxx
  │
  ├─→ User copies and shares URL with the External Auditor
  │
  ├─→ Auditor visits URL:
  │     ├─ Middleware checks JWT and verifies token is active in 'AuditorAccess' table
  │     ├─ If valid: Renders a read-only layout of compliance frameworks, controls, evidence, and audit verification page
  │     └─ Renders a countdown banner at the top showing remaining access time (e.g. "Access expires in 23h 15m")
```

---

## 4. Loading States & Breakpoints

- **Asynchronous Pollers:** Whenever a BullMQ task runs (evidence analysis, policy generation), a central loading spinner appears with a detail description ("Extracting file data...", "Calling local LLM model...").
- **Table Skeletons:** Framework requirement tables render matching gray skeletons while tRPC query loading state is true.
- **Mobile-First Layout:** The sidebar collapses to an overlay sheet on screens < 1024px. Forms and tables automatically stack vertically for tablet/mobile screen compatibility.
