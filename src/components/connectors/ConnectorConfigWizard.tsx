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

type ConnectorTypeKey = 'AWS' | 'AZURE' | 'GCP' | 'GITHUB' | 'OKTA' | 'JIRA';

const CONNECTOR_TYPES: { type: ConnectorTypeKey; label: string; enabled: boolean }[] = [
  { type: 'AWS', label: 'AWS', enabled: true },
  { type: 'AZURE', label: 'Azure', enabled: false },
  { type: 'GCP', label: 'GCP', enabled: false },
  { type: 'GITHUB', label: 'GitHub', enabled: true },
  { type: 'OKTA', label: 'Okta', enabled: true },
  { type: 'JIRA', label: 'Jira', enabled: true },
];

interface ConfigField {
  key: string;
  label: string;
  placeholder?: string;
  secret?: boolean;
}

// Each connector type's step-2 form is generated from this table rather than
// a bespoke component per type — same wizard shell for every connector,
// per the Part 3 UI spec ("reusing the exact same wizard shell").
const CONNECTOR_FIELDS: Record<ConnectorTypeKey, ConfigField[]> = {
  AWS: [
    { key: 'roleArn', label: 'Role ARN', placeholder: 'arn:aws:iam::123456789012:role/DharmaReadOnly' },
    { key: 'externalId', label: 'External ID' },
    { key: 'region', label: 'Region', placeholder: 'us-east-1' },
  ],
  AZURE: [],
  GCP: [],
  GITHUB: [
    { key: 'org', label: 'GitHub organization', placeholder: 'dharma-org' },
    { key: 'installationToken', label: 'Installation token (read-only)', secret: true },
  ],
  OKTA: [
    { key: 'oktaDomain', label: 'Okta domain', placeholder: 'dharma.okta.com' },
    { key: 'apiToken', label: 'API token', secret: true },
  ],
  JIRA: [
    { key: 'siteUrl', label: 'Site URL', placeholder: 'https://dharma.atlassian.net' },
    { key: 'email', label: 'Email' },
    { key: 'apiToken', label: 'API token', secret: true },
    { key: 'projectKey', label: 'Project key', placeholder: 'COMP' },
  ],
};

const DEFAULT_NAMES: Record<ConnectorTypeKey, string> = {
  AWS: 'AWS Production',
  AZURE: 'Azure',
  GCP: 'GCP',
  GITHUB: 'GitHub Organization',
  OKTA: 'Okta',
  JIRA: 'Jira',
};

export function ConnectorConfigWizard({ onClose }: ConnectorConfigWizardProps) {
  const [step, setStep] = useState(1);
  const [selectedType, setSelectedType] = useState<ConnectorTypeKey>('AWS');
  const [name, setName] = useState(DEFAULT_NAMES.AWS);
  const [fieldValues, setFieldValues] = useState<Record<string, string>>({});
  const [evidenceTypes, setEvidenceTypes] = useState<string[]>([]);
  const [isTesting, setIsTesting] = useState(false);

  const { createMutation } = useConnectors();
  const evidenceTypesQuery = api.connector.listAvailableEvidenceTypes.useQuery(
    { type: selectedType as any },
    { enabled: false },
  );

  const fields = CONNECTOR_FIELDS[selectedType];

  const selectType = (type: ConnectorTypeKey) => {
    setSelectedType(type);
    setName(DEFAULT_NAMES[type]);
    setFieldValues({});
    setStep(2);
  };

  const handleCopyPolicy = async () => {
    await navigator.clipboard.writeText(awsIamPolicyTemplate);
    toast.success('IAM policy copied to clipboard');
  };

  const handleTestAndCreate = async () => {
    const missing = fields.filter((f) => !fieldValues[f.key]?.trim());
    if (missing.length > 0) {
      toast.error(`${missing.map((f) => f.label).join(', ')} ${missing.length === 1 ? 'is' : 'are'} required`);
      return;
    }

    setIsTesting(true);
    try {
      await createMutation.mutateAsync({
        type: selectedType,
        name,
        config: { ...fieldValues },
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
    toast.success(`${DEFAULT_NAMES[selectedType]} connector added`);
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
                  onClick={() => selectType(c.type)}
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
              {selectedType === 'AWS' && (
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
              )}

              <div className="space-y-3">
                <div>
                  <Label htmlFor="name">Connector name</Label>
                  <Input id="name" value={name} onChange={(e) => setName(e.target.value)} />
                </div>
                {fields.map((field) => (
                  <div key={field.key}>
                    <Label htmlFor={field.key}>{field.label}</Label>
                    <Input
                      id={field.key}
                      type={field.secret ? 'password' : 'text'}
                      placeholder={field.placeholder}
                      value={fieldValues[field.key] ?? ''}
                      onChange={(e) =>
                        setFieldValues((prev) => ({ ...prev, [field.key]: e.target.value }))
                      }
                    />
                  </div>
                ))}
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
