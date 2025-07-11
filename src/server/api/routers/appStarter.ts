import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

import { eventBroadcaster } from "~/lib/eventBroadcaster";
import { getNetworkInfo, findAvailablePort } from "~/lib/networkUtils";
import { processManager } from "~/lib/processManager";

/**
 * Helper function to create a temporary directory for the Expo project
 */
async function makeTmpDir(): Promise<{ sessionId: string; dir: string }> {
  const sessionId = randomUUID();
  const dir = join(tmpdir(), `expo-${sessionId}`);

  try {
    await mkdir(dir, { recursive: true });
    return { sessionId, dir };
  } catch (error) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: `Failed to create temporary directory: ${
        error instanceof Error ? error.message : String(error)
      }`,
    });
  }
}

/**
 * Helper function to start Expo development server in background
 */
async function startExpoServer(
  projectDir: string,
  port: number,
  sessionId: string
): Promise<{ process: any; url: string }> {
  const { getNetworkInfo } = await import("~/lib/networkUtils");
  const networkInfo = await getNetworkInfo(port);

  // Verify project directory exists and is accessible
  const fs = require("node:fs");
  try {
    if (!fs.existsSync(projectDir)) {
      throw new Error(`Project directory does not exist: ${projectDir}`);
    }
    fs.accessSync(projectDir, fs.constants.R_OK | fs.constants.W_OK);
    console.log(`[ExpoServer] Verified project directory: ${projectDir}`);
  } catch (error) {
    console.error(`[ExpoServer] Project directory verification failed:`, error);
    throw new Error(`Invalid project directory: ${projectDir}`);
  }

  console.log(
    `[ExpoServer] Starting Expo development server for session: ${sessionId} on port ${port}`
  );

  // Start Expo server in background with better port handling
  const expoProcess = spawn(
    "npx",
    [
      "expo",
      "start",
      "--port",
      port.toString(),
      "--clear",
      "--lan",
    ],
    {
      cwd: projectDir,
      stdio: ["ignore", "pipe", "pipe"],
      detached: false, // Keep attached to parent process for easier cleanup
      env: {
        ...process.env,
        CI: "1", // Use CI mode instead of --non-interactive
        EXPO_FORCE_PORT: port.toString(), // Force Expo to use this specific port
        PWD: projectDir, // Explicitly set the PWD environment variable
      },
    }
  );

  // Send real-time output
  expoProcess.stdout?.on("data", (data) => {
    const output = data.toString();
    console.log(`[ExpoServer] ${sessionId}: ${output.trim()}`);

    try {
      eventBroadcaster.sendToSession(sessionId, {
        type: "output",
        stage: "Expo Development Server",
        message: output.trim(),
      });
    } catch (error) {
      console.error(`[ExpoServer] Failed to send output:`, error);
    }
  });

  expoProcess.stderr?.on("data", (data) => {
    const output = data.toString();
    console.error(`[ExpoServer] ${sessionId} ERROR: ${output.trim()}`);

    try {
      eventBroadcaster.sendToSession(sessionId, {
        type: "output",
        stage: "Expo Development Server",
        message: output.trim(),
        error: output.trim(),
      });
    } catch (error) {
      console.error(`[ExpoServer] Failed to send error output:`, error);
    }
  });

  // Register the process with the process manager
  processManager.registerProcess(sessionId, expoProcess, "expo", {
    port,
    projectPath: projectDir,
  });

  // Clean up project directory when process exits
  expoProcess.on("exit", (code) => {
    console.log(
      `[ExpoServer] Process exited with code ${code}, cleaning up project directory: ${projectDir}`
    );
    // Clean up the temporary directory asynchronously
    rm(projectDir, { recursive: true, force: true }).catch((error) => {
      console.error(
        `[ExpoServer] Failed to clean up project directory ${projectDir}:`,
        error
      );
    });
  });

  // Wait a moment for server to start up
  await new Promise((resolve) => setTimeout(resolve, 3000));

  return {
    process: expoProcess,
    url: networkInfo.url,
  };
}

/**
 * Helper function to run a command with progress reporting via SSE
 */
async function runCmd(
  cmd: string,
  args: string[],
  cwd: string,
  sessionId?: string,
  stage?: string
): Promise<void> {
  return new Promise((resolve, reject) => {
    // Verify working directory exists before spawning process
    const fs = require("node:fs");
    try {
      if (!fs.existsSync(cwd)) {
        throw new Error(`Working directory does not exist: ${cwd}`);
      }
      fs.accessSync(cwd, fs.constants.R_OK | fs.constants.W_OK);
      console.log(`[runCmd] Verified working directory: ${cwd}`);
    } catch (error) {
      console.error(`[runCmd] Working directory verification failed:`, error);
      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Invalid working directory: ${cwd}`,
        })
      );
      return;
    }

    // Update build progress
    if (sessionId && stage) {
      updateBuildProgress(sessionId, {
        type: "progress",
        stage,
        message: `Starting: ${cmd} ${args.join(" ")}`,
        progress: 0,
      });
    }

    console.log(`[runCmd] Spawning: ${cmd} ${args.join(" ")} in ${cwd}`);
    const childProcess = spawn(cmd, args, {
      cwd,
      stdio: ["inherit", "pipe", "pipe"],
      env: {
        ...process.env, // Use global process.env
        PWD: cwd, // Explicitly set the PWD environment variable
      },
    });

    let stdoutData = "";
    let stderrData = "";

    childProcess.stdout?.on("data", (data) => {
      const output = data.toString();
      stdoutData += output;

      // Update build progress with output
      if (sessionId) {
        updateBuildProgress(sessionId, {
          type: "output",
          stage,
          message: output.trim(),
        });
      }
    });

    childProcess.stderr?.on("data", (data) => {
      const output = data.toString();
      stderrData += output;

      // Update build progress with error output
      if (sessionId) {
        updateBuildProgress(sessionId, {
          type: "output",
          stage,
          message: output.trim(),
          error: output.trim(),
        });
      }
    });

    childProcess.on("close", (code) => {
      clearTimeout(timeout); // Clear timeout on any close
      if (code === 0) {
        // Update build progress on completion
        if (sessionId && stage) {
          updateBuildProgress(sessionId, {
            type: "progress",
            stage: `${stage} completed`,
            message: "Command completed successfully",
            progress: 100,
          });
        }
        resolve();
      } else {
        // Update build progress with error
        if (sessionId) {
          updateBuildProgress(sessionId, {
            type: "error",
            stage,
            message: `Command failed with exit code ${code}`,
            error: stderrData || stdoutData || "Unknown error",
            hasError: true,
          });
        }

        reject(
          new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Command failed with exit code ${code}: ${
              stderrData || stdoutData || "Unknown error"
            }`,
          })
        );
      }
    });

    childProcess.on("error", (error) => {
      // Update build progress with spawn error
      if (sessionId) {
        updateBuildProgress(sessionId, {
          type: "error",
          stage,
          message: `Failed to spawn process: ${error.message}`,
          error: error.message,
          hasError: true,
        });
      }

      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to spawn process: ${error.message}`,
        })
      );
    });

    // Add timeout to prevent hanging processes
    const timeout = setTimeout(() => {
      console.error(
        `[runCmd] Command timed out after 5 minutes: ${cmd} ${args.join(" ")}`
      );
      childProcess.kill("SIGTERM");

      // Force kill after additional 10 seconds
      setTimeout(() => {
        if (!childProcess.killed) {
          childProcess.kill("SIGKILL");
        }
      }, 10000);

      if (sessionId) {
        updateBuildProgress(sessionId, {
          type: "error",
          stage,
          message: "Command timed out after 5 minutes",
          error: "Process timeout",
          hasError: true,
        });
      }

      reject(
        new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Command timed out after 5 minutes",
        })
      );
    }, 5 * 60 * 1000); // 5 minutes timeout

    // Clear timeout when process completes
    childProcess.once("exit", () => {
      clearTimeout(timeout);
    });
  });
}

// In-memory build progress storage (in production, use Redis or database)
const buildProgressMap = new Map<string, any>();

// Helper to update build progress
function updateBuildProgress(sessionId: string, update: any) {
  const current = buildProgressMap.get(sessionId) || {};
  const logs = current.logs || [];
  const newLogs = current.newLogs || [];
  
  if (update.message && !update.message.includes("heartbeat")) {
    logs.push(update.message);
    newLogs.push(update.message);
  }
  
  buildProgressMap.set(sessionId, {
    ...current,
    ...update,
    logs,
    newLogs,
  });
  
  // Also try to send via SSE if available
  eventBroadcaster.sendToSession(sessionId, {
    type: update.type || "progress",
    ...update,
  });
}

export const appStarterRouter = createTRPCRouter({
  getProgress: publicProcedure
    .input(
      z.object({
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .query(async ({ input }) => {
      const { sessionId } = input;
      const progress = buildProgressMap.get(sessionId);
      
      if (!progress) {
        return {
          stage: "Waiting",
          message: "Waiting for build to start...",
          progress: 0,
          isComplete: false,
          hasError: false,
          logs: [],
          newLogs: [],
        };
      }
      
      // Clear logs after sending to avoid duplicates
      const logs = progress.newLogs || [];
      progress.newLogs = [];
      
      return {
        ...progress,
        logs: progress.logs || [],
        newLogs: logs,
      };
    }),
    
  start: publicProcedure
    .input(
      z.object({
        projectName: z.string().min(1, "Project name is required"),
        sessionId: z.string().min(1, "Session ID is required"),
      })
    )
    .mutation(async ({ input }) => {
      const { sessionId, projectName } = input;

      try {
        // Initialize build progress
        buildProgressMap.set(sessionId, {
          stage: "Initializing",
          message: "Setting up your Expo project...",
          progress: 10,
          isComplete: false,
          hasError: false,
          logs: ["Starting build process..."],
          newLogs: ["Starting build process..."],
        });

        // Send initial progress update
        const initialSent = eventBroadcaster.sendToSession(sessionId, {
          type: "progress",
          stage: "Initializing",
          message: "Setting up your Expo project...",
          progress: 10,
        });

        if (!initialSent) {
          console.warn(
            `[AppStarter] No SSE connections found for session: ${sessionId}. Build will continue without real-time updates.`
          );
        }

        // Create temporary directory using provided session ID with absolute path
        const baseDir = tmpdir();
        const dir = join(baseDir, `expo-${sessionId}`);

        console.log(`[AppStarter] Creating project directory: ${dir}`);

        // Clean up existing directory if it exists
        try {
          await rm(dir, { recursive: true, force: true });
          console.log(`[AppStarter] Cleaned up existing directory: ${dir}`);
        } catch (error) {
          console.log(`[AppStarter] No existing directory to clean up: ${dir}`);
        }

        // Create directory with proper permissions
        await mkdir(dir, { recursive: true, mode: 0o755 });

        // Verify directory exists and is accessible
        const fs = await import("node:fs");
        try {
          await fs.promises.access(dir, fs.constants.R_OK | fs.constants.W_OK);
          console.log(`[AppStarter] Directory verified accessible: ${dir}`);
        } catch (error) {
          throw new TRPCError({
            code: "INTERNAL_SERVER_ERROR",
            message: `Failed to access project directory: ${dir}`,
          });
        }

        const projectDir = dir;

        // Send directory creation update
        updateBuildProgress(sessionId, {
          stage: "Creating workspace",
          message: `Creating project directory: ${projectDir}`,
          progress: 20,
        });

        // Create Expo app with progress reporting
        try {
          await runCmd(
            "npx",
            ["create-expo-app", ".", "--template", "blank", "--yes"],
            projectDir,
            sessionId,
            "Creating Expo template"
          );
        } catch (error) {
          console.error(`[AppStarter] Expo app creation failed:`, error);
          // Try alternative approach without specific template
          updateBuildProgress(sessionId, {
            type: "progress",
            stage: "Retrying with alternative method",
            message: "Trying alternative installation method...",
            progress: 50,
          });

          await runCmd(
            "npx",
            ["create-expo-app", ".", "--yes"],
            projectDir,
            sessionId,
            "Installing Expo template (retry)"
          );
        }

        // Find available port for Expo dev server
        const expoPort = await findAvailablePort(8081);

        eventBroadcaster.sendToSession(sessionId, {
          type: "progress",
          stage: "Starting development server",
          message: `Starting Expo development server on port ${expoPort}...`,
          progress: 90,
        });

        // Start Expo development server in background
        const { process: expoProcess, url: expoUrl } = await startExpoServer(
          projectDir,
          expoPort,
          sessionId
        );

        // Get network information for QR code
        const networkInfo = await getNetworkInfo(expoPort);

        // Send completion update with network info
        updateBuildProgress(sessionId, {
          type: "completed",
          stage: "Development server ready",
          message: "Your Expo app is ready! Scan the QR code with Expo Go.",
          progress: 100,
          isComplete: true,
          expoUrl,
          networkInfo,
          data: {
            projectDir,
            networkInfo,
            expoUrl,
            port: expoPort,
            processId: expoProcess.pid,
          },
        });

        // Store process reference for potential cleanup
        // Note: In production, you'd want to store this in a database or Redis
        console.log(
          `[AppStarter] Expo server started for session: ${sessionId}, PID: ${expoProcess.pid}`
        );

        return {
          sessionId,
          projectDir,
          expoUrl,
          networkInfo,
          processId: expoProcess.pid,
          status: "completed",
        };
      } catch (error) {
        // Send error update via SSE
        eventBroadcaster.sendToSession(sessionId, {
          type: "error",
          stage: "Build failed",
          message: "Failed to create Expo app",
          error: error instanceof Error ? error.message : String(error),
        });

        // Re-throw TRPCError as-is, wrap other errors
        if (error instanceof TRPCError) {
          throw error;
        }
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: `Failed to create Expo app: ${
            error instanceof Error ? error.message : String(error)
          }`,
        });
      }
    }),
});
