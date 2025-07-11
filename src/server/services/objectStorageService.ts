import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { env } from "~/env";
import { createReadStream, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { randomUUID } from "node:crypto";

// Initialize S3 client for Cloudflare R2
let s3Client: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3Client) {
    if (!env.R2_ENDPOINT || !env.R2_ACCESS_KEY_ID || !env.R2_SECRET_ACCESS_KEY) {
      throw new Error("R2 configuration missing. Build persistence requires R2_ENDPOINT, R2_ACCESS_KEY_ID, and R2_SECRET_ACCESS_KEY.");
    }

    s3Client = new S3Client({
      region: "auto", // Cloudflare R2 uses "auto" region
      endpoint: env.R2_ENDPOINT,
      credentials: {
        accessKeyId: env.R2_ACCESS_KEY_ID,
        secretAccessKey: env.R2_SECRET_ACCESS_KEY,
      },
      // Disable AWS-specific features
      forcePathStyle: true,
    });
  }
  return s3Client;
}

export interface UploadResult {
  key: string;
  url: string;
  size: number;
  etag: string;
}

export interface DownloadResult {
  stream: NodeJS.ReadableStream;
  size: number;
  lastModified: Date;
}

/**
 * Object storage service for Cloudflare R2
 * Handles file upload, download, and management
 */
export class ObjectStorageService {
  private client: S3Client;
  private bucketName: string;

  constructor() {
    this.client = getS3Client();
    this.bucketName = env.R2_BUCKET_NAME || "promptfuel-builds";
  }

  /**
   * Upload a file to R2 storage
   */
  async uploadFile(
    sessionId: string,
    filePath: string,
    body: Buffer | Uint8Array | string
  ): Promise<UploadResult> {
    try {
      const key = this.generateKey(sessionId, filePath);
      
      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: body,
        ContentType: this.getContentType(filePath),
        Metadata: {
          sessionId,
          originalPath: filePath,
          uploadedAt: new Date().toISOString(),
        },
      });

      console.log(`[ObjectStorage] Uploading ${filePath} for session ${sessionId}`);
      const result = await this.client.send(command);

      const url = this.getPublicUrl(key);
      const size = Buffer.isBuffer(body) ? body.length : 
                   body instanceof Uint8Array ? body.length : 
                   Buffer.byteLength(body.toString());

      return {
        key,
        url,
        size,
        etag: result.ETag || "",
      };
    } catch (error) {
      console.error(`[ObjectStorage] Upload failed for ${filePath}:`, error);
      throw new Error(`Failed to upload file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Upload a file stream to R2 storage
   */
  async uploadStream(
    sessionId: string,
    fileName: string,
    stream: NodeJS.ReadableStream,
    size?: number
  ): Promise<UploadResult> {
    try {
      const key = this.generateKey(sessionId, fileName);
      
      // Convert stream to buffer for S3 upload
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      const buffer = Buffer.concat(chunks);

      const command = new PutObjectCommand({
        Bucket: this.bucketName,
        Key: key,
        Body: buffer,
        ContentType: this.getContentType(fileName),
        ContentLength: size || buffer.length,
        Metadata: {
          sessionId,
          originalPath: fileName,
          uploadedAt: new Date().toISOString(),
        },
      });

      console.log(`[ObjectStorage] Uploading stream ${fileName} for session ${sessionId}`);
      const result = await this.client.send(command);

      const url = this.getPublicUrl(key);

      return {
        key,
        url,
        size: buffer.length,
        etag: result.ETag || "",
      };
    } catch (error) {
      console.error(`[ObjectStorage] Stream upload failed for ${fileName}:`, error);
      throw new Error(`Failed to upload stream: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download a file from R2 storage
   */
  async downloadFile(key: string): Promise<DownloadResult> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      console.log(`[ObjectStorage] Downloading ${key}`);
      const result = await this.client.send(command);

      if (!result.Body) {
        throw new Error("No file body returned");
      }

      return {
        stream: result.Body as NodeJS.ReadableStream,
        size: result.ContentLength || 0,
        lastModified: result.LastModified || new Date(),
      };
    } catch (error) {
      console.error(`[ObjectStorage] Download failed for ${key}:`, error);
      throw new Error(`Failed to download file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Download file as buffer
   */
  async downloadBuffer(key: string): Promise<Buffer> {
    try {
      const { stream } = await this.downloadFile(key);
      
      const chunks: Buffer[] = [];
      for await (const chunk of stream) {
        chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      }
      
      return Buffer.concat(chunks);
    } catch (error) {
      console.error(`[ObjectStorage] Buffer download failed for ${key}:`, error);
      throw new Error(`Failed to download buffer: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete a file from R2 storage
   */
  async deleteFile(key: string): Promise<void> {
    try {
      const command = new DeleteObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      console.log(`[ObjectStorage] Deleting ${key}`);
      await this.client.send(command);
    } catch (error) {
      console.error(`[ObjectStorage] Delete failed for ${key}:`, error);
      throw new Error(`Failed to delete file: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check if file exists and get metadata
   */
  async getFileInfo(key: string): Promise<{ exists: boolean; size?: number; lastModified?: Date }> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      const result = await this.client.send(command);
      
      return {
        exists: true,
        size: result.ContentLength,
        lastModified: result.LastModified,
      };
    } catch (error: any) {
      if (error.name === "NotFound" || error.$metadata?.httpStatusCode === 404) {
        return { exists: false };
      }
      
      console.error(`[ObjectStorage] Head request failed for ${key}:`, error);
      throw new Error(`Failed to get file info: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a signed URL for temporary access
   */
  async getSignedDownloadUrl(key: string, expiresIn: number = 3600): Promise<string> {
    try {
      const command = new GetObjectCommand({
        Bucket: this.bucketName,
        Key: key,
      });

      return await getSignedUrl(this.client, command, { expiresIn });
    } catch (error) {
      console.error(`[ObjectStorage] Signed URL generation failed for ${key}:`, error);
      throw new Error(`Failed to generate signed URL: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Delete all files for a session
   */
  async deleteSessionFiles(sessionId: string): Promise<void> {
    try {
      // For now, we'll delete the main archive file
      // In a full implementation, you'd list all objects with the session prefix
      const key = this.generateKey(sessionId, "build.tar.gz");
      await this.deleteFile(key);
    } catch (error) {
      console.error(`[ObjectStorage] Session cleanup failed for ${sessionId}:`, error);
      // Don't throw here - cleanup failures shouldn't break the main flow
    }
  }

  /**
   * Generate storage key for a file
   */
  private generateKey(sessionId: string, fileName: string): string {
    const sanitizedSessionId = sessionId.replace(/[^a-zA-Z0-9-]/g, "");
    const sanitizedFileName = fileName.replace(/[^a-zA-Z0-9.-]/g, "_");
    return `builds/${sanitizedSessionId}/${sanitizedFileName}`;
  }

  /**
   * Get public URL for a file
   */
  private getPublicUrl(key: string): string {
    if (env.R2_PUBLIC_URL) {
      return `${env.R2_PUBLIC_URL}/${key}`;
    }
    // Fallback to direct R2 URL (may not be publicly accessible)
    return `${env.R2_ENDPOINT}/${this.bucketName}/${key}`;
  }

  /**
   * Determine content type based on file extension
   */
  private getContentType(fileName: string): string {
    const ext = fileName.toLowerCase().split(".").pop();
    
    const contentTypes: Record<string, string> = {
      "tar": "application/x-tar",
      "gz": "application/gzip",
      "tgz": "application/gzip",
      "zip": "application/zip",
      "json": "application/json",
      "js": "application/javascript",
      "ts": "application/typescript",
      "tsx": "application/typescript",
      "jsx": "application/javascript",
      "txt": "text/plain",
      "md": "text/markdown",
    };

    return contentTypes[ext || ""] || "application/octet-stream";
  }
}

// Export singleton instance
export const objectStorageService = new ObjectStorageService();

/**
 * Check if object storage is configured and available
 */
export function isObjectStorageAvailable(): boolean {
  return !!(
    env.R2_ENDPOINT &&
    env.R2_ACCESS_KEY_ID &&
    env.R2_SECRET_ACCESS_KEY &&
    env.R2_BUCKET_NAME
  );
}

/**
 * Get storage configuration info
 */
export function getStorageConfig() {
  return {
    isAvailable: isObjectStorageAvailable(),
    bucketName: env.R2_BUCKET_NAME,
    publicUrl: env.R2_PUBLIC_URL,
    retentionDays: env.BUILD_RETENTION_DAYS,
    maxSizeMB: env.MAX_BUILD_SIZE_MB,
    maxBuildsPerUser: env.MAX_BUILDS_PER_USER,
    sharingEnabled: env.ENABLE_BUILD_SHARING,
  };
}