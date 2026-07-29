'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { toast } from 'sonner';
import { Check, Copy, Send, Trash2, ChevronDown, ChevronUp } from 'lucide-react';

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
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Skeleton } from '@/components/ui/skeleton';
import { useWebhooks } from '@/lib/hooks/useWebhooks';
import { WebhookDeliveryLog } from '@/components/connectors/WebhookDeliveryLog';

const AVAILABLE_EVENTS = [
  { value: 'evidence.updated', label: 'Evidence updated' },
  { value: 'control.failed', label: 'Control failed' },
] as const;

function AddWebhookDialog({
  onClose,
  onCreated,
}: {
  onClose: () => void;
  onCreated: (secret: string) => void;
}) {
  const [url, setUrl] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const { createMutation } = useWebhooks();

  const toggleEvent = (value: string) => {
    setEvents((prev) => (prev.includes(value) ? prev.filter((e) => e !== value) : [...prev, value]));
  };

  const handleCreate = async () => {
    if (!url.trim()) {
      toast.error('URL is required');
      return;
    }
    if (events.length === 0) {
      toast.error('Select at least one event');
      return;
    }
    try {
      const created = await createMutation.mutateAsync({ url, events: events as any });
      onCreated(created.secret);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to create webhook');
    }
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Webhook</DialogTitle>
          <DialogDescription>
            Dharma will POST a signed JSON payload to this URL when a subscribed event occurs.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label htmlFor="webhook-url">Endpoint URL</Label>
            <Input
              id="webhook-url"
              placeholder="https://example.com/hooks/dharma"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
            />
          </div>

          <div>
            <Label>Events</Label>
            <div className="space-y-2 mt-1">
              {AVAILABLE_EVENTS.map((event) => (
                <div key={event.value} className="flex items-center gap-2">
                  <Checkbox
                    checked={events.includes(event.value)}
                    onCheckedChange={() => toggleEvent(event.value)}
                  />
                  <span className="text-sm">{event.label}</span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex gap-3 justify-end pt-2">
            <Button variant="outline" onClick={onClose}>Cancel</Button>
            <Button onClick={handleCreate} disabled={createMutation.isPending}>
              {createMutation.isPending ? 'Creating...' : 'Create'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function SecretRevealDialog({ secret, onClose }: { secret: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true);
    toast.success('Signing secret copied to clipboard');
  };

  return (
    <Dialog open onOpenChange={onClose}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Copy your signing secret now</DialogTitle>
          <DialogDescription>
            This is the only time the full secret is shown. Use it to verify the{' '}
            <code className="text-xs">X-Dharma-Signature-256</code> header on incoming requests.
          </DialogDescription>
        </DialogHeader>

        <div className="relative">
          <pre className="text-xs bg-dharma-ink text-dharma-ink-inverse rounded-lg p-3 overflow-x-auto break-all whitespace-pre-wrap">
            {secret}
          </pre>
          <Button variant="ghost" size="sm" className="absolute top-1 right-1" onClick={handleCopy}>
            {copied ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
          </Button>
        </div>

        <div className="flex justify-end pt-2">
          <Button onClick={onClose}>I&apos;ve copied it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export default function WebhooksSettingsPage() {
  const [isAddOpen, setIsAddOpen] = useState(false);
  const [revealSecret, setRevealSecret] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const { listQuery, deleteMutation, updateMutation, testDeliverMutation } = useWebhooks();
  const { data: webhooks, isLoading } = listQuery;

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success('Webhook removed');
    } catch (error) {
      toast.error('Failed to remove webhook');
    }
  };

  const handleToggleActive = async (id: string, isActive: boolean) => {
    try {
      await updateMutation.mutateAsync({ id, isActive: !isActive });
    } catch (error) {
      toast.error('Failed to update webhook');
    }
  };

  const handleSendTest = async (id: string) => {
    try {
      await testDeliverMutation.mutateAsync({ id });
      toast.success('Test event queued — check the delivery log below');
      setExpandedId(id);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Failed to send test event');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold tracking-tight">Webhooks</h2>
          <p className="text-dharma-ink-secondary">
            Trigger external workflows when evidence is updated or a control fails.
          </p>
        </div>
        <Button onClick={() => setIsAddOpen(true)}>Add Webhook</Button>
      </div>

      {isLoading ? (
        <div className="space-y-3">
          {[...Array(2)].map((_, i) => (
            <Skeleton key={i} className="h-24 w-full rounded-lg" />
          ))}
        </div>
      ) : !webhooks || webhooks.length === 0 ? (
        <p className="text-sm text-dharma-ink-secondary py-8 text-center">
          No webhooks configured yet. Add one to get started.
        </p>
      ) : (
        <div className="space-y-4">
          {webhooks.map((webhook: any) => {
            const isExpanded = expandedId === webhook.id;
            return (
              <Card key={webhook.id}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <div>
                    <CardTitle className="text-base font-mono">{webhook.url}</CardTitle>
                    <p className="text-xs text-dharma-ink-secondary mt-1">
                      Secret: {webhook.secretPreview} ·{' '}
                      {webhook.isActive ? 'Active' : 'Disabled'}
                    </p>
                  </div>
                  <div className="flex items-center gap-1">
                    {webhook.events.map((event: string) => (
                      <Badge key={event} variant="outline" className="text-xs">
                        {event}
                      </Badge>
                    ))}
                  </div>
                </CardHeader>
                <CardContent>
                  <div className="flex gap-2 justify-end">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleToggleActive(webhook.id, webhook.isActive)}
                    >
                      {webhook.isActive ? 'Disable' : 'Enable'}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleSendTest(webhook.id)}
                      disabled={testDeliverMutation.isPending}
                      title="Send test event"
                    >
                      <Send className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedId(isExpanded ? null : webhook.id)}
                      title="Delivery log"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(webhook.id)}
                      className="text-dharma-danger-text hover:bg-dharma-surface-hover"
                      title="Delete webhook"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                  {isExpanded && (
                    <div className="mt-4 pt-4 border-t">
                      <WebhookDeliveryLog webhookId={webhook.id} />
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {isAddOpen && (
        <AddWebhookDialog
          onClose={() => setIsAddOpen(false)}
          onCreated={(secret) => {
            setIsAddOpen(false);
            setRevealSecret(secret);
          }}
        />
      )}

      {revealSecret && (
        <SecretRevealDialog secret={revealSecret} onClose={() => setRevealSecret(null)} />
      )}
    </div>
  );
}
