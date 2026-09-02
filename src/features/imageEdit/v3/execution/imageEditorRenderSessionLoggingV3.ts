import { createLogger } from '@/core/logging'
import type { ImageEditorRenderSnapshotV3 } from './imageEditorRenderSessionContractsV3'

const logger = createLogger('image_editor_v3.render_session')

export function logImageEditorRenderSessionPhaseV3(
  phase: 'draft' | 'backdrop' | 'analysis' | 'target',
  snapshot: ImageEditorRenderSnapshotV3,
  cameraSequence: number,
  startedAt: number,
  completedAt: number,
  mip: number,
): void {
  logger.debug('图片编辑显示阶段完成', {
    event: 'image_editor_v3.render_session.phase.completed',
    context: {
      documentId: snapshot.document.id,
      renderGeneration: snapshot.renderGeneration,
      cameraSequence,
      phase,
      mip,
      durationMs: Math.max(0, Math.round(completedAt - startedAt)),
    },
  })
}
