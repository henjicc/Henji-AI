import { canvasApplicationDomain } from '@/features/canvas/application/applicationDomain'
import { cameraStageApplicationDomain } from '@/features/cameraStage/application/applicationDomain'
import { assetsApplicationDomain } from '@/features/assets/application/applicationDomain'
import { imageEditApplicationDomain } from '@/features/imageEdit/application/applicationDomain'
import { imageMarkApplicationDomain } from '@/features/imageMark/application/applicationDomain'
import { generationApplicationDomain } from '@/features/generation/application/applicationDomain'
import { settingsApplicationDomain } from '@/features/settings/application-control/applicationDomain'
import { toolboxApplicationDomain } from '@/features/toolbox/application/applicationDomain'
import { memoryApplicationDomain } from '@/features/assistant/application/applicationDomain'
import { navigationApplicationDomain } from '@/features/navigation/application/applicationDomain'
import { audioEditApplicationDomain } from '@/features/audioEdit/application/applicationDomain'
import { videoEditApplicationDomain } from '@/features/videoEdit/application/applicationDomain'
import { documentsApplicationDomain } from '@/features/documents/application/applicationDomain'
import { localModelsApplicationDomain } from '@/features/localModels/application/applicationDomain'
import type { ApplicationDomainModule } from './domainModule'
import { configureImageEditDocumentProjectionResolverV3 } from '@/features/imageEdit/v3/application/imageEditDocumentBindings'
import { resolveCanvasImageEditDocumentProjection } from '@/features/canvas/application/imageEditDocumentProjectionBinding'

/** 由应用注册/反射装配点调用；仅导入领域目录不配置跨域绑定。 */
export function initializeApplicationDomainBindings(): void {
  configureImageEditDocumentProjectionResolverV3(resolveCanvasImageEditDocumentProjection)
}

export const APPLICATION_DOMAINS: readonly ApplicationDomainModule[] = [
  canvasApplicationDomain,
  cameraStageApplicationDomain,
  assetsApplicationDomain,
  imageEditApplicationDomain,
  imageMarkApplicationDomain,
  generationApplicationDomain,
  settingsApplicationDomain,
  toolboxApplicationDomain,
  audioEditApplicationDomain,
  videoEditApplicationDomain,
  documentsApplicationDomain,
  localModelsApplicationDomain,
  memoryApplicationDomain,
  navigationApplicationDomain,
]
