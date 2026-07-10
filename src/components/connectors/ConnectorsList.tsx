'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { Trash2, RefreshCw, Cloud, ChevronDown, ChevronUp } from 'lucide-react';
import { toast } from 'sonner';

import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Skeleton } from '@/components/ui/skeleton';
import { useConnectors } from '@/lib/hooks/useConnectors';
import { EvidenceMappingBoard } from './EvidenceMappingBoard';

const SUPPORTED_TYPES = ['AWS', 'AZURE', 'GCP', 'GITHUB', 'OKTA', 'JIRA'] as const;

const STATUS_STYLES: Record<string, { dot: string; label: string; pulse?: boolean }> = {
  CONNECTED: { dot: 'bg-emerald-500', label: 'Connected' },
  DISCONNECTED: { dot: 'bg-stone-400', label: 'Disconnected' },
  ERROR: { dot: 'bg-red-500', label: 'Error' },
  TESTING: { dot: 'bg-amber-500', label: 'Testing', pulse: true },
};

function StatusDot({ status }: { status: string }) {
  const style = STATUS_STYLES[status] ?? STATUS_STYLES.DISCONNECTED;
  return (
    <span className="relative flex h-2.5 w-2.5">
      {style.pulse && (
        <span className={`absolute inline-flex h-full w-full animate-ping rounded-full ${style.dot} opacity-75`} />
      )}
      <span className={`relative inline-flex h-2.5 w-2.5 rounded-full ${style.dot}`} />
    </span>
  );
}

export function ConnectorsList() {
  const [expandedConnectorId, setExpandedConnectorId] = useState<string | null>(null);
  const { listQuery, deleteMutation, testConnectionMutation } = useConnectors();
  const { data: connectors, isLoading } = listQuery;

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

  const configured = connectors ?? [];
  const configuredTypes = new Set(configured.map((c) => c.type));
  const comingSoonTypes = SUPPORTED_TYPES.filter((t) => t !== 'AWS' && !configuredTypes.has(t));

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
                  <p className="text-xs text-stone-500 dark:text-stone-400">
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
                      className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
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
              <p className="text-xs text-stone-500 dark:text-stone-400">
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
