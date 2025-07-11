# Deployment Guide

This document provides comprehensive guidance for deploying PromptFuel to production environments.

## Prerequisites

### Environment Requirements

**Node.js Environment:**
- Node.js 18.0 or later
- npm 8.0 or later
- 4GB RAM minimum
- 20GB disk space

**Database:**
- PostgreSQL 13 or later
- Redis (recommended for production)
- Connection pooling support

**External Services:**
- Anthropic Claude API key
- Domain name and SSL certificate
- CDN (optional but recommended)

## Environment Configuration

### Production Environment Variables

Create a production `.env` file:

```bash
# Database
DATABASE_URL="postgresql://user:password@host:5432/promptfuel"
DATABASE_URL_UNPOOLED="postgresql://user:password@host:5432/promptfuel"

# API Keys
ANTHROPIC_API_KEY="sk-ant-api03-your-production-key"

# Application
NODE_ENV="production"
NEXTAUTH_URL="https://your-domain.com"
NEXTAUTH_SECRET="your-long-random-secret"

# Optional: Redis for progress tracking
REDIS_URL="redis://localhost:6379"

# Security
CORS_ORIGIN="https://your-domain.com"
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=900000

# Logging
LOG_LEVEL="info"
```

### Security Configuration

**API Key Management:**
```bash
# Use secrets management in production
export ANTHROPIC_API_KEY=$(cat /etc/secrets/anthropic-api-key)
```

**Database Security:**
```bash
# Use connection pooling
DATABASE_POOL_SIZE=20
DATABASE_TIMEOUT=30000
```

## Build and Deployment

### Docker Deployment

#### Dockerfile

```dockerfile
FROM node:18-alpine AS builder

WORKDIR /app
COPY package*.json ./
RUN npm ci --only=production

COPY . .
RUN npm run build

FROM node:18-alpine AS runner

WORKDIR /app
RUN addgroup --system --gid 1001 nodejs
RUN adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs

EXPOSE 3000
ENV PORT 3000

CMD ["node", "server.js"]
```

#### Docker Compose

```yaml
version: '3.8'

services:
  app:
    build: .
    ports:
      - "3000:3000"
    environment:
      - DATABASE_URL=${DATABASE_URL}
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - NODE_ENV=production
    depends_on:
      - postgres
      - redis
    restart: unless-stopped

  postgres:
    image: postgres:15
    environment:
      - POSTGRES_DB=promptfuel
      - POSTGRES_USER=${DB_USER}
      - POSTGRES_PASSWORD=${DB_PASSWORD}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    restart: unless-stopped

  redis:
    image: redis:7-alpine
    volumes:
      - redis_data:/data
    restart: unless-stopped

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
      - "443:443"
    volumes:
      - ./nginx.conf:/etc/nginx/nginx.conf
      - ./ssl:/etc/ssl
    depends_on:
      - app
    restart: unless-stopped

volumes:
  postgres_data:
  redis_data:
```

### Vercel Deployment

#### vercel.json

```json
{
  "framework": "nextjs",
  "buildCommand": "npm run build",
  "devCommand": "npm run dev",
  "installCommand": "npm install",
  "env": {
    "ANTHROPIC_API_KEY": "@anthropic-api-key",
    "DATABASE_URL": "@database-url"
  },
  "functions": {
    "src/app/api/**/*.ts": {
      "maxDuration": 300
    }
  }
}
```

#### Build Configuration

```bash
# Install Vercel CLI
npm i -g vercel

# Configure environment variables
vercel env add ANTHROPIC_API_KEY production
vercel env add DATABASE_URL production

# Deploy
vercel --prod
```

### Railway Deployment

#### railway.json

```json
{
  "build": {
    "builder": "NIXPACKS"
  },
  "deploy": {
    "startCommand": "npm start",
    "restartPolicyType": "ON_FAILURE",
    "restartPolicyMaxRetries": 10
  }
}
```

#### Environment Setup

```bash
# Install Railway CLI
npm install -g @railway/cli

# Login and deploy
railway login
railway link
railway up
```

## Database Setup

### Prisma Migration

```bash
# Generate Prisma client
npx prisma generate

# Run migrations
npx prisma migrate deploy

# Seed database (if needed)
npx prisma db seed
```

### Connection Pooling

```typescript
// lib/db.ts
import { PrismaClient } from '@prisma/client'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
}

export const db = globalForPrisma.prisma ?? new PrismaClient({
  log: ['query'],
  datasources: {
    db: {
      url: process.env.DATABASE_URL
    }
  }
})

if (process.env.NODE_ENV !== 'production') globalForPrisma.prisma = db
```

## Scaling Considerations

### Horizontal Scaling

**Load Balancer Configuration:**
```nginx
upstream promptfuel {
    server app1:3000;
    server app2:3000;
    server app3:3000;
}

server {
    listen 80;
    server_name your-domain.com;
    
    location / {
        proxy_pass http://promptfuel;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

**Session Affinity:**
```typescript
// For progress tracking across instances
import Redis from 'ioredis'

const redis = new Redis(process.env.REDIS_URL)

export async function updateBuildProgress(sessionId: string, update: any) {
  await redis.setex(`progress:${sessionId}`, 3600, JSON.stringify(update))
}
```

### Resource Optimization

**Memory Management:**
```typescript
// Process limits
process.setMaxListeners(100)

// Garbage collection tuning
if (process.env.NODE_ENV === 'production') {
  setInterval(() => {
    if (global.gc) {
      global.gc()
    }
  }, 30000)
}
```

**File System Cleanup:**
```typescript
// Scheduled cleanup
setInterval(async () => {
  const tempDir = path.join(os.tmpdir(), 'expo-*')
  const oldDirs = await glob(tempDir, { 
    maxAge: 1000 * 60 * 60 // 1 hour
  })
  
  for (const dir of oldDirs) {
    await fs.rm(dir, { recursive: true, force: true })
  }
}, 1000 * 60 * 30) // Every 30 minutes
```

## Monitoring and Logging

### Application Monitoring

#### Health Check Endpoint

```typescript
// app/api/health/route.ts
export async function GET() {
  try {
    // Check database connection
    await db.$queryRaw`SELECT 1`
    
    // Check Claude API
    await anthropic.messages.create({
      model: 'claude-3-haiku-20240307',
      max_tokens: 10,
      messages: [{ role: 'user', content: 'test' }]
    })
    
    return Response.json({ 
      status: 'healthy',
      timestamp: new Date().toISOString(),
      uptime: process.uptime()
    })
  } catch (error) {
    return Response.json(
      { status: 'unhealthy', error: error.message },
      { status: 503 }
    )
  }
}
```

#### Logging Configuration

```typescript
// lib/logger.ts
import winston from 'winston'

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' }),
  ],
})

if (process.env.NODE_ENV !== 'production') {
  logger.add(new winston.transports.Console({
    format: winston.format.simple()
  }))
}
```

### Metrics Collection

#### Prometheus Integration

```typescript
// lib/metrics.ts
import { register, Counter, Histogram, Gauge } from 'prom-client'

export const httpRequestDuration = new Histogram({
  name: 'http_request_duration_seconds',
  help: 'Duration of HTTP requests in seconds',
  labelNames: ['method', 'route', 'status']
})

export const claudeApiCalls = new Counter({
  name: 'claude_api_calls_total',
  help: 'Total number of Claude API calls',
  labelNames: ['type', 'status']
})

export const activeBuilds = new Gauge({
  name: 'active_builds',
  help: 'Number of active builds'
})

register.registerMetric(httpRequestDuration)
register.registerMetric(claudeApiCalls)
register.registerMetric(activeBuilds)
```

### Error Tracking

#### Sentry Integration

```typescript
// lib/sentry.ts
import * as Sentry from '@sentry/nextjs'

Sentry.init({
  dsn: process.env.SENTRY_DSN,
  environment: process.env.NODE_ENV,
  tracesSampleRate: 0.1,
  beforeSend(event) {
    // Filter sensitive data
    if (event.extra?.apiKey) {
      delete event.extra.apiKey
    }
    return event
  }
})
```

## Security Hardening

### Rate Limiting

```typescript
// middleware.ts
import { Ratelimit } from '@upstash/ratelimit'
import { Redis } from '@upstash/redis'

const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(100, '15 m'),
})

export async function middleware(request: NextRequest) {
  const ip = request.ip ?? '127.0.0.1'
  const { success } = await ratelimit.limit(ip)
  
  if (!success) {
    return new Response('Rate limit exceeded', { status: 429 })
  }
}
```

### Content Security Policy

```typescript
// next.config.js
const ContentSecurityPolicy = `
  default-src 'self';
  script-src 'self' 'unsafe-eval' 'unsafe-inline';
  style-src 'self' 'unsafe-inline';
  img-src 'self' data: blob:;
  connect-src 'self' https://api.anthropic.com;
  font-src 'self';
`

const securityHeaders = [
  {
    key: 'Content-Security-Policy',
    value: ContentSecurityPolicy.replace(/\s{2,}/g, ' ').trim()
  },
  {
    key: 'X-Frame-Options',
    value: 'DENY'
  },
  {
    key: 'X-Content-Type-Options',
    value: 'nosniff'
  }
]

module.exports = {
  async headers() {
    return [
      {
        source: '/(.*)',
        headers: securityHeaders,
      },
    ]
  },
}
```

## Backup and Recovery

### Database Backups

```bash
#!/bin/bash
# backup.sh

DATE=$(date +%Y%m%d_%H%M%S)
BACKUP_FILE="promptfuel_backup_$DATE.sql"

pg_dump $DATABASE_URL > $BACKUP_FILE
gzip $BACKUP_FILE

# Upload to S3
aws s3 cp "$BACKUP_FILE.gz" s3://your-backup-bucket/

# Cleanup local files older than 7 days
find . -name "promptfuel_backup_*.sql.gz" -mtime +7 -delete
```

### Application State Backup

```typescript
// Backup build progress data
export async function backupProgressData() {
  const data = Array.from(buildProgressMap.entries())
  
  await fs.writeFile(
    path.join(process.cwd(), 'backups', `progress_${Date.now()}.json`),
    JSON.stringify(data, null, 2)
  )
}

// Restore from backup
export async function restoreProgressData(backupFile: string) {
  const data = JSON.parse(await fs.readFile(backupFile, 'utf8'))
  
  for (const [sessionId, progress] of data) {
    buildProgressMap.set(sessionId, progress)
  }
}
```

## Performance Optimization

### Caching Strategy

```typescript
// lib/cache.ts
import NodeCache from 'node-cache'

export const cache = new NodeCache({
  stdTTL: 600, // 10 minutes
  checkperiod: 120 // Check for expired keys every 2 minutes
})

// Cache Claude responses for identical requests
export function getCachedResponse(prompt: string): string | null {
  const key = `claude:${crypto.createHash('sha256').update(prompt).digest('hex')}`
  return cache.get(key) || null
}

export function setCachedResponse(prompt: string, response: string): void {
  const key = `claude:${crypto.createHash('sha256').update(prompt).digest('hex')}`
  cache.set(key, response)
}
```

### CDN Configuration

```typescript
// next.config.js
module.exports = {
  images: {
    domains: ['your-cdn-domain.com'],
    loader: 'custom',
    loaderFile: './lib/image-loader.js'
  },
  
  async rewrites() {
    return [
      {
        source: '/assets/:path*',
        destination: 'https://your-cdn-domain.com/assets/:path*'
      }
    ]
  }
}
```

## Troubleshooting

### Common Production Issues

**Memory Leaks:**
```bash
# Monitor memory usage
node --max-old-space-size=4096 server.js

# Use heap profiling
node --inspect server.js
```

**Database Connection Issues:**
```typescript
// Connection pool monitoring
setInterval(() => {
  console.log('Active connections:', db.$pool.totalCount)
  console.log('Idle connections:', db.$pool.idleCount)
}, 30000)
```

**Claude API Rate Limits:**
```typescript
// Implement exponential backoff
async function callClaudeWithRetry(prompt: string, retries = 3): Promise<string> {
  try {
    return await claude.generate(prompt)
  } catch (error) {
    if (error.status === 429 && retries > 0) {
      const delay = Math.pow(2, 3 - retries) * 1000
      await new Promise(resolve => setTimeout(resolve, delay))
      return callClaudeWithRetry(prompt, retries - 1)
    }
    throw error
  }
}
```

## Maintenance

### Regular Maintenance Tasks

```bash
#!/bin/bash
# maintenance.sh

# Update dependencies
npm audit fix

# Run database maintenance
psql $DATABASE_URL -c "VACUUM ANALYZE;"

# Clear temporary files
find /tmp -name "expo-*" -mtime +1 -exec rm -rf {} \;

# Restart application
pm2 restart promptfuel
```

### Monitoring Checklist

- [ ] Application health endpoint responding
- [ ] Database connections within limits
- [ ] Claude API calls succeeding
- [ ] Disk space available for temporary files
- [ ] Error rates below threshold
- [ ] Response times acceptable
- [ ] Memory usage stable
- [ ] No failed builds in last hour