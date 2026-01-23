# UI Pattern Analysis: PanelTrigger & Tooltip Integration

## Document Overview

This document analyzes the old Henji-AI system's click-to-expand (PanelTrigger) and tooltip patterns, identifies gaps in the new system, and provides a comprehensive implementation plan to integrate these patterns while maintaining the configuration-driven architecture.

---

## 1. Click-to-Expand Pattern (PanelTrigger)

### 1.1 Old System Implementation

**Location:** `old-Henji-AI/src/components/ui/PanelTrigger.tsx`

#### Key Features

1. **Button with Dropdown Arrow**
   - Displays current value with a chevron icon
   - Arrow rotates 180° when panel is open
   - Button styling: `bg-zinc-800/70 backdrop-blur-lg border border-zinc-700/50`
   - Height: `38px` (consistent with other inputs)

2. **Portal-Based Panel Rendering**
   - Uses `createPortal(panel, document.body)` for z-index control
   - Panel positioned using `position: fixed` with calculated coordinates
   - Supports two alignment modes:
     - `bottomLeft`: Panel appears below button (default)
     - `aboveCenter`: Panel appears above button, centered

3. **Click Outside to Close**
   - Global `mousedown` event listener
   - Checks if click is inside trigger or panel
   - Supports conditional closing via `closeOnPanelClick` prop

4. **Animation System**
   - Opening: `animate-scale-in` (0.2s ease-out)
   - Closing: `animate-scale-out` (0.2s ease-out)
   - Two-state system: `open` and `closing` states
   - 200ms delay before unmounting panel

5. **Smart Positioning**
   - Calculates viewport boundaries
   - Accounts for Tauri title bar (40px)
   - Maintains 8px margin from viewport edges
   - Updates position on scroll/resize
   - Uses `useLayoutEffect` for immediate positioning

6. **Stable Height Mode**
   - Optional `stableHeight` prop
   - Tracks maximum panel height with `ResizeObserver`
   - Prevents panel from shrinking after expansion

#### Code Example

```tsx
// Old System: PanelTrigger Usage
<PanelTrigger
  label="分辨率"
  display="1024x1024"
  panelWidth={400}
  alignment="bottomLeft"
  closeOnPanelClick={true}
  renderPanel={() => (
    <div className="p-4">
      {/* Panel content */}
    </div>
  )}
/>
```

#### Animation CSS

```css
/* Old System: index.css */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes scaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

.animate-scale-in {
  animation: scaleIn 0.2s ease-out forwards;
}

.animate-scale-out {
  animation: scaleOut 0.2s ease-out forwards;
}
```

---

## 2. Tooltip Pattern

### 2.1 Old System Implementation

**Location:** `old-Henji-AI/src/components/ui/Tooltip.tsx`

#### Key Features

1. **Hover Delay**
   - Default: 500ms before tooltip appears
   - Configurable via `delay` prop
   - Uses `setTimeout` for delay management

2. **Positioning**
   - Positioned above the trigger element
   - Centered horizontally: `left: rect.left + rect.width / 2`
   - 8px gap above trigger: `top: rect.top - 8`
   - Uses CSS transforms: `-translate-x-1/2 -translate-y-full`

3. **Fade In/Out Animations**
   - Opening: `animate-fade-in` (0.3s ease-out)
   - Closing: `animate-fade-out` (0.3s ease-out)
   - 300ms delay before unmounting

4. **Portal Rendering**
   - Uses `createPortal(tooltip, document.body)`
   - Z-index: `9999` (highest priority)
   - Pointer events disabled: `pointer-events-none`

5. **Scroll/Resize Handling**
   - Updates position on scroll/resize
   - Only updates when visible and not closing

6. **Flex Layout Support**
   - Detects if child has `flex-1` or `flex-grow` classes
   - Applies flex layout to wrapper to preserve child layout

#### Code Example

```tsx
// Old System: Tooltip Usage in SchemaForm
const wrapWithTooltip = (component: React.ReactElement, param: ParamDef, key: string) => {
  if (param.tooltip) {
    return (
      <Tooltip key={key} content={param.tooltip} delay={param.tooltipDelay || 500}>
        {component}
      </Tooltip>
    )
  }
  return React.cloneElement(component, { key })
}

// In render:
{visibleParams.map(param => {
  const component = <Dropdown {...props} />
  return wrapWithTooltip(component, param, param.id)
})}
```

#### Animation CSS

```css
/* Old System: index.css */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fadeOut {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out forwards;
}

.animate-fade-out {
  animation: fadeOut 0.3s ease-out forwards;
}
```

#### Tooltip Styling

```tsx
// Fixed positioning with transforms
<span
  className="fixed z-[9999] -translate-x-1/2 -translate-y-full w-[280px]
             bg-zinc-800/90 border border-zinc-700/50 rounded-lg shadow-lg
             text-xs text-white p-3 pointer-events-none"
  style={{
    top: coords.top,
    left: coords.left,
  }}
>
  {content}
</span>
```

---

## 3. Old System Integration Pattern

### 3.1 SchemaForm Component

**Location:** `old-Henji-AI/src/components/ui/SchemaForm.tsx`

The old system integrated tooltips at the **SchemaForm level**, not in individual input components.

#### Integration Flow

```
SchemaForm
  ↓
visibleParams.map(param => {
  ↓
  switch (param.type) {
    case 'dropdown':
      component = <Dropdown {...props} />
      break
    case 'toggle':
      component = <Toggle {...props} />
      break
    // ...
  }
  ↓
  return wrapWithTooltip(component, param, param.id)
})
```

#### Key Insight

**Tooltips wrap the entire parameter component**, not just the label. This allows:
- Hovering over any part of the component to show tooltip
- Consistent behavior across all parameter types
- No need to modify individual input components

---

## 4. Current New System Issues

### 4.1 Parameter Display

**Current Implementation:** `src/components/MediaGenerator/components/ParameterPanel.tsx`

```tsx
// New System: All parameters expanded by default
<div className="flex flex-wrap items-end gap-x-3 gap-y-2">
  {params.map((param) => (
    <ParamRenderer
      key={param.id}
      param={param}
      value={values[param.id]}
      onChange={(value) => onChange(param.id, value)}
      allValues={values}
      uploadedImages={uploadedImages}
    />
  ))}
</div>
```

**Problems:**
1. All parameters are always visible (no click-to-expand)
2. No tooltips on parameter names
3. No visual hierarchy for complex parameters
4. Takes up too much vertical space

### 4.2 Individual Input Components

**Example:** `src/components/params/base/DropdownInput.tsx`

```tsx
// New System: Dropdown always renders label + dropdown
<div className="w-auto">
  <label className="block text-sm font-medium text-zinc-300 mb-1.5">
    {displayName}
    {param.required && <span className="text-red-500 ml-1">*</span>}
  </label>
  <Dropdown
    value={value || ''}
    display={displayValue}
    options={options}
    onSelect={onChange}
    disabled={disabled}
    buttonClassName="w-full"
  />
</div>
```

**Problems:**
1. No tooltip support
2. No click-to-expand option
3. Always renders full UI

---

## 5. Implementation Plan

### 5.1 Architecture Decision

**Approach:** Extend the parameter definition schema to support display modes, then implement at the ParamRenderer level.

**Why this approach:**
- Maintains configuration-driven architecture
- No changes to individual input components
- Centralized logic in ParamRenderer
- Backward compatible (defaults to current behavior)

### 5.2 Schema Extensions

#### Add to `ParamDef` Type

**Location:** `src/core/types/ParamDef.ts`

```typescript
export interface ParamDef {
  // ... existing fields ...

  /**
   * Tooltip text shown on hover
   * Supports i18n via I18nText
   */
  tooltip?: I18nText

  /**
   * Tooltip hover delay in milliseconds
   * @default 500
   */
  tooltipDelay?: number

  /**
   * Display mode for the parameter
   * - 'inline': Always visible (default)
   * - 'panel': Click-to-expand panel
   */
  displayMode?: 'inline' | 'panel'

  /**
   * Panel configuration (only for displayMode: 'panel')
   */
  panelConfig?: {
    /**
     * Panel width in pixels
     * @default button width
     */
    width?: number

    /**
     * Panel alignment
     * @default 'bottomLeft'
     */
    alignment?: 'bottomLeft' | 'aboveCenter'

    /**
     * Close panel when clicking inside
     * @default true
     */
    closeOnClick?: boolean

    /**
     * Maintain stable height after expansion
     * @default false
     */
    stableHeight?: boolean
  }
}
```

### 5.3 Component Creation

#### 5.3.1 Create Tooltip Component

**Location:** `src/components/ui/Tooltip.tsx` (already exists, verify compatibility)

**Action:** Verify the existing Tooltip component matches the old system's behavior. If not, update it.

#### 5.3.2 Create PanelTrigger Component

**Location:** `src/components/ui/PanelTrigger.tsx` (already exists, verify compatibility)

**Action:** Verify the existing PanelTrigger component matches the old system's behavior. If not, update it.

#### 5.3.3 Create ParamWrapper Component

**Location:** `src/components/params/ParamWrapper.tsx` (NEW)

This component handles tooltip and panel display logic.

```typescript
/**
 * ParamWrapper - Wraps parameter components with tooltip and panel support
 *
 * Handles:
 * - Tooltip display on hover
 * - Click-to-expand panel mode
 * - Inline display mode (default)
 */

import React from 'react'
import { useTranslation } from 'react-i18next'
import type { ParamDef } from '@/core/types/ParamDef'
import { getI18nText } from '@/core/types/I18nText'
import Tooltip from '@/components/ui/Tooltip'
import PanelTrigger from '@/components/ui/PanelTrigger'

interface ParamWrapperProps {
  param: ParamDef
  value: any
  children: React.ReactElement
}

export const ParamWrapper: React.FC<ParamWrapperProps> = ({
  param,
  value,
  children
}) => {
  const { i18n } = useTranslation()

  // Get display name for panel trigger
  const displayName = getI18nText(param.name, i18n.language)

  // Get tooltip content
  const tooltipContent = param.tooltip
    ? getI18nText(param.tooltip, i18n.language)
    : undefined

  // Determine display mode
  const displayMode = param.displayMode || 'inline'

  // Wrap with tooltip if specified
  const wrapWithTooltip = (component: React.ReactElement) => {
    if (tooltipContent) {
      return (
        <Tooltip
          content={tooltipContent}
          delay={param.tooltipDelay || 500}
        >
          {component}
        </Tooltip>
      )
    }
    return component
  }

  // Panel mode: Use PanelTrigger
  if (displayMode === 'panel') {
    const panelConfig = param.panelConfig || {}

    // Get display value for button
    const displayValue = getDisplayValue(param, value)

    const panelTrigger = (
      <PanelTrigger
        label={displayName}
        display={displayValue}
        panelWidth={panelConfig.width}
        alignment={panelConfig.alignment || 'bottomLeft'}
        closeOnPanelClick={panelConfig.closeOnClick !== false}
        stableHeight={panelConfig.stableHeight}
        renderPanel={() => (
          <div className="p-4">
            {children}
          </div>
        )}
      />
    )

    return wrapWithTooltip(panelTrigger)
  }

  // Inline mode: Wrap with tooltip only
  return wrapWithTooltip(children)
}

/**
 * Get display value for panel trigger button
 */
function getDisplayValue(param: ParamDef, value: any): string {
  // For dropdown, find selected option label
  if (param.type === 'dropdown') {
    const dropdownParam = param as DropdownParamDef
    const option = dropdownParam.options.find(opt => opt.value === value)
    if (option) {
      return getI18nText(option.label, i18n.language)
    }
  }

  // For other types, convert value to string
  return String(value ?? '')
}
```

### 5.4 Update ParamRenderer

**Location:** `src/components/params/ParamRenderer.tsx`

```typescript
// Add import
import { ParamWrapper } from './ParamWrapper'

export const ParamRenderer: React.FC<ParamRendererProps> = React.memo(({
  param,
  value,
  onChange,
  allValues,
  uploadedImages = [],
  uploadedVideos = [],
  disabled: externalDisabled = false
}) => {
  // ... existing visibility logic ...

  // Get component (existing logic)
  const Component = COMPONENT_MAP[param.type as keyof typeof COMPONENT_MAP]

  if (!Component) {
    return (
      <div className="param-renderer-error" data-param-id={param.id}>
        <span>Unknown component type: {param.type}</span>
      </div>
    )
  }

  // Render component
  const component = (
    <Component
      param={param as any}
      value={value}
      onChange={onChange}
      disabled={externalDisabled}
    />
  )

  // Wrap with ParamWrapper for tooltip and panel support
  return (
    <ParamWrapper param={param} value={value}>
      {component}
    </ParamWrapper>
  )
})
```

### 5.5 Update Individual Input Components

**Action:** Remove label rendering from individual input components when in panel mode.

**Example:** `src/components/params/base/DropdownInput.tsx`

```typescript
export const DropdownInput: React.FC<DropdownInputProps> = ({
  param,
  value,
  onChange,
  disabled = false
}) => {
  const { i18n } = useTranslation()

  // Get display name
  const displayName = getI18nText(param.name, i18n.language)

  // Convert options
  const options = param.options.map((option) => ({
    label: getI18nText(option.label, i18n.language),
    value: option.value
  }))

  // Get display value
  const selectedOption = options.find(opt => opt.value === value)
  const displayValue = selectedOption?.label || ''

  // Check if we're in panel mode (label will be rendered by PanelTrigger)
  const showLabel = param.displayMode !== 'panel'

  return (
    <div className="w-auto">
      {showLabel && (
        <label className="block text-sm font-medium text-zinc-300 mb-1.5">
          {displayName}
          {param.required && <span className="text-red-500 ml-1">*</span>}
        </label>
      )}
      <Dropdown
        value={value || ''}
        display={displayValue}
        options={options}
        onSelect={onChange}
        disabled={disabled}
        buttonClassName="w-full"
      />
      {param.description && showLabel && (
        <p className="text-xs text-zinc-500 mt-1">
          {getI18nText(param.description, i18n.language)}
        </p>
      )}
    </div>
  )
}
```

**Apply similar changes to:**
- `TextInput.tsx`
- `NumberInput.tsx`
- `SliderInput.tsx`
- `SwitchInput.tsx`
- `RadioInput.tsx`
- `ImageUpload.tsx`
- `VideoUpload.tsx`

### 5.6 Update Model Definitions

**Example:** Add tooltip and panel mode to model definitions

```typescript
// src/models/ppio/wan-2.6.model.ts
export const wan26Model = defineModel({
  meta: {
    id: 'wan-2.6',
    // ...
  },
  params: [
    {
      id: 'resolution',
      type: 'dropdown',
      order: 2,
      name: { zh: '分辨率', en: 'Resolution' },
      tooltip: {
        zh: '选择视频分辨率。更高的分辨率会增加生成时间和成本。',
        en: 'Select video resolution. Higher resolution increases generation time and cost.'
      },
      tooltipDelay: 500,
      displayMode: 'panel', // Enable click-to-expand
      panelConfig: {
        width: 400,
        alignment: 'bottomLeft',
        closeOnClick: true
      },
      options: [
        { label: { zh: '720p', en: '720p' }, value: '720p' },
        { label: { zh: '1080p', en: '1080p' }, value: '1080p' }
      ],
      default: '1080p'
    },
    {
      id: 'duration',
      type: 'slider',
      order: 3,
      name: { zh: '时长', en: 'Duration' },
      tooltip: {
        zh: '视频时长（秒）。最长支持15秒。',
        en: 'Video duration in seconds. Maximum 15 seconds.'
      },
      min: 5,
      max: 15,
      step: 1,
      default: 10,
      // Inline display (default)
      displayMode: 'inline'
    }
  ]
})
```

