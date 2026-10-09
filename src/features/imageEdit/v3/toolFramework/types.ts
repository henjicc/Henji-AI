import type { ComponentType, ReactNode } from 'react'
import type { LucideIcon } from 'lucide-react'
import type { InteractionGesture, InteractionTime } from '@/core/imaging/interaction/contracts'
import type { ImageEditCommandBusV3 } from '../application/imageEditCommandBus'
import type { ImageEditorHostProfileIdV3 } from '../application/imageEditorHostProfiles'
import type { AnnotationOutputGeometryV3 } from '../editor/annotationGeometryV3'
import type { ImageEditorV3Controller } from '../editor/types'
import type { ImageEditDocumentV3 } from '@/core/imageEdit/v3/documentTypes'

/** Each built-in entry augments this map; new tools don't edit a central union. */
export interface ImageEditorToolCatalog {}
export type ImageEditorRegisteredToolId = keyof ImageEditorToolCatalog

export interface ToolContext {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
  time: InteractionTime
  referenceGrid: { width: number; height: number }
}

export interface ToolOptionsProps {
  controller: ImageEditorV3Controller
  bus: ImageEditCommandBusV3
}

export interface ToolOverlayContext extends ToolOptionsProps {
  bindKeyboard: ToolKeyboardBinding
  bindPointerAvailability: ToolPointerAvailabilityBinding
  projectedDocument: ImageEditDocumentV3
  geometry: AnnotationOutputGeometryV3
  stageWidth: number
  stageHeight: number
  resourceByteSizes?: Readonly<Record<string, number>>
  basePreviewDocumentId: string | null
  basePreviewRevision: number | null
}

/** Overlay commands are invoked only after the editor's input policy approves them. */
export type ToolKeyboardHandler = (event: KeyboardEvent) => boolean
export type ToolKeyboardBinding = (slot: string, handler: ToolKeyboardHandler) => () => void
export type ToolPointerAvailabilityBinding = (slot: string, available: () => boolean) => () => void

export interface ToolOverlaySlot {
  id: string
  activeOnly?: boolean
  requiresLayout?: boolean
  resetOnCancel?: boolean
  onCancel?: (context: ToolOptionsProps) => void
  render: (context: ToolOverlayContext) => ReactNode
}

export interface ToolDefinition {
  id: ImageEditorRegisteredToolId
  labelKey: string
  description: string
  aliases: readonly string[]
  icon: LucideIcon
  group: { id: string; order: number; collapsed?: boolean; labelKey?: string; expandedProfiles?: readonly ImageEditorHostProfileIdV3[]; triggerId?: string }
  profiles: readonly ImageEditorHostProfileIdV3[]
  cursor: string
  shortcut?: string
  requiresRasterTarget?: boolean
  Options?: ComponentType<ToolOptionsProps>
  overlays?: readonly ToolOverlaySlot[]
  /** Legacy adapter receives only input authorized by the capture router. */
  input: 'navigation' | 'move' | 'overlay'
  createGesture?: (context: ToolContext) => InteractionGesture
  legacyFinalMove?: boolean
}
