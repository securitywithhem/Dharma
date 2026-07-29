"use client";

// Phase 9 Part 2 — report builder. Type toggle: CUSTOM_PDF shows a section
// checklist + framework/date pickers; BOARD_SUMMARY has a single Generate
// button (auto-composed by the graph builder, no section picker). An optional
// cadence turns the one-off into a recurring schedule.
import React, { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Presentation } from "lucide-react";
import { api } from "@/lib/trpc";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SECTIONS: { key: string; label: string }[] = [
  { key: "framework_readiness", label: "Framework readiness" },
  { key: "evidence_status", label: "Evidence status" },
  { key: "vulnerability_trend", label: "Vulnerability trend" },
  { key: "endpoint_compliance", label: "Endpoint compliance" },
];

export default function NewReportPage() {
  const router = useRouter();
  const [type, setType] = useState<"CUSTOM_PDF" | "BOARD_SUMMARY">("CUSTOM_PDF");
  const [title, setTitle] = useState("");
  const [sections, setSections] = useState<Record<string, boolean>>({
    framework_readiness: true,
    evidence_status: true,
    vulnerability_trend: true,
    endpoint_compliance: true,
  });
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [cadence, setCadence] = useState<string>("none");
  const [recipients, setRecipients] = useState("");

  const create = api.report.create.useMutation({
    onSuccess: () => {
      toast.success("Report queued — it will appear in the list shortly");
      router.push("/dashboard/reports" as never);
    },
    onError: (e) => toast.error(e.message),
  });
  const scheduleCreate = api.report.schedule.create.useMutation({
    onSuccess: () => {
      toast.success("Schedule created");
      router.push("/dashboard/reports" as never);
    },
    onError: (e) => toast.error(e.message),
  });

  const buildConfig = () => {
    const dateRange = {
      from: from ? new Date(from).toISOString() : null,
      to: to ? new Date(`${to}T23:59:59`).toISOString() : null,
    };
    if (type === "CUSTOM_PDF") {
      return {
        type: "CUSTOM_PDF" as const,
        sections: Object.entries(sections).filter(([, on]) => on).map(([k]) => k),
        ...dateRange,
      };
    }
    return { type: "BOARD_SUMMARY" as const, ...dateRange };
  };

  const submit = () => {
    const effectiveTitle =
      title.trim() || (type === "BOARD_SUMMARY" ? "Board summary" : "Compliance report");
    const config = buildConfig();
    if (config.type === "CUSTOM_PDF" && config.sections.length === 0) {
      toast.error("Select at least one section.");
      return;
    }

    if (cadence === "none") {
      create.mutate({ title: effectiveTitle, config });
    } else {
      const emails = recipients
        .split(",")
        .map((e) => e.trim())
        .filter(Boolean);
      scheduleCreate.mutate({
        title: effectiveTitle,
        config,
        cadence: cadence as "daily" | "weekly" | "monthly",
        recipients: emails,
      });
    }
  };

  const pending = create.isPending || scheduleCreate.isPending;

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-semibold">New report</h1>
        <p className="text-sm text-dharma-ink-secondary">
          Build a one-off report or schedule it to recur.
        </p>
      </div>

      <div className="grid grid-cols-2 gap-3">
        {(
          [
            { t: "CUSTOM_PDF", label: "Custom PDF", icon: FileText, desc: "Pick sections and filters" },
            { t: "BOARD_SUMMARY", label: "Board summary", icon: Presentation, desc: "AI-narrated executive brief" },
          ] as const
        ).map(({ t, label, icon: Icon, desc }) => (
          <button
            key={t}
            onClick={() => setType(t)}
            className={`rounded-lg border p-4 text-left transition-colors ${
              type === t ? "border-dharma-accent bg-dharma-accent-tint" : "hover:border-dharma-accent"
            }`}
          >
            <Icon className="mb-2 h-5 w-5" />
            <div className="font-medium">{label}</div>
            <div className="text-xs text-dharma-ink-secondary">{desc}</div>
          </button>
        ))}
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Details</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-1">
            <Label htmlFor="title">Title</Label>
            <Input
              id="title"
              placeholder={type === "BOARD_SUMMARY" ? "Board summary" : "Q3 compliance report"}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          {type === "CUSTOM_PDF" && (
            <div className="space-y-2">
              <Label>Sections</Label>
              <div className="grid grid-cols-2 gap-2">
                {SECTIONS.map((s) => (
                  <label key={s.key} className="flex items-center gap-2 text-sm">
                    <Checkbox
                      checked={sections[s.key] === true}
                      onCheckedChange={(c) => setSections({ ...sections, [s.key]: c === true })}
                    />
                    {s.label}
                  </label>
                ))}
              </div>
            </div>
          )}

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1">
              <Label htmlFor="from">From (optional)</Label>
              <Input id="from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="to">To (optional)</Label>
              <Input id="to" type="date" value={to} onChange={(e) => setTo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1">
            <Label>Schedule</Label>
            <Select value={cadence} onValueChange={setCadence}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="none">One-off (generate now)</SelectItem>
                <SelectItem value="daily">Daily</SelectItem>
                <SelectItem value="weekly">Weekly (Mondays)</SelectItem>
                <SelectItem value="monthly">Monthly (1st)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {cadence !== "none" && (
            <div className="space-y-1">
              <Label htmlFor="recipients">Email recipients (comma-separated)</Label>
              <Input
                id="recipients"
                placeholder="board@company.com, ciso@company.com"
                value={recipients}
                onChange={(e) => setRecipients(e.target.value)}
              />
            </div>
          )}
        </CardContent>
      </Card>

      <div className="flex justify-end gap-2">
        <Button variant="outline" onClick={() => router.push("/dashboard/reports" as never)}>
          Cancel
        </Button>
        <Button onClick={submit} disabled={pending}>
          {cadence === "none" ? "Generate" : "Create schedule"}
        </Button>
      </div>
    </div>
  );
}