---

## 6. Migration Strategy

### 6.1 Phase 1: Foundation (Week 1)

1. **Verify UI Components**
   - Check `Tooltip.tsx` compatibility
   - Check `PanelTrigger.tsx` compatibility
   - Update if necessary

2. **Create ParamWrapper**
   - Implement `ParamWrapper.tsx`
   - Add unit tests

3. **Update ParamRenderer**
   - Integrate ParamWrapper
   - Test with existing models

### 6.2 Phase 2: Input Component Updates (Week 1-2)

1. **Update Base Components**
   - Add `showLabel` logic to all input components
   - Test inline and panel modes

2. **Update Type Definitions**
   - Add tooltip and displayMode fields to ParamDef
   - Update TypeScript types

### 6.3 Phase 3: Model Migration (Week 2-3)

1. **Identify Complex Parameters**
   - Resolution selectors
   - Multi-option panels
   - Advanced settings

2. **Add Tooltips**
   - Add tooltip text to all parameters
   - Translate to English

3. **Enable Panel Mode**
   - Convert complex parameters to panel mode
   - Test user experience

### 6.4 Phase 4: Testing & Refinement (Week 3-4)

1. **User Testing**
   - Test with all 41 models
   - Verify tooltip positioning
   - Verify panel positioning

2. **Performance Testing**
   - Check animation smoothness
   - Verify no memory leaks

3. **Documentation**
   - Update model definition guide
   - Add examples to CLAUDE.md

---

## 7. Benefits of This Approach

### 7.1 Configuration-Driven

- All behavior defined in model definitions
- No hardcoded logic in UI components
- Easy to add tooltips/panels to new models

### 7.2 Backward Compatible

- Existing models work without changes
- Default behavior is inline display
- Gradual migration possible

### 7.3 Centralized Logic

- Tooltip logic in ParamWrapper
- Panel logic in ParamWrapper
- Individual input components stay simple

### 7.4 Maintainable

- Single source of truth (model definitions)
- Easy to update tooltip text
- Easy to change display modes

### 7.5 User Experience

- Cleaner UI with less clutter
- Helpful tooltips for complex parameters
- Familiar click-to-expand pattern

---

## 8. Example: Before & After

### 8.1 Before (Current New System)

```tsx
// All parameters always visible
<div className="flex flex-wrap items-end gap-x-3 gap-y-2">
  <DropdownInput param={resolutionParam} value="1080p" onChange={...} />
  <SliderInput param={durationParam} value={10} onChange={...} />
  <SwitchInput param={audioParam} value={true} onChange={...} />
  <NumberInput param={cfgScaleParam} value={7} onChange={...} />
  {/* 10+ more parameters... */}
</div>
```

**Problems:**
- Takes up entire screen
- No tooltips
- Hard to find specific parameters

### 8.2 After (With PanelTrigger & Tooltip)

```tsx
// Complex parameters in panels, simple ones inline
<div className="flex flex-wrap items-end gap-x-3 gap-y-2">
  {/* Panel mode: Click to expand */}
  <ParamWrapper param={resolutionParam} value="1080p">
    <PanelTrigger label="分辨率" display="1080p" renderPanel={...} />
  </ParamWrapper>

  {/* Inline mode with tooltip */}
  <ParamWrapper param={durationParam} value={10}>
    <Tooltip content="视频时长（秒）。最长支持15秒。">
      <SliderInput param={durationParam} value={10} onChange={...} />
    </Tooltip>
  </ParamWrapper>

  {/* Simple parameters inline */}
  <SwitchInput param={audioParam} value={true} onChange={...} />
</div>
```

**Benefits:**
- Cleaner UI
- Helpful tooltips
- Complex parameters hidden until needed

---

## 9. Technical Considerations

### 9.1 Z-Index Management

- Tooltip: `z-[9999]` (highest)
- PanelTrigger: `z-[1000]` (default, configurable)
- Dropdown: `z-[1000]` (default)

**Ensure no conflicts:** Tooltips should always be on top.

