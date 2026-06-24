import { z } from 'zod';
import { EvidenceType } from '@prisma/client';

export const EvidenceTypeEnum = {
  SCREENSHOT: 'SCREENSHOT',
  POLICY_DOC: 'POLICY_DOC',
  API_RESPONSE: 'API_RESPONSE',
  LOG_EXCERPT: 'LOG_EXCERPT',
  OTHER: 'OTHER',
} as const;

export const GetUploadUrlInputSchema = z.object({
  fileName: z.string().min(1, 'File name required').max(255),
  contentType: z.string().min(1, 'Content type required'),
});

export const CreateEvidenceInputSchema = z.object({
  controlId: z.string().cuid('Invalid control ID'),
  fileName: z.string().min(1).max(255),
  filePath: z.string().min(1, 'File path (MinIO object key) required'),
  type: z.nativeEnum(EvidenceType),
});

export const ListEvidenceInputSchema = z.object({
  controlId: z.string().cuid('Invalid control ID'),
});

export type GetUploadUrlInput = z.infer<typeof GetUploadUrlInputSchema>;
export type CreateEvidenceInput = z.infer<typeof CreateEvidenceInputSchema>;
export type ListEvidenceInput = z.infer<typeof ListEvidenceInputSchema>;
