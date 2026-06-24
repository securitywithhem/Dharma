import { api } from '@/lib/trpc';
import { useCallback } from 'react';
import { EvidenceType } from '@prisma/client';

export function useEvidence() {
  const utils = api.useUtils();

  // Query: List evidence for a control
  const listQuery = (controlId?: string) => {
    return api.evidence.list.useQuery({ controlId });
  };

  // Mutation: Get presigned upload URL
  const getUploadUrlMutation = api.evidence.getUploadUrl.useMutation();

  // Mutation: Create evidence record
  const createEvidenceMutation = api.evidence.create.useMutation({
    onSuccess: (data, variables) => {
      // Invalidate the list query to refetch evidence
      if (variables.controlId) {
        void utils.evidence.list.invalidate({ controlId: variables.controlId });
      }
      // Also invalidate the generic list
      void utils.evidence.list.invalidate();
    },
  });

  // Mutation: Delete evidence
  const deleteEvidenceMutation = api.evidence.delete.useMutation({
    onSuccess: () => {
      // Refetch list
      void utils.evidence.list.invalidate();
    },
  });

  // Handler: Upload file and create evidence record
  const uploadEvidence = useCallback(
    async (
      controlId: string | undefined,
      file: File,
      type: EvidenceType
    ) => {
      try {
        // Step 1: Get presigned upload URL
        const { uploadUrl, filePath } = await getUploadUrlMutation.mutateAsync({
          fileName: file.name,
          contentType: file.type,
          controlId,
        });

        // Step 2: Upload file directly to MinIO
        const response = await fetch(uploadUrl, {
          method: 'PUT',
          body: file,
          headers: {
            'Content-Type': file.type,
          },
        });

        if (!response.ok) {
          throw new Error(`Upload failed with status ${response.status}`);
        }

        // Step 3: Create evidence record
        const evidence = await createEvidenceMutation.mutateAsync({
          controlId,
          fileName: file.name,
          filePath,
          type,
        });

        return evidence;
      } catch (error) {
        console.error('Upload failed:', error);
        throw error;
      }
    },
    [getUploadUrlMutation, createEvidenceMutation]
  );

  return {
    listQuery,
    getUploadUrlMutation,
    createEvidenceMutation,
    deleteEvidenceMutation,
    uploadEvidence,
  };
}