### 9.2 Animation Performance

- Use CSS animations (GPU-accelerated)
- Avoid JavaScript animations
- Use `transform` and `opacity` only

### 9.3 Accessibility

- Add ARIA labels to PanelTrigger buttons
- Ensure keyboard navigation works
- Add focus management

### 9.4 Mobile Considerations

- Tooltips may not work well on touch devices
- Consider showing tooltips on tap instead of hover
- Panel mode works well on mobile

---

## 10. Testing Checklist

### 10.1 Tooltip Testing

- [ ] Tooltip appears after 500ms hover
- [ ] Tooltip disappears on mouse leave
- [ ] Tooltip positioned correctly above element
- [ ] Tooltip updates position on scroll/resize
- [ ] Tooltip doesn't block interactions
- [ ] Tooltip works with all parameter types

### 10.2 PanelTrigger Testing

- [ ] Panel opens on button click
- [ ] Panel closes on outside click
- [ ] Panel closes on inside click (if configured)
- [ ] Panel positioned correctly below button
- [ ] Panel positioned correctly above button (aboveCenter mode)
- [ ] Panel updates position on scroll/resize
- [ ] Panel respects viewport boundaries
- [ ] Panel animation smooth (200ms)
- [ ] Panel stable height mode works

### 10.3 Integration Testing

- [ ] ParamWrapper works with all input types
- [ ] Inline mode works correctly
- [ ] Panel mode works correctly
- [ ] Tooltip + inline mode works
- [ ] Tooltip + panel mode works
- [ ] No memory leaks
- [ ] No performance issues

---

## 11. Conclusion

The old Henji-AI system's PanelTrigger and Tooltip patterns provide excellent UX for managing complex parameter panels. By extending the parameter definition schema and implementing these patterns at the ParamRenderer level, we can:

1. **Maintain configuration-driven architecture** - All behavior defined in model definitions
2. **Improve user experience** - Cleaner UI, helpful tooltips, familiar patterns
3. **Stay backward compatible** - Existing models work without changes
4. **Enable gradual migration** - Add tooltips/panels incrementally

The implementation plan provides a clear path forward with minimal risk and maximum benefit.

---

## Appendix A: File Locations

### Old System
- `old-Henji-AI/src/components/ui/PanelTrigger.tsx`
- `old-Henji-AI/src/components/ui/Tooltip.tsx`
- `old-Henji-AI/src/components/ui/SchemaForm.tsx`
- `old-Henji-AI/src/components/ui/Dropdown.tsx`
- `old-Henji-AI/src/index.css` (animations)

### New System
- `src/components/ui/PanelTrigger.tsx` (verify)
- `src/components/ui/Tooltip.tsx` (verify)
- `src/components/params/ParamRenderer.tsx` (update)
- `src/components/params/ParamWrapper.tsx` (create)
- `src/components/params/base/*.tsx` (update all)
- `src/core/types/ParamDef.ts` (extend)

---

## Appendix B: Animation CSS

Add to `src/index.css` if not already present:

```css
/* Scale animations for panels */
@keyframes scaleIn {
  from {
    opacity: 0;
    transform: scale(0.95);
  }
  to {
    opacity: 1;
    transform: scale(1);
  }
}

@keyframes scaleOut {
  from {
    opacity: 1;
    transform: scale(1);
  }
  to {
    opacity: 0;
    transform: scale(0.95);
  }
}

.animate-scale-in {
  animation: scaleIn 0.2s ease-out forwards;
}

.animate-scale-out {
  animation: scaleOut 0.2s ease-out forwards;
}

/* Fade animations for tooltips */
@keyframes fadeIn {
  from {
    opacity: 0;
  }
  to {
    opacity: 1;
  }
}

@keyframes fadeOut {
  from {
    opacity: 1;
  }
  to {
    opacity: 0;
  }
}

.animate-fade-in {
  animation: fadeIn 0.3s ease-out forwards;
}

.animate-fade-out {
  animation: fadeOut 0.3s ease-out forwards;
}
```
