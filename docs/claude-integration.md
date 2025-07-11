# Claude AI Integration

This document explains how PromptFuel integrates with Claude AI for code generation and chat responses.

## Overview

PromptFuel uses Claude-3.5-Sonnet for two main purposes:
1. **Code Generation**: Converting natural language to React Native/Expo code
2. **Chat Responses**: Providing helpful assistance and guidance

## Service Architecture

### Claude Service (`src/server/services/claude.ts`)

The Claude service provides three main functions:
- `generateCode()`: Code generation from user requests
- `generateChatResponse()`: General chat responses
- `generateInitialApp()`: Custom initial app structure

## Code Generation

### How It Works

1. **Request Analysis**: User message is analyzed for code generation keywords
2. **Context Gathering**: Existing project files are read for context
3. **Prompt Engineering**: Structured prompt sent to Claude
4. **Response Parsing**: JSON response parsed and validated
5. **File Operations**: Generated code applied to project

### Prompt Structure

```typescript
const systemPrompt = `You are an expert React Native/Expo developer assistant.

IMPORTANT RULES:
1. Generate complete, working React Native/Expo code
2. Use Expo SDK 53.0.0 compatible code
3. Include all necessary imports
4. Follow React Native and JavaScript best practices
5. Return your response in a specific JSON format

Context:
- Project directory: ${projectDir}
- Project type: expo
- Existing files: ${existingFiles}

RESPONSE FORMAT:
{
  "files": [
    {
      "path": "relative/path/to/file.js",
      "content": "// Complete file content here",
      "action": "create" // or "update" or "delete"
    }
  ],
  "explanation": "Brief explanation of what was done"
}`;
```

### Generated File Format

Claude returns files in this structure:

```typescript
interface GeneratedFile {
  path: string;           // Relative path from project root
  content: string;        // Complete file content
  action: "create" | "update" | "delete"; // Operation type
}
```

### Example Code Generation Flow

**User Input:**
```
"Add a header component with the title 'My Tasks' and make it blue"
```

**Claude Response:**
```json
{
  "files": [
    {
      "path": "components/Header.js",
      "content": "import React from 'react';\nimport { View, Text, StyleSheet } from 'react-native';\n\nexport default function Header() {\n  return (\n    <View style={styles.container}>\n      <Text style={styles.title}>My Tasks</Text>\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: {\n    backgroundColor: '#007AFF',\n    padding: 20,\n    paddingTop: 50,\n    alignItems: 'center',\n  },\n  title: {\n    color: 'white',\n    fontSize: 24,\n    fontWeight: 'bold',\n  },\n});",
      "action": "create"
    },
    {
      "path": "App.js",
      "content": "import React from 'react';\nimport { View, StyleSheet } from 'react-native';\nimport Header from './components/Header';\n\nexport default function App() {\n  return (\n    <View style={styles.container}>\n      <Header />\n      {/* Your app content here */}\n    </View>\n  );\n}\n\nconst styles = StyleSheet.create({\n  container: {\n    flex: 1,\n    backgroundColor: '#fff',\n  },\n});",
      "action": "update"
    }
  ],
  "explanation": "Created a blue header component with the title 'My Tasks' and integrated it into the main App component."
}
```

## Chat Responses

### Non-Code Interactions

For general questions and help requests, Claude provides conversational responses:

```typescript
const systemPrompt = `You are a helpful AI assistant for a mobile app development platform. 
Help users understand how to build their Expo/React Native apps. Be concise and friendly.`;
```

### Example Chat Interactions

**User:** "What can you help me with?"

**Claude Response:**
```
I can help you build and modify your Expo/React Native app! Here are some things I can do:

• Create new components and screens
• Add navigation between screens
• Style your app with custom colors and layouts
• Implement features like forms, lists, and buttons
• Add functionality like data storage and API calls
• Help with debugging and best practices

Just describe what you'd like to add or change, and I'll generate the code for you!
```

## Code Generation Keywords

The system automatically detects code generation requests based on these keywords:

### Primary Actions
- `add`, `create`, `implement`, `build`, `make`
- `change`, `update`, `modify`, `edit`
- `delete`, `remove`, `fix`, `style`

### Component Types
- `component`, `screen`, `feature`, `navigation`
- `button`, `form`, `list`, `header`, `footer`
- `modal`, `alert`, `picker`, `slider`

### Style Keywords
- `color`, `theme`, `dark`, `light`
- `layout`, `design`, `ui`, `ux`

## Error Handling

### API Error Classification

```typescript
// Rate limiting (429)
if (error.status === 429 && retries > 0) {
  await new Promise(resolve => setTimeout(resolve, 5000));
  return generateCode(request, retries - 1);
}

// Authentication errors
case 401: "Invalid API key. Please check your Claude API configuration."
case 403: "API access forbidden. Please check your API key permissions."

// Server errors
case 500:
case 502: 
case 503: "Claude API is temporarily unavailable. Please try again."
```

### Retry Logic

- **Code Generation**: 2 retries with 5-second delays
- **Chat Responses**: 1 retry with 3-second delay
- **Exponential Backoff**: For repeated failures

### Fallback Responses

When Claude API fails:
- Code generation returns empty files array with error message
- Chat responses return helpful fallback message
- User is informed of the issue without technical details

## Configuration

### Model Settings

```typescript
const response = await anthropic.messages.create({
  model: "claude-3-5-sonnet-20241022",
  max_tokens: 8192,        // Code generation
  temperature: 0.2,        // Low for consistent code
  // OR
  max_tokens: 1024,        // Chat responses
  temperature: 0.7,        // Higher for natural conversation
});
```

### Environment Setup

```bash
# Required environment variable
ANTHROPIC_API_KEY="sk-ant-api03-..."
```

## Security Considerations

### Input Sanitization
- User messages sanitized before sending to Claude
- File paths validated to prevent directory traversal
- Generated code content validated for safety

### API Key Protection
- Stored in environment variables only
- Never exposed to client-side code
- Validated on application startup

### Rate Limit Management
- Automatic retry with backoff
- Client-side rate limiting for user interactions
- Graceful degradation when limits exceeded

## Best Practices

### Prompt Engineering
- Clear, specific instructions for code generation
- Context about existing codebase provided
- Consistent JSON response format required
- Error handling instructions included

### Code Quality
- Generated code follows React Native best practices
- TypeScript types preserved where applicable
- Proper import/export statements included
- Consistent code style maintained

### Performance
- Limit context files to prevent token limit issues
- Cache responses where appropriate
- Minimize API calls through smart request detection

### User Experience
- Progress updates during code generation
- Clear error messages for users
- Fallback responses when API unavailable
- Real-time feedback on code application