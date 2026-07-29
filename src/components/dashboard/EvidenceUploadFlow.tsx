'use client';

import React, { useState, useCallback } from 'react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Progress } from '@/components/ui/progress';
import { cn } from '@/lib/utils';
import {
  Upload,
  CheckCircle2,
  AlertCircle,
  FileText,
  ChevronRight,
} from 'lucide-react';

/**
 * Framework suggestion from AI analysis of uploaded evidence.
 * In production, this would come from the backend ML pipeline.
 */
export interface FrameworkSuggestion {
  framework: string;
  control: string;
  confidence: number; // 0-100
  description: string;
}

/**
 * Represents uploaded evidence and its framework mapping.
 */
export interface UploadedEvidence {
  id: string;
  fileName: string;
  size: number;
  suggestions: FrameworkSuggestion[];
  assignedControl?: string;
}

export interface EvidenceUploadFlowProps {
  onSuccess?: (evidence: UploadedEvidence) => void;
}

/**
 * Mock AI suggestions for demonstration.
 * In production, this would be replaced by a backend API call.
 */
const MOCK_SUGGESTIONS: FrameworkSuggestion[] = [
  {
    framework: 'ISO 27001',
    control: 'A.9.2.1 User registration and de-registration',
    confidence: 94,
    description: 'Evidence shows systematic user access provisioning',
  },
  {
    framework: 'SOC 2',
    control: 'CC6.1 Logical and Physical Access Controls',
    confidence: 88,
    description: 'Demonstrates implementation of access control mechanisms',
  },
  {
    framework: 'DPDP',
    control: 'Data Processing Agreement',
    confidence: 82,
    description: 'Aligns with data processing and consent management',
  },
];

/**
 * File upload state machine states
 */
type UploadState = 'idle' | 'uploading' | 'suggesting' | 'review' | 'success';

export function EvidenceUploadFlow({ onSuccess }: EvidenceUploadFlowProps) {
  const [state, setState] = useState<UploadState>('idle');
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [evidence, setEvidence] = useState<UploadedEvidence | null>(null);
  const [isDragActive, setIsDragActive] = useState(false);
  const [selectedSuggestion, setSelectedSuggestion] = useState<FrameworkSuggestion | null>(null);
  const [error, setError] = useState<string | null>(null);

  const validateFile = useCallback((file: File): boolean => {
    const MAX_SIZE = 50 * 1024 * 1024; // 50MB
    const ACCEPTED_TYPES = ['image/*', 'application/pdf', '.json', '.txt', '.log'];

    if (file.size > MAX_SIZE) {
      setError(`File exceeds maximum size (50MB)`);
      return false;
    }

    const isAccepted = ACCEPTED_TYPES.some((type) => {
      if (type.endsWith('*')) {
        return file.type.startsWith(type.slice(0, -1));
      }
      return file.type === type || file.name.endsWith(type);
    });

    if (!isAccepted) {
      setError('File type not supported. Use images, PDFs, JSON, TXT, or LOG files.');
      return false;
    }

    setError(null);
    return true;
  }, []);

  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (state === 'idle') setIsDragActive(true);
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

    if (state !== 'idle') return;

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      const file = files[0];
      if (validateFile(file)) {
        setSelectedFile(file);
        simulateUpload(file);
      }
    }
  };

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files || e.target.files.length === 0) return;

    const file = e.target.files[0];
    if (validateFile(file)) {
      setSelectedFile(file);
      simulateUpload(file);
    }
  };

  const simulateUpload = async (file: File) => {
    setState('uploading');
    setError(null);

    // Simulate upload progress
    for (let i = 0; i <= 100; i += Math.random() * 40) {
      setUploadProgress(Math.min(i, 90));
      await new Promise((resolve) => setTimeout(resolve, 200));
    }

    // Transition to AI analysis
    setState('suggesting');
    setUploadProgress(95);
    await new Promise((resolve) => setTimeout(resolve, 800));

    // Simulate AI suggestions
    const newEvidence: UploadedEvidence = {
      id: `evidence_${Date.now()}`,
      fileName: file.name,
      size: file.size,
      suggestions: MOCK_SUGGESTIONS,
    };

    setEvidence(newEvidence);
    setUploadProgress(100);
    setState('review');
    setSelectedSuggestion(MOCK_SUGGESTIONS[0]); // Pre-select the top suggestion
  };

  const handleAccept = () => {
    if (!evidence || !selectedSuggestion) return;

    const assignedEvidence: UploadedEvidence = {
      ...evidence,
      assignedControl: selectedSuggestion.control,
    };

    setState('success');
    setEvidence(assignedEvidence);

    if (onSuccess) {
      onSuccess(assignedEvidence);
    }
  };

  const handleReset = () => {
    setState('idle');
    setSelectedFile(null);
    setUploadProgress(0);
    setEvidence(null);
    setSelectedSuggestion(null);
    setError(null);
  };

  // ============================================================================
  // IDLE STATE — Drag-and-drop upload zone
  // ============================================================================
  if (state === 'idle') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Add Evidence</CardTitle>
          <CardDescription>
            Upload files that demonstrate compliance with a framework control
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            onDrop={handleDrop}
            className={cn(
              'relative rounded-lg border-2 border-dashed p-8 text-center transition-colors',
              isDragActive
                ? 'border-dharma-accent bg-dharma-accent-tint'
                : 'border-dharma-border bg-dharma-surface hover:border-dharma-border'
            )}
          >
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-lg bg-dharma-surface-hover p-3">
                <Upload className="h-6 w-6 text-dharma-ink-secondary" />
              </div>
              <div>
                <p className="text-sm font-medium text-dharma-ink">
                  Drag and drop files here
                </p>
                <p className="mt-1 text-xs text-dharma-ink-secondary">
                  or click to browse (Images, PDFs, JSON, TXT, LOG — up to 50MB)
                </p>
              </div>
              <input
                id="file-input"
                type="file"
                onChange={handleFileInput}
                className="hidden"
                accept="image/*,application/pdf,.json,.txt,.log"
              />
              <label htmlFor="file-input">
                <Button type="button" variant="outline" size="sm" onClick={(e) => {
                  e.preventDefault();
                  document.getElementById('file-input')?.click();
                }}>
                  Select file
                </Button>
              </label>
            </div>
          </div>

          {error && (
            <div className="mt-4 flex gap-2 rounded-lg border border-dharma-danger bg-dharma-danger-bg p-3">
              <AlertCircle className="h-4 w-4 flex-shrink-0 text-dharma-danger-text" />
              <p className="text-sm text-dharma-danger-text">{error}</p>
            </div>
          )}
        </CardContent>
      </Card>
    );
  }

  // ============================================================================
  // UPLOADING & SUGGESTING STATES — Progress visualization
  // ============================================================================
  if (state === 'uploading' || state === 'suggesting') {
    return (
      <Card>
        <CardHeader>
          <CardTitle>Uploading evidence</CardTitle>
          <CardDescription>
            {selectedFile?.name} ({(selectedFile?.size ?? 0 / 1024 / 1024).toFixed(2)}MB)
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <div className="flex items-center justify-between text-sm">
              <span className="text-dharma-ink-secondary">
                {state === 'uploading' ? 'Uploading file' : 'Analyzing with AI'}
              </span>
              <span className="font-medium text-dharma-ink">{uploadProgress}%</span>
            </div>
            <Progress value={uploadProgress} className="h-2" />
          </div>

          <p className="text-xs text-dharma-ink-secondary">
            {state === 'uploading'
              ? 'Transferring your file to secure storage...'
              : 'Analyzing evidence and matching to compliance frameworks...'}
          </p>
        </CardContent>
      </Card>
    );
  }

  // ============================================================================
  // REVIEW STATE — Framework suggestions with accept/refine
  // ============================================================================
  if (state === 'review' && evidence) {
    return (
      <Card>
        <CardHeader>
          <CardTitle>AI Framework Suggestions</CardTitle>
          <CardDescription>
            {evidence.fileName} was analyzed and matched to these controls
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* File badge */}
          <div className="flex items-center gap-2 rounded-lg border border-dharma-border bg-dharma-surface-hover p-3">
            <FileText className="h-4 w-4 text-dharma-ink-secondary" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-dharma-ink">
                {evidence.fileName}
              </p>
              <p className="text-xs text-dharma-ink-secondary">
                {(evidence.size / 1024 / 1024).toFixed(2)}MB
              </p>
            </div>
          </div>

          {/* Suggestions */}
          <div className="space-y-2">
            <p className="text-sm font-medium text-dharma-ink">
              Suggested controls ({evidence.suggestions.length})
            </p>
            <div className="space-y-2">
              {evidence.suggestions.map((suggestion, idx) => (
                <button
                  key={idx}
                  onClick={() => setSelectedSuggestion(suggestion)}
                  className={cn(
                    'w-full rounded-lg border p-3 text-left transition-colors',
                    selectedSuggestion?.control === suggestion.control
                      ? 'border-dharma-accent bg-dharma-accent-tint'
                      : 'border-dharma-border bg-dharma-surface hover:bg-dharma-surface-hover'
                  )}
                >
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium text-dharma-ink">
                          {suggestion.framework}
                        </p>
                        <Badge variant="secondary" className="ml-auto flex-shrink-0">
                          {suggestion.confidence}%
                        </Badge>
                      </div>
                      <p className="mt-1 text-xs text-dharma-ink-secondary line-clamp-2">
                        {suggestion.control}
                      </p>
                      <p className="mt-1 text-xs text-dharma-ink-secondary">
                        {suggestion.description}
                      </p>
                    </div>
                    {selectedSuggestion?.control === suggestion.control && (
                      <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-dharma-accent-on-tint mt-0.5" />
                    )}
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-end border-t border-dharma-border pt-4">
            <Button type="button" variant="outline" onClick={handleReset} size="sm">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleAccept}
              disabled={!selectedSuggestion}
              size="sm"
            >
              Assign to control
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  // ============================================================================
  // SUCCESS STATE — Confirmation with assigned control
  // ============================================================================
  if (state === 'success' && evidence && selectedSuggestion) {
    return (
      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-lg bg-dharma-success-bg p-2.5">
              <CheckCircle2 className="h-5 w-5 text-dharma-success-text" />
            </div>
            <div className="flex-1">
              <CardTitle className="text-dharma-success-text">Evidence uploaded</CardTitle>
              <CardDescription>Successfully assigned to compliance framework</CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {/* Uploaded file summary */}
          <div className="rounded-lg border border-dharma-border bg-dharma-surface-hover p-3">
            <p className="text-xs font-medium text-dharma-ink-secondary">File</p>
            <p className="mt-1 text-sm font-medium text-dharma-ink">{evidence.fileName}</p>
          </div>

          {/* Assigned control summary */}
          <div className="rounded-lg border border-dharma-success bg-dharma-success-bg p-3">
            <p className="text-xs font-medium text-dharma-success-text">Assigned to</p>
            <p className="mt-1 text-sm font-medium text-dharma-ink">
              {selectedSuggestion.framework}
            </p>
            <p className="mt-1 text-xs text-dharma-ink-secondary line-clamp-2">
              {selectedSuggestion.control}
            </p>
            <p className="mt-2 text-xs text-dharma-ink-secondary">
              {selectedSuggestion.description}
            </p>
          </div>

          {/* Next steps */}
          <div className="rounded-lg border border-dharma-border bg-dharma-surface-hover p-3">
            <p className="text-xs font-medium text-dharma-ink-secondary">Next steps</p>
            <ul className="mt-2 space-y-1 text-xs text-dharma-ink-secondary">
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-dharma-surface-hover-foreground" />
                Review similar controls in the same framework
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-dharma-surface-hover-foreground" />
                Upload additional evidence for comprehensive coverage
              </li>
              <li className="flex items-center gap-2">
                <span className="h-1 w-1 rounded-full bg-dharma-surface-hover-foreground" />
                Check your readiness dashboard for updated compliance score
              </li>
            </ul>
          </div>

          {/* Action buttons */}
          <div className="flex gap-3 justify-end border-t border-dharma-border pt-4">
            <Button type="button" variant="outline" onClick={handleReset} size="sm">
              Upload another
            </Button>
            <Button type="button" variant="outline" size="sm" className="gap-2">
              View framework
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </CardContent>
      </Card>
    );
  }

  return null;
}
