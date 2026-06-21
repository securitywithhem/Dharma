"use client";

import { useState } from "react";
import { api } from "@/hooks/trpc";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";

const PREDEFINED_FRAMEWORKS = [
  {
    name: "DPDP Act 2023",
    description: "India's Digital Personal Data Protection Act baseline framework.",
    badge: "India",
  },
  {
    name: "ISO 27001:2022",
    description: "International standard for Information Security Management Systems.",
    badge: "International",
  },
  {
    name: "SOC 2 Type II",
    description: "AICPA Trust Service Criteria for SaaS companies.",
    badge: "USA",
  },
];

interface AddFrameworkModalProps {
  onClose: () => void;
  onSuccess: () => void;
}

export function AddFrameworkModal({ onClose, onSuccess }: AddFrameworkModalProps) {
  const [selected, setSelected] = useState<string | null>(null);
  const [customName, setCustomName] = useState("");
  const [customVersion, setCustomVersion] = useState("1.0");
  const [mode, setMode] = useState<"predefined" | "custom">("predefined");

  const createMutation = api.framework.create.useMutation({
    onSuccess,
  });

  const handleSubmit = () => {
    const name = mode === "predefined" ? (selected ?? "") : customName.trim();
    const version = mode === "custom" ? customVersion.trim() || "1.0" : "1.0";

    if (!name) return;

    createMutation.mutate({ name, version });
  };

  const isValid =
    mode === "predefined" ? !!selected : customName.trim().length >= 2;

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent
        className="max-w-lg"
        aria-labelledby="add-framework-title"
        onClose={onClose}
      >
        <DialogHeader>
          <DialogTitle id="add-framework-title">
            Activate Compliance Framework
          </DialogTitle>
          <DialogDescription>
            Choose a predefined framework — controls will be seeded
            automatically — or enter a custom framework name.
          </DialogDescription>
        </DialogHeader>

        {/* Mode toggle */}
        <div className="flex gap-2 rounded-lg border border-border p-1 mb-2">
          {(["predefined", "custom"] as const).map((m) => (
            <button
              key={m}
              type="button"
              className={`flex-1 rounded-md px-3 py-1.5 text-sm font-medium transition-colors ${
                mode === m
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:text-foreground"
              }`}
              onClick={() => setMode(m)}
            >
              {m === "predefined" ? "Predefined" : "Custom"}
            </button>
          ))}
        </div>

        {mode === "predefined" ? (
          <div className="space-y-2" role="radiogroup" aria-label="Select framework">
            {PREDEFINED_FRAMEWORKS.map((fw) => (
              <button
                key={fw.name}
                type="button"
                role="radio"
                aria-checked={selected === fw.name}
                className={`w-full rounded-lg border p-4 text-left transition-all ${
                  selected === fw.name
                    ? "border-primary bg-primary/5 ring-2 ring-primary/20"
                    : "border-border hover:border-primary/40 hover:bg-muted/30"
                }`}
                onClick={() => setSelected(fw.name)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="font-semibold text-sm">{fw.name}</p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {fw.description}
                    </p>
                  </div>
                  <Badge variant="outline" className="shrink-0 text-xs">
                    {fw.badge}
                  </Badge>
                </div>
              </button>
            ))}
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-1.5">
              <label htmlFor="custom-fw-name" className="text-sm font-medium">
                Framework Name <span aria-hidden="true">*</span>
              </label>
              <Input
                id="custom-fw-name"
                placeholder="e.g. HIPAA, PCI DSS, GDPR"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                maxLength={120}
              />
            </div>
            <div className="space-y-1.5">
              <label htmlFor="custom-fw-version" className="text-sm font-medium">
                Version
              </label>
              <Input
                id="custom-fw-version"
                placeholder="1.0"
                value={customVersion}
                onChange={(e) => setCustomVersion(e.target.value)}
                maxLength={40}
              />
            </div>
          </div>
        )}

        {createMutation.error && (
          <p role="alert" className="text-xs text-destructive mt-2">
            {createMutation.error.message}
          </p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={onClose} disabled={createMutation.isPending}>
            Cancel
          </Button>
          <Button
            onClick={handleSubmit}
            disabled={!isValid || createMutation.isPending}
          >
            {createMutation.isPending ? "Activating…" : "Activate Framework"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
