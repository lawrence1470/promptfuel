import { z } from "zod";
import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";
import { buildStorageService } from "~/server/services/buildStorageService";
import { isObjectStorageAvailable, getStorageConfig } from "~/server/services/objectStorageService";
import { TRPCError } from "@trpc/server";
import { buildProgressMap } from "./appStarter";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const buildPersistenceRouter = createTRPCRouter({
  /**
   * Check if build persistence is available and get configuration
   */
  getConfig: publicProcedure.query(async () => {
    return getStorageConfig();
  }),

  /**
   * Save the current build for a session
   */
  save: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        projectName: z.string().min(1, "Project name is required").optional(),
        userId: z.string().optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, projectName, userId } = input;

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        // Get current build progress to extract metadata
        const buildProgress = buildProgressMap.get(sessionId);
        if (!buildProgress) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `No active build found for session: ${sessionId}`,
          });
        }

        // Determine project directory
        const projectDir = buildProgress.data?.projectDir || join(tmpdir(), `expo-${sessionId}`);

        // Extract metadata from build progress
        const metadata = {
          projectName: projectName || buildProgress.data?.projectName || "My Expo App",
          appDescription: buildProgress.appDescription,
          expoUrl: buildProgress.expoUrl || buildProgress.data?.expoUrl,
          userId,
        };

        // Save the build
        const result = await buildStorageService.saveBuild(sessionId, projectDir, metadata);

        if (!result.success) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: result.error || "Failed to save build",
          });
        }

        return {
          success: true,
          sessionId: result.sessionId,
          storageUrl: result.storageUrl,
          sizeBytes: result.sizeBytes,
          fileCount: result.fileCount,
          message: "Build saved successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Save failed for session ${sessionId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to save build: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Restore a saved build to a new session
   */
  restore: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
        newSessionId: z.string().min(1, "New session ID is required").optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, newSessionId } = input;

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        // Restore the build
        const result = await buildStorageService.restoreBuild(sessionId);

        if (!result.success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: result.error || "Failed to restore build",
          });
        }

        // If a new session ID was provided, we need to move the restored files
        let finalSessionId = sessionId;
        let finalProjectDir = result.projectDir;

        if (newSessionId && newSessionId !== sessionId) {
          finalSessionId = newSessionId;
          const newProjectDir = join(tmpdir(), `expo-${newSessionId}`);
          
          // The restored files are already in result.projectDir
          // We'll rename the directory to match the new session ID
          const { rename } = await import("node:fs/promises");
          try {
            await rename(result.projectDir!, newProjectDir);
            finalProjectDir = newProjectDir;
          } catch (error) {
            console.warn(`[BuildPersistence] Failed to rename directory, using original: ${error}`);
          }
        }

        return {
          success: true,
          sessionId: finalSessionId,
          projectDir: finalProjectDir,
          message: "Build restored successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Restore failed for session ${sessionId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to restore build: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * List saved builds for a user
   */
  list: publicProcedure
    .input(
      z.object({
        userId: z.string().optional(),
        includeShared: z.boolean().default(false),
        limit: z.number().min(1).max(100).default(20),
      })
    )
    .query(async ({ input }) => {
      const { userId, includeShared, limit } = input;

      try {
        const builds = await buildStorageService.listBuilds(userId, includeShared);
        
        // Apply limit and return formatted results
        return {
          builds: builds.slice(0, limit).map(build => ({
            sessionId: build.sessionId,
            projectName: build.projectName,
            appDescription: build.appDescription,
            sizeBytes: build.sizeBytes,
            fileCount: build.fileCount,
            createdAt: build.createdAt.toISOString(),
            lastAccessed: build.lastAccessed.toISOString(),
            isShared: build.isShared,
            shareToken: build.shareToken,
            // Format size for display
            displaySize: formatBytes(build.sizeBytes),
            // Calculate age
            ageInDays: Math.floor((Date.now() - build.lastAccessed.getTime()) / (1000 * 60 * 60 * 24)),
          })),
          total: builds.length,
          storageConfig: getStorageConfig(),
        };
      } catch (error) {
        console.error(`[BuildPersistence] List failed:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to list builds: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Delete a saved build
   */
  delete: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId } = input;

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        const result = await buildStorageService.deleteBuild(sessionId);

        if (!result.success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: result.error || "Failed to delete build",
          });
        }

        return {
          success: true,
          sessionId,
          message: "Build deleted successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Delete failed for session ${sessionId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to delete build: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Create a share link for a build
   */
  share: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId } = input;

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        const result = await buildStorageService.createShareLink(sessionId);

        if (!result.success) {
          throw new TRPCError({
            code: "BAD_REQUEST",
            message: result.error || "Failed to create share link",
          });
        }

        // Generate the full share URL
        const baseUrl = process.env.NEXTAUTH_URL || "http://localhost:3000";
        const shareUrl = `${baseUrl}/shared/${result.shareToken}`;

        return {
          success: true,
          shareToken: result.shareToken,
          shareUrl,
          message: "Share link created successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Share failed for session ${sessionId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create share link: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Import a shared build
   */
  import: publicProcedure
    .input(
      z.object({
        shareToken: z.string().min(1, "Share token is required"),
        newSessionId: z.string().min(1, "New session ID is required").optional(),
      })
    )
    .mutation(async ({ input }) => {
      const { shareToken, newSessionId } = input;

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        const result = await buildStorageService.importSharedBuild(shareToken, newSessionId);

        if (!result.success) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: result.error || "Failed to import shared build",
          });
        }

        return {
          success: true,
          sessionId: result.sessionId,
          message: "Shared build imported successfully",
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Import failed for token ${shareToken}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to import shared build: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Clean up expired builds (admin function)
   */
  cleanup: publicProcedure
    .input(
      z.object({
        adminKey: z.string().min(1).optional(), // In production, add proper admin auth
      })
    )
    .mutation(async ({ input }) => {
      // In production, you'd want proper admin authentication here
      // For now, we'll allow cleanup without auth for development

      if (!isObjectStorageAvailable()) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "Build persistence is not configured. Object storage settings are required.",
        });
      }

      try {
        const result = await buildStorageService.cleanupExpiredBuilds();

        return {
          success: true,
          deletedCount: result.deletedCount,
          errors: result.errors,
          message: `Cleanup completed: ${result.deletedCount} builds deleted`,
        };
      } catch (error) {
        console.error(`[BuildPersistence] Cleanup failed:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to cleanup builds: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),

  /**
   * Get build metadata without restoring
   */
  getMetadata: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .query(async ({ input }) => {
      const { sessionId } = input;

      try {
        const { db } = await import("~/server/db");
        
        const buildSession = await db.buildSession.findUnique({
          where: { sessionId },
          include: {
            files: {
              select: {
                filePath: true,
                sizeBytes: true,
                fileHash: true,
              },
            },
          },
        });

        if (!buildSession) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Build not found: ${sessionId}`,
          });
        }

        // Check if build has expired
        if (buildSession.expiresAt && buildSession.expiresAt < new Date()) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: `Build has expired: ${sessionId}`,
          });
        }

        return {
          sessionId: buildSession.sessionId,
          projectName: buildSession.projectName,
          appDescription: buildSession.appDescription,
          fileCount: buildSession.fileCount,
          sizeBytes: Number(buildSession.sizeBytes),
          displaySize: formatBytes(Number(buildSession.sizeBytes)),
          buildMetadata: buildSession.buildMetadata,
          expoUrl: buildSession.expoUrl,
          isShared: buildSession.isShared,
          shareToken: buildSession.shareToken,
          createdAt: buildSession.createdAt.toISOString(),
          lastAccessed: buildSession.lastAccessed.toISOString(),
          expiresAt: buildSession.expiresAt?.toISOString(),
          files: buildSession.files.map(file => ({
            path: file.filePath,
            size: file.sizeBytes,
            displaySize: formatBytes(file.sizeBytes),
            hash: file.fileHash.substring(0, 8), // First 8 chars of hash
          })),
        };
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }

        console.error(`[BuildPersistence] Get metadata failed for session ${sessionId}:`, error);
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to get build metadata: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    }),
});

/**
 * Format bytes to human readable string
 */
function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 Bytes";

  const k = 1024;
  const sizes = ["Bytes", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(k));

  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + " " + sizes[i];
}