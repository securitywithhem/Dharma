'use client';

import React, { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'sonner';
import { AlertCircle, Loader2 } from 'lucide-react';

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Form,
  FormControl,
  FormDescription,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from '@/components/ui/form';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Button } from '@/components/ui/button';
import { UploadDropzone } from './UploadDropzone';
import { useEvidence } from '@/lib/hooks/useEvidence';

interface EvidenceUploadModalProps {
  isOpen: boolean;
  onClose: () => void;
  controlId: string;
  controlTitle?: string;
}

const uploadFormSchema = z.object({
  type: z.enum(['SCREENSHOT', 'POLICY_DOC', 'API_RESPONSE', 'LOG_EXCERPT', 'OTHER'], {
    errorMap: () => ({ message: 'Please select an evidence type' }),
  }),
});

type UploadFormValues = z.infer<typeof uploadFormSchema>;

export function EvidenceUploadModal({
  isOpen,
  onClose,
  controlId,
  controlTitle,
}: EvidenceUploadModalProps) {
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const { uploadEvidence } = useEvidence();

  const form = useForm<UploadFormValues>({
    resolver: zodResolver(uploadFormSchema),
    defaultValues: {
      type: 'SCREENSHOT',
    },
  });

  const handleFilesSelected = (files: File[]) => {
    if (files.length > 0) {
      setSelectedFile(files[0]);
      toast.success(`File selected: ${files[0].name}`);
    }
  };

  const onSubmit = async (values: UploadFormValues) => {
    if (!selectedFile) {
      toast.error('Please select a file to upload');
      return;
    }

    setIsUploading(true);
    try {
      const evidence = await uploadEvidence(controlId, selectedFile, values.type as any);
      toast.success('Evidence uploaded successfully!', {
        description: `${selectedFile.name} is now being analyzed.`,
      });
      form.reset();
      setSelectedFile(null);
      onClose();
    } catch (error) {
      console.error('Upload error:', error);
      toast.error('Failed to upload evidence', {
        description: error instanceof Error ? error.message : 'Unknown error occurred',
      });
    } finally {
      setIsUploading(false);
    }
  };

  return (
    <Dialog open={isOpen} onOpenChange={onClose}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Upload Evidence</DialogTitle>
          <DialogDescription>
            {controlTitle ? `For control: ${controlTitle}` : 'Link evidence to your compliance control'}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-6">
          {/* Step 1: Select Evidence Type */}
          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="type"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Evidence Type</FormLabel>
                    <Select value={field.value} onValueChange={field.onChange}>
                      <FormControl>
                        <SelectTrigger>
                          <SelectValue placeholder="Select evidence type" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="SCREENSHOT">Screenshot</SelectItem>
                        <SelectItem value="POLICY_DOC">Policy Document</SelectItem>
                        <SelectItem value="API_RESPONSE">API Response</SelectItem>
                        <SelectItem value="LOG_EXCERPT">Log Excerpt</SelectItem>
                        <SelectItem value="OTHER">Other</SelectItem>
                      </SelectContent>
                    </Select>
                    <FormDescription>
                      Select the type of evidence you are uploading.
                    </FormDescription>
                    <FormMessage />
                  </FormItem>
                )}
              />

              {/* Step 2: Dropzone */}
              <FormItem>
                <FormLabel>Upload File</FormLabel>
                <UploadDropzone
                  onFilesSelected={handleFilesSelected}
                  disabled={isUploading}
                  isLoading={isUploading}
                />
              </FormItem>

              {/* File Preview */}
              <AnimatePresence>
                {selectedFile && (
                  <motion.div
                    initial={{ opacity: 0, height: 0 }}
                    animate={{ opacity: 1, height: 'auto' }}
                    exit={{ opacity: 0, height: 0 }}
                    className="p-3 rounded-lg bg-emerald-50 dark:bg-emerald-950 border border-emerald-200 dark:border-emerald-800"
                  >
                    <p className="text-sm font-medium text-emerald-900 dark:text-emerald-100">
                      ✓ {selectedFile.name}
                    </p>
                    <p className="text-xs text-emerald-700 dark:text-emerald-300 mt-1">
                      {(selectedFile.size / 1024 / 1024).toFixed(2)}MB
                    </p>
                  </motion.div>
                )}
              </AnimatePresence>

              {/* Action Buttons */}
              <div className="flex gap-3 justify-end pt-4">
                <Button
                  type="button"
                  variant="outline"
                  onClick={onClose}
                  disabled={isUploading}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={!selectedFile || isUploading}
                  className="gap-2"
                >
                  {isUploading ? (
                    <>
                      <Loader2 className="w-4 h-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    'Upload Evidence'
                  )}
                </Button>
              </div>
            </form>
          </Form>
        </div>
      </DialogContent>
    </Dialog>
  );
}
