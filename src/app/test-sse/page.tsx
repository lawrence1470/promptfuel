"use client";

import { useEffect, useState } from "react";

export default function TestSSE() {
  const [messages, setMessages] = useState<string[]>([]);
  const [status, setStatus] = useState<string>("Not connected");
  
  useEffect(() => {
    console.log("[Test Page] Starting SSE test");
    setStatus("Connecting...");
    
    const eventSource = new EventSource("/api/test-sse");
    
    eventSource.onopen = () => {
      console.log("[Test Page] SSE connection opened");
      setStatus("Connected");
    };
    
    eventSource.onmessage = (event) => {
      console.log("[Test Page] Received message:", event.data);
      setMessages(prev => [...prev, event.data]);
    };
    
    eventSource.onerror = (error) => {
      console.error("[Test Page] SSE error:", error);
      setStatus("Error - check console");
    };
    
    return () => {
      console.log("[Test Page] Closing SSE connection");
      eventSource.close();
    };
  }, []);
  
  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold mb-4">SSE Test Page</h1>
      <p className="mb-4">Status: <span className="font-mono">{status}</span></p>
      <div className="border p-4 rounded">
        <h2 className="font-bold mb-2">Messages:</h2>
        {messages.map((msg, i) => (
          <pre key={i} className="text-sm mb-1">{msg}</pre>
        ))}
      </div>
    </div>
  );
}