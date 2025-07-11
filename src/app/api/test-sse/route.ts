import { NextRequest } from "next/server";

// Force dynamic rendering for SSE
export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET(request: NextRequest) {
  console.log('[Test SSE] Request received');
  
  const encoder = new TextEncoder();
  
  const stream = new ReadableStream({
    async start(controller) {
      console.log('[Test SSE] Stream started');
      
      // Send initial message
      const data = `data: ${JSON.stringify({ message: "SSE Test Working!", timestamp: Date.now() })}\n\n`;
      controller.enqueue(encoder.encode(data));
      
      // Send a few more messages
      let count = 0;
      const interval = setInterval(() => {
        count++;
        if (count <= 5) {
          const message = `data: ${JSON.stringify({ count, timestamp: Date.now() })}\n\n`;
          try {
            controller.enqueue(encoder.encode(message));
            console.log(`[Test SSE] Sent message ${count}`);
          } catch (error) {
            console.error('[Test SSE] Error sending message:', error);
            clearInterval(interval);
          }
        } else {
          clearInterval(interval);
          controller.close();
          console.log('[Test SSE] Stream closed');
        }
      }, 1000);
    },
    
    cancel() {
      console.log('[Test SSE] Stream cancelled');
    }
  });
  
  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}