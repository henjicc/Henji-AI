import type { ImageEditNodeData } from '../domain/canvasNodes'
import type { MultiAngleBatchSnapshotV1 } from './multiAngleBatchService'
import type { MultiAngleConfigV1 } from '../capabilities/multiAnglePolicy'
import type { RelightSettingsV1 } from '../capabilities/relightPolicy'

export interface MultiAngleGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.multi-angle'
  multiAngleConfig: MultiAngleConfigV1
  multiAngleBatch?: MultiAngleBatchSnapshotV1 | null
  multiAngleResultPlaceholderId?: string | null
  sourceImageUrl?: string | null
}

export interface RelightGenerationNodeData extends ImageEditNodeData {
  capabilityId: 'image.relight'
  relightSettings: RelightSettingsV1
  promptTemplateVersion: string
  lightingReferenceImages: string[]
  relightRouteReasons?: string[]
  sourceImageUrl?: string | null
}

