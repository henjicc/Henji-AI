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
import type { ApplicationDomainModule } from './domainModule'
import { configureImageEditDocumentProjectionResolverV3 } from '@/features/imageEdit/v3/application/imageEditDocumentBindings'
import { resolveCanvasImageEditDocumentProjection } from '@/features/canvas/application/imageEditDocumentProjectionBinding'

configureImageEditDocumentProjectionResolverV3(resolveCanvasImageEditDocumentProjection)

export const APPLICATION_DOMAINS: readonly ApplicationDomainModule[] = [
  canvasApplicationDomain,
  cameraStageApplicationDomain,
  assetsApplicationDomain,
  imageEditApplicationDomain,
  imageMarkApplicationDomain,
  generationApplicationDomain,
  settingsApplicationDomain,
  toolboxApplicationDomain,
  memoryApplicationDomain,
  navigationApplicationDomain,
]
