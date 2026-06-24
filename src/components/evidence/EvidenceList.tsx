'use client';

import React from 'react';
import { motion } from 'framer-motion';
import { formatDistanceToNow } from 'date-fns';
import { Trash2, Download, FileText, Image, AlertCircle } from 'lucide-react';
import { toast } from 'sonner';

import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { Skeleton } from '@/components/ui/skeleton';
import { useEvidence } from '@/lib/hooks/useEvidence';

interface EvidenceListProps {
  controlId: string;
}

export function EvidenceList({ controlId }: EvidenceListProps) {
  const { listQuery, deleteEvidenceMutation } = useEvidence();
  const { data: listResponse, isLoading, error } = listQuery(controlId);
  const [deleteId, setDeleteId] = React.useState<string | null>(null);

  // Note: the backend actually returns { items, nextCursor, hasMore }
  // So we extract items from listResponse.
  const evidence = listResponse?.items || [];

  const handleDelete = async (id: string) => {
    try {
      await deleteEvidenceMutation.mutateAsync({ id });
      toast.success('Evidence deleted successfully');
      setDeleteId(null);
    } catch (error) {
      toast.error('Failed to delete evidence');
    }
  };

  const getFileIcon = (type: string) => {
    switch (type) {
      case 'SCREENSHOT':
        return <Image className="w-4 h-4" />;
      case 'POLICY_DOC':
        return <FileText className="w-4 h-4" />;
      default:
        return <FileText className="w-4 h-4" />;
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-3">
        {[...Array(3)].map((_, i) => (
          <Skeleton key={i} className="h-12 w-full rounded-lg" />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="p-4 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800 flex gap-3 items-start"
      >
        <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="font-medium text-red-900 dark:text-red-100">Error loading evidence</p>
          <p className="text-sm text-red-700 dark:text-red-300">{error.message}</p>
        </div>
      </motion.div>
    );
  }

  if (!evidence || evidence.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        className="text-center py-8"
      >
        <FileText className="w-12 h-12 text-stone-300 dark:text-stone-700 mx-auto mb-3" />
        <p className="text-sm text-stone-500 dark:text-stone-400">
          No evidence uploaded yet. Start by uploading a file.
        </p>
      </motion.div>
    );
  }

  return (
    <div className="space-y-4">
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>File Name</TableHead>
            <TableHead>Type</TableHead>
            <TableHead>Uploaded</TableHead>
            <TableHead className="text-right">Actions</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {evidence.map((item, index) => (
            <motion.tr
              key={item.id}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: index * 0.05 }}
            >
              <TableCell className="font-medium flex gap-2 items-center">
                {getFileIcon(item.type)}
                <span>{item.fileName}</span>
              </TableCell>
              <TableCell>
                <Badge variant="outline" className="capitalize">
                  {item.type.toLowerCase().replace(/_/g, ' ')}
                </Badge>
              </TableCell>
              <TableCell className="text-sm text-stone-500 dark:text-stone-400">
                {formatDistanceToNow(new Date(item.createdAt), { addSuffix: true })}
              </TableCell>
              <TableCell className="text-right">
                <div className="flex gap-2 justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      // Download functionality can be added here
                      toast.info('Download feature coming soon');
                    }}
                    title="Download"
                  >
                    <Download className="w-4 h-4" />
                  </Button>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setDeleteId(item.id)}
                    className="text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-950"
                    title="Delete"
                  >
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </TableCell>
            </motion.tr>
          ))}
        </TableBody>
      </Table>

      {/* Delete Confirmation Dialog */}
      <Dialog open={!!deleteId} onOpenChange={(open) => !open && setDeleteId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Evidence</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete this evidence? This action cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3 justify-end pt-4">
            <Button variant="outline" onClick={() => setDeleteId(null)}>Cancel</Button>
            <Button
              onClick={() => deleteId && handleDelete(deleteId)}
              className="bg-red-600 hover:bg-red-700 text-white"
            >
              Delete
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
