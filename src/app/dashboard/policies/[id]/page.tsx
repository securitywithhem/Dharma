"use client";

/**
 * WAVE 7.2 — the policy detail / review page.
 *
 * This route did not exist (fullstack-audit-2026-08-06 §4 CRITICAL): the only
 * pages under policies/ were the list and the builder, so a generated policy
 * could never be opened again. That broke User_Journeys.md flow 3 ("TipTap
 * review/edit → publish → AuditLog entry") at the review step, which is the
 * whole point of the flagship AI-drafted-policy feature.
 *
 * The TipTap integration is the same StarterKit + Markdown pairing the builder
 * uses (policies/new/page.tsx) rather than a second editor setup — the markdown
 * round-trip has to match, or content saved by one and opened by the other
 * would drift.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import { Markdown } from "tiptap-markdown";
import { toast } from "sonner";
import {
  AlertTriangle,
  ArrowLeft,
  CheckCircle2,
  Loader2,
  Save,
  ShieldAlert,
  ShieldCheck,
  Trash2,
} from "lucide-react";

import { api } from "@/lib/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { ConfirmDialog } from "@/components/ui/confirm-dialog";
import { Skeleton } from "@/components/ui/skeleton";

type ReviewFinding = {
  type: string;
  description: string;
  severity: string;
  regulationRef?: string;
};

export default function PolicyDetailPage({ params }: { params: { id: string } }) {
  // Next 14.2: `params` is a plain object, not a promise. Deliberately NOT
  // using React.use() here — that Next 15 idiom is what caused the framework
  // detail crash fixed in WAVE 1.1, and this app is still on 14.2.
  const policyId = params.id;

  const router = useRouter();
  const utils = api.useUtils();

  const [title, setTitle] = useState("");
  const [dirty, setDirty] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [reviewJobId, setReviewJobId] = useState<string | null>(null);

  const policyQuery = api.policy.getById.useQuery({ id: policyId });
  const sessionQuery = api.user.capabilities.useQuery(undefined, { staleTime: 5 * 60_000 });

  const editor = useEditor({
    extensions: [StarterKit, Markdown],
    content: "",
    editorProps: {
      attributes: {
        class:
          "prose prose-sm sm:prose mx-auto focus:outline-none p-6 border border-dharma-border rounded-lg min-h-[420px] bg-dharma-surface",
      },
    },
    onUpdate: () => setDirty(true),
  });

  // Seed the editor once the policy arrives. Guarded on `dirty` so a background
  // refetch cannot silently discard edits the user has in progress.
  useEffect(() => {
    if (!editor || !policyQuery.data || dirty) return;
    editor.commands.setContent(policyQuery.data.content);
    setTitle(policyQuery.data.title);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, policyQuery.data?.id, policyQuery.data?.updatedAt]);

  const editorMarkdown = () =>
    (editor?.storage as { markdown?: { getMarkdown: () => string } } | undefined)?.markdown?.getMarkdown() ??
    editor?.getHTML() ??
    "";

  const updateMutation = api.policy.update.useMutation({
    onSuccess: async (updated) => {
      setDirty(false);
      toast.success(
        updated.isPublished
          ? "Saved."
          : "Saved as a draft." +
              (updated.version > 1 ? ` Now version ${updated.version} — republish when ready.` : ""),
      );
      await utils.policy.getById.invalidate({ id: policyId });
      await utils.policy.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const publishMutation = api.policy.publish.useMutation({
    onSuccess: async () => {
      toast.success("Policy published.");
      await utils.policy.getById.invalidate({ id: policyId });
      await utils.policy.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const unpublishMutation = api.policy.unpublish.useMutation({
    onSuccess: async () => {
      toast.success("Policy withdrawn to draft.");
      await utils.policy.getById.invalidate({ id: policyId });
      await utils.policy.list.invalidate();
    },
    onError: (error) => toast.error(error.message),
  });

  const deleteMutation = api.policy.delete.useMutation({
    onSuccess: async () => {
      toast.success("Policy deleted.");
      await utils.policy.list.invalidate();
      router.push("/dashboard/policies");
    },
    onError: (error) => toast.error(error.message),
  });

  const reviewDraft = api.policy.reviewDraft.useMutation({
    onSuccess: (data) => setReviewJobId(data.jobId ?? null),
    onError: (error) => toast.error(error.message),
  });

  const { data: reviewStatus } = api.policy.getReviewStatus.useQuery(
    { jobId: reviewJobId! },
    {
      enabled: !!reviewJobId,
      refetchInterval: (query) => {
        const data = query?.state?.data as { status?: string } | undefined;
        return !data || data.status === "active" ? 2000 : false;
      },
    },
  );

  const policy = policyQuery.data;
  const busy =
    updateMutation.isPending ||
    publishMutation.isPending ||
    unpublishMutation.isPending ||
    deleteMutation.isPending;

  // `policiesWrite` mirrors the server gate on update/publish/delete exactly
  // (see user.capabilities), so this can never render a control the API
  // refuses. Gated on isSuccess rather than `?? fallback` — the fallback form
  // is the anti-pattern WAVE 2.3 removed, and here it would flash edit controls
  // at a viewer on every load.
  const canEdit = sessionQuery.isSuccess && sessionQuery.data.policiesWrite;

  // ── Loading ───────────────────────────────────────────────────────────────
  if (policyQuery.isPending) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-4 w-96" />
        <Skeleton className="h-[420px] w-full" />
      </div>
    );
  }

  // ── Error ─────────────────────────────────────────────────────────────────
  // A distinct branch, not a silent empty state: the audit's §6 HIGH-1 is that
  // an outage rendering as "nothing here" reads as fact about the user's
  // compliance posture rather than as a backend failure.
  if (policyQuery.isError || !policy) {
    const notFound = policyQuery.error?.data?.code === "NOT_FOUND";
    return (
      <div className="space-y-6">
        <BackLink />
        <Card className="border-dharma-danger bg-dharma-danger-bg">
          <CardHeader>
            <div className="flex items-center gap-2 text-dharma-danger-text">
              <ShieldAlert className="h-5 w-5" />
              <CardTitle className="text-base">
                {notFound ? "Policy not found" : "Failed to load this policy"}
              </CardTitle>
            </div>
            <CardDescription>
              {notFound
                ? "It may have been deleted, or it belongs to another organisation."
                : (policyQuery.error?.message ?? "An unexpected error occurred.")}
            </CardDescription>
          </CardHeader>
          {!notFound && (
            <CardContent>
              <Button variant="outline" onClick={() => policyQuery.refetch()}>
                Try again
              </Button>
            </CardContent>
          )}
        </Card>
      </div>
    );
  }

  const findings = (reviewStatus?.status === "completed"
    ? ((reviewStatus.findings as ReviewFinding[] | undefined) ?? [])
    : []) as ReviewFinding[];

  return (
    <div className="space-y-6">
      <BackLink />

      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0 space-y-1">
          {canEdit ? (
            <input
              value={title}
              onChange={(e) => {
                setTitle(e.target.value);
                setDirty(true);
              }}
              aria-label="Policy title"
              className="w-full max-w-xl rounded-md border border-transparent bg-transparent text-3xl font-semibold tracking-tight text-dharma-ink hover:border-dharma-border focus:border-dharma-accent focus:outline-none"
            />
          ) : (
            <h1 className="text-3xl font-semibold tracking-tight">{policy.title}</h1>
          )}
          <div className="flex flex-wrap items-center gap-2 text-sm text-dharma-ink-secondary">
            <Badge variant={policy.isPublished ? "success" : "outline"}>
              {policy.isPublished ? "Published" : "Draft"}
            </Badge>
            <span>{policy.policyType.replaceAll("_", " ")}</span>
            <span aria-hidden>·</span>
            <span>Version {policy.version}</span>
            {policy.publishedAt && (
              <>
                <span aria-hidden>·</span>
                <span>Published {new Date(policy.publishedAt).toLocaleDateString()}</span>
              </>
            )}
          </div>
        </div>

        {canEdit && (
          <div className="flex shrink-0 flex-wrap gap-2">
            <Button
              variant="outline"
              disabled={busy || !dirty}
              onClick={() =>
                updateMutation.mutate({ id: policyId, title, content: editorMarkdown() })
              }
            >
              {updateMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : (
                <Save className="mr-2 h-4 w-4" />
              )}
              Save
            </Button>

            {policy.isPublished ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => unpublishMutation.mutate({ id: policyId })}
              >
                Withdraw
              </Button>
            ) : (
              <Button
                disabled={busy || dirty}
                title={dirty ? "Save your changes before publishing." : undefined}
                onClick={() => publishMutation.mutate({ id: policyId })}
              >
                <ShieldCheck className="mr-2 h-4 w-4" />
                Publish
              </Button>
            )}

            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setConfirmDelete(true)}
              aria-label="Delete policy"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {/* Editing a published policy returns it to draft — say so before they
          start typing, not in a toast afterwards. */}
      {canEdit && policy.isPublished && (
        <Card className="border-dharma-warning bg-dharma-warning-bg">
          <CardHeader className="py-3">
            <div className="flex items-center gap-2 text-dharma-warning-text">
              <AlertTriangle className="h-4 w-4" />
              <CardDescription className="text-dharma-warning-text">
                This policy is published. Changing its text returns it to draft as version{" "}
                {policy.version + 1}, so nobody attests to wording that was never approved.
              </CardDescription>
            </div>
          </CardHeader>
        </Card>
      )}

      <EditorContent editor={editor} />

      {canEdit && (
        <div className="flex flex-wrap items-center gap-3">
          <Button
            variant="outline"
            disabled={reviewDraft.isPending || reviewStatus?.status === "active"}
            onClick={() => {
              const content = editorMarkdown();
              if (content.trim().length < 50) {
                toast.error("The policy is too short to review.");
                return;
              }
              reviewDraft.mutate({ policyContent: content });
            }}
          >
            {reviewDraft.isPending || reviewStatus?.status === "active" ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : null}
            Request AI review
          </Button>
          <p className="text-sm text-dharma-ink-secondary">
            The review flags gaps and never rewrites your legal text.
          </p>
        </div>
      )}

      {reviewStatus?.status === "failed" && (
        <Card className="border-dharma-danger bg-dharma-danger-bg">
          <CardHeader className="py-3">
            <CardDescription className="text-dharma-danger-text">
              The review could not be completed. {reviewStatus.error ?? ""}
            </CardDescription>
          </CardHeader>
        </Card>
      )}

      {reviewStatus?.status === "completed" && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">AI review</CardTitle>
          </CardHeader>
          <CardContent>
            {findings.length === 0 ? (
              <div className="flex items-center text-dharma-success-text">
                <CheckCircle2 className="mr-2 h-5 w-5" />
                No issues found.
              </div>
            ) : (
              <div className="space-y-3">
                {findings.map((f, i) => (
                  <div
                    key={`${f.type}-${i}`}
                    className={`rounded-lg border-l-4 p-3 ${
                      f.severity === "HIGH"
                        ? "border-dharma-danger bg-dharma-danger-bg"
                        : f.severity === "MEDIUM"
                          ? "border-dharma-warning bg-dharma-warning-bg"
                          : "border-dharma-border bg-dharma-surface"
                    }`}
                  >
                    <p className="text-sm font-medium text-dharma-ink">{f.type}</p>
                    <p className="text-sm text-dharma-ink-secondary">{f.description}</p>
                    {f.regulationRef && (
                      <p className="mt-1 text-xs uppercase tracking-[0.15em] text-dharma-ink-secondary">
                        {f.regulationRef}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* The shared confirm dialog, not window.confirm — §6 MEDIUM-2. */}
      <ConfirmDialog
        open={confirmDelete}
        onOpenChange={setConfirmDelete}
        title="Delete this policy?"
        description={
          policy.isPublished
            ? "This policy is currently published. It will be removed from your list; the audit trail keeps a record that it existed and was live."
            : "It will be removed from your list. The audit trail keeps a record that it existed."
        }
        confirmLabel="Delete policy"
        pending={deleteMutation.isPending}
        onConfirm={() => deleteMutation.mutate({ id: policyId })}
      />
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/dashboard/policies"
      className="inline-flex items-center gap-1.5 text-sm text-dharma-ink-secondary hover:text-dharma-ink"
    >
      <ArrowLeft className="h-4 w-4" />
      All policies
    </Link>
  );
}
