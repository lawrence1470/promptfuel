# Progress Tracking System

This document explains how PromptFuel tracks and reports build progress in real-time.

## Overview

PromptFuel uses a polling-based progress tracking system that replaced the previous Server-Sent Events (SSE) implementation for better reliability and simplicity.

## Architecture

### Progress Storage

Build progress is stored in an in-memory Map on the server:

```typescript
// In-memory build progress storage
export const buildProgressMap = new Map<string, any>();
```

**Key Features:**
- Session-based isolation
- Real-time updates
- Persistent during server runtime
- Automatic cleanup on completion

### Progress Structure

```typescript
interface BuildProgress {
  stage: string;           // Current operation stage
  message: string;         // Detailed status message
  progress: number;        // Percentage (0-100)
  isComplete: boolean;     // Build completion flag
  hasError: boolean;       // Error state flag
  logs: string[];          // Accumulated build logs
  newLogs: string[];       // New logs since last poll
  expoUrl?: string;        // Generated app URL
  networkInfo?: {          // Network configuration
    ip: string;
    port: number;
    url: string;
    isValidForMobile: boolean;
  };
  error?: string;          // Error message if applicable
  type?: string;           // Update type for categorization
}
```

## Progress Updates

### Update Function

Central function for updating progress:

```typescript
export function updateBuildProgress(sessionId: string, update: any) {
  const current = buildProgressMap.get(sessionId) || {};
  const logs = current.logs || [];
  const newLogs = current.newLogs || [];
  
  // Add new messages to logs
  if (update.message && !update.message.includes("heartbeat")) {
    logs.push(update.message);
    newLogs.push(update.message);
  }
  
  // Update progress state
  buildProgressMap.set(sessionId, {
    ...current,
    ...update,
    logs,
    newLogs,
  });
  
  // Also send via SSE if available (fallback)
  eventBroadcaster.sendToSession(sessionId, {
    type: update.type || "progress",
    ...update,
  });
}
```

### Progress Stages

#### App Creation Stages

1. **Initializing** (10%)
   ```typescript
   updateBuildProgress(sessionId, {
     stage: "Initializing",
     message: "Setting up your Expo project...",
     progress: 10,
   });
   ```

2. **Creating workspace** (20%)
   ```typescript
   updateBuildProgress(sessionId, {
     stage: "Creating workspace",
     message: `Creating project directory: ${projectDir}`,
     progress: 20,
   });
   ```

3. **Creating Expo template** (30-50%)
   ```typescript
   updateBuildProgress(sessionId, {
     stage: "Creating Expo template",
     message: "Installing Expo dependencies...",
     progress: 40,
   });
   ```

4. **Custom App Generation** (60-80%)
   ```typescript
   // If app description provided
   updateBuildProgress(sessionId, {
     stage: "Generating custom app",
     message: "Claude is creating your custom app structure...",
     progress: 60,
   });
   ```

5. **Starting development server** (90%)
   ```typescript
   updateBuildProgress(sessionId, {
     stage: "Starting development server",
     message: `Starting Expo development server on port ${expoPort}...`,
     progress: 90,
   });
   ```

6. **Complete** (100%)
   ```typescript
   updateBuildProgress(sessionId, {
     stage: "Development server ready",
     message: "Your Expo app is ready! Scan the QR code with Expo Go.",
     progress: 100,
     isComplete: true,
     expoUrl,
     networkInfo,
   });
   ```

#### Chat Interaction Stages

1. **AI Processing**
   ```typescript
   updateBuildProgress(sessionId, {
     type: "ai-thinking",
     stage: "AI Processing",
     message: "Claude is analyzing your request...",
   });
   ```

2. **Applying Changes**
   ```typescript
   updateBuildProgress(sessionId, {
     type: "ai-applying",
     stage: "Applying Changes", 
     message: `Updating ${fileCount} file(s)...`,
   });
   ```

3. **Changes Applied**
   ```typescript
   updateBuildProgress(sessionId, {
     type: "ai-complete",
     stage: "Changes Applied",
     message: "Your code has been updated successfully!",
   });
   ```

## Client-Side Polling

### useBuildProgress Hook

Custom React hook for polling progress:

```typescript
export function useBuildProgress({ 
  sessionId, 
  enabled = true,
  pollingInterval = 2000 // Poll every 2 seconds
}: UseBuildProgressOptions) {
  const [progress, setProgress] = useState<BuildProgress>({
    stage: "Initializing",
    message: "Setting up your workspace...",
    progress: 0,
    isComplete: false,
    hasError: false,
    logs: [],
  });
  
  // Use tRPC query with refetch
  const { data, error, refetch } = api.appStarter.getProgress.useQuery(
    { sessionId },
    {
      enabled: enabled && sessionId !== "__INVALID__",
      refetchInterval: progress.isComplete || progress.hasError ? false : pollingInterval,
    }
  );
  
  // Update progress when data changes
  useEffect(() => {
    if (data) {
      setProgress(prev => ({
        ...prev,
        ...data,
        logs: [...prev.logs, ...(data.newLogs || [])]
      }));
    }
  }, [data]);
  
  return {
    progress,
    isLoading: !data && !error,
    error,
    refetch
  };
}
```

### Polling Configuration

**Default Settings:**
- Interval: 2000ms (2 seconds)
- Auto-stop: When `isComplete` or `hasError` is true
- Error handling: Continue polling on network errors

**Customization:**
```typescript
const { progress } = useBuildProgress({
  sessionId: "uuid-here",
  enabled: true,
  pollingInterval: 1000 // Poll every second
});
```

## API Endpoint

### getProgress Query

tRPC endpoint for retrieving progress:

```typescript
getProgress: publicProcedure
  .input(z.object({
    sessionId: z.string().min(1, "Session ID is required"),
  }))
  .query(async ({ input }) => {
    const { sessionId } = input;
    const progress = buildProgressMap.get(sessionId);
    
    if (!progress) {
      return {
        stage: "Waiting",
        message: "Waiting for build to start...",
        progress: 0,
        isComplete: false,
        hasError: false,
        logs: [],
        newLogs: [],
      };
    }
    
    // Clear logs after sending to avoid duplicates
    const logs = progress.newLogs || [];
    progress.newLogs = [];
    
    return {
      ...progress,
      logs: progress.logs || [],
      newLogs: logs,
    };
  })
```

## Error Handling

### Error States

Progress tracking handles various error conditions:

```typescript
// Command execution error
updateBuildProgress(sessionId, {
  type: "error",
  stage: "Build failed",
  message: `Command failed with exit code ${code}`,
  error: stderrData || stdoutData || "Unknown error",
  hasError: true,
});

// Claude API error
updateBuildProgress(sessionId, {
  type: "error",
  stage: "AI Error",
  message: "Failed to generate code",
  error: "Claude API temporarily unavailable",
  hasError: true,
});

// File operation error
updateBuildProgress(sessionId, {
  type: "error",
  stage: "File Error",
  message: "Failed to write generated files",
  error: "Permission denied",
  hasError: true,
});
```

### Recovery Mechanisms

**Automatic Retry:**
- Claude API retries with exponential backoff
- File operations retry once on permission errors
- Command timeouts trigger cleanup and retry

**Manual Recovery:**
- User can refresh page to restart build
- Session data preserved during recovery
- Progress state cleared on new attempts

## UI Integration

### Progress Display

The chat page displays progress in multiple ways:

**Progress Bar:**
```tsx
<div className="w-full bg-gray-200 rounded-full h-3">
  <div
    className="bg-black h-3 rounded-full transition-all duration-500 ease-out"
    style={{ width: `${buildProgress.progress}%` }}
  />
</div>
```

**Status Text:**
```tsx
<div className="flex justify-between text-sm text-gray-600">
  <span>{buildProgress.stage}</span>
  <span>{buildProgress.progress}%</span>
</div>
<p className="text-sm text-gray-500 text-center">
  {buildProgress.message}
</p>
```

**Build Logs:**
```tsx
{buildProgress.logs.length > 0 && (
  <details className="bg-gray-50 border border-gray-200 rounded-xl p-4">
    <summary className="cursor-pointer font-medium text-gray-700 mb-2">
      View Build Logs ({buildProgress.logs.length} entries)
    </summary>
    <div className="max-h-40 overflow-y-auto bg-black text-green-400 p-3 rounded font-mono text-sm">
      {buildProgress.logs.map((log, index) => (
        <div key={index} className="mb-1">{log}</div>
      ))}
    </div>
  </details>
)}
```

### Loading States

**Initial Loading:**
```tsx
{isLoadingProgress && (
  <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full text-sm bg-gray-100 text-gray-800">
    <div className="w-2 h-2 rounded-full bg-gray-500 animate-pulse" />
    Loading build status...
  </div>
)}
```

**Error Display:**
```tsx
{buildProgress.hasError && (
  <div className="bg-red-50 border border-red-200 rounded-xl p-6">
    <h3 className="text-lg font-semibold text-red-800">Build Error</h3>
    <p className="text-red-700 mb-4">{buildProgress.message}</p>
    {buildProgress.error && (
      <div className="bg-red-100 border border-red-200 rounded-lg p-3">
        <p className="text-red-800 font-mono text-sm">{buildProgress.error}</p>
      </div>
    )}
  </div>
)}
```

## Performance Considerations

### Memory Management

**Storage Limits:**
- Progress data limited to 1MB per session
- Logs truncated after 1000 entries
- Sessions cleaned up after 1 hour of inactivity

**Polling Efficiency:**
- Stops polling when complete
- Reduces frequency on errors
- Batches multiple updates

### Network Optimization

**Request Optimization:**
- Small JSON payloads
- Compressed responses
- Minimal data transfer

**Error Handling:**
- Graceful degradation on network issues
- Automatic retry with backoff
- Offline state detection

## Migration from SSE

### Why Polling?

**Previous SSE Issues:**
- Connection reliability problems
- Complex error handling
- Browser compatibility issues
- Memory leaks in long sessions

**Polling Benefits:**
- Simpler implementation
- Better error recovery
- Consistent behavior
- Easier debugging

### Backwards Compatibility

The system maintains SSE endpoints for fallback:
- SSE broadcast still available
- Gradual migration path
- Dual update mechanism
- Legacy client support

## Future Improvements

### Scalability Enhancements

**Database Storage:**
- Replace in-memory Map with Redis/PostgreSQL
- Persistent progress across server restarts
- Multi-server support

**WebSocket Upgrade:**
- Real-time bidirectional communication
- Lower latency than polling
- Better resource utilization

**Push Notifications:**
- Browser notifications for completed builds
- Email notifications for long-running processes
- Mobile app integration