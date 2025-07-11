# File Management System

This document explains how PromptFuel safely manages file operations for generated code.

## Overview

The file management system ensures secure and reliable file operations within Expo project directories. It handles code generation, file updates, and maintains project integrity.

## Core Components

### File Manager Service (`src/server/services/fileManager.ts`)

Provides secure file operations with the following functions:
- `applyGeneratedFiles()`: Apply Claude-generated code to project
- `readProjectFiles()`: Read existing project files for context
- `listProjectFiles()`: Get list of files in project
- `isPathSafe()`: Validate file paths for security
- `backupFiles()`: Create backups before modifications
- `restoreFiles()`: Restore from backups if needed

## Security Model

### Path Validation

All file operations are validated to ensure they stay within the project directory:

```typescript
export function isPathSafe(projectDir: string, filePath: string): boolean {
  const resolvedPath = path.resolve(projectDir, filePath);
  const resolvedProjectDir = path.resolve(projectDir);
  
  // Ensure the resolved path is within the project directory
  return resolvedPath.startsWith(resolvedProjectDir);
}
```

### Project Isolation

Each session operates in an isolated temporary directory:

```
/tmp/expo-{sessionId}/
├── App.js
├── app.json
├── package.json
├── components/
├── screens/
└── assets/
```

### Prevented Operations

- Access to files outside project directory
- Reading system files or environment variables
- Modifying system directories
- Network file operations

## File Operations

### Apply Generated Files

Processes Claude-generated files and applies them to the project:

```typescript
interface GeneratedFile {
  path: string;                    // Relative path from project root
  content: string;                 // Complete file content
  action: "create" | "update" | "delete"; // Operation type
}

const results = await applyGeneratedFiles(projectDir, files);
```

#### Operation Types

**Create**: Creates new files
- Ensures parent directory exists
- Writes content to file
- Sets appropriate permissions

**Update**: Modifies existing files
- Overwrites existing content
- Preserves file permissions
- Creates backup before modification

**Delete**: Removes files
- Safely removes file if it exists
- Ignores if file doesn't exist
- No error for missing files

### Read Project Files

Reads existing files to provide context to Claude:

```typescript
const existingCode = await readProjectFiles(projectDir, [
  'App.js',
  'components/Header.js',
  'screens/Home.js'
]);
```

**Features:**
- Returns file contents as string map
- Skips files that don't exist or can't be read
- Limits to specific file types for security
- UTF-8 encoding support

### List Project Files

Scans project directory for relevant files:

```typescript
const projectFiles = await listProjectFiles(projectDir, [
  '.js', '.jsx', '.ts', '.tsx', '.json'
]);
```

**Features:**
- Recursive directory scanning
- File extension filtering
- Excludes `node_modules` and hidden directories
- Returns relative paths from project root

## File Types

### Supported Extensions

The system works with these file types:
- **JavaScript**: `.js`, `.jsx`
- **TypeScript**: `.ts`, `.tsx`
- **Configuration**: `.json`
- **Styles**: `.css` (limited support)

### Project Structure

Standard Expo project structure:

```
project/
├── App.js              # Main app entry point
├── app.json           # Expo configuration
├── package.json       # Dependencies
├── babel.config.js    # Babel configuration
├── components/        # Reusable components
│   ├── Button.js
│   ├── Header.js
│   └── Navigation.js
├── screens/           # App screens
│   ├── Home.js
│   ├── Profile.js
│   └── Settings.js
├── utils/             # Utility functions
├── services/          # API services
├── assets/            # Static assets
│   ├── images/
│   └── fonts/
└── node_modules/      # Dependencies (excluded)
```

## Error Handling

### File Operation Results

Each operation returns detailed results:

```typescript
interface FileOperationResult {
  success: boolean;
  path: string;
  error?: string;
}
```

### Common Errors

**Permission Denied**
```
Error: EACCES: permission denied, open '/path/to/file'
```
- Solution: Check file permissions
- Fallback: Skip file and continue

**File Not Found**
```
Error: ENOENT: no such file or directory, open '/path/to/file'
```
- Solution: Create parent directories
- Fallback: Report as successful for delete operations

**Invalid Path**
```
Error: Invalid file path detected
```
- Solution: Use relative paths only
- Security: Reject operation and log attempt

**Disk Space**
```
Error: ENOSPC: no space left on device
```
- Solution: Clean up temporary files
- Fallback: Report error to user

## Backup and Recovery

### Automatic Backups

Before applying changes, the system creates backups:

```typescript
const backups = await backupFiles(projectDir, filePaths);
```

**Backup Storage:**
- In-memory Map for session duration
- Key: relative file path
- Value: original file content

### Recovery Process

If file operations fail, automatic recovery:

```typescript
await restoreFiles(projectDir, backups);
```

**Recovery Scenarios:**
- Partial write failures
- Permission errors during batch operations
- User cancellation
- System crashes

## Performance Considerations

### File Reading Limits

To prevent token limit issues:
- Maximum 10 files read for context
- File size limit of 50KB per file
- Total context limit of 500KB

### Caching Strategy

- File listings cached for 30 seconds
- File contents cached during session
- Cache invalidated after file modifications

### Cleanup

Automatic cleanup processes:
- Temporary directories removed on process exit
- Backup data cleared after successful operations
- Old project directories cleaned periodically

## Integration with Claude

### Context Preparation

Before sending requests to Claude:

1. **Scan Project**: List all relevant files
2. **Read Context**: Read key files for context
3. **Limit Size**: Truncate if too large
4. **Format**: Structure for Claude consumption

### Code Application

After receiving Claude response:

1. **Validate**: Check file paths and content
2. **Backup**: Store current file states
3. **Apply**: Write new/updated files
4. **Verify**: Check operation success
5. **Report**: Return results to user

### Error Recovery

If Claude generates invalid code:

1. **Detect**: Parse and validate generated files
2. **Reject**: Refuse invalid operations
3. **Restore**: Restore from backups if needed
4. **Report**: Inform user of issues

## Monitoring and Logging

### Operation Logging

All file operations are logged:

```typescript
console.log(`[FileManager] ${operation} ${filePath}: ${result}`);
```

### Security Logging

Security violations logged:

```typescript
console.warn(`[Security] Path traversal attempt: ${filePath}`);
```

### Performance Metrics

Track operation performance:
- File operation duration
- Backup creation time
- Context reading time
- Error rates by operation type

## Best Practices

### For Developers

1. **Always validate paths** before file operations
2. **Create backups** before destructive changes
3. **Handle errors gracefully** with appropriate fallbacks
4. **Log security violations** for monitoring
5. **Clean up resources** after operations

### For Users

1. **Use descriptive requests** for better code generation
2. **Test changes** in small increments
3. **Report issues** if file operations fail
4. **Keep project structure** organized for better AI understanding