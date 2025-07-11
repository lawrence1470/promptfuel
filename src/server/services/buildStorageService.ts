import { spawn } from "node:child_process";
import { createReadStream, createWriteStream } from "node:fs";
import { readdir, stat, mkdir, rm, readFile, writeFile } from "node:fs/promises";
import { join, relative, dirname } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { db } from "~/server/db";
import { objectStorageService, isObjectStorageAvailable } from "./objectStorageService";
import { env } from "~/env";

export interface BuildMetadata {
  sessionId: string;
  projectName: string;
  appDescription?: string;
  expoUrl?: string;
  fileCount: number;
  sizeBytes: number;
  createdAt: Date;
  lastAccessed: Date;
  buildData: {
    dependencies?: Record<string, string>;
    expoConfig?: any;
    customFiles?: string[];
  };
}

export interface SaveBuildResult {
  success: boolean;
  sessionId: string;
  storageUrl?: string;
  sizeBytes?: number;
  fileCount?: number;
  error?: string;
}

export interface RestoreBuildResult {
  success: boolean;
  projectDir?: string;
  sessionId?: string;
  error?: string;
}

export interface BuildListItem {
  sessionId: string;
  projectName: string;
  appDescription?: string;
  sizeBytes: number;
  fileCount: number;
  createdAt: Date;
  lastAccessed: Date;
  isShared: boolean;
  shareToken?: string;
}

/**
 * Build storage service that handles compression, metadata, and persistence
 */
export class BuildStorageService {
  /**
   * Save a build to persistent storage
   */
  async saveBuild(
    sessionId: string,
    projectDir: string,
    metadata: {
      projectName: string;
      appDescription?: string;
      expoUrl?: string;
      userId?: string;
    }
  ): Promise<SaveBuildResult> {
    try {
      console.log(`[BuildStorage] Starting save for session: ${sessionId}`);

      // Check if object storage is available
      if (!isObjectStorageAvailable()) {
        return {
          success: false,
          sessionId,
          error: "Object storage not configured. Build persistence requires R2 configuration.",
        };
      }

      // Check if project directory exists
      try {
        await stat(projectDir);
      } catch (error) {
        return {
          success: false,
          sessionId,
          error: `Project directory not found: ${projectDir}`,
        };
      }

      // Create compressed archive
      const { archivePath, fileCount, sizeBytes } = await this.createArchive(projectDir, sessionId);

      try {
        // Upload to object storage
        const archiveBuffer = await readFile(archivePath);
        const uploadResult = await objectStorageService.uploadFile(
          sessionId,
          "build.tar.gz",
          archiveBuffer
        );

        // Extract build metadata
        const buildMetadata = await this.extractBuildMetadata(projectDir);

        // Save to database
        const expiresAt = new Date();
        expiresAt.setDate(expiresAt.getDate() + env.BUILD_RETENTION_DAYS);

        const buildSession = await db.buildSession.upsert({
          where: { sessionId },
          update: {
            storageUrl: uploadResult.url,
            fileCount,
            sizeBytes,
            buildMetadata,
            lastAccessed: new Date(),
            expiresAt,
            isActive: true,
            expoUrl: metadata.expoUrl,
          },
          create: {
            sessionId,
            userId: metadata.userId,
            projectName: metadata.projectName,
            appDescription: metadata.appDescription,
            storageUrl: uploadResult.url,
            fileCount,
            sizeBytes,
            buildMetadata,
            expoUrl: metadata.expoUrl,
            expiresAt,
          },
        });

        // Save file list for deduplication tracking
        const files = await this.getFileList(projectDir);
        for (const file of files) {
          const fileHash = await this.calculateFileHash(join(projectDir, file.path));
          await db.buildFile.upsert({
            where: {
              sessionId_filePath: {
                sessionId,
                filePath: file.path,
              },
            },
            update: {
              fileHash,
              sizeBytes: file.size,
            },
            create: {
              sessionId,
              filePath: file.path,
              fileHash,
              sizeBytes: file.size,
            },
          });
        }

        console.log(`[BuildStorage] Successfully saved build for session: ${sessionId}`);

        return {
          success: true,
          sessionId,
          storageUrl: uploadResult.url,
          sizeBytes,
          fileCount,
        };
      } finally {
        // Clean up temporary archive
        try {
          await rm(archivePath, { force: true });
        } catch (error) {
          console.warn(`[BuildStorage] Failed to clean up archive: ${archivePath}`);
        }
      }
    } catch (error) {
      console.error(`[BuildStorage] Save failed for session ${sessionId}:`, error);
      return {
        success: false,
        sessionId,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Restore a build from persistent storage
   */
  async restoreBuild(sessionId: string, targetDir?: string): Promise<RestoreBuildResult> {
    try {
      console.log(`[BuildStorage] Starting restore for session: ${sessionId}`);

      // Get build metadata from database
      const buildSession = await db.buildSession.findUnique({
        where: { sessionId },
        include: { files: true },
      });

      if (!buildSession) {
        return {
          success: false,
          error: `Build session not found: ${sessionId}`,
        };
      }

      // Check if build has expired
      if (buildSession.expiresAt && buildSession.expiresAt < new Date()) {
        return {
          success: false,
          error: `Build has expired: ${sessionId}`,
        };
      }

      // Create target directory
      const projectDir = targetDir || join(tmpdir(), `expo-${sessionId}-restored-${randomUUID()}`);
      await mkdir(projectDir, { recursive: true });

      try {
        // Download archive from object storage
        const storageKey = this.extractKeyFromUrl(buildSession.storageUrl);
        const archiveBuffer = await objectStorageService.downloadBuffer(storageKey);

        // Save archive to temporary file
        const tempArchive = join(tmpdir(), `${sessionId}-restore.tar.gz`);
        await writeFile(tempArchive, archiveBuffer);

        try {
          // Extract archive
          await this.extractArchive(tempArchive, projectDir);

          // Update last accessed timestamp
          await db.buildSession.update({
            where: { sessionId },
            data: { lastAccessed: new Date() },
          });

          console.log(`[BuildStorage] Successfully restored build for session: ${sessionId}`);

          return {
            success: true,
            projectDir,
            sessionId,
          };
        } finally {
          // Clean up temporary archive
          try {
            await rm(tempArchive, { force: true });
          } catch (error) {
            console.warn(`[BuildStorage] Failed to clean up temp archive: ${tempArchive}`);
          }
        }
      } catch (storageError) {
        // Clean up project directory on failure
        try {
          await rm(projectDir, { recursive: true, force: true });
        } catch (cleanupError) {
          console.warn(`[BuildStorage] Failed to clean up project dir on error: ${projectDir}`);
        }
        throw storageError;
      }
    } catch (error) {
      console.error(`[BuildStorage] Restore failed for session ${sessionId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Get list of builds for a user
   */
  async listBuilds(userId?: string, includeShared: boolean = false): Promise<BuildListItem[]> {
    try {
      const where: any = {
        isActive: true,
        expiresAt: {
          gt: new Date(), // Only include non-expired builds
        },
      };

      if (userId) {
        where.userId = userId;
      }

      if (includeShared) {
        where.OR = [
          { userId },
          { isShared: true },
        ];
      }

      const builds = await db.buildSession.findMany({
        where,
        select: {
          sessionId: true,
          projectName: true,
          appDescription: true,
          sizeBytes: true,
          fileCount: true,
          createdAt: true,
          lastAccessed: true,
          isShared: true,
          shareToken: true,
        },
        orderBy: { lastAccessed: "desc" },
        take: env.MAX_BUILDS_PER_USER,
      });

      return builds.map((build) => ({
        sessionId: build.sessionId,
        projectName: build.projectName,
        appDescription: build.appDescription || undefined,
        sizeBytes: Number(build.sizeBytes),
        fileCount: build.fileCount,
        createdAt: build.createdAt,
        lastAccessed: build.lastAccessed,
        isShared: build.isShared,
        shareToken: build.shareToken || undefined,
      }));
    } catch (error) {
      console.error(`[BuildStorage] List builds failed:`, error);
      return [];
    }
  }

  /**
   * Delete a build and its associated files
   */
  async deleteBuild(sessionId: string): Promise<{ success: boolean; error?: string }> {
    try {
      console.log(`[BuildStorage] Deleting build for session: ${sessionId}`);

      // Get build metadata
      const buildSession = await db.buildSession.findUnique({
        where: { sessionId },
      });

      if (!buildSession) {
        return {
          success: false,
          error: `Build session not found: ${sessionId}`,
        };
      }

      // Delete from object storage
      try {
        const storageKey = this.extractKeyFromUrl(buildSession.storageUrl);
        await objectStorageService.deleteFile(storageKey);
      } catch (storageError) {
        console.warn(`[BuildStorage] Failed to delete from storage for ${sessionId}:`, storageError);
        // Continue with database cleanup even if storage delete fails
      }

      // Delete from database (cascade will delete related BuildFile records)
      await db.buildSession.delete({
        where: { sessionId },
      });

      console.log(`[BuildStorage] Successfully deleted build for session: ${sessionId}`);

      return { success: true };
    } catch (error) {
      console.error(`[BuildStorage] Delete failed for session ${sessionId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Create a share link for a build
   */
  async createShareLink(sessionId: string): Promise<{ success: boolean; shareToken?: string; error?: string }> {
    try {
      if (!env.ENABLE_BUILD_SHARING) {
        return {
          success: false,
          error: "Build sharing is disabled",
        };
      }

      const shareToken = randomUUID();

      await db.buildSession.update({
        where: { sessionId },
        data: {
          isShared: true,
          shareToken,
        },
      });

      return {
        success: true,
        shareToken,
      };
    } catch (error) {
      console.error(`[BuildStorage] Share link creation failed for ${sessionId}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Import a shared build
   */
  async importSharedBuild(shareToken: string, newSessionId?: string): Promise<RestoreBuildResult> {
    try {
      // Find the shared build
      const sharedBuild = await db.buildSession.findUnique({
        where: { shareToken },
      });

      if (!sharedBuild || !sharedBuild.isShared) {
        return {
          success: false,
          error: "Shared build not found or sharing is disabled",
        };
      }

      // Check if build has expired
      if (sharedBuild.expiresAt && sharedBuild.expiresAt < new Date()) {
        return {
          success: false,
          error: "Shared build has expired",
        };
      }

      // Restore the build with a new session ID
      const targetSessionId = newSessionId || randomUUID();
      const result = await this.restoreBuild(sharedBuild.sessionId);

      if (result.success && result.projectDir) {
        // Create a new build session for the imported build
        const saveResult = await this.saveBuild(targetSessionId, result.projectDir, {
          projectName: `${sharedBuild.projectName} (Imported)`,
          appDescription: sharedBuild.appDescription || undefined,
        });

        // Clean up the temporary restore directory
        try {
          await rm(result.projectDir, { recursive: true, force: true });
        } catch (error) {
          console.warn(`[BuildStorage] Failed to clean up temp dir: ${result.projectDir}`);
        }

        if (saveResult.success) {
          return {
            success: true,
            sessionId: targetSessionId,
            projectDir: undefined, // Don't return temp directory
          };
        } else {
          return {
            success: false,
            error: saveResult.error,
          };
        }
      }

      return result;
    } catch (error) {
      console.error(`[BuildStorage] Import shared build failed for token ${shareToken}:`, error);
      return {
        success: false,
        error: error instanceof Error ? error.message : String(error),
      };
    }
  }

  /**
   * Clean up expired builds
   */
  async cleanupExpiredBuilds(): Promise<{ deletedCount: number; errors: string[] }> {
    try {
      console.log(`[BuildStorage] Starting cleanup of expired builds`);

      const expiredBuilds = await db.buildSession.findMany({
        where: {
          OR: [
            { expiresAt: { lt: new Date() } },
            { isActive: false },
          ],
        },
        select: { sessionId: true, storageUrl: true },
      });

      let deletedCount = 0;
      const errors: string[] = [];

      for (const build of expiredBuilds) {
        try {
          await this.deleteBuild(build.sessionId);
          deletedCount++;
        } catch (error) {
          const errorMessage = `Failed to delete ${build.sessionId}: ${error instanceof Error ? error.message : String(error)}`;
          errors.push(errorMessage);
          console.error(`[BuildStorage] ${errorMessage}`);
        }
      }

      console.log(`[BuildStorage] Cleanup completed: ${deletedCount} builds deleted, ${errors.length} errors`);

      return { deletedCount, errors };
    } catch (error) {
      console.error(`[BuildStorage] Cleanup failed:`, error);
      return {
        deletedCount: 0,
        errors: [error instanceof Error ? error.message : String(error)],
      };
    }
  }

  /**
   * Create compressed archive of project directory
   */
  private async createArchive(projectDir: string, sessionId: string): Promise<{
    archivePath: string;
    fileCount: number;
    sizeBytes: number;
  }> {
    const archivePath = join(tmpdir(), `${sessionId}-build.tar.gz`);
    
    // Exclude patterns for files we don't want to archive
    const excludePatterns = [
      "node_modules",
      ".expo",
      ".git",
      "dist",
      "build",
      ".next",
      ".DS_Store",
      "*.log",
      "npm-debug.log*",
      "yarn-debug.log*",
      "yarn-error.log*",
    ];

    return new Promise((resolve, reject) => {
      const excludeArgs = excludePatterns.flatMap(pattern => ["--exclude", pattern]);
      
      const tarProcess = spawn("tar", [
        "-czf",
        archivePath,
        "-C",
        dirname(projectDir),
        ...excludeArgs,
        relative(dirname(projectDir), projectDir),
      ]);

      let stderr = "";

      tarProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      tarProcess.on("close", async (code) => {
        if (code === 0) {
          try {
            const archiveStats = await stat(archivePath);
            const files = await this.getFileList(projectDir);
            
            resolve({
              archivePath,
              fileCount: files.length,
              sizeBytes: archiveStats.size,
            });
          } catch (error) {
            reject(new Error(`Failed to get archive stats: ${error instanceof Error ? error.message : String(error)}`));
          }
        } else {
          reject(new Error(`Archive creation failed with code ${code}: ${stderr}`));
        }
      });

      tarProcess.on("error", (error) => {
        reject(new Error(`Failed to start tar process: ${error.message}`));
      });
    });
  }

  /**
   * Extract archive to target directory
   */
  private async extractArchive(archivePath: string, targetDir: string): Promise<void> {
    return new Promise((resolve, reject) => {
      const tarProcess = spawn("tar", [
        "-xzf",
        archivePath,
        "-C",
        targetDir,
        "--strip-components=1", // Remove the top-level directory from archive
      ]);

      let stderr = "";

      tarProcess.stderr?.on("data", (data) => {
        stderr += data.toString();
      });

      tarProcess.on("close", (code) => {
        if (code === 0) {
          resolve();
        } else {
          reject(new Error(`Archive extraction failed with code ${code}: ${stderr}`));
        }
      });

      tarProcess.on("error", (error) => {
        reject(new Error(`Failed to start tar process: ${error.message}`));
      });
    });
  }

  /**
   * Get list of files in project directory
   */
  private async getFileList(projectDir: string): Promise<Array<{ path: string; size: number }>> {
    const files: Array<{ path: string; size: number }> = [];

    async function walk(dir: string, basePath: string = ""): Promise<void> {
      const entries = await readdir(dir);

      for (const entry of entries) {
        const fullPath = join(dir, entry);
        const relativePath = join(basePath, entry);
        const stats = await stat(fullPath);

        if (stats.isDirectory()) {
          // Skip excluded directories
          if (!["node_modules", ".expo", ".git", "dist", "build", ".next"].includes(entry)) {
            await walk(fullPath, relativePath);
          }
        } else {
          files.push({
            path: relativePath,
            size: stats.size,
          });
        }
      }
    }

    await walk(projectDir);
    return files;
  }

  /**
   * Calculate SHA-256 hash of a file
   */
  private async calculateFileHash(filePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      const hash = createHash("sha256");
      const stream = createReadStream(filePath);

      stream.on("data", (data) => hash.update(data));
      stream.on("end", () => resolve(hash.digest("hex")));
      stream.on("error", reject);
    });
  }

  /**
   * Extract build metadata from project directory
   */
  private async extractBuildMetadata(projectDir: string): Promise<any> {
    const metadata: any = {};

    try {
      // Read package.json for dependencies
      const packageJsonPath = join(projectDir, "package.json");
      try {
        const packageJson = JSON.parse(await readFile(packageJsonPath, "utf-8"));
        metadata.dependencies = {
          ...packageJson.dependencies,
          ...packageJson.devDependencies,
        };
      } catch (error) {
        console.warn(`[BuildStorage] Could not read package.json: ${error}`);
      }

      // Read app.json for Expo config
      const appJsonPath = join(projectDir, "app.json");
      try {
        const appJson = JSON.parse(await readFile(appJsonPath, "utf-8"));
        metadata.expoConfig = appJson.expo;
      } catch (error) {
        console.warn(`[BuildStorage] Could not read app.json: ${error}`);
      }

      // List custom files (non-default Expo files)
      const files = await this.getFileList(projectDir);
      const defaultFiles = ["App.js", "App.tsx", "app.json", "package.json", "babel.config.js"];
      metadata.customFiles = files
        .map(f => f.path)
        .filter(path => !defaultFiles.includes(path) && !path.startsWith("assets/"));

    } catch (error) {
      console.warn(`[BuildStorage] Error extracting metadata: ${error}`);
    }

    return metadata;
  }

  /**
   * Extract storage key from URL
   */
  private extractKeyFromUrl(url: string): string {
    // Extract the key from the storage URL
    // Format: https://domain.com/builds/sessionId/build.tar.gz
    const urlParts = url.split("/");
    const keyParts = urlParts.slice(-3); // ["builds", "sessionId", "build.tar.gz"]
    return keyParts.join("/");
  }
}

// Export singleton instance
export const buildStorageService = new BuildStorageService();