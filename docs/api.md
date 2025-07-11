# API Reference

This document describes the tRPC API endpoints available in PromptFuel.

## Base URL

All API endpoints are available at: `/api/trpc/[router].[procedure]`

## Routers

### App Starter Router (`appStarter`)

#### `start` (Mutation)

Creates a new Expo project and starts the development server.

**Input Schema:**
```typescript
{
  projectName: string;     // Name of the project (min 1 char)
  sessionId: string;       // Unique session identifier (min 1 char)
  appDescription?: string; // Optional app description for custom generation
}
```

**Response:**
```typescript
{
  sessionId: string;
  projectDir: string;
  expoUrl: string;
  networkInfo: {
    ip: string;
    port: number;
    url: string;
    isValidForMobile: boolean;
  };
  processId: number;
  status: "completed";
}
```

**Example Usage:**
```typescript
const result = await api.appStarter.start.mutate({
  projectName: "MyAwesomeApp",
  sessionId: "uuid-here",
  appDescription: "A todo list app with dark mode"
});
```

#### `getProgress` (Query)

Retrieves the current build progress for a session (used for polling).

**Input Schema:**
```typescript
{
  sessionId: string; // Session ID to check progress for
}
```

**Response:**
```typescript
{
  stage: string;           // Current build stage
  message: string;         // Status message
  progress: number;        // Progress percentage (0-100)
  isComplete: boolean;     // Whether build is complete
  hasError: boolean;       // Whether an error occurred
  logs: string[];          // Accumulated build logs
  newLogs: string[];       // New logs since last poll
  expoUrl?: string;        // Expo app URL (when complete)
  networkInfo?: {          // Network info (when complete)
    ip: string;
    port: number;
    url: string;
    isValidForMobile: boolean;
  };
  error?: string;          // Error message (if hasError is true)
}
```

**Example Usage:**
```typescript
const progress = await api.appStarter.getProgress.useQuery({
  sessionId: "uuid-here"
});
```

### Chat Router (`chat`)

#### `sendMessage` (Mutation)

Processes user messages and generates AI responses. Automatically detects whether the message requires code generation or is a general chat.

**Input Schema:**
```typescript
{
  sessionId: string; // Session ID for the project
  message: string;   // User's message
}
```

**Response:**
```typescript
{
  response: string;  // AI-generated response
  sessionId: string; // Echo of the session ID
}
```

**Code Generation Keywords:**
The system detects code generation requests based on these keywords:
- `add`, `create`, `implement`, `build`, `make`
- `change`, `update`, `modify`, `edit`
- `delete`, `remove`, `fix`, `style`
- `component`, `screen`, `feature`, `navigation`

**Example Usage:**
```typescript
// Code generation request
const codeResponse = await api.chat.sendMessage.mutate({
  sessionId: "uuid-here",
  message: "Add a navigation bar with home and settings tabs"
});

// General chat request
const chatResponse = await api.chat.sendMessage.mutate({
  sessionId: "uuid-here",
  message: "What can you help me with?"
});
```

## Error Handling

### Standard Error Format

All API errors follow the tRPC error format:

```typescript
{
  error: {
    json: {
      message: string;
      code: number;
      data: {
        code: string;
        httpStatus: number;
        stack?: string;
        path?: string;
      };
    };
  };
}
```

### Common Error Codes

#### Authentication Errors
- **401 Unauthorized**: Invalid or missing Anthropic API key
- **403 Forbidden**: API key lacks required permissions

#### Rate Limiting
- **429 Too Many Requests**: Claude API rate limit exceeded
  - Automatic retry after delay
  - Exponential backoff for repeated failures

#### Server Errors
- **500 Internal Server Error**: General server error
- **502 Bad Gateway**: Claude API unavailable
- **503 Service Unavailable**: Temporary service issues

#### Client Errors
- **400 Bad Request**: Invalid input data
- **404 Not Found**: Session or resource not found

## Progress Tracking

### Build Stages

The `getProgress` endpoint returns different stages during app creation:

1. **"Initializing"** (10%): Setting up project directory
2. **"Creating workspace"** (20%): Creating project structure
3. **"Creating Expo template"** (30-50%): Running create-expo-app
4. **"Generating custom app"** (60%): Claude generating custom code
5. **"Applying custom code"** (70%): Writing generated files
6. **"Custom app ready"** (80%): Custom code applied
7. **"Starting development server"** (90%): Starting Expo server
8. **"Development server ready"** (100%): Complete

### Chat Progress Updates

During chat interactions with code generation:

1. **"AI Processing"**: Claude analyzing request
2. **"Applying Changes"**: Writing generated code to files
3. **"Changes Applied"**: Code successfully updated

## Rate Limiting

### Claude API Limits
- Automatic retry with exponential backoff
- Maximum 2 retries for code generation
- Maximum 1 retry for chat responses
- 5-second delay for code generation retries
- 3-second delay for chat retries

### Best Practices
- Avoid rapid successive API calls
- Handle 429 errors gracefully
- Implement client-side rate limiting for user interactions

## Real-time Updates

### Polling Implementation

Progress updates use polling instead of Server-Sent Events:

```typescript
// Custom hook for progress tracking
const { progress, isLoading } = useBuildProgress({
  sessionId: "uuid-here",
  enabled: true,
  pollingInterval: 2000 // Poll every 2 seconds
});
```

### Polling Configuration
- **Default interval**: 2000ms (2 seconds)
- **Stops when**: `isComplete: true` or `hasError: true`
- **Error handling**: Continues polling on network errors

## Security

### Input Validation
- All inputs validated with Zod schemas
- File paths validated to prevent directory traversal
- Session IDs must be valid UUIDs

### File Operations
- Restricted to project temporary directories
- Path resolution prevents access outside project
- Automatic cleanup of temporary files

### API Key Management
- Stored in environment variables
- Not exposed to client
- Validated on server startup