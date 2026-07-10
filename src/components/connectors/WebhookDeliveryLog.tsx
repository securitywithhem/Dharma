'use client';

import React, { useState } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ChevronDown, ChevronRight } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { useWebhooks } from '@/lib/hooks/useWebhooks';

interface WebhookDeliveryLogProps {
  webhookId: string;
}

export function WebhookDeliveryLog({ webhookId }: WebhookDeliveryLogProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const { listDeliveriesQuery } = useWebhooks();
  const { data: deliveries, isLoading } = listDeliveriesQuery(webhookId, true);

  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Loading delivery history...</p>;
  }

  if (!deliveries || deliveries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-2">
        No deliveries yet. Use &quot;Send test event&quot; to verify your endpoint receives signed requests.
      </p>
    );
  }

  return (
    <Table>
      <TableHeader>
        <TableRow>
          <TableHead className="w-8"></TableHead>
          <TableHead>Event</TableHead>
          <TableHead>Status</TableHead>
          <TableHead>Attempt</TableHead>
          <TableHead>When</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {deliveries.map((delivery: any) => {
          const isExpanded = expandedId === delivery.id;
          return (
            <React.Fragment key={delivery.id}>
              <TableRow
                className="cursor-pointer"
                onClick={() => setExpandedId(isExpanded ? null : delivery.id)}
              >
                <TableCell>
                  {isExpanded ? <ChevronDown className="w-4 h-4" /> : <ChevronRight className="w-4 h-4" />}
                </TableCell>
                <TableCell className="font-mono text-xs">{delivery.event}</TableCell>
                <TableCell>
                  <Badge variant={delivery.success ? 'success' : 'destructive'}>
                    {delivery.responseCode ?? 'network error'}
                  </Badge>
                </TableCell>
                <TableCell className="text-xs text-muted-foreground">{delivery.attempt}</TableCell>
                <TableCell className="text-xs text-muted-foreground">
                  {formatDistanceToNow(new Date(delivery.createdAt), { addSuffix: true })}
                </TableCell>
              </TableRow>
              {isExpanded && (
                <TableRow>
                  <TableCell colSpan={5} className="bg-muted/30">
                    <div className="space-y-2 py-1">
                      <div>
                        <p className="text-xs font-semibold text-muted-foreground mb-1">Payload</p>
                        <pre className="text-xs bg-stone-950 text-stone-100 rounded-lg p-3 overflow-x-auto max-h-48">
                          {JSON.stringify(delivery.payload, null, 2)}
                        </pre>
                      </div>
                    </div>
                  </TableCell>
                </TableRow>
              )}
            </React.Fragment>
          );
        })}
      </TableBody>
    </Table>
  );
}
