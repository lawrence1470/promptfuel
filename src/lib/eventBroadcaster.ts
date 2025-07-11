import { EventEmitter } from "events";

export interface BuildEvent {
  type: "progress" | "output" | "completed" | "error" | "connected" | "ping";
  sessionId: string;
  stage?: string;
  message?: string;
  progress?: number;
  error?: string;
  data?: any;
  timestamp: number;
}

export interface SSEConnection {
  controller: ReadableStreamDefaultController;
  sessionId: string;
  lastHeartbeat: number;
}

class EventBroadcaster extends EventEmitter {
  private connections = new Map<string, Set<SSEConnection>>();
  private heartbeatInterval: NodeJS.Timeout;

  constructor() {
    super();
    this.setMaxListeners(1000); // Support many concurrent builds

    // Heartbeat to clean up dead connections
    this.heartbeatInterval = setInterval(() => {
      this.cleanupDeadConnections();
    }, 30000); // Check every 30 seconds
  }

  /**
   * Add a new SSE connection for a session
   */
  addConnection(sessionId: string, connection: SSEConnection): void {
    console.log(
      `[EventBroadcaster] Adding connection for session: ${sessionId}`
    );

    if (!this.connections.has(sessionId)) {
      this.connections.set(sessionId, new Set());
    }

    const sessionConnections = this.connections.get(sessionId)!;

    // Only clean up if we have multiple connections
    if (sessionConnections.size > 0) {
      console.log(
        `[EventBroadcaster] Cleaning up existing connections before adding new one for session: ${sessionId}`
      );
      this.cleanupSessionDeadConnections(sessionId);
    }

    sessionConnections.add(connection);

    console.log(
      `[EventBroadcaster] Added connection for session: ${sessionId}, total: ${sessionConnections.size}`
    );
    console.log(
      `[EventBroadcaster] Total sessions: ${
        this.connections.size
      }, total connections: ${this.getTotalConnections()}`
    );

    // Send initial connection confirmation
    this.sendToConnection(connection, {
      type: "progress",
      sessionId,
      message: "Connected to build updates",
      stage: "Connected",
      progress: 0,
      timestamp: Date.now(),
    });
  }

  /**
   * Remove a connection when it closes
   */
  removeConnection(sessionId: string, connection: SSEConnection): void {
    const sessionConnections = this.connections.get(sessionId);
    if (sessionConnections) {
      sessionConnections.delete(connection);

      // Clean up empty session
      if (sessionConnections.size === 0) {
        this.connections.delete(sessionId);
      }
    }

    console.log(
      `[EventBroadcaster] Removed connection for session: ${sessionId}`
    );
  }

  /**
   * Send an event to all connections for a specific session
   */
  sendToSession(
    sessionId: string,
    event: Omit<BuildEvent, "sessionId" | "timestamp">
  ): boolean {
    const sessionConnections = this.connections.get(sessionId);
    if (!sessionConnections || sessionConnections.size === 0) {
      console.log(
        `[EventBroadcaster] No connections for session: ${sessionId}`
      );
      return false;
    }

    const fullEvent: BuildEvent = {
      ...event,
      sessionId,
      timestamp: Date.now(),
    };

    console.log(
      `[EventBroadcaster] Broadcasting to session ${sessionId}:`,
      fullEvent
    );

    let successCount = 0;
    const deadConnections: SSEConnection[] = [];

    for (const connection of sessionConnections) {
      if (this.sendToConnection(connection, fullEvent)) {
        successCount++;
      } else {
        deadConnections.push(connection);
      }
    }

    // Clean up dead connections
    deadConnections.forEach((conn) => {
      this.removeConnection(sessionId, conn);
    });

    return successCount > 0;
  }

  /**
   * Send event to a specific connection
   */
  private sendToConnection(
    connection: SSEConnection,
    event: BuildEvent
  ): boolean {
    try {
      const encoder = new TextEncoder();
      const data = `data: ${JSON.stringify(event)}\n\n`;
      connection.controller.enqueue(encoder.encode(data));
      connection.lastHeartbeat = Date.now();
      return true;
    } catch (error) {
      console.error(`[EventBroadcaster] Failed to send to connection:`, error);
      return false;
    }
  }

