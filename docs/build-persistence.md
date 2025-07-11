# Build Persistence

This document outlines the build persistence system for PromptFuel, allowing users to save, restore, and share their Expo app builds.

## Overview

The build persistence system addresses the current limitation where Expo builds are stored in temporary directories and lost when the browser is refreshed or the session expires. It implements a hybrid storage approach using PostgreSQL for metadata and Cloudflare R2 for file storage.

## Current Limitations

### Temporary Storage Issues
- **Session Loss**: Builds are lost on browser refresh
- **Process Cleanup**: Projects deleted when Expo server exits  
- **No Persistence**: No way to return to previous work
- **Memory Usage**: In-memory progress tracking only
- **No Sharing**: Cannot share builds between users

### Storage Location
```
/tmp/expo-{sessionId}/     # Temporary directory
├── App.js                 # Gets deleted on process exit
├── package.json
├── components/
└── node_modules/
```

## Solution Architecture

### Hybrid Storage Approach

**PostgreSQL**: Fast metadata storage and queries
- Build session information
- User associations
- File metadata and hashes
- Progress tracking
- Share links and permissions

**Cloudflare R2**: Cost-effective file storage
- Compressed project archives (tar.gz)
- Large build assets
- Global CDN distribution
- ~20x cheaper than database storage

### Cost Analysis

**Database Storage (PostgreSQL)**:
- Cost: ~$0.25/GB/month
- 100 builds × 20MB = 2GB = $6/month

**Object Storage (Cloudflare R2)**:
- Cost: $0.015/GB/month
- 100 builds × 20MB = 2GB = $0.30/month
- **Savings: 95% cost reduction**

## Implementation Details

### Database Schema

```prisma
model BuildSession {
  id            String   @id @default(cuid())
  sessionId     String   @unique
  userId        String?  // Optional user association
  projectName   String
  appDescription String?
  storageUrl    String   // R2 URL to compressed build
  fileCount     Int
  sizeBytes     BigInt
  buildMetadata Json     // Expo config, dependencies, etc.
  expoUrl       String?
  isActive      Boolean  @default(true)
  isShared      Boolean  @default(false)
  shareToken    String?  @unique
  createdAt     DateTime @default(now())
  lastAccessed  DateTime @default(now())
  expiresAt     DateTime?
  
  files BuildFile[]
  
  @@index([userId])
  @@index([shareToken])
  @@index([createdAt])
}

model BuildFile {
  id        String @id @default(cuid())
  sessionId String
  filePath  String
  fileHash  String  // SHA-256 for deduplication
  sizeBytes Int
  
  session BuildSession @relation(fields: [sessionId], references: [sessionId], onDelete: Cascade)
  
  @@unique([sessionId, filePath])
  @@index([fileHash]) // For deduplication
}
```

### Storage Service Architecture

```typescript
interface BuildStorageService {
  // Core operations
  saveBuild(sessionId: string, projectDir: string): Promise<SaveResult>
  restoreBuild(sessionId: string, targetDir: string): Promise<RestoreResult>
  deleteBuild(sessionId: string): Promise<void>
  
  // Metadata operations
  getBuildMetadata(sessionId: string): Promise<BuildMetadata>
  listUserBuilds(userId?: string): Promise<BuildMetadata[]>
  
  // Sharing operations
  createShareLink(sessionId: string): Promise<string>
  restoreSharedBuild(shareToken: string): Promise<RestoreResult>
}
```

### File Compression Strategy

**Compression Pipeline**:
1. **Exclude unnecessary files**: `node_modules`, `.expo`, `.git`
2. **Create tarball**: Use `tar -czf` for optimal compression
3. **Calculate hashes**: SHA-256 for deduplication
4. **Upload to R2**: Parallel upload with progress tracking

**Expected Compression Ratios**:
- Fresh Expo app: 50MB → 5MB (90% reduction)
- With assets: 200MB → 20MB (90% reduction)
- Code-heavy apps: 100MB → 15MB (85% reduction)

### Deduplication Strategy

**File-level deduplication**:
- Calculate SHA-256 hash for each file
- Store unique files only once in R2
- Reference same file from multiple builds
- Significant savings for common files (React Native core, dependencies)

**Example**: 10 builds sharing React Native core files
- Without deduplication: 10 × 50MB = 500MB
- With deduplication: 50MB + 9 × 5MB = 95MB (81% savings)

## API Endpoints

### tRPC Procedures

```typescript
// Build management
buildPersistence: {
  save: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => { /* Save current build */ }),
    
  restore: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => { /* Restore build to temp dir */ }),
    
  list: publicProcedure
    .input(z.object({ userId: z.string().optional() }))
    .query(async ({ input }) => { /* List user's builds */ }),
    
  delete: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => { /* Delete build and files */ }),
    
  share: publicProcedure
    .input(z.object({ sessionId: z.string() }))
    .mutation(async ({ input }) => { /* Create share link */ }),
    
  import: publicProcedure
    .input(z.object({ shareToken: z.string() }))
    .mutation(async ({ input }) => { /* Import shared build */ })
}
```

## User Experience Flow

### Saving a Build
1. User clicks "Save Build" button in QR code section
2. System compresses current project directory
3. Uploads to R2 with progress indicator
4. Saves metadata to PostgreSQL
5. Shows success message with build name

### Restoring a Build
1. User visits homepage and sees "Previous Builds" section
2. Clicks on a saved build from the list
3. System downloads and extracts to new session
4. Redirects to chat page with restored build
5. Expo server starts with existing code

### Sharing a Build
1. User clicks "Share Build" in build list
2. System generates unique share token
3. Provides shareable URL: `promptfuel.com/shared/abc123`
4. Other users can import shared build
5. Creates new session with copied files

## Configuration

### Environment Variables

```bash
# Cloudflare R2 Configuration
R2_ENDPOINT="https://your-account.r2.cloudflarestorage.com"
R2_ACCESS_KEY_ID="your-access-key"
R2_SECRET_ACCESS_KEY="your-secret-key"
R2_BUCKET_NAME="promptfuel-builds"
R2_PUBLIC_URL="https://builds.your-domain.com"

# Storage Settings
BUILD_RETENTION_DAYS=30
MAX_BUILD_SIZE_MB=500
MAX_BUILDS_PER_USER=50
ENABLE_BUILD_SHARING=true
```

### Security Considerations

**Access Control**:
- Builds associated with user sessions
- Share tokens are UUID-based and unpredictable
- Expired builds automatically cleaned up
- File path validation prevents directory traversal

**Storage Security**:
- R2 bucket with private access
- Signed URLs for temporary access
- No public file listing
- Build isolation between users

## Migration Strategy

### Phase 1: MVP Implementation
1. Basic save/restore functionality
2. PostgreSQL + R2 integration
3. Simple UI for build management
4. Manual cleanup processes

### Phase 2: Enhanced Features
1. Automatic build versioning
2. Build comparison tools
3. Advanced sharing controls
4. Storage optimization

### Phase 3: Production Scaling
1. Automated cleanup jobs
2. Advanced deduplication
3. CDN integration
4. Analytics and monitoring

## Performance Considerations

### Upload Performance
- **Parallel uploads**: Split large files into chunks
- **Progress tracking**: Real-time upload progress
- **Retry logic**: Handle network interruptions
- **Background processing**: Non-blocking UI

### Download Performance
- **CDN distribution**: Global edge caching
- **Parallel downloads**: Multiple file streams
- **Resumable downloads**: Handle connection drops
- **Smart extraction**: Extract only needed files

### Storage Optimization
- **Cleanup jobs**: Remove expired builds automatically
- **Compression tuning**: Optimize for speed vs size
- **Deduplication**: Reduce redundant storage
- **Monitoring**: Track storage usage and costs

## Monitoring and Analytics

### Key Metrics
- **Storage usage**: Total bytes stored per user
- **Build frequency**: Saves per user per day
- **Restoration rate**: How often builds are restored
- **Share usage**: Most shared builds
- **Cost tracking**: R2 storage and bandwidth costs

### Alerting
- **Storage quotas**: Alert when approaching limits
- **Failed uploads**: Monitor upload success rates
- **Cleanup issues**: Track cleanup job failures
- **Cost overruns**: Alert on unexpected costs

## Future Enhancements

### Advanced Features
- **Build templates**: Save builds as reusable templates
- **Collaborative editing**: Multiple users editing same build
- **Version control**: Git-like branching and merging
- **Automated testing**: Run tests on saved builds

### Integration Opportunities
- **GitHub sync**: Import/export to GitHub repositories
- **EAS integration**: Deploy saved builds to app stores
- **CI/CD**: Automated builds from saved projects
- **Team workspaces**: Shared build libraries

## Conclusion

The build persistence system transforms PromptFuel from a session-based tool to a comprehensive app development platform. By implementing hybrid storage with PostgreSQL and Cloudflare R2, we achieve:

- **95% cost reduction** compared to database-only storage
- **Persistent user experience** across sessions
- **Build sharing and collaboration** capabilities
- **Scalable architecture** for production use

This foundation enables future features like team collaboration, build templates, and advanced development workflows.