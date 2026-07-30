'use client';

import React, { useState } from 'react';
import { motion } from 'framer-motion';
import { Download, Loader2, CheckCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { api } from '@/hooks/trpc';

export function ExportReportCard() {
  const [isExporting, setIsExporting] = useState(false);
  const exportMutation = api.report.exportReport.useMutation();
  const historyQuery = api.report.getHistory.useQuery();

  const handleExport = async () => {
    setIsExporting(true);
    try {
      const result = await exportMutation.mutateAsync({
        includeAuditLog: true,
      });

      // Trigger download
      const link = document.createElement('a');
      link.href = result.downloadUrl;
      link.download = result.fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);

      toast.success('Report exported successfully!', {
        description: `Compliance Score: ${result.complianceScore}%`,
      });

      // Refresh history
      await historyQuery.refetch();
    } catch (error) {
      toast.error('Failed to export report', {
        description: error instanceof Error ? error.message : 'Unknown error',
      });
    } finally {
      setIsExporting(false);
    }
  };

  const statusColors = {
    VALID: 'success',
    COMPROMISED: 'destructive',
    UNVERIFIED: 'secondary',
  } as const;

  const lastExport = historyQuery.data?.[0];

  return (
    /*
      h-full down the whole chain — wrapper, motion.div, Card. As a grid child
      this stretches to the row's tallest card (Quick actions, 4 rows), but a
      nested wrapper does not pass that height to its descendants automatically,
      so the Card underneath kept its content height and the row looked
      unbalanced. flex-1 on the export card lets the optional history card below
      keep its natural height.
    */
    <div className="flex h-full flex-col gap-6">
      {/* Export Card */}
      <motion.div
        className="flex flex-1 flex-col"
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card className="flex h-full flex-col">
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Export Compliance Report</CardTitle>
                <CardDescription>
                  Generate a signed PDF for auditors, customers, or investors.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          {/*
            justify-between rather than a top-aligned button: once the card
            stretches to match Quick actions there is real vertical slack, and a
            lone CTA pinned to the top of it reads as an oversight. The CTA sits
            at the top of the slack, the provenance line at the bottom.
          */}
          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <Button
              onClick={handleExport}
              disabled={isExporting}
              size="lg"
              className="w-fit gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Generate Report
                </>
              )}
            </Button>

            {/*
              Real provenance from report.getHistory, not filler. An auditor-
              facing export is a dated artefact, so "when was the last one" is
              the question this card should answer without a click.
            */}
            <p className="text-micro text-dharma-ink-secondary">
              {lastExport ? (
                <>
                  Last exported{' '}
                  <time
                    dateTime={new Date(lastExport.timestamp).toISOString()}
                    className="tabular-nums"
                  >
                    {new Date(lastExport.timestamp).toLocaleDateString()}
                  </time>{' '}
                  · <span className="tabular-nums">{lastExport.complianceScore}%</span> compliance
                </>
              ) : (
                'No report exported yet.'
              )}
            </p>
          </CardContent>
        </Card>
      </motion.div>

      {/* Recent Exports */}
      {historyQuery.data && historyQuery.data.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
        >
          <Card>
            <CardHeader>
              <CardTitle className="text-lg">Recent Exports</CardTitle>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {historyQuery.data.map((report: any) => (
                  <motion.div
                    key={report.id}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-center justify-between p-3 rounded-lg bg-dharma-surface-hover border border-dharma-border"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-dharma-success-text" />
                      <div className="min-w-0 flex-1">
                        {/* Generated filenames run long (dharma-compliance-report-2026-07-30.pdf). */}
                        <p className="truncate text-sm font-medium">{report.fileName}</p>
                        <p className="text-xs text-dharma-ink-secondary">
                          {new Date(report.timestamp).toLocaleDateString()}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant="outline" className="text-xs">
                        {report.complianceScore}%
                      </Badge>
                      <Badge
                        variant={statusColors[report.verificationStatus as keyof typeof statusColors]}
                        className="text-xs"
                      >
                        {report.verificationStatus}
                      </Badge>
                    </div>
                  </motion.div>
                ))}
              </div>
            </CardContent>
          </Card>
        </motion.div>
      )}
    </div>
  );
}
