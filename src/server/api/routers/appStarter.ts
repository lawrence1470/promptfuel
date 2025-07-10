import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { TRPCError } from "@trpc/server";
import { z } from "zod";

import { createTRPCRouter, publicProcedure } from "~/server/api/trpc";

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
 * Helper function to run a command with proper error handling
 */
async function runCmd(cmd: string, args: string[], cwd: string): Promise<void> {
	return new Promise((resolve, reject) => {
		const process = spawn(cmd, args, {
			cwd,
			stdio: ["inherit", "inherit", "pipe"],
		});

		let stderrData = "";

		process.stderr?.on("data", (data) => {
			stderrData += data.toString();
		});

		process.on("close", (code) => {
			if (code === 0) {
				resolve();
			} else {
				reject(
					new TRPCError({
						code: "INTERNAL_SERVER_ERROR",
						message: `Command failed with exit code ${code}: ${stderrData}`,
					}),
				);
			}
		});

		process.on("error", (error) => {
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
			}),
		)
		.mutation(async ({ input }) => {
			const { sessionId, dir: projectDir } = await makeTmpDir();

			try {
				await runCmd(
					"npx",
					["create-expo-app", ".", "--template", "blank", "--yes"],
					projectDir,
				);

				return {
					sessionId,
					projectDir,
				};
			} catch (error) {
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
