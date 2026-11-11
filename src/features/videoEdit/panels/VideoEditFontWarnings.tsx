import { memo, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Virtuoso } from 'react-virtuoso'
import { UI_DROP_TARGET_OVERLAY_CLASS, UiButton, UiError, useFileDropTarget } from '@/components/ui'
import type { VideoEditComposition, VideoEditDocument } from '@/core/videoEdit/document'
import { missingVideoEditFonts, type VideoEditFontUse } from '@/core/videoEdit/fonts'
import { fontLibrarySnapshot, importFonts, isFontFilePath, loadFontLibrary, subscribeFontLibrary } from '@/platform/fonts'
import { videoEditFontUses } from '../application/videoEditFonts'
import { createLogger } from '@/core/logging'
const logger = createLogger('features.videoEdit.fonts')
export const VideoEditFontWarnings = memo(function VideoEditFontWarnings({ document: project }: { document: VideoEditDocument | VideoEditComposition }): React.ReactElement | null {
  const library = useSyncExternalStore(subscribeFontLibrary, fontLibrarySnapshot)
  const [uses, setUses] = useState<VideoEditFontUse[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [retry, setRetry] = useState(0)
  const logged = useRef('')
  useEffect(() => {
    let active = true
    void Promise.all([loadFontLibrary(), videoEditFontUses(project)]).then(([, value]) => { if (active) setUses(value) }, reason => { if (active) setError(reason instanceof Error ? reason.message : '无法检查工程字体。') })
    return () => { active = false }
  }, [project, retry])
  const missing = useMemo(() => missingVideoEditFonts(uses, library.faces), [uses, library.faces])
  const runImport = (paths?: readonly string[]): void => { setBusy(true); void importFonts(paths).catch(reason => setError(reason instanceof Error ? reason.message : '字体导入失败。')).finally(() => setBusy(false)) }
  // 缺的字体文件直接拖到提示上就导入
  const fontDrop = useFileDropTarget({ multiple: true, disabled: busy, accept: ({ name }) => isFontFilePath(name), onDropFiles: items => runImport(items.map(item => item.path)) })
  const key = JSON.stringify(missing)
  useEffect(() => { const identity = `${project.id}:${key}`; if (logged.current === identity) return; logged.current = identity; if (missing.length) logger.warn('工程字体缺失', { event: 'video_edit.fonts.missing', context: { documentId: project.id, fonts: missing } }) }, [key, missing, project.id])
  if (error || library.error) return <UiError size="xs" align="start" title="字体检查未完成" message={error || library.error} onRetry={() => { setError(''); setRetry(value => value + 1); void loadFontLibrary(true).catch(() => undefined) }} />
  if (!missing.length) return null
  const row = (font: (typeof missing)[number]): React.ReactElement => <p className="text-xs text-text2">缺少“{font.font}”，将用{font.fallback}；影响：{font.uses.map(use => use.label).join('、')}</p>
  return <div role="status" className="relative flex flex-col gap-2 px-3 py-2" data-video-edit-font-warnings {...fontDrop.dropProps}>
    {fontDrop.isDragOver ? <div aria-hidden="true" className={UI_DROP_TARGET_OVERLAY_CLASS} /> : null}
    {missing.length > 6 ? <Virtuoso className="h-32" data={missing} itemContent={(_index, font) => row(font)} /> : missing.map(font => <div key={font.font}>{row(font)}</div>)}
    <UiButton size="sm" disabled={busy} onClick={() => runImport()}>导入缺失字体</UiButton>
  </div>
})
