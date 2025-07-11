import { networkInterfaces } from "node:os";

/**
 * Get the local network IP address that mobile devices can connect to
 */
export function getNetworkIP(): string | null {
  const interfaces = networkInterfaces();

  // Priority order: prefer en0 (WiFi) over other interfaces
  const preferredInterfaces = ["en0", "eth0", "wlan0"];

  for (const interfaceName of preferredInterfaces) {
    const networkInterface = interfaces[interfaceName];
    if (networkInterface) {
      for (const network of networkInterface) {
        // Look for IPv4 addresses that are not internal (localhost)
        if (network.family === "IPv4" && !network.internal) {
          console.log(
            `[NetworkUtils] Found network IP: ${network.address} on interface ${interfaceName}`
          );
          return network.address;
        }
      }
    }
  }

  // Fallback: check all interfaces for any non-internal IPv4 address
  for (const [interfaceName, networkInterface] of Object.entries(interfaces)) {
    if (networkInterface) {
      for (const network of networkInterface) {
        if (network.family === "IPv4" && !network.internal) {
          console.log(
            `[NetworkUtils] Found fallback network IP: ${network.address} on interface ${interfaceName}`
          );
          return network.address;
        }
      }
    }
  }

  console.warn(
    "[NetworkUtils] No network IP address found, falling back to localhost"
  );
  return null;
}

/**
 * Validate if an IP address is accessible for mobile devices
 */
export function isValidNetworkIP(ip: string): boolean {
  // Basic validation
  if (!ip || ip === "localhost" || ip === "127.0.0.1") {
    return false;
  }

  // Check if it's a valid private network IP
  const privateRanges = [
    /^10\./, // 10.0.0.0/8
    /^172\.(1[6-9]|2[0-9]|3[01])\./, // 172.16.0.0/12
    /^192\.168\./, // 192.168.0.0/16
  ];

  return privateRanges.some((range) => range.test(ip));
}

/**
 * Generate the Expo development server URL for QR code
 */
export function generateExpoURL(
  projectPath: string,
  port: number = 8081
): string {
  const networkIP = getNetworkIP();

  if (networkIP && isValidNetworkIP(networkIP)) {
    return `exp://${networkIP}:${port}`;
  }

  // Fallback to localhost (will only work on same machine)
  console.warn(
    "[NetworkUtils] Using localhost fallback - mobile devices may not be able to connect"
  );
  return `exp://localhost:${port}`;
}

/**
 * Get available ports for Expo development server
 */
export async function findAvailablePort(
  startPort: number = 8081
): Promise<number> {
  const net = await import("node:net");

  return new Promise((resolve, reject) => {
    const server = net.createServer();

    // Set a timeout to prevent hanging
    const timeout = setTimeout(() => {
      server.close();
      reject(new Error(`Port finding timed out for port ${startPort}`));
    }, 5000);

    server.listen(startPort, () => {
      const address = server.address();
      const port =
        address && typeof address === "object" ? address.port : startPort;

      clearTimeout(timeout);
      server.close(() => {
        console.log(`[NetworkUtils] Found available port: ${port}`);
        resolve(port);
      });
    });

    server.on("error", (error: any) => {
      clearTimeout(timeout);
      console.log(`[NetworkUtils] Port ${startPort} in use, trying next...`);

      // Port is in use, try next one (up to 10 attempts)
      if (startPort < 8091) {
        resolve(findAvailablePort(startPort + 1));
      } else {
        reject(
          new Error(
            `No available ports found between 8081-8091: ${error.message}`
          )
        );
      }
    });
  });
}

export interface NetworkInfo {
  ip: string;
  port: number;
  url: string;
  isValidForMobile: boolean;
}

/**
 * Get complete network information for Expo development
 */
export async function getNetworkInfo(port?: number): Promise<NetworkInfo> {
  const actualPort = port || (await findAvailablePort());
  const ip = getNetworkIP() || "localhost";
  const url = generateExpoURL("", actualPort);
  const isValidForMobile = isValidNetworkIP(ip);

  return {
    ip,
    port: actualPort,
    url,
    isValidForMobile,
  };
}