  /**
   * Clean up dead connections for a specific session
   */
  private cleanupSessionDeadConnections(sessionId: string): void {
    const connections = this.connections.get(sessionId);
    if (!connections) return;

    const now = Date.now();
    const deadConnections: SSEConnection[] = [];

    console.log(
      `[EventBroadcaster] Checking ${connections.size} connections for session: ${sessionId}`
    );

    for (const connection of connections) {
      const timeSinceLastHeartbeat = now - connection.lastHeartbeat;
      console.log(
        `[EventBroadcaster] Connection age: ${timeSinceLastHeartbeat}ms for session: ${sessionId}`
      );

      // Only test connections that are older than 30 seconds (not 15)
      if (timeSinceLastHeartbeat > 30000) {
        // Test if connection is still alive by trying to send data
        try {
          const testData = `data: {"type":"ping","timestamp":${now}}\n\n`;
          const encoder = new TextEncoder();
          connection.controller.enqueue(encoder.encode(testData));
          connection.lastHeartbeat = now;
          console.log(
            `[EventBroadcaster] Ping successful for session: ${sessionId}`
          );
        } catch (error) {
          // Connection is dead
          console.log(
            `[EventBroadcaster] Found dead connection for session: ${sessionId}`,
            error
          );
          deadConnections.push(connection);
        }
      }
    }

    // Remove dead connections
    deadConnections.forEach((conn) => {
      console.log(
        `[EventBroadcaster] Removing dead connection for session: ${sessionId}`
      );
      this.removeConnection(sessionId, conn);
    });
  }

  /**
   * Force cleanup all connections for a session (emergency cleanup)
   */
  forceCleanupSession(sessionId: string): void {
    const connections = this.connections.get(sessionId);
    if (!connections) return;

    console.log(
      `[EventBroadcaster] Force cleaning up ${connections.size} connections for session: ${sessionId}`
    );

    // Try to close all connections gracefully
    const connectionsToClose = Array.from(connections);
    for (const connection of connectionsToClose) {
      try {
        // Send a close message first
        const closeMessage = {
          type: "error" as const,
          sessionId,
          message: "Connection force closed",
          timestamp: Date.now(),
        };
        this.sendToConnection(connection, closeMessage);

        // Then close the controller
        connection.controller.close();
      } catch (error) {
        console.warn(
          `[EventBroadcaster] Error during force cleanup for session ${sessionId}:`,
          error
        );
        // Continue with cleanup even if individual connection fails
      }
    }

    // Remove all connections for this session
    this.connections.delete(sessionId);
    console.log(
      `[EventBroadcaster] Force cleanup completed for session: ${sessionId}`
    );
  }

  /**
   * Clean up dead connections without spamming heartbeats
   */
  private cleanupDeadConnections(): void {
    const now = Date.now();
    const deadConnectionThreshold = 90000; // 1.5 minutes without activity

    for (const [sessionId, connections] of this.connections.entries()) {
      const deadConnections: SSEConnection[] = [];

      for (const connection of connections) {
        if (now - connection.lastHeartbeat > deadConnectionThreshold) {
          deadConnections.push(connection);
        }
        // No heartbeat spam - connections stay alive through actual messages
      }

      // Remove dead connections
      deadConnections.forEach((conn) => {
        console.log(
          `[EventBroadcaster] Removing dead connection for session: ${sessionId}`
        );
        this.removeConnection(sessionId, conn);
      });
    }
  }

  /**
   * Get connection count for a specific session
   */
  getSessionConnectionCount(sessionId: string): number {
    const sessionConnections = this.connections.get(sessionId);
    return sessionConnections ? sessionConnections.size : 0;
  }

  /**
   * Get stats about active connections
   */
  getStats(): { totalSessions: number; totalConnections: number } {
    let totalConnections = 0;
    for (const connections of this.connections.values()) {
      totalConnections += connections.size;
    }

    return {
      totalSessions: this.connections.size,
      totalConnections,
    };
  }

  /**
   * Cleanup when shutting down
   */
  destroy(): void {
    clearInterval(this.heartbeatInterval);

    // Close all connections
    for (const [sessionId, connections] of this.connections.entries()) {
      for (const connection of connections) {
        try {
          connection.controller.close();
        } catch (error) {
          // Ignore errors during cleanup
        }
      }
    }

    this.connections.clear();
    this.removeAllListeners();
  }

  /**
   * Helper method to get total connections across all sessions
   */
  private getTotalConnections(): number {
    let total = 0;
    for (const connections of this.connections.values()) {
      total += connections.size;
    }
    return total;
  }
}

// Global singleton instance
export const eventBroadcaster = new EventBroadcaster();

// Cleanup on process exit
process.on("SIGTERM", () => {
  eventBroadcaster.destroy();
});

process.on("SIGINT", () => {
  eventBroadcaster.destroy();
});
