"use client";

import React, { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, CheckCircle2 } from "lucide-react";
import { api as trpc } from "@/lib/trpc";
import Link from "next/link";
import { useRouter } from "next/navigation";

interface ImportModalProps {
  item: {
    id: string;
    name: string;
    price: number;
    type: string;
  };
  onClose: () => void;
}

export function ImportModal({ item, onClose }: ImportModalProps) {
  const router = useRouter();
  const [frameworkName, setFrameworkName] = useState(item.name);
  const [step, setStep] = useState<"confirm" | "importing" | "success">("confirm");
  const [importedFrameworkId, setImportedFrameworkId] = useState<string | null>(null);

  const validate = trpc.import.validateImport.useQuery(
    { marketplaceItemId: item.id },
    { enabled: true, retry: false }
  );

  const importMutation = trpc.import.importFramework.useMutation({
    onSuccess: (data: any) => {
      setImportedFrameworkId(data.framework.id);
      setStep("success");
    },
    onError: (error: any) => {
      alert(`Failed to import: ${error.message}`);
      setStep("confirm");
    },
  });

  const handleImport = async () => {
    setStep("importing");

    try {
      if (!validate.data?.valid) {
        alert(`Cannot import: ${validate.data?.error || 'Validation failed'}`);
        setStep("confirm");
        return;
      }

      await importMutation.mutateAsync({
        marketplaceItemId: item.id,
        frameworkNameOverride: frameworkName,
      });
    } catch (error) {
      setStep("confirm");
    }
  };

  return (
    <Dialog open={true} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-md">
        {step === "confirm" && (
          <>
            <DialogHeader>
              <DialogTitle>Import Framework</DialogTitle>
              <DialogDescription>
                You are about to import this {item.type.toLowerCase()} into your workspace.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-4 py-4">
              {validate.isLoading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  <span className="ml-2 text-sm text-muted-foreground">Validating import...</span>
                </div>
              ) : validate.data?.valid === false ? (
                <div className="bg-destructive/10 text-destructive text-sm p-3 rounded-md">
                  <strong>Cannot import:</strong> {validate.data.error}
                </div>
              ) : (
                <>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Framework Name</p>
                      <p className="font-semibold">{item.name}</p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-1">Price</p>
                      <p className="font-semibold">{item.price === 0 ? "Free" : `$${(item.price / 100).toFixed(2)}`}</p>
                    </div>
                  </div>
                  <div className="space-y-2 pt-2">
                    <label className="text-sm font-medium">Import Name (optional)</label>
                    <Input
                      value={frameworkName}
                      onChange={(e) => setFrameworkName(e.target.value)}
                      placeholder="Custom name for imported framework"
                    />
                  </div>
                  <div className="bg-primary/10 border border-primary/20 text-primary-foreground text-sm p-4 rounded-md mt-4">
                    <p className="text-primary font-medium">
                      ✨ This framework will be copied into your organization with all controls and templates. You can customize it after import.
                    </p>
                  </div>
                </>
              )}
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={onClose} disabled={importMutation.isPending}>
                Cancel
              </Button>
              <Button 
                onClick={handleImport} 
                disabled={validate.isLoading || validate.data?.valid === false || importMutation.isPending}
              >
                {importMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                Confirm Import
              </Button>
            </DialogFooter>
          </>
        )}

        {step === "importing" && (
          <div className="py-12 flex flex-col items-center justify-center space-y-4">
            <Loader2 className="h-10 w-10 animate-spin text-primary" />
            <p className="text-muted-foreground font-medium">Importing framework...</p>
          </div>
        )}

        {step === "success" && (
          <>
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <CheckCircle2 className="h-6 w-6 text-green-500" />
                Import Complete!
              </DialogTitle>
            </DialogHeader>

            <div className="py-6 space-y-4">
              <p className="text-muted-foreground">
                Your framework has been imported successfully. You can now assign evidence to controls.
              </p>
              <div className="bg-muted p-4 rounded-md border border-border">
                <p className="text-sm font-medium">
                  Framework: <span className="font-semibold text-foreground">{frameworkName}</span>
                </p>
              </div>
            </div>

            <DialogFooter className="gap-2 sm:gap-0">
              <Button variant="outline" onClick={onClose}>
                Done
              </Button>
              <Button>
                <Link href={`/dashboard/frameworks/${importedFrameworkId}` as any}>
                  View Framework
                </Link>
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
