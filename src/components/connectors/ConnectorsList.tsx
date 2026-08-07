'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { Trash2, RefreshCw, Cloud, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { QueryError } from '@/components/ui/query-error';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectors } from '@/lib/hooks/useConnectors';
import { EvidenceMappingBoard } from './EvidenceMappingBoard';

const SUPPORTED_TYPES = ['AWS', 'AZURE', 'GCP', 'GITHUB', 'OKTA', 'JIRA'] as const;
// Types with a live ConnectorAdapter registered (src/server/connectors/registry.ts).
// Everything else in SUPPORTED_TYPES still renders as a "Coming soon" card.
const ENABLED_TYPES = new Set(['AWS', 'GITHUB', 'OKTA', 'JIRA']);

const STATUS_STYLES: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  CONNECTED: { dot: 'bg-dharma-success-bg', label: 'Connected' },
  DISCONNECTED: { dot: 'bg-dharma-surface-hover-foreground', label: 'Disconnected' },
  ERROR: { dot: 'bg-dharma-danger-bg', label: 'Error' },
  TESTING: { dot: 'bg-dharma-warning-bg', label: 'Testing', pulse: true },
};

function StatusDot({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.DISCONNECTED;
  return (
    // The live indicator is an opacity pulse, not `animate-ping`. Ping expands
    // a second ring to 2x scale and fades it -- a repeating scale animation in
    // a list that can hold a dozen connectors, which is the opposite of
    // "motion is a whisper". Opacity alone stays on the compositor and reads
    // as a heartbeat rather than a radar sweep.
    <span className="relative flex h-2.5 w-2.5">
      {style.pulse && (
        <span className={`absolute inline-flex h-full w-full animate-pulse-subtle rounded-full ${style.dot}`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
    </span>
  );
}

export function ConnectorsList() {
  const [expandedConnectorId, setExpandedConnectorId] = useState<string | null>(null);
  const { listQuery, deleteMutation, testConnectionMutation } = useConnectors();
  const { data: connectors, isLoading, isError, error, refetch } = listQuery;

  const handleDelete = async (id: string) => {
    try {
      await deleteMutation.mutateAsync({ id });
      toast.success('Connector removed');
    } catch (error) {
      toast.error('Failed to remove connector');
    }
  };

  if (isLoading) {
    return (
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-36 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  // WAVE 9.2 (§6 HIGH-1): without this, a failed request fell through to
  // `connectors ?? []` and rendered as "no connectors configured" — telling the
  // user their integrations are absent when in fact we could not ask.
  if (isError) {
    return (
      <QueryError
        title="Failed to load connectors"
        message={error?.message}
        onRetry={() => refetch()}
      />
    );
  }

  const configured = connectors ?? [];
  const configuredTypes = new Set(configured.map((c) => c.type));
  const comingSoonTypes = SUPPORTED_TYPES.filter((t) => !ENABLED_TYPES.has(t) && !configuredTypes.has(t));

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {configured.map((connector, index) => {
          const style = STATUS_STYLES[connector.status] ?? STATUS_STYLES.DISCONNECTED;
          const isExpanded = expandedConnectorId === connector.id;
          return (
            <motion.div
              key={connector.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <Card title={connector.lastError ?? undefined}>
                <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <Cloud className="w-4 h-4" />
                    {connector.name}
                  </CardTitle>
                  <Badge variant="outline" className="flex items-center gap-1.5">
                    <StatusDot status={connector.status} />
                    {style.label}
                  </Badge>
                </CardHeader>
                <CardContent>
                  <p className="text-xs text-dharma-ink-secondary">
                    {connector.type} · {connector.lastSyncAt
                      ? `Synced ${formatDistanceToNow(new Date(connector.lastSyncAt), { addSuffix: true })}`
                      : 'Never synced'}
                  </p>
                  <div className="flex gap-2 justify-end mt-4">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setExpandedConnectorId(isExpanded ? null : connector.id)}
                      title="Map evidence types"
                    >
                      {isExpanded ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={testConnectionMutation.isPending}
                      onClick={async () => {
                        try {
                          const result = await testConnectionMutation.mutateAsync({ id: connector.id });
                          if (result.status === 'CONNECTED') {
                            toast.success('Connection is healthy');
                          } else {
                            toast.error(result.lastError ?? 'Connection test failed');
                          }
                        } catch (error) {
                          toast.error(error instanceof Error ? error.message : 'Re-test failed');
                        }
                      }}
                      title="Re-test connection"
                    >
                      <RefreshCw className="w-4 h-4" />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(connector.id)}
                      className="text-dharma-danger-text hover:bg-dharma-surface-hover"
                      title="Delete connector"
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </motion.div>
          );
        })}

        {comingSoonTypes.map((type) => (
          <Card key={type} className="opacity-50 cursor-not-allowed">
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
              <CardTitle className="flex items-center gap-2 text-base">
                <Cloud className="w-4 h-4" />
                {type}
              </CardTitle>
              <Badge variant="outline">Coming soon</Badge>
            </CardHeader>
            <CardContent>
              <p className="text-xs text-dharma-ink-secondary">
                Support for {type} connectors is planned for a future release.
              </p>
            </CardContent>
          </Card>
        ))}
      </div>

      {/* Expanded Mapping Board */}
      {expandedConnectorId && configured.find((c) => c.id === expandedConnectorId) && (
        <motion.div
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
        >
          <EvidenceMappingBoard
            connectorId={expandedConnectorId}
            connectorType={configured.find((c) => c.id === expandedConnectorId)!.type}
            connectorName={configured.find((c) => c.id === expandedConnectorId)!.name}
          />
        </motion.div>
      )}
    </div>
  );
}
