# MiniMax Hailuo 2.3 Implementation Plan

## ✅ Completed Steps

### Step 1: Parameter Schema ✓
- Created `src/models/fal-ai-minimax-hailuo-2.3.ts`
- Defined 4 parameters:
  - `falHailuo23Version`: 版本 (standard/pro)
  - `falHailuo23Duration`: 时长 (6s/10s, Pro only supports 6s)
  - `falHailuo23FastMode`: 快速模式 (toggle, only visible with images)
  - `falHailuo23PromptOptimizer`: 提示词优化 (toggle)

### Step 2: Schema Registration ✓
- Added to `src/models/index.ts`:
  - Export statement
  - Import statement
  - modelSchemaMap entries for both IDs

### Step 3-5: UI & State (SKIPPED - Using SchemaForm) ✓
- Fal models use SchemaForm which automatically handles:
  - Parameter panel rendering
  - State management
  - Parameter mapping
- No manual implementation needed

## 🔄 Remaining Steps

### Step 6: OptionsBuilder Configuration
**File**: `src/components/MediaGenerator/builders/configs/fal-models.ts`

Add configuration:
```typescript
export const falHailuo23Config: ModelConfig = {
  id: 'minimax-hailuo-2.3-fal',
  type: 'video',
  provider: 'fal',

  paramMapping: {
    duration: {
      source: ['falHailuo23Duration', 'videoDuration'],
      defaultValue: '6'
    },
    prompt_optimizer: {
      source: 'falHailuo23PromptOptimizer',
      defaultValue: true
    }
  },

  features: {
    imageUpload: {
      enabled: true,
      maxImages: 1,
      mode: 'single',
      paramKey: 'image_url',
      convertToBlob: false
    }
  },

  customHandlers: commonImageUploadHandler
}
```

### Step 7: Register OptionsBuilder Config
**File**: `src/components/MediaGenerator/builders/configs/index.ts`

Add:
```typescript
import { falHailuo23Config } from './fal-models'

export function registerAllConfigs() {
  // ... existing
  optionsBuilder.registerConfig(falHailuo23Config)
  optionsBuilder.registerConfig({ ...falHailuo23Config, id: 'fal-ai-minimax-hailuo-2.3' })
}
```

### Step 8: Model Route
**File**: `src/adapters/fal/models/fal-ai-minimax-hailuo-2.3.ts`

Create route with 6 endpoints:
- Standard T2V: `fal-ai/minimax/hailuo-2.3/standard/text-to-video`
- Standard I2V: `fal-ai/minimax/hailuo-2.3/standard/image-to-video`
- Pro T2V: `fal-ai/minimax/hailuo-2.3/pro/text-to-video`
- Pro I2V: `fal-ai/minimax/hailuo-2.3/pro/image-to-video`
- Fast Standard I2V: `fal-ai/minimax/hailuo-2.3-fast/standard/image-to-video`
- Fast Pro I2V: `fal-ai/minimax/hailuo-2.3-fast/pro/image-to-video`

### Step 9: Register Route
**File**: `src/adapters/fal/models/index.ts`

### Step 10: Polling Configuration
**File**: `src/adapters/fal/config.ts`

Add: `'fal-ai-minimax-hailuo-2.3': 30`

### Step 11: providers.json
**File**: `src/config/providers.json`

Add to fal provider models array

### Step 12: Pricing Configuration
**File**: `src/config/pricing.ts`

Add price constants and calculator:
- Standard T2V/I2V: $0.28 (6s), $0.56 (10s)
- Pro T2V/I2V: $0.49 (fixed)
- Fast Standard I2V: $0.19 (6s), $0.32 (10s)
- Fast Pro I2V: $0.33 (fixed)

## Key Implementation Notes

1. **Endpoint Selection Logic**:
   - Version (standard/pro) → path segment
   - Image count (0/1) → text-to-video vs image-to-video
   - Fast mode + has image → use `-fast` variant

2. **Duration Handling**:
   - Standard: supports 6s and 10s (pass as string "6" or "10")
   - Pro: fixed 6s (don't pass duration parameter)

3. **Price Calculation**:
   - Check version, duration, fast mode, and image count
   - Use USD prices × 7.071 (USD_TO_CNY)

4. **Parameter Naming**:
   - All use `fal` prefix: `falHailuo23*`
   - Avoids conflicts with PPIO Hailuo models
