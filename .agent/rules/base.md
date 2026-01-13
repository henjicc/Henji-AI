---
trigger: always_on
---

## Project Overview

Henji-AI (痕迹AI) is a Tauri-based desktop application that aggregates multiple AI providers (PPIO, Fal, ModelScope, KIE) for generating images, videos, and audio through a unified interface. The application uses an adapter pattern to abstract provider-specific APIs.

## Development Commands

### Frontend Development
```bash
npm install              # Install dependencies
npm run dev              # Vite dev server only
npm run build            # TypeScript compilation + Vite build
npm run preview          # Preview production build
npm run lint             # Run ESLint
npm run lint:fix         # Auto-fix ESLint issues
```

### Tauri Development
```bash
# Windows (requires Visual Studio Build Tools)
npm run tauri:dev        # Development mode with hot reload
npm run tauri:build      # Production build (generates MSI)
npm run tauri:build:ci   # CI build without VS environment setup

# macOS (requires Xcode Command Line Tools)
npm run tauri:dev:mac    # Development mode
npm run tauri:build:mac  # Production build (generates DMG)
```

Build artifacts are located in `src-tauri/target/release/bundle/`

## Architecture

### Adapter Pattern Implementation

The core architecture uses a **Factory + Strategy pattern** to integrate multiple AI providers:

```
MediaGenerator (UI)
    ↓
ApiService (Singleton)
    ↓
AdapterFactory.createAdapter(config)
    ↓
BaseAdapter (Abstract)
    ↓
├── PPIOAdapter
├── FalAdapter
├── KIEAdapter
└── ModelscopeAdapter
```

**Key Files:**
- `src/adapters/base/BaseAdapter.ts` - Abstract base class defining the adapter interface
- `src/adapters/index.ts` - `AdapterFactory` with `createAdapter()` method
- `src/services/api.ts` - `ApiService` singleton managing adapter lifecycle

### Model Routing System

Each adapter implements a **route-based model system** that maps model IDs to request builders:

```typescript
interface ModelRoute {
  matches: (modelId: string) => boolean
  buildImageRequest?: (params) => { endpoint, requestData }
  buildVideoRequest?: (params) => { endpoint, requestData }
  buildAudioRequest?: (params) => { endpoint, requestData }
}
```

**Route Registration:**
- `src/adapters/ppio/models/index.ts` - PPIO model routes
- `src/adapters/fal/models/index.ts` - Fal model routes
- `src/adapters/kie/models/index.ts` - KIE model routes
- `src/adapters/modelscope/models/index.ts` - ModelScope model routes

**Flow:** `adapter.generateImage()` → `findRoute(modelId)` → `route.buildImageRequest()` → API call

### Provider-Specific Implementations

**PPIO Adapter** (`src/adapters/ppio/PPIOAdapter.ts`)
- Uses Axios for HTTP requests
- Polling via `PPIOStatusHandler` class
- Config: `src/adapters/ppio/config.ts` (base URL, poll interval: 3000ms, max attempts: 120)

**Fal Adapter** (`src/adapters/fal/FalAdapter.ts`)
- Uses official `@fal-ai/client` SDK
- Automatic polling via `fal.subscribe()`
- Handles image/video uploads to Fal CDN
- Config: `src/adapters/fal/config.ts` (model-specific poll counts)

**KIE Adapter** (`src/adapters/kie/KIEAdapter.ts`)
- Uses Axios with separate upload client
- Uploads images to KIE CDN before processing
- Status mapping: waiting → QUEUED, generating → PROCESSING, success → COMPLETED
- Config: `src/adapters/kie/config.ts` (poll interval: 3000ms, max attempts: 200)

**ModelScope Adapter** (`src/adapters/modelscope/ModelscopeAdapter.ts`)
- Uses Tauri backend via `invoke()` for API calls
- Optional Fal CDN integration for image uploads
- Currently supports image generation only

### Configuration System

**Provider Registry** (`src/config/providers.ts`)
- Loads from `providers.json`
- Defines provider metadata and available models
- Structure: `Provider { id, name, type, models[] }`

**Model Parameter System** (`src/models/index.ts`)
- Centralized `modelSchemaMap` mapping model IDs to parameter schemas
- Key functions:
  - `getModelSchema(modelId)` - Get parameter schema
  - `getModelDefaultValues(modelId)` - Extract default values
  - `getAutoSwitchValues(modelId, currentValues)` - Conditional parameter switching
  - `getSmartMatchValues(modelId, imageDataUrl, currentValues)` - Intelligent aspect ratio matching

**Model Parameter Files:**
- `src/models/ppio/` - PPIO model parameters
- `src/models/fal/` - Fal model parameters
- `src/models/modelscope/` - ModelScope model parameters
- `src/models/kie/` - KIE model parameters

### Response Parsing

Each adapter has provider-specific parsers:
- `src/adapters/ppio/parsers/index.ts` - PPIO response parsing
- `src/adapters/fal/parsers/imageParser.ts` - Fal response parsing
- `src/adapters/kie/parsers/` - KIE response parsing

### Data Storage

- **API Keys:** localStorage
- **History:** AppLocalData (`Henji-AI/history.json`)
- **Media Files:** AppLocalData (`Henji-AI/Media/`)
- **Cache:** AppLocalData (`Henji-AI/Uploads/`, `Henji-AI/Waveforms/`)

## Adding New AI Models or Providers

See **[docs/model-adaptation-guide.md](docs/model-adaptation-guide.md)** for detailed instructions on:
1. Defining model parameter schemas
2. Implementing adapter routes
3. Registering models in the system

### Quick Steps:

**Adding a new model to an existing provider:**
1. Create parameter schema in `src/models/{provider}/{model-name}.ts`
2. Register in `src/models/index.ts` modelSchemaMap
3. Add route in `src/adapters/{provider}/models/index.ts`
4. Update `providers.json` with model metadata

**Adding a new provider:**
1. Create adapter class extending `BaseAdapter` in `src/adapters/{provider}/`
2. Implement `generateImage()`, `generateVideo()`, `generateAudio()` methods
3. Create model routes in `src/adapters/{provider}/models/`
4. Add provider case in `AdapterFactory.createAdapter()`
5. Create parameter schemas in `src/models/{provider}/`
6. Update `providers.json` with provider metadata

## Troubleshooting & FAQ Resources

When encountering difficult problems, check the **`docs/FAQ/`** directory for detailed troubleshooting guides:

- **`fal-model-integration-issues.md`** - Common issues when integrating Fal models:
  - Price calculation not updating
  - Image upload button display issues
  - Parameter auto-switching failures
  - Auto-restore behavior problems
  - Incomplete parameter passing

- **`history-json-base64-bloat.md`** - Solutions for history.json file bloat:
  - Base64 data causing file size issues
  - Proper cleanup of image/video data in history
  - Best practices for new model integration

- **`配置驱动架构-常见问题.md`** - Configuration-driven architecture issues:
  - Parameters not appearing in API requests
  - autoSwitch not working or being too aggressive
  - Price estimation not updating
  - Image upload button visibility issues

- **`新模型参数-同步更新清单.md`** - Checklist for adding new model parameters:
  - Required updates across multiple files
  - TypeScript type definitions
  - Common mistakes and missing locations
  - Quick verification methods

These FAQs contain detailed root cause analysis, step-by-step solutions, and debugging techniques for common problems encountered during model adaptation.

## Key Interfaces

```typescript
// Core parameter types (src/adapters/base/BaseAdapter.ts)
interface GenerateImageParams {
  prompt: string
  model: string
  images?: string[]
  imageUrls?: string[]
  aspect_ratio?: string
  onProgress?: (status: ProgressStatus) => void
  [key: string]: any
}

interface GenerateVideoParams {
  prompt: string
  model: string
  mode?: 'text-image-to-video' | 'start-end-frame' | 'reference-to-video'
  images?: string[]
  videos?: string[]
  aspectRatio?: string
  onProgress?: (status: ProgressStatus) => void
  [key: string]: any
}

// Result types
interface ImageResult {
  url: string
  taskId?: string
  filePath?: string
  status?: 'completed' | 'timeout'
}

interface VideoResult {
  taskId?: string
  url?: string
  filePath?: string
  status?: string
}

// Progress callback
interface ProgressStatus {
  status: 'IN_QUEUE' | 'IN_PROGRESS' | 'COMPLETED'
  queue_position?: number
  message?: string
  progress?: number
}
```

## Platform-Specific Notes

### Windows
- Requires Visual Studio Build Tools (MSVC)
- Uses custom build script that sets up VS environment
- Window controls use Windows-specific styling

### macOS
- Requires Xcode Command Line Tools
- Uses separate build scripts (`tauri:dev:mac`, `tauri:build:mac`)
- Window controls use macOS-specific styling

### Cross-Platform Compatibility
- File paths use Tauri API (`@tauri-apps/plugin-fs`)
- HTTP requests use Tauri plugin (`@tauri-apps/plugin-http`)
- Avoid platform-specific path separators

## Common Patterns

### Polling Pattern
All adapters implement polling for async operations:
- PPIO: `PPIOStatusHandler.pollTaskStatus()`
- Fal: `fal.subscribe()` with automatic polling
- KIE: Direct polling with status mapping
- ModelScope: Backend-managed polling via Tauri

### Progress Callbacks
Use `onProgress` callback for real-time status updates:
```typescript
await adapter.generateImage({
  prompt: "...",
  onProgress: (status) => {
    console.log(status.status, status.progress)
  }
})
```

### Error Handling
All adapters use `BaseAdapter.formatError()` for consistent error formatting.

## Testing

No test suite is currently configured. When adding tests:
- Use the existing ESLint configuration
- Follow TypeScript strict mode conventions
- Test adapter implementations independently
