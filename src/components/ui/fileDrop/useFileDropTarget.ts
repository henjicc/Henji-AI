import { useCallback, useEffect, useRef, useState, type DragEvent } from 'react'

import { HENJI_DRAG_DATA_MIME, readHenjiDragData } from '@/contexts/dragDataTransfer'
import { getPathForFile } from '@/platform/desktopApi'

/** 拖进来的一项：系统文件带 File；从资产库、生成记录拖来的只有本机路径。 */
export interface DroppedFileItem {
  path: string
  name: string
  file?: File
}

export interface FileDropTargetOptions {
  /** 判断拖进来的一项收不收；不传表示什么文件都收。常用写法见 services/localMediaImport 的 acceptsFileAttribute。 */
  accept?: (item: { name: string; mimeType: string }) => boolean
  /** 只收一个时取第一个合格的。 */
  multiple?: boolean
  disabled?: boolean
  /** 调用方要的是 File 对象（直接读内容）时设为 true：只收系统文件，资产库里拖来的不接。 */
  filesOnly?: boolean
  onDropFiles: (items: DroppedFileItem[]) => void
}

export interface FileDropTarget {
  /** 拖着合格的东西停在上面：用来画落点高亮。 */
  isDragOver: boolean
  dropProps: {
    onDragEnter: (event: DragEvent) => void
    onDragOver: (event: DragEvent) => void
    onDragLeave: () => void
    onDrop: (event: DragEvent) => void
  }
}

function carriesDroppable(event: DragEvent, filesOnly: boolean): boolean {
  const types = Array.from(event.dataTransfer?.types ?? [])
  return types.includes('Files') || (!filesOnly && types.includes(HENJI_DRAG_DATA_MIME))
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path
}

/**
 * 能上传的地方都能拖进来：系统文件，以及从资产库、生成记录拖来的素材，走同一个入口。
 * 点选上传与拖放调用同一个回调，调用点只多写一行 `{...dropProps}`。
 */
export function useFileDropTarget({ accept, multiple = false, disabled = false, filesOnly = false, onDropFiles }: FileDropTargetOptions): FileDropTarget {
  const [isDragOver, setIsDragOver] = useState(false)
  const depth = useRef(0)
  // 嵌套时里层接住文件会拦冒泡，外层收不到放下：高亮期间在窗口捕获阶段听放下与拖动结束，统一复位
  useEffect(() => {
    if (!isDragOver) return undefined
    const reset = (): void => { depth.current = 0; setIsDragOver(false) }
    window.addEventListener('drop', reset, true)
    window.addEventListener('dragend', reset, true)
    return () => {
      window.removeEventListener('drop', reset, true)
      window.removeEventListener('dragend', reset, true)
    }
  }, [isDragOver])

  // 进入、经过、离开都不拦冒泡：外层（画布、全局“正在拖文件”的计数）要看到成对的进出；
  // 只有真的收下了才在放下时拦住，收不下的交给外层照常处理
  const onDragEnter = useCallback((event: DragEvent) => {
    if (disabled || !carriesDroppable(event, filesOnly)) return
    event.preventDefault()
    depth.current += 1
    setIsDragOver(true)
  }, [disabled, filesOnly])
  const onDragOver = useCallback((event: DragEvent) => {
    if (disabled || !carriesDroppable(event, filesOnly)) return
    event.preventDefault()
    event.dataTransfer.dropEffect = 'copy'
  }, [disabled, filesOnly])
  // 离开不看 disabled：拖到一半变成不可用时计数也要归零，否则高亮会留着
  const onDragLeave = useCallback(() => {
    if (depth.current === 0) return
    depth.current -= 1
    if (depth.current === 0) setIsDragOver(false)
  }, [])
  const onDrop = useCallback((event: DragEvent) => {
    depth.current = 0
    setIsDragOver(false)
    if (disabled || !carriesDroppable(event, filesOnly)) return
    const files: DroppedFileItem[] = Array.from(event.dataTransfer.files ?? []).map((file) => ({ file, name: file.name, path: getPathForFile(file) }))
    const henji = files.length === 0 && !filesOnly ? readHenjiDragData(event.dataTransfer) : null
    // 资产库与生成记录的显示名可能没有扩展名，按路径判断格式
    const items = henji?.filePath
      ? [{ path: henji.filePath, name: henji.displayName ?? basename(henji.filePath) }]
      : files
    const accepted = items.filter((item) => (filesOnly || item.path)
      && (!accept || accept({ name: item.file ? item.name : item.path, mimeType: item.file?.type ?? '' })))
    if (accepted.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    onDropFiles(multiple ? accepted : accepted.slice(0, 1))
  }, [accept, disabled, filesOnly, multiple, onDropFiles])

  return { isDragOver, dropProps: { onDragEnter, onDragOver, onDragLeave, onDrop } }
}
