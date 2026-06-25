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

  return (
    <div className="space-y-6">
      {/* Export Card */}
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
      >
        <Card>
          <CardHeader>
            <div className="flex items-start justify-between">
              <div>
                <CardTitle>Export Compliance Report</CardTitle>
                <CardDescription>
                  Generate a signed PDF with all frameworks, controls, and evidence.
                </CardDescription>
              </div>
            </div>
          </CardHeader>
          <CardContent>
            <Button
              onClick={handleExport}
              disabled={isExporting}
              size="lg"
              className="gap-2"
            >
              {isExporting ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating Report...
                </>
              ) : (
                <>
                  <Download className="w-4 h-4" />
                  Export & Download Report
                </>
              )}
            </Button>
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
                    className="flex items-center justify-between p-3 rounded-lg bg-stone-50 dark:bg-stone-900 border border-stone-200 dark:border-stone-800"
                  >
                    <div className="flex items-center gap-3">
                      <CheckCircle className="w-5 h-5 text-emerald-600" />
                      <div className="flex-1">
                        <p className="text-sm font-medium">{report.fileName}</p>
                        <p className="text-xs text-stone-500 dark:text-stone-400">
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
