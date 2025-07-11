/**
 * Run `build` or `dev` with `SKIP_ENV_VALIDATION` to skip env validation. This is especially useful
 * for Docker builds.
 */
import "./src/env.js";

/** @type {import("next").NextConfig} */
const config = {
  // Enable experimental features for better streaming support
  experimental: {
    // Ensure server components can stream properly
    serverActions: {
      bodySizeLimit: '2mb',
    },
  },
  // Webpack configuration for better SSE support
  webpack: (config, { isServer }) => {
    // Disable Webpack's default behavior for handling SSE responses
    if (!isServer) {
      config.resolve.fallback = {
        ...config.resolve.fallback,
        stream: false,
      };
    }
    return config;
  },
  // Ensure proper headers for SSE
  async headers() {
    return [
      {
        source: '/api/events/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'no-cache, no-transform',
          },
          {
            key: 'Content-Type',
            value: 'text/event-stream',
          },
          {
            key: 'Connection',
            value: 'keep-alive',
          },
          {
            key: 'X-Accel-Buffering',
            value: 'no',
          },
        ],
      },
    ];
  },
};

export default config;
