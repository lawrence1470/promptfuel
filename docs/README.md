# PromptFuel Documentation

PromptFuel is an AI-powered mobile app development platform that generates custom Expo/React Native applications from natural language descriptions using Claude AI.

## Quick Start

1. **Environment Setup**
   ```bash
   cp .env.example .env
   # Add your Anthropic API key to .env
   ```

2. **Install Dependencies**
   ```bash
   npm install
   ```

3. **Start Development**
   ```bash
   npm run dev
   ```

4. **Create an App**
   - Visit http://localhost:3000
   - Optionally describe your app
   - Click "Create New Expo App"
   - Chat with Claude to modify your app

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Frontend      │    │   Backend       │    │   AI Services   │
│   (Next.js)     │◄──►│   (tRPC)        │◄──►│   (Claude API)  │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │                       │
         ▼                       ▼                       ▼
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Chat UI       │    │   File Manager  │    │   Code Generation│
│   Progress UI   │    │   Progress      │    │   Chat Responses │
└─────────────────┘    │   Tracking      │    └─────────────────┘
                       └─────────────────┘
                                │
                                ▼
                       ┌─────────────────┐
                       │   Expo Projects │
                       │   (Temporary)   │
                       └─────────────────┘
```

## Key Features

- **AI Code Generation**: Claude generates React Native code from natural language
- **Real-time Updates**: Polling-based progress tracking
- **File Management**: Safe file operations within project boundaries
- **Expo Integration**: Automatic Expo app creation and development server
- **Error Handling**: Comprehensive error handling with retries

## Directory Structure

```
src/
├── app/                 # Next.js App Router pages
│   ├── page.tsx        # Home page with app description
│   ├── chat/           # Chat interface
│   └── api/            # API routes
├── server/
│   ├── api/            # tRPC routers
│   └── services/       # Core services
│       ├── claude.ts   # Claude AI integration
│       └── fileManager.ts # File operations
├── hooks/              # React hooks
├── lib/                # Utility libraries
└── env.js             # Environment validation
```

## Documentation Sections

- [Architecture](./architecture.md) - Detailed system architecture
- [API Reference](./api.md) - tRPC endpoints and schemas
- [Claude Integration](./claude-integration.md) - AI service implementation
- [File Management](./file-management.md) - File operation system
- [Progress Tracking](./progress-tracking.md) - Real-time updates
- [Expo Integration](./expo-integration.md) - Mobile app generation
- [Deployment](./deployment.md) - Production deployment guide

## Development

- **TypeScript**: Full type safety
- **tRPC**: End-to-end type safety for API
- **Tailwind CSS**: Utility-first styling
- **Prisma**: Database ORM (configured for PostgreSQL)
- **Biome**: Code formatting and linting