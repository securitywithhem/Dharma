'use client';

import React, { useCallback, useState } from 'react';
import { motion } from 'framer-motion';
import { Upload, AlertCircle, CheckCircle } from 'lucide-react';
import { cn } from '@/lib/utils';

interface UploadDropzoneProps {
  onFilesSelected: (files: File[]) => void;
  maxFileSize?: number; // in bytes, default 50MB
  acceptedTypes?: string[];
  disabled?: boolean;
  isLoading?: boolean;
}

export function UploadDropzone({
  onFilesSelected,
  maxFileSize = 50 * 1024 * 1024, // 50MB default
  acceptedTypes = ['image/*', 'application/pdf', '.json', '.txt', '.log'],
  disabled = false,
  isLoading = false,
}: UploadDropzoneProps) {
  const [isDragActive, setIsDragActive] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const validateFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArray = Array.from(files);
      const errors: string[] = [];

      for (const file of fileArray) {
        // Check file size
        if (file.size > maxFileSize) {
          errors.push(`${file.name} exceeds maximum size (${(maxFileSize / 1024 / 1024).toFixed(0)}MB)`);
        }

        // Check file type (basic validation)
        const isAccepted = acceptedTypes.some((type) => {
          if (type.endsWith('*')) {
            return file.type.startsWith(type.slice(0, -1));
          }
          return file.type === type || file.name.endsWith(type);
        });

        if (!isAccepted) {
          errors.push(`${file.name} is not an accepted file type`);
        }
      }

      return { valid: errors.length === 0, errors };
    },
    [maxFileSize, acceptedTypes]
  );

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!disabled) setIsDragActive(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragActive(false);

    if (disabled || isLoading) return;

    const files = e.dataTransfer.files;
    const { valid, errors } = validateFiles(files);

    if (!valid) {
      setError(errors.join('; '));
      return;
    }

    setError(null);
    onFilesSelected(Array.from(files));
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;

    const { valid, errors } = validateFiles(e.target.files);

    if (!valid) {
      setError(errors.join('; '));
      return;
    }

    setError(null);
    onFilesSelected(Array.from(e.target.files));
  };

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="w-full"
    >
      <div
        onDragEnter={handleDragEnter}
        onDragLeave={handleDragLeave}
        onDragOver={handleDragOver}
        onDrop={handleDrop}
        className={cn(
          'relative rounded-lg border-2 border-dashed transition-all duration-200',
          isDragActive
            ? 'border-amber-600 bg-amber-50 dark:bg-amber-950'
            : 'border-stone-300 dark:border-stone-700 bg-stone-50 dark:bg-stone-900',
          disabled && 'opacity-50 cursor-not-allowed'
        )}
      >
        <div className="flex flex-col items-center justify-center px-6 py-12 gap-4">
          <motion.div
            animate={isDragActive ? { scale: 1.1 } : { scale: 1 }}
            transition={{ duration: 0.2 }}
          >
            <Upload
              className={cn(
                'w-12 h-12 transition-colors',
                isDragActive ? 'text-amber-600' : 'text-stone-400 dark:text-stone-500'
              )}
            />
          </motion.div>

          <div className="text-center">
            <p className="text-sm font-medium text-stone-900 dark:text-stone-100">
              {isLoading ? 'Uploading...' : 'Drag & drop files here or click to browse'}
            </p>
            <p className="text-xs text-stone-500 dark:text-stone-400 mt-2">
              Supported: Images, PDFs, JSON, TXT, LOG (max {(maxFileSize / 1024 / 1024).toFixed(0)}MB)
            </p>
          </div>

          <label htmlFor="file-input" className="cursor-pointer">
            <input
              id="file-input"
              type="file"
              multiple
              disabled={disabled || isLoading}
              onChange={handleFileInput}
              className="hidden"
              accept={acceptedTypes.join(',')}
            />
          </label>
        </div>
      </div>

      {error && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          className="mt-3 flex gap-2 items-start p-3 rounded-lg bg-red-50 dark:bg-red-950 border border-red-200 dark:border-red-800"
        >
          <AlertCircle className="w-5 h-5 text-red-600 dark:text-red-400 flex-shrink-0 mt-0.5" />
          <p className="text-sm text-red-700 dark:text-red-300">{error}</p>
        </motion.div>
      )}
    </motion.div>
  );
}
