import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

import { eventBroadcaster } from "~/lib/eventBroadcaster";

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
			message: `Failed to create temporary directory: ${error instanceof Error ? error.message : String(error)}`,
		});
	}
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
		// Send initial stage update (gracefully handle SSE failures)
		if (sessionId && stage) {
			try {
				const sent = eventBroadcaster.sendToSession(sessionId, {
					type: "progress",
					stage,
					message: `Starting: ${cmd} ${args.join(" ")}`,
					progress: 0
				});
				if (!sent) {
					console.warn(`[runCmd] No SSE connections for session: ${sessionId}, continuing without progress updates`);
				}
			} catch (error) {
				console.error(`[runCmd] Failed to send progress update:`, error);
				// Continue with the build even if SSE fails
			}
		}

		const process = spawn(cmd, args, {
			cwd,
			stdio: ["inherit", "pipe", "pipe"],
		});

		let stdoutData = "";
		let stderrData = "";

		process.stdout?.on("data", (data) => {
			const output = data.toString();
			stdoutData += output;
			
			// Send real-time output via SSE
			if (sessionId) {
				eventBroadcaster.sendToSession(sessionId, {
					type: "output",
					stage,
					message: output.trim()
				});
			}
		});

		process.stderr?.on("data", (data) => {
			const output = data.toString();
			stderrData += output;
			
			// Send error output via SSE
			if (sessionId) {
				eventBroadcaster.sendToSession(sessionId, {
					type: "output",
					stage,
					message: output.trim(),
					error: output.trim()
				});
			}
		});

		process.on("close", (code) => {
			if (code === 0) {
				// Send completion update
				if (sessionId && stage) {
					eventBroadcaster.sendToSession(sessionId, {
						type: "progress",
						stage: `${stage} completed`,
						message: "Command completed successfully",
						progress: 100
					});
				}
				resolve();
			} else {
				// Send error update
				if (sessionId) {
					eventBroadcaster.sendToSession(sessionId, {
						type: "error",
						stage,
						message: `Command failed with exit code ${code}`,
						error: stderrData
					});
				}
				
				reject(
					new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: `Command failed with exit code ${code}: ${stderrData}`,
					}),
				);
			}
		});

		process.on("error", (error) => {
			// Send error update
			if (sessionId) {
				eventBroadcaster.sendToSession(sessionId, {
					type: "error",
					stage,
					message: `Failed to spawn process: ${error.message}`,
					error: error.message
				});
			}
			
			reject(
				new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to spawn process: ${error.message}`,
				}),
			);
		});
	});
}

export const appStarterRouter = createTRPCRouter({
	start: publicProcedure
		.input(
			z.object({
				projectName: z.string().min(1, "Project name is required"),
				sessionId: z.string().min(1, "Session ID is required"),
			}),
		)
		.mutation(async ({ input }) => {
			const { sessionId, projectName } = input;

			try {
				// Send initial progress update
				const initialSent = eventBroadcaster.sendToSession(sessionId, {
					type: "progress",
					stage: "Initializing",
					message: "Setting up your Expo project...",
					progress: 10
				});
				
				if (!initialSent) {
					console.warn(`[AppStarter] No SSE connections found for session: ${sessionId}. Build will continue without real-time updates.`);
				}

				// Create temporary directory using provided session ID
				const dir = join(tmpdir(), `expo-${sessionId}`);
				
				// Clean up existing directory if it exists
				try {
					await rm(dir, { recursive: true, force: true });
				} catch (error) {
					// Ignore errors if directory doesn't exist
				}
				
				await mkdir(dir, { recursive: true });
				const projectDir = dir;

				// Send directory creation update
				eventBroadcaster.sendToSession(sessionId, {
					type: "progress",
					stage: "Creating workspace",
					message: `Creating project directory: ${projectDir}`,
					progress: 20
				});

				// Create Expo app with progress reporting
				await runCmd(
					"npx",
					["create-expo-app", ".", "--template", "blank", "--yes"],
					projectDir,
					sessionId,
					"Installing Expo template"
				);

				// Send completion update
				eventBroadcaster.sendToSession(sessionId, {
					type: "completed",
					stage: "Project created",
					message: "Your Expo app is ready! You can now start building.",
					progress: 100,
					data: { projectDir }
				});

				return {
					sessionId,
					projectDir,
					status: "completed"
				};
			} catch (error) {
				// Send error update via SSE
				eventBroadcaster.sendToSession(sessionId, {
					type: "error",
					stage: "Build failed",
					message: "Failed to create Expo app",
					error: error instanceof Error ? error.message : String(error)
				});

				// Re-throw TRPCError as-is, wrap other errors
				if (error instanceof TRPCError) {
					throw error;
				}
				throw new TRPCError({
					code: "INTERNAL_SERVER_ERROR",
					message: `Failed to create Expo app: ${error instanceof Error ? error.message : String(error)}`,
				});
			}
		}),
});
