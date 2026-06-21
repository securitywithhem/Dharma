# 4. UI/UX Design Brief

## Dharma — Design System & Visual Guidelines

---

## 1. Design Philosophy

### Core Principles

1. **Information Hierarchy & Clarity First**
   - Compliance status must be instantly scannable.
   - Dashboards should present high-level aggregates (overall score) and support deep drilling into individual controls.
   - No unnecessary decorative elements that clutter the view.

2. **Security & Authority**
   - Professional, minimal developer aesthetic inspired by platforms like Vercel and Linear.
   - Use clean, dark-mode friendly gray and slate tones.
   - Explicit visual confirmation of actions (e.g. log integrity validation states).

3. **Efficiency of Action**
   - Multi-step wizards (like RAG policy drafting) are broken down into logical steps.
   - Provide drag-and-drop file upload zones with clear progress indicators.

4. **Consistency**
   - Standardized components mapped directly to tailwind utility classes and `shadcn/ui` modules.
   - Consistent state changes for all query statuses (loading skeletons, empty states, error toasts).

---

## 2. Color Palette

Dharma uses CSS variables to manage colors, supporting a seamless light and dark mode toggle.

### Primary Colors (Deep Saffron/Ochre Accent)
- **Primary Saffron (Light/Medium/Dark):** Used for links, primary buttons, and highlight states.
  - Light: `#FEF3C7` (amber-100)
  - Base: `#D97706` (amber-600)
  - Dark: `#92400E` (amber-800)
  - CSS Variable: `--color-primary` (maps to `#D97706` in light, `#F59E0B` in dark)

### Status Colors
- **Success/Accent (Emerald):** Denotes compliance, growth, verified evidence, and valid cryptographic hash chains.
  - Hex: `#10B981` (500)
  - CSS Variable: `--color-success`
- **Warning (Amber/Orange):** Denotes in-progress controls, pending files, or expiring tokens.
  - Hex: `#F59E0B` (500)
  - CSS Variable: `--color-warning`
- **Danger (Red):** Denotes non-compliant requirements, rejected evidence, and broken cryptographic log chains.
  - Hex: `#EF4444` (500)
  - CSS Variable: `--color-danger`

### Grayscale (Stone Theme)
- Light Mode:
  - Background: `#FAFAF9` (stone-50)
  - Card/Container BG: `#FFFFFF`
  - Text Main: `#1C1917` (stone-900)
  - Text Muted: `#78716C` (stone-500)
  - Border: `#E7E5E4` (stone-200)
- Dark Mode:
  - Background: `#0C0A09` (stone-950)
  - Card/Container BG: `#1C1917` (stone-900)
  - Text Main: `#FAFAF9` (stone-50)
  - Text Muted: `#A8A29E` (stone-400)
  - Border: `#292524` (stone-800)

---

## 3. Typography

- **Primary Font:** Inter (Headings: semi-bold/bold, Body: regular/medium)
- **Code Font:** JetBrains Mono or IBM Plex Mono (used for rendering policies, logs, hashes, and code blocks)

---

## 4. Custom Component Specifications

### 1. Cryptographic Audit Chain Validation Box
- **Valid State:** Renders as a banner or container with:
  - Background: `#D1FAE5` (Emerald-100) or dark equivalent.
  - Border: `1px solid #10B981`
  - Icon: `FiShieldCheck` (Emerald-600)
  - Text: "Cryptographic hash chain validated successfully. (calculated count: N records)"
- **Corrupted State:** Renders as an warning banner:
  - Background: `#FEE2E2` (Red-100)
  - Border: `1px solid #EF4444`
  - Icon: `FiShieldAlert` (Red-600)
  - Text: "Integrity check failed. Chain broken at Log ID: [UUID]"

### 2. Local File Dropzone (MinIO Upload)
- **Normal State:** Dotted border (`border-dashed border-2 border-slate-300`), centering icon `FiUploadCloud`, prompt text "Drag & drop screenshot or document here, or click to browse."
- **Uploading State:** Displays progress bar (`h-2 bg-slate-200 rounded`, fill width animated with `--color-primary`), and upload percentage indicator.

### 3. Ollama Queue Loading Indicator
- Renders during background policy drafting or text vectorization:
  - Shows spinning loader alongside description status:
    - `Waiting in queue...` (Redis BullMQ state)
    - `Fetching regulation context...` (pgvector search execution)
    - `Drafting policy sections using Llama 3...` (Ollama inference)
  - Pulsing text opacity transition (0.5 to 1.0) to indicate activity.

### 4. Auditor Countdown Banner
- Fixed to the top of the auditor viewport:
  - Background: `#312E81` (Indigo-900)
  - Text: White, bold typography displaying remaining hours/minutes (`Access Session Expires in: 23h 14m`).
  - Access restriction notes (read-only warning).

---

## 5. Layout & Breakpoints

- **Sidebar Menu:** Width: `256px`. Standard collapsible states. Links use `Lucide React` icons:
  - Dashboard: `FiGrid`
  - Frameworks: `FiLayers`
  - Policies: `FiFeather`
  - Evidence: `FiFileText`
  - Settings: `FiSettings`
- **Responsive Layout:**
  - Desktop (>1024px): Sidebar locked, full main view.
  - Tablet/Mobile (<1024px): Sidebar hidden, triggered by top-navigation hamburger icon. Grid components collapse from 3-column layouts to single-column streams.
