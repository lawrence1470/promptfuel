import { NextRequest } from "next/server";
import { processManager } from "~/lib/processManager";
import { eventBroadcaster } from "~/lib/eventBroadcaster";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return new Response("Session ID required", { status: 400 });
    }

    console.log(`[Cleanup] Cleaning up session: ${sessionId}`);

    // Kill the Expo process for this session
    const processKilled = processManager.killProcess(sessionId);
    
    // Force cleanup SSE connections
    eventBroadcaster.forceCleanupSession(sessionId);

    // Get stats for response
    const processStats = processManager.getStats();
    const sseStats = eventBroadcaster.getStats();

    return Response.json({
      sessionId,
      status: "cleaned",
      processKilled,
      processStats,
      sseStats,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error(`[Cleanup] Error cleaning up session:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}

// Health check endpoint for process management
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return new Response("Session ID required", { status: 400 });
    }

    const managedProcess = processManager.getProcess(sessionId);
    const sseConnections = eventBroadcaster.getSessionConnectionCount(sessionId);
    const processStats = processManager.getStats();
    const sseStats = eventBroadcaster.getStats();

    return Response.json({
      sessionId,
      process: managedProcess ? {
        pid: managedProcess.pid,
        type: managedProcess.type,
        startTime: managedProcess.startTime,
        age: Date.now() - managedProcess.startTime,
        port: managedProcess.port,
        isRunning: !managedProcess.process.killed
      } : null,
      sseConnections,
      processStats,
      sseStats,
      timestamp: Date.now()
    });

  } catch (error) {
    console.error(`[Cleanup] Error getting session status:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}