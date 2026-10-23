import { v4 as uuidv4 } from 'uuid'
import type { ApplicationCollectionExecutor, ApplicationCompletedStepResult, ApplicationEvidence, ApplicationPlannedStep } from '@/core/application-control'
import { createLogger } from '@/core/logging'
import { getPlatform } from '@/platform'

type CollectionStep = Extract<ApplicationPlannedStep, { kind: 'collection' }>

export const WEB_RECORDING_TYPE = 'screen_recording.web_recording'
export const WEB_RECORDING_LIBRARY_TYPE = 'screen_recording.web_recording_library'
const logger = createLogger('features.screenRecording.web_recording_collection')
const undoRecords = new Map<string, string[]>()

/**
 * Deleting web recordings through the generic collection verb. A deleted recording moves to the
 * trash folder beside the recordings, so compensation and undo restore it under the same id.
 * The same service backs the recording page's delete button.
 */
export class WebRecordingCollectionExecutor implements ApplicationCollectionExecutor {
  readonly entityType = WEB_RECORDING_TYPE
  readonly effectContract = { direct: [], cascades: [] }

  async apply(step: CollectionStep): Promise<ApplicationCompletedStepResult> {
    if (step.parent.kind !== WEB_RECORDING_LIBRARY_TYPE || step.parent.id !== 'default') throw new Error(`WEB_RECORDING_LIBRARY_REF_INVALID：网页录制只能在 ${WEB_RECORDING_LIBRARY_TYPE}/default 下删除。`)
    if (step.operation.kind === 'create') throw new Error('WEB_RECORDING_CREATE_UNSUPPORTED：网页录制由 start_web_app_recording 与 stop_web_app_recording 产生，不能直接新建。')
    const ids = step.operation.targets.map(target => {
      if (target.kind !== WEB_RECORDING_TYPE) throw new Error(`WEB_RECORDING_REF_INVALID：删除目标必须是 ${WEB_RECORDING_TYPE} 引用。`)
      return target.id
    })
    const platform = getPlatform().webReplay
    const removed: string[] = []
    try {
      for (const id of ids) { await platform.remove(id); removed.push(id) }
    } catch (error) {
      for (const id of removed.reverse()) await platform.restore(id).catch(rollbackError => logger.error('网页录制删除回滚失败', rollbackError, { event: 'web_replay.collection.rollback.failed', context: { id } }))
      throw error
    }
    const undoToken = `web-recording-collection-undo:${uuidv4()}`
    undoRecords.set(undoToken, removed)
    logger.info('网页录制已删除', { event: 'web_replay.collection.removed', context: { count: removed.length } })
    return {
      status: 'completed',
      resultingRevisions: { screen_recording: 0 },
      directRefs: removed.map(id => ({ kind: WEB_RECORDING_TYPE, id, revision: 0 })),
      evidence: [{
        kind: 'operation_result', target: { kind: WEB_RECORDING_LIBRARY_TYPE, id: 'default', revision: 0 },
        fact: `已删除 ${removed.length} 段网页录制（可撤销）。`, data: { operation: 'remove', itemCount: removed.length }, capturedAt: new Date().toISOString(),
      }],
      undoToken,
    }
  }

  async compensate(_step: CollectionStep, result: ApplicationCompletedStepResult): Promise<ApplicationEvidence[]> {
    return result.undoToken ? (await this.undo(result.undoToken)).evidence : []
  }

  async undo(undoToken: string): Promise<ApplicationCompletedStepResult> {
    const ids = undoRecords.get(undoToken)
    if (!ids) throw new Error('WEB_RECORDING_COLLECTION_UNDO_NOT_FOUND')
    for (const id of ids) await getPlatform().webReplay.restore(id)
    undoRecords.delete(undoToken)
    return {
      status: 'completed', resultingRevisions: { screen_recording: 0 },
      directRefs: ids.map(id => ({ kind: WEB_RECORDING_TYPE, id, revision: 0 })),
      evidence: [{ kind: 'entity_state', target: { kind: WEB_RECORDING_LIBRARY_TYPE, id: 'default', revision: 0 }, fact: '网页录制删除已撤销。', capturedAt: new Date().toISOString() }],
    }
  }
}
