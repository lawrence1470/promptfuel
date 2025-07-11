import { createEnv } from "@t3-oss/env-nextjs";
import { z } from "zod";

export const env = createEnv({
	/**
	 * Specify your server-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars.
	 */
	server: {
		DATABASE_URL: z.string().url(),
		NODE_ENV: z
			.enum(["development", "test", "production"])
			.default("development"),
		ANTHROPIC_API_KEY: z.string().min(1),
		// Cloudflare R2 Configuration
		R2_ENDPOINT: z.string().url().optional(),
		R2_ACCESS_KEY_ID: z.string().min(1).optional(),
		R2_SECRET_ACCESS_KEY: z.string().min(1).optional(),
		R2_BUCKET_NAME: z.string().min(1).optional(),
		R2_PUBLIC_URL: z.string().url().optional(),
		// Build Storage Settings
		BUILD_RETENTION_DAYS: z.coerce.number().default(30),
		MAX_BUILD_SIZE_MB: z.coerce.number().default(500),
		MAX_BUILDS_PER_USER: z.coerce.number().default(50),
		ENABLE_BUILD_SHARING: z.coerce.boolean().default(true),
	},

	/**
	 * Specify your client-side environment variables schema here. This way you can ensure the app
	 * isn't built with invalid env vars. To expose them to the client, prefix them with
	 * `NEXT_PUBLIC_`.
	 */
	client: {
		// NEXT_PUBLIC_CLIENTVAR: z.string(),
	},

	/**
	 * You can't destruct `process.env` as a regular object in the Next.js edge runtimes (e.g.
	 * middlewares) or client-side so we need to destruct manually.
	 */
	runtimeEnv: {
		DATABASE_URL: process.env.DATABASE_URL,
		NODE_ENV: process.env.NODE_ENV,
		ANTHROPIC_API_KEY: process.env.ANTHROPIC_API_KEY,
		// Cloudflare R2 Configuration
		R2_ENDPOINT: process.env.R2_ENDPOINT,
		R2_ACCESS_KEY_ID: process.env.R2_ACCESS_KEY_ID,
		R2_SECRET_ACCESS_KEY: process.env.R2_SECRET_ACCESS_KEY,
		R2_BUCKET_NAME: process.env.R2_BUCKET_NAME,
		R2_PUBLIC_URL: process.env.R2_PUBLIC_URL,
		// Build Storage Settings
		BUILD_RETENTION_DAYS: process.env.BUILD_RETENTION_DAYS,
		MAX_BUILD_SIZE_MB: process.env.MAX_BUILD_SIZE_MB,
		MAX_BUILDS_PER_USER: process.env.MAX_BUILDS_PER_USER,
		ENABLE_BUILD_SHARING: process.env.ENABLE_BUILD_SHARING,
		// NEXT_PUBLIC_CLIENTVAR: process.env.NEXT_PUBLIC_CLIENTVAR,
	},
	/**
	 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially
	 * useful for Docker builds.
	 */
	skipValidation: !!process.env.SKIP_ENV_VALIDATION,
	/**
	 * Makes it so that empty strings are treated as undefined. `SOME_VAR: z.string()` and
	 * `SOME_VAR=''` will throw an error.
	 */
	emptyStringAsUndefined: true,
});
