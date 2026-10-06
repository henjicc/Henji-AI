import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'

import { AlertDialog } from '@/components/ui'
import type { VideoEditCreativeSource } from '@/core/videoEdit/creativeResult'
import { openDialog } from '@/platform/desktopApi'
import { openVideoEditClipSource, relocateVideoEditClipSource } from '../application/videoEditComposition'

/*
 * 片段“回到来源继续编辑”的界面入口（4.1）：时间线右键与双击共用。
 * 来源找到了就打开（嵌入模式，定位到部位）；文档找不到时提示并可“重新定位…”到同一类型的另一份文件，
 * 剪辑里引用原文档的片段一并改写后再打开；生成记录找不到时只能提示。
 */

interface MissingSource {
  projectId: string
  clipId: string
  source: VideoEditCreativeSource
  extension: string | null
}

function fileNameOf(filePath: string): string {
  return filePath.slice(Math.max(filePath.lastIndexOf('/'), filePath.lastIndexOf('\\')) + 1)
}

export function useVideoEditClipSource(onError: (error: unknown) => void): { open: (projectId: string, clipId: string) => void; dialog: React.ReactNode } {
  const { t } = useTranslation('ui')
  const [missing, setMissing] = useState<MissingSource | null>(null)

  const open = useCallback((projectId: string, clipId: string): void => {
    void openVideoEditClipSource(projectId, clipId)
      .then((outcome) => { if (outcome.status === 'missing') setMissing({ projectId, clipId, ...outcome }) })
      .catch(onError)
  }, [onError])

  const relocate = useCallback(async (pending: MissingSource): Promise<void> => {
    if (pending.source.type !== 'document' || !pending.extension) return
    const selected = await openDialog({ multiple: false, filters: [{ name: t('videoEditProject.source.fileFilter'), extensions: [pending.extension.slice(1)] }] })
    const picked = typeof selected === 'string' ? selected : Array.isArray(selected) ? selected[0] : null
    if (!picked) return
    await relocateVideoEditClipSource(pending.projectId, pending.source.docRef.docId, picked)
    const outcome = await openVideoEditClipSource(pending.projectId, pending.clipId)
    if (outcome.status === 'missing') setMissing({ projectId: pending.projectId, clipId: pending.clipId, ...outcome })
  }, [t])

  const dialog = missing ? (
    <AlertDialog
      isOpen
      type="warning"
      title={t('videoEditProject.source.missingTitle')}
      message={missing.source.type === 'document'
        ? t('videoEditProject.source.missingDocument', { name: fileNameOf(missing.source.docRef.path) })
        : t('videoEditProject.source.missingGeneration')}
      closeLabel={t('videoEditProject.source.cancel')}
      closeImmediately
      onClose={() => setMissing(null)}
      actions={missing.source.type === 'document' && missing.extension ? [{
        label: t('videoEditProject.source.relocate'),
        variant: 'primary',
        onClick: () => {
          const pending = missing
          setMissing(null)
          void relocate(pending).catch(onError)
        },
      }] : []}
    />
  ) : null

  return { open, dialog }
}
