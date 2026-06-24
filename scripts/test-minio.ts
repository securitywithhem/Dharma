import { initializeBucket, generatePresignedUploadUrl } from '@/lib/storage/minioClient';

async function testMinio() {
  try {
    console.log('🔍 Testing MinIO initialization...');
    await initializeBucket();
    console.log('✅ Bucket initialized successfully.');

    console.log('🔍 Generating presigned upload URL...');
    const { uploadUrl, objectKey } = await generatePresignedUploadUrl(
      'test-file.txt',
      'text/plain'
    );
    console.log(`✅ Presigned URL generated:`, uploadUrl);
    console.log(`✅ Object Key: ${objectKey}`);
  } catch (error) {
    console.error('❌ MinIO test failed:', error);
  }
}

testMinio();
