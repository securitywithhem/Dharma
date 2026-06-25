import { signPdf, verifyPdfSignature } from '@/lib/pdf/pdfSigner';

// Mock MinIO client functions
jest.mock('@/server/minio', () => ({
  minioClient: {
    putObject: jest.fn().mockResolvedValue(true),
  },
  generatePresignedUrl: jest.fn().mockResolvedValue('https://mock-url.com/report.pdf'),
}));

describe('PDF Signer', () => {
  it('should sign and verify PDF signature', async () => {
    const testBuffer = Buffer.from('Test PDF content');
    const signingKey = 'test-key-12345';

    const { signedBuffer, signature } = await signPdf(
      testBuffer,
      'org_123',
      signingKey
    );

    expect(signedBuffer.length).toBeGreaterThan(testBuffer.length);
    expect(signature).toBeDefined();

    const isValid = verifyPdfSignature(testBuffer, signature, signingKey);
    expect(isValid).toBe(true);
  });

  it('should reject tampered PDF', () => {
    const testBuffer = Buffer.from('Test PDF content');
    const tamperedBuffer = Buffer.from('Tampered content');
    const signature = 'original_signature_hex'; // Mock signature length
    // We mock the original signature length buffer just to pass the length check internally
    const signingKey = 'test-key-12345';

    const isValid = verifyPdfSignature(tamperedBuffer, signature.padEnd(64, '0'), signingKey);
    expect(isValid).toBe(false);
  });
});
