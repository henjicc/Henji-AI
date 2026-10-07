import { useState } from 'react'
import { UiButton, UiEmpty } from '@/components/ui'
import { VideoEditSequenceFrameRateRequired, type VideoEditSequenceSettings } from '@/core/videoEdit/projectItems'
import { acceptsVideoEditDrop, dropVideoEditInput, readVideoEditDrop, type VideoEditDropInput } from '../application/videoEditDrop'
import { appendVideoEditSequence, listVideoEditInstances, requireVideoEditInstance, switchVideoEditSequence, type VideoEditInstance } from '../application/videoEditService'
import { VideoEditSequenceDialog } from './VideoEditSequenceDialog'

/** 零时间线仍是正式拖放目标；规格确认与素材落位都委托现有领域入口。 */
export function VideoEditEmptyTimeline({ instance, onError }: { instance: VideoEditInstance; onError: (error: unknown) => void }): React.ReactElement {
  const [dialog, setDialog] = useState<{ input?: VideoEditDropInput; settings: VideoEditSequenceSettings } | null>(null)
  const projectId = instance.document.id
  const drop = (input: VideoEditDropInput, settings?: VideoEditSequenceSettings): Promise<string[]> => {
    if (requireVideoEditInstance(projectId) !== instance || instance.document.sequences.length) return Promise.reject(new Error('原剪辑或序列已改变，请重新拖入。'))
    return dropVideoEditInput(projectId, input, { frame: 0 }, undefined, { sequenceSettings: settings })
  }
  return <div role="region" aria-label="时间线编辑区域" data-video-edit-timeline data-video-edit-timeline-viewport tabIndex={0} className="flex h-full min-h-0 flex-1 flex-col bg-panel"
    onDragOver={event => { if (acceptsVideoEditDrop(event.dataTransfer)) { event.preventDefault(); event.dataTransfer.dropEffect = 'copy' } }}
    onDrop={event => {
      if (!acceptsVideoEditDrop(event.dataTransfer)) return
      event.preventDefault(); event.stopPropagation()
      try {
        const input = readVideoEditDrop(event.dataTransfer)
        void drop(input).catch(error => { if (error instanceof VideoEditSequenceFrameRateRequired && listVideoEditInstances().includes(instance) && !instance.document.sequences.length) setDialog({ input, settings: error.settings }); else onError(error) })
      } catch (error) { onError(error) }
    }}>
    <UiEmpty className="h-full" title="还没有序列" action={<UiButton variant="primary" onClick={() => setDialog({ settings: { name: '序列 1' } })}>新建序列</UiButton>} />
    {dialog && <VideoEditSequenceDialog title="新建序列" initial={dialog.settings} requireFrameRate={Boolean(dialog.input)} bins={instance.document.bins} onClose={() => setDialog(null)} onSubmit={async settings => {
      if (dialog.input) await drop(dialog.input, settings)
      else {
        if (requireVideoEditInstance(projectId) !== instance || instance.document.sequences.length) throw new Error('原剪辑或序列已改变，请重新新建。')
        switchVideoEditSequence(projectId, appendVideoEditSequence(projectId, { ...settings, binId: settings.binId || undefined }))
      }
    }} />}
  </div>
}
