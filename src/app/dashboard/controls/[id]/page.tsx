'use client';

import React, { useState } from 'react';
import { useParams } from 'next/navigation';
import { motion } from 'framer-motion';
import { Upload, ChevronLeft } from 'lucide-react';
import Link from 'next/link';

import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Separator } from '@/components/ui/separator';
import { EvidenceUploadModal } from '@/components/evidence/EvidenceUploadModal';
import { EvidenceList } from '@/components/evidence/EvidenceList';
import { api } from '@/lib/trpc';

export default function ControlDetailPage() {
  const params = useParams();
  const controlId = params.id as string;
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);

  // Fetch control details - wait, let's assume api.control.getById exists or fallback.
  // We use api as imported from '@/lib/trpc' based on the project structure
  const { data: control, isLoading } = api.control.getById.useQuery({
    id: controlId,
  });

  if (isLoading) {
    return (
      <div className="p-8 max-w-4xl mx-auto">
        <div className="h-8 bg-stone-200 dark:bg-stone-800 rounded-lg w-64 mb-6 animate-pulse" />
        <div className="h-40 bg-stone-100 dark:bg-stone-900 rounded-lg animate-pulse" />
      </div>
    );
  }

  if (!control) {
    return (
      <div className="p-8 max-w-4xl mx-auto text-center">
        <p className="text-red-600">Control not found</p>
      </div>
    );
  }

  const statusColors = {
    NOT_STARTED: 'secondary',
    IN_PROGRESS: 'yellow',
    COMPLIANT: 'green',
    NOT_APPLICABLE: 'gray',
  } as const;

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      className="p-8 max-w-4xl mx-auto"
    >
      {/* Back Button */}
      <Link
        href="/dashboard/frameworks"
        className="flex items-center gap-2 text-sm text-stone-600 dark:text-stone-400 hover:text-stone-900 dark:hover:text-stone-100 mb-6"
      >
        <ChevronLeft className="w-4 h-4" />
        Back to Frameworks
      </Link>

      {/* Control Header */}
      <Card className="mb-8">
        <CardHeader>
          <div className="flex items-start justify-between">
            <div>
              <div className="flex items-center gap-3 mb-2">
                <CardTitle>{control.title}</CardTitle>
                <Badge variant={statusColors[control.status as keyof typeof statusColors] || 'secondary'}>
                  {control.status ? control.status.replace(/_/g, ' ') : 'NOT STARTED'}
                </Badge>
              </div>
              <CardDescription>{control.domain}</CardDescription>
            </div>
          </div>
          <Separator className="mt-4" />
          <CardContent className="mt-4 p-0">
            <p className="text-sm text-stone-600 dark:text-stone-400">{control.description}</p>
          </CardContent>
        </CardHeader>
      </Card>

      {/* Evidence Section */}
      <Card>
        <CardHeader>
          <div className="flex items-center justify-between">
            <div>
              <CardTitle>Evidence & Documentation</CardTitle>
              <CardDescription>Upload files to demonstrate compliance with this control</CardDescription>
            </div>
            <Button
              onClick={() => setIsUploadModalOpen(true)}
              className="gap-2"
            >
              <Upload className="w-4 h-4" />
              Upload Evidence
            </Button>
          </div>
        </CardHeader>
        <Separator />
        <CardContent className="pt-6">
          <EvidenceList controlId={controlId} />
        </CardContent>
      </Card>

      {/* Upload Modal */}
      <EvidenceUploadModal
        isOpen={isUploadModalOpen}
        onClose={() => setIsUploadModalOpen(false)}
        controlId={controlId}
        controlTitle={control.title}
      />
    </motion.div>
  );
}
