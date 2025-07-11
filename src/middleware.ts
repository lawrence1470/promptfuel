import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

export function middleware(request: NextRequest) {
  // Log SSE requests for debugging
  if (request.nextUrl.pathname.startsWith('/api/events/') || 
      request.nextUrl.pathname === '/api/test-sse') {
    console.log(`[Middleware] SSE request: ${request.method} ${request.url}`);
    
    // Ensure SSE requests are not cached or blocked
    const response = NextResponse.next();
    
    // Add headers to prevent caching and ensure proper SSE handling
    response.headers.set('Cache-Control', 'no-cache, no-transform');
    response.headers.set('X-Accel-Buffering', 'no');
    
    return response;
  }
  
  return NextResponse.next();
}

export const config = {
  matcher: ['/api/events/:path*', '/api/test-sse'],
};