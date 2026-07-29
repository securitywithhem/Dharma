"use client";

/**
 * src/app/dashboard/policies/new/page.tsx
 *
 * Phase 2 Feature 4 — Template-First Policy Builder.
 *
 * BEFORE: Free-form context → AI writes policy from scratch.
 * AFTER:  Pick template → fill variable form → rendered Markdown → optional AI audit.
 */

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { PolicyType } from "@prisma/client";
import { api } from "@/lib/trpc";
import { toast } from "sonner";
import { Loader2, Save, FileText, CheckCircle2, ShieldCheck, AlertTriangle } from "lucide-react";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";

// ── Type helpers ──────────────────────────────────────────────────────────────

interface TemplateVariable {
  key: string;
  label: string;
  type: "text" | "date" | "email" | "boolean";
  required: boolean;
  defaultValue?: string;
}

type Step = 1 | 2 | 3 | 4;

export default function NewPolicyPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>(1);
  const [selectedTemplateId, setSelectedTemplateId] = useState<string>("");
  const [variables, setVariables] = useState<Record<string, string>>({});
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);

  // ── tRPC calls ───────────────────────────────────────────────────────────────

  const { data: templates = [], isLoading: loadingTemplates } = api.policy.listTemplates.useQuery({});

  const generateFromTemplate = api.policy.generateFromTemplate.useMutation({
    onSuccess: (data) => {
      editor?.commands.setContent(data.content);
      setStep(3);
    },
    onError: (err) => {
      toast.error(`Template render failed: ${err.message}`);
    },
  });

  const reviewDraft = api.policy.reviewDraft.useMutation({
    onSuccess: (data) => {
      setReviewJobId(data.jobId ?? null);
      setStep(4);
    },
    onError: (err) => {
      toast.error(`Review submission failed: ${err.message}`);
    },
  });

  const { data: reviewStatus } = api.policy.getReviewStatus.useQuery(
    { jobId: reviewJobId! },
    {
      enabled: !!reviewJobId,
      refetchInterval: (query) => {
        const data = query?.state?.data as any;
        if (!data || data.status === "active") return 2000;
        return false;
      },
    },
  );

  const createPolicy = api.policy.create.useMutation({
    onSuccess: () => {
      toast.success("Policy saved successfully!");
      router.push("/dashboard/policies");
    },
    onError: (err) => {
      toast.error(`Failed to save policy: ${err.message}`);
    },
  });

  // ── Editor ───────────────────────────────────────────────────────────────────

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose lg:prose-lg xl:prose-2xl mx-auto focus:outline-none p-6 border rounded-lg min-h-[500px]",
      },
    },
  });

  // Pre-fill default values when template changes
  const selectedTemplate = templates.find((t) => t.id === selectedTemplateId);

  useEffect(() => {
    if (!selectedTemplate) return;
    const defaults: Record<string, string> = {};
    for (const v of (selectedTemplate.variables as unknown as TemplateVariable[]) ?? []) {
      if (v.defaultValue) defaults[v.key] = v.defaultValue;
    }
    setVariables(defaults);
  }, [selectedTemplateId]);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleRender = () => {
    if (!selectedTemplateId) {
      toast.error("Please select a template.");
      return;
    }
    generateFromTemplate.mutate({ templateId: selectedTemplateId, variables });
  };

  const handleRequestReview = () => {
    const content = (editor?.storage as any)?.markdown?.getMarkdown() || editor?.getHTML() || "";
    if (!content) {
      toast.error("Policy content is empty.");
      return;
    }
    reviewDraft.mutate({ policyContent: content });
  };

  const handleSave = (isPublished: boolean) => {
    const content = (editor?.storage as any)?.markdown?.getMarkdown() || editor?.getHTML() || "";
    if (!content) {
      toast.error("Policy content is empty!");
      return;
    }
    const title = selectedTemplate?.name ?? "New Policy";
    const policyType = selectedTemplate?.policyType ?? PolicyType.PRIVACY_POLICY;
    createPolicy.mutate({ title, policyType, content, isPublished });
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div className="max-w-4xl mx-auto py-8">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-dharma-ink">Template-First Policy Builder</h1>
        <p className="text-dharma-ink-secondary mt-1">
          Start with a DPDP-aligned template, fill in your details, and request an AI audit —
          no AI rewrites your legal text.
        </p>
      </div>

      {/* Step 1: Pick template */}
      {step === 1 && (
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
          <h2 className="text-lg font-medium text-dharma-ink mb-4">Step 1: Choose a template</h2>
          {loadingTemplates ? (
            <div className="flex items-center text-dharma-ink-secondary">
              <Loader2 className="w-4 h-4 animate-spin mr-2" /> Loading templates…
            </div>
          ) : (
            <div className="grid gap-3">
              {templates.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTemplateId(t.id)}
                  className={`text-left p-4 rounded-lg border-2 transition-colors ${
                    selectedTemplateId === t.id
                      ? "border-dharma-accent bg-dharma-accent-tint"
                      : "border-dharma-border hover:border-dharma-accent"
                  }`}
                >
                  <div className="font-medium text-dharma-ink">{t.name}</div>
                  <div className="text-sm text-dharma-ink-secondary mt-0.5">
                    {t.policyType.replace(/_/g, " ")} · v{t.version}
                  </div>
                </button>
              ))}
            </div>
          )}
          <div className="flex justify-end mt-6">
            <button
              onClick={() => setStep(2)}
              disabled={!selectedTemplateId}
              className="bg-dharma-accent text-dharma-ink-inverse px-4 py-2 rounded-md hover:bg-dharma-accent-hover font-medium disabled:opacity-50 disabled:cursor-not-allowed"
            >
              Continue
            </button>
          </div>
        </div>
      )}

      {/* Step 2: Fill variables */}
      {step === 2 && selectedTemplate && (
        <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border animate-in fade-in slide-in-from-bottom-4">
          <h2 className="text-lg font-medium text-dharma-ink mb-4">
            Step 2: Fill in your details for &ldquo;{selectedTemplate.name}&rdquo;
          </h2>
          <div className="space-y-4">
            {(selectedTemplate.variables as unknown as TemplateVariable[]).map((v) => (
              <div key={v.key}>
                <label className="block text-sm font-medium text-dharma-ink-secondary">
                  {v.label}
                  {v.required && <span className="text-dharma-danger-text ml-1">*</span>}
                </label>
                {v.type === "boolean" ? (
                  <input
                    type="checkbox"
                    checked={variables[v.key] === "true"}
                    onChange={(e) =>
                      setVariables((prev) => ({ ...prev, [v.key]: e.target.checked ? "true" : "false" }))
                    }
                    className="mt-1 h-4 w-4"
                  />
                ) : (
                  <input
                    type={v.type === "date" ? "date" : v.type === "email" ? "email" : "text"}
                    value={variables[v.key] ?? ""}
                    onChange={(e) => setVariables((prev) => ({ ...prev, [v.key]: e.target.value }))}
                    className="mt-1 block w-full border border-dharma-border rounded-md border border-dharma-border p-2 text-sm focus:border-dharma-accent focus:ring-dharma-accent"
                    placeholder={v.defaultValue}
                  />
                )}
              </div>
            ))}
          </div>
          <div className="flex justify-between mt-6">
            <button
              onClick={() => setStep(1)}
              className="text-dharma-ink-secondary bg-dharma-surface-hover px-4 py-2 rounded-md hover:bg-dharma-surface-hover font-medium"
            >
              Back
            </button>
            <button
              onClick={handleRender}
              disabled={generateFromTemplate.isPending}
              className="bg-dharma-accent text-dharma-ink-inverse px-4 py-2 rounded-md hover:bg-dharma-accent-hover font-medium flex items-center disabled:opacity-60"
            >
              {generateFromTemplate.isPending ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" /> Rendering…
                </>
              ) : (
                "Generate Draft"
              )}
            </button>
          </div>
        </div>
      )}

      {/* Step 3: Review & Edit */}
      {step === 3 && (
        <div className="space-y-6 animate-in fade-in slide-in-from-bottom-8">
          <div className="flex justify-between items-center bg-dharma-surface p-4 rounded-lg border border-dharma-border">
            <div className="flex items-center text-dharma-success-text">
              <CheckCircle2 className="w-5 h-5 mr-2" />
              <span className="font-medium">Draft generated — review and edit below</span>
            </div>
            <div className="flex space-x-3">
              <button
                onClick={handleRequestReview}
                disabled={reviewDraft.isPending}
                className="flex items-center px-4 py-2 bg-dharma-accent-tint border border-dharma-accent rounded-md text-dharma-accent-on-tint hover:bg-dharma-accent-hover"
              >
                <ShieldCheck className="w-4 h-4 mr-2" />
                AI Audit
              </button>
              <button
                onClick={() => handleSave(false)}
                disabled={createPolicy.isPending}
                className="flex items-center px-4 py-2 bg-dharma-surface border border-dharma-border rounded-md text-dharma-ink-secondary hover:bg-dharma-surface-hover"
              >
                <Save className="w-4 h-4 mr-2" />
                Save Draft
              </button>
              <button
                onClick={() => handleSave(true)}
                disabled={createPolicy.isPending}
                className="flex items-center px-4 py-2 bg-dharma-accent rounded-md text-dharma-ink-inverse hover:bg-dharma-accent-hover"
              >
                <FileText className="w-4 h-4 mr-2" />
                Publish
              </button>
            </div>
          </div>
          <div className="bg-dharma-surface rounded-lg border border-dharma-border">
            <EditorContent editor={editor} />
          </div>
        </div>
      )}

      {/* Step 4: AI Audit Results */}
      {step === 4 && (
        <div className="space-y-6 animate-in fade-in">
          <div className="bg-dharma-surface p-6 rounded-lg border border-dharma-border">
            <h2 className="text-lg font-medium text-dharma-ink mb-4 flex items-center">
              <ShieldCheck className="w-5 h-5 mr-2 text-dharma-accent-on-tint" />
              AI Compliance Audit Results
            </h2>
            {!reviewStatus || reviewStatus.status === "active" ? (
              <div className="flex items-center text-dharma-ink-secondary">
                <Loader2 className="w-4 h-4 animate-spin mr-2" /> Analysing your policy draft…
              </div>
            ) : reviewStatus.status === "failed" ? (
              <p className="text-dharma-danger-text">Audit failed: {reviewStatus.error}</p>
            ) : reviewStatus.status === "completed" ? (
              <div>
                {(reviewStatus.findings as Array<{ type: string; description: string; severity: string; regulationRef?: string }> || []).length === 0 ? (
                  <div className="flex items-center text-dharma-success-text">
                    <CheckCircle2 className="w-5 h-5 mr-2" />
                    <span>No issues found — your policy looks good!</span>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {(reviewStatus.findings as Array<{ type: string; description: string; severity: string; regulationRef?: string }>).map(
                      (f, i) => (
                        <div
                          key={i}
                          className={`p-3 rounded-lg border-l-4 ${
                            f.severity === "HIGH"
                              ? "border-dharma-danger bg-dharma-danger-bg"
                              : f.severity === "MEDIUM"
                                ? "border-dharma-warning bg-dharma-warning-bg"
                                : "border-dharma-accent bg-dharma-accent-tint"
                          }`}
                        >
                          <div className="flex items-start">
                            <AlertTriangle className="w-4 h-4 mt-0.5 mr-2 flex-shrink-0" />
                            <div>
                              <span className="text-xs font-semibold uppercase tracking-wide">
                                {f.type.replace(/_/g, " ")} · {f.severity}
                              </span>
                              {f.regulationRef && (
                                <span className="ml-2 text-xs text-dharma-ink-secondary">§ {f.regulationRef}</span>
                              )}
                              <p className="text-sm mt-1">{f.description}</p>
                            </div>
                          </div>
                        </div>
                      ),
                    )}
                  </div>
                )}
              </div>
            ) : null}

            <div className="flex justify-between mt-6">
              <button
                onClick={() => setStep(3)}
                className="text-dharma-ink-secondary bg-dharma-surface-hover px-4 py-2 rounded-md hover:bg-dharma-surface-hover font-medium"
              >
                ← Back to Editor
              </button>
              <div className="flex space-x-3">
                <button
                  onClick={() => handleSave(false)}
                  disabled={createPolicy.isPending}
                  className="flex items-center px-4 py-2 bg-dharma-surface border border-dharma-border rounded-md text-dharma-ink-secondary hover:bg-dharma-surface-hover"
                >
                  <Save className="w-4 h-4 mr-2" /> Save Draft
                </button>
                <button
                  onClick={() => handleSave(true)}
                  disabled={createPolicy.isPending}
                  className="flex items-center px-4 py-2 bg-dharma-accent rounded-md text-dharma-ink-inverse hover:bg-dharma-accent-hover"
                >
                  <FileText className="w-4 h-4 mr-2" /> Publish
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
