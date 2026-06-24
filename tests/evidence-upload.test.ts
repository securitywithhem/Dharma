import { describe, it, expect } from '@jest/globals';
import { generatePresignedUploadUrl } from '@/lib/storage/minioClient';

describe('generatePresignedUploadUrl', () => {
  it('should return a valid presigned URL', async () => {
    const { uploadUrl, objectKey } = await generatePresignedUploadUrl(
      'test.png',
      'image/png'
    );

    expect(uploadUrl).toContain('http');
    expect(objectKey).toMatch(/^[a-f0-9-]+-test\.png$/);
  });
});
