import { NextRequest } from "next/server";
import { eventBroadcaster, type SSEConnection } from "~/lib/eventBroadcaster";

// Force dynamic rendering for SSE
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  console.log(`[SSE Route] GET request received`);
  
  try {
    const { sessionId } = await params;
    console.log(`[SSE Route] Session ID: ${sessionId}`);

    if (!sessionId) {
      console.error(`[SSE Route] No session ID provided`);
      return new Response("Session ID required", { status: 400 });
    }

    // Log request details for debugging
    console.log(`[SSE] GET request received for session: ${sessionId}`);
    console.log(`[SSE] Request URL: ${request.url}`);
    console.log(`[SSE] Request headers:`, Object.fromEntries(request.headers.entries()));

    // Check if session already has too many connections (prevent connection explosion)
    const existingConnections =
      eventBroadcaster.getSessionConnectionCount(sessionId);

    if (existingConnections > 3) {
      console.warn(
        `[SSE] Too many connections for session ${sessionId}: ${existingConnections}, forcing cleanup`
      );
      // Force cleanup and allow this new connection
      eventBroadcaster.forceCleanupSession(sessionId);
    }

    console.log(
      `[SSE] New connection for session: ${sessionId} (existing: ${existingConnections})`
    );

    // Create a readable stream for Server-Sent Events
    const encoder = new TextEncoder();
    let connection: SSEConnection | null = null;
    let isConnectionClosed = false;

    console.log(`[SSE] Creating ReadableStream for session: ${sessionId}`);

    const stream = new ReadableStream({
      start(controller) {
        try {
          console.log(
            `[SSE] ReadableStream start() called for session: ${sessionId}`
          );

          // Create connection object
          connection = {
            controller,
            sessionId,
            lastHeartbeat: Date.now(),
          };

          console.log(
            `[SSE] Adding connection to broadcaster for session: ${sessionId}`
          );

          // Add connection to broadcaster
          eventBroadcaster.addConnection(sessionId, connection);

          console.log(
            `[SSE] Connection added, sending initial headers for session: ${sessionId}`
          );

          // Send initial SSE headers with server status
          const serverStatus = {
            type: "connected",
            sessionId,
            message: "SSE connection established",
            timestamp: Date.now(),
            serverVersion: process.env.npm_package_version || "unknown",
            environment: process.env.NODE_ENV || "development",
          };

          const headers = [
            "retry: 10000\n", // Retry every 10 seconds if connection fails
            "event: connected\n",
            `data: ${JSON.stringify(serverStatus)}\n\n`,
          ].join("");

          controller.enqueue(encoder.encode(headers));

          console.log(`[SSE] Initial headers sent for session: ${sessionId}`);

          // Store interval reference for cleanup
          let keepaliveInterval: NodeJS.Timeout | null = null;
          let keepaliveTimeout: NodeJS.Timeout | null = null;

          // Send periodic keepalive after initial connection is established
          keepaliveTimeout = setTimeout(() => {
            keepaliveInterval = setInterval(() => {
              if (connection && !isConnectionClosed) {
                try {
                  const keepalive = `data: ${JSON.stringify({
                    type: "keepalive",
                    timestamp: Date.now(),
                  })}\n\n`;
                  controller.enqueue(encoder.encode(keepalive));
                  connection.lastHeartbeat = Date.now(); // Update heartbeat
                } catch (error) {
                  console.log(
                    `[SSE] Connection broken during keepalive for session: ${sessionId}`
                  );
                  if (keepaliveInterval) {
                    clearInterval(keepaliveInterval);
                    keepaliveInterval = null;
                  }
                  if (connection) {
                    eventBroadcaster.removeConnection(sessionId, connection);
                  }
                }
              } else {
                if (keepaliveInterval) {
                  clearInterval(keepaliveInterval);
                  keepaliveInterval = null;
                }
              }
            }, 45000); // Every 45 seconds
          }, 5000); // Start after 5 seconds to let connection stabilize

          // Store cleanup function on controller for access in cancel()
          (controller as any)._cleanup = () => {
            if (keepaliveTimeout) {
              clearTimeout(keepaliveTimeout);
              keepaliveTimeout = null;
            }
            if (keepaliveInterval) {
              clearInterval(keepaliveInterval);
              keepaliveInterval = null;
            }
          };
        } catch (error) {
          console.error(`[SSE] Error in start handler:`, error);
          try {
            controller.error(error);
          } catch (controllerError) {
            console.error(
              `[SSE] Failed to send error to controller:`,
              controllerError
            );
          }
        }
      },

      cancel(reason) {
        if (isConnectionClosed) return; // Prevent double cleanup
        isConnectionClosed = true;

        console.log(
          `[SSE] Connection cancelled for session: ${sessionId}`,
          reason
        );

        // Clean up timers - access from connection object
        if (connection && (connection as any).controller) {
          const ctrl = (connection as any).controller as any;
          if (ctrl._cleanup) {
            ctrl._cleanup();
          }
        }

        // Properly remove the connection
        if (connection) {
          try {
            eventBroadcaster.removeConnection(sessionId, connection);
          } catch (error) {
            console.error(`[SSE] Error removing connection:`, error);
          }
          connection = null;
        }
      },
    });

    // Return response with appropriate SSE headers
    const response = new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Headers": "Cache-Control",
        "X-Accel-Buffering": "no", // Disable Nginx buffering
        "X-Content-Type-Options": "nosniff",
      },
    });

    // Log successful response creation
    console.log(`[SSE] Response created for session: ${sessionId}`);
    
    return response;
  } catch (error) {
    console.error(`[SSE] Error in GET handler:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}

// Optional: Health check endpoint
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const { sessionId } = await params;

    if (!sessionId) {
      return new Response("Session ID required", { status: 400 });
    }

    const stats = eventBroadcaster.getStats();
    const sessionConnections =
      eventBroadcaster.getSessionConnectionCount(sessionId);

    return Response.json({
      sessionId,
      status: "ok",
      sessionConnections,
      ...stats,
      timestamp: Date.now(),
    });
  } catch (error) {
    console.error(`[SSE] Error in POST handler:`, error);
    return new Response("Internal server error", { status: 500 });
  }
}
