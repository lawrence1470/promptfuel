import { spawn, ChildProcess } from "node:child_process";

export interface ManagedProcess {
  pid: number;
  sessionId: string;
  type: "expo" | "other";
  startTime: number;
  port?: number;
  projectPath?: string;
  process: ChildProcess;
}

class ProcessManager {
  private processes = new Map<string, ManagedProcess>();
  private cleanupInterval: NodeJS.Timeout;

  constructor() {
    // Clean up orphaned processes every 5 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanupOrphanedProcesses();
    }, 2 * 60 * 1000); // Reduced from 5 minutes to 2 minutes
  }

  /**
   * Register a new process
   */
  registerProcess(
    sessionId: string,
    process: ChildProcess,
    type: "expo" | "other",
    metadata?: { port?: number; projectPath?: string }
  ): void {
    if (!process.pid) {
      console.error(
        `[ProcessManager] Cannot register process without PID for session: ${sessionId}`
      );
      return;
    }

    const managedProcess: ManagedProcess = {
      pid: process.pid,
      sessionId,
      type,
      startTime: Date.now(),
      port: metadata?.port,
      projectPath: metadata?.projectPath,
      process,
    };

    this.processes.set(sessionId, managedProcess);
    console.log(
      `[ProcessManager] Registered ${type} process PID ${process.pid} for session: ${sessionId}`
    );

    // Handle process exit
    process.on("exit", (code) => {
      console.log(
        `[ProcessManager] Process PID ${process.pid} exited with code ${code} for session: ${sessionId}`
      );
      this.processes.delete(sessionId);
    });
  }

  /**
   * Get process info for a session
   */
  getProcess(sessionId: string): ManagedProcess | undefined {
    return this.processes.get(sessionId);
  }

  /**
   * Kill a process for a specific session
   */
  killProcess(sessionId: string): boolean {
    const managedProcess = this.processes.get(sessionId);
    if (!managedProcess) {
      console.log(
        `[ProcessManager] No process found for session: ${sessionId}`
      );
      return false;
    }

    try {
      console.log(
        `[ProcessManager] Killing ${managedProcess.type} process PID ${managedProcess.pid} for session: ${sessionId}`
      );

      // Try graceful shutdown first
      managedProcess.process.kill("SIGTERM");

      // Force kill after 5 seconds if still running
      setTimeout(() => {
        if (!managedProcess.process.killed) {
          console.log(
            `[ProcessManager] Force killing process PID ${managedProcess.pid} for session: ${sessionId}`
          );
          managedProcess.process.kill("SIGKILL");
        }
      }, 5000);

      this.processes.delete(sessionId);
      return true;
    } catch (error) {
      console.error(
        `[ProcessManager] Error killing process for session ${sessionId}:`,
        error
      );
      return false;
    }
  }

  /**
   * Kill all processes for cleanup
   */
  killAllProcesses(): void {
    console.log(
      `[ProcessManager] Killing all ${this.processes.size} managed processes`
    );

    for (const [sessionId, managedProcess] of this.processes.entries()) {
      try {
        console.log(
          `[ProcessManager] Killing ${managedProcess.type} process PID ${managedProcess.pid} for session: ${sessionId}`
        );
        managedProcess.process.kill("SIGTERM");
      } catch (error) {
        console.error(
          `[ProcessManager] Error killing process PID ${managedProcess.pid}:`,
          error
        );
      }
    }

    // Force kill any remaining processes after 5 seconds
    setTimeout(() => {
      for (const [sessionId, managedProcess] of this.processes.entries()) {
        try {
          if (!managedProcess.process.killed) {
            console.log(
              `[ProcessManager] Force killing process PID ${managedProcess.pid} for session: ${sessionId}`
            );
            managedProcess.process.kill("SIGKILL");
          }
        } catch (error) {
          // Ignore errors during force cleanup
        }
      }
      this.processes.clear();
    }, 5000);
  }

  /**
   * Clean up orphaned processes (older than 30 minutes with no activity)
   */
  private cleanupOrphanedProcesses(): void {
    const now = Date.now();
    const maxAge = 30 * 60 * 1000; // Reduced from 2 hours to 30 minutes
    const orphanedSessions: string[] = [];

    for (const [sessionId, managedProcess] of this.processes.entries()) {
      const age = now - managedProcess.startTime;

      if (age > maxAge) {
        console.log(
          `[ProcessManager] Found orphaned process for session ${sessionId}, age: ${Math.round(
            age / 1000 / 60
          )} minutes`
        );
        orphanedSessions.push(sessionId);
      }
    }

    // Kill orphaned processes
    orphanedSessions.forEach((sessionId) => {
      this.killProcess(sessionId);
    });

    if (orphanedSessions.length > 0) {
      console.log(
        `[ProcessManager] Cleaned up ${orphanedSessions.length} orphaned processes`
      );
    }
  }

  /**
   * Get stats about managed processes
   */
  getStats(): {
    totalProcesses: number;
    expoProcesses: number;
    averageAge: number;
  } {
    const now = Date.now();
    let totalAge = 0;
    let expoCount = 0;

    for (const managedProcess of this.processes.values()) {
      totalAge += now - managedProcess.startTime;
      if (managedProcess.type === "expo") {
        expoCount++;
      }
    }

    return {
      totalProcesses: this.processes.size,
      expoProcesses: expoCount,
      averageAge:
        this.processes.size > 0
          ? Math.round(totalAge / this.processes.size / 1000)
          : 0,
    };
  }

  /**
   * Cleanup when shutting down
   */
  destroy(): void {
    clearInterval(this.cleanupInterval);
    this.killAllProcesses();
  }
}

// Global singleton instance
export const processManager = new ProcessManager();

// Cleanup on process exit
process.on("SIGTERM", () => {
  processManager.destroy();
});

process.on("SIGINT", () => {
  processManager.destroy();
});

process.on("exit", () => {
  processManager.destroy();
});
