'use client';

import React, { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { Check, Cloud, Copy, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Badge } from '@/components/ui/badge';
import { api } from '@/lib/trpc';
import { useConnectors } from '@/lib/hooks/useConnectors';
import { awsIamPolicyTemplate } from '@/server/connectors/aws/iamPolicyTemplate';

interface ConnectorConfigWizardProps {
  onClose: () => void;
}

const CONNECTOR_TYPES = [
  { type: 'AWS' as const, label: 'AWS', enabled: true },
  { type: 'AZURE' as const, label: 'Azure', enabled: false },
  { type: 'GCP' as const, label: 'GCP', enabled: false },
  { type: 'GITHUB' as const, label: 'GitHub', enabled: false },
  { type: 'OKTA' as const, label: 'Okta', enabled: false },
  { type: 'JIRA' as const, label: 'Jira', enabled: false },
];

export function ConnectorConfigWizard({ onClose }: ConnectorConfigWizardProps) {
  const [step, setStep] = useState(1);
  const [name, setName] = useState('AWS Production');
  const [roleArn, setRoleArn] = useState('');
  const [externalId, setExternalId] = useState('');
  const [region, setRegion] = useState('us-east-1');
  const [evidenceTypes, setEvidenceTypes] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  const { createMutation } = useConnectors();
  const evidenceTypesQuery = api.connector.listAvailableEvidenceTypes.useQuery(
    { type: 'AWS' },
    { enabled: false },
  );

  const handleCopyPolicy = async () => {
    await navigator.clipboard.writeText(awsIamPolicyTemplate);
    toast.success('IAM policy copied to clipboard');
  };

  const handleTestAndCreate = async () => {
    if (!roleArn || !externalId) {
      toast.error('Role ARN and External ID are required');
      return;
    }

    setIsTesting(true);
    try {
      await createMutation.mutateAsync({
        type: 'AWS',
        name,
        config: { roleArn, externalId, region },
      });

      const { data } = await evidenceTypesQuery.refetch();
      setEvidenceTypes(data ?? []);
      toast.success('Connection successful');
      setStep(3);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Connection test failed');
    } finally {
      setIsTesting(false);
    }
  };

  const handleFinish = () => {
    toast.success('AWS connector added');
    onClose();
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Add Connector</DialogTitle>
          <DialogDescription>
            Step {step} of 3 — connect an external system for automated evidence collection.
          </DialogDescription>
        </DialogHeader>

        <AnimatePresence mode="wait">
          {step === 1 && (
            <motion.div
              key="step1"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="grid grid-cols-2 gap-3"
            >
              {CONNECTOR_TYPES.map((c) => (
                <button
                  key={c.type}
                  disabled={!c.enabled}
                  onClick={() => setStep(2)}
                  className="flex flex-col items-center gap-2 p-4 rounded-lg border border-stone-200 dark:border-stone-800 hover:border-primary disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                >
                  <Cloud className="w-6 h-6" />
                  <span className="text-sm font-medium">{c.label}</span>
                  {!c.enabled && (
                    <Badge variant="outline" className="text-xs">
                      Coming soon
                    </Badge>
                  )}
                </button>
              ))}
            </motion.div>
          )}

          {step === 2 && (
            <motion.div
              key="step2"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-4"
            >
              <div>
                <Label>1. Create a read-only IAM role using this policy</Label>
                <div className="relative mt-1">
                  <pre className="text-xs bg-stone-950 text-stone-100 rounded-lg p-3 overflow-x-auto max-h-40">
                    {awsIamPolicyTemplate}
                  </pre>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="absolute top-1 right-1"
                    onClick={handleCopyPolicy}
                  >
                    <Copy className="w-4 h-4" />
                  </Button>
                </div>
              </div>

              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Connector name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="roleArn">Role ARN</Label>
                  <Input
                    id="roleArn"
                    placeholder="arn:aws:iam::123456789012:role/DharmaReadOnly"
                    value={roleArn}
                    onChange={(e) => setRoleArn(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="externalId">External ID</Label>
                  <Input
                    id="externalId"
                    value={externalId}
                    onChange={(e) => setExternalId(e.target.value)}
                  />
                </div>
                <div>
                  <Label htmlFor="region">Region</Label>
                  <Input id="region" value={region} onChange={(e) => setRegion(e.target.value)} />
                </div>
              </div>

              <div className="flex gap-3 justify-end pt-2">
                <Button variant="outline" onClick={() => setStep(1)}>Back</Button>
                <Button onClick={handleTestAndCreate} disabled={isTesting} className="gap-2">
                  {isTesting ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" /> Testing...
                    </>
                  ) : (
                    'Test Connection'
                  )}
                </Button>
              </div>
            </motion.div>
          )}

          {step === 3 && (
            <motion.div
              key="step3"
              initial={{ opacity: 0, x: 10 }}
              animate={{ opacity: 1, x: 0 }}
              exit={{ opacity: 0, x: -10 }}
              className="space-y-4"
            >
              <div className="flex items-center gap-2 text-emerald-600 dark:text-emerald-400">
                <Check className="w-5 h-5" />
                <span className="font-medium">Connected successfully</span>
              </div>
              <div>
                <Label>Available evidence types</Label>
                <p className="text-xs text-stone-500 dark:text-stone-400 mb-2">
                  Selecting which types to collect on a schedule is configured after setup.
                </p>
                <div className="space-y-2">
                  {evidenceTypes.map((et) => (
                    <div key={et} className="flex items-center gap-2">
                      <Checkbox checked disabled />
                      <span className="text-sm">{et}</span>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex gap-3 justify-end pt-2">
                <Button onClick={handleFinish}>Done</Button>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </DialogContent>
    </Dialog>
  );
}
