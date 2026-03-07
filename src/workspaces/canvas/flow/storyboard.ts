import { saveBase64ToUploads } from '@/utils/save'
import type { StoryboardFrameItem } from '@/workspaces/canvas/types'

function readRatio(ratio: string): number {
  const [wRaw = '1', hRaw = '1'] = ratio.split(':')
  const w = Number(wRaw)
  const h = Number(hRaw)
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1
  return w / h
}

function resolveDisplayUrl(source: string): string {
  if (source.startsWith('data:') || source.startsWith('blob:') || source.startsWith('http')) {
    return source
  }
  if (source.startsWith('asset:') || source.startsWith('tauri:') || source.startsWith('file:')) {
    return source
  }
  return source
}

async function loadImage(source: string): Promise<HTMLImageElement> {
  const img = new Image()
  const displaySrc = resolveDisplayUrl(source)
  if (displaySrc.startsWith('http://') || displaySrc.startsWith('https://')) {
    img.crossOrigin = 'anonymous'
  }
  return await new Promise((resolve, reject) => {
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error('图片加载失败'))
    img.src = displaySrc
  })
}

export async function splitImageToStoryboardFrames(params: {
  imageUrl: string
  rows: number
  cols: number
}): Promise<StoryboardFrameItem[]> {
  const { imageUrl, rows, cols } = params
  const safeRows = Math.max(1, Math.floor(rows))
  const safeCols = Math.max(1, Math.floor(cols))
  const image = await loadImage(imageUrl)
  const cellW = Math.floor(image.naturalWidth / safeCols)
  const cellH = Math.floor(image.naturalHeight / safeRows)
  const frames: StoryboardFrameItem[] = []

  for (let r = 0; r < safeRows; r += 1) {
    for (let c = 0; c < safeCols; c += 1) {
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, cellW)
      canvas.height = Math.max(1, cellH)
      const ctx = canvas.getContext('2d')
      if (!ctx) continue
      ctx.drawImage(
        image,
        c * cellW,
        r * cellH,
        cellW,
        cellH,
        0,
        0,
        canvas.width,
        canvas.height
      )
      const dataUrl = canvas.toDataURL('image/png')
      const persisted = await saveBase64ToUploads(dataUrl)
      frames.push({
        id: `sf-${Date.now()}-${r}-${c}`,
        imageUrl: persisted.displaySrc,
        filePath: persisted.fullPath,
        note: '',
        order: r * safeCols + c,
      })
    }
  }

  return frames
}

export async function composeStoryboardImage(params: {
  frames: StoryboardFrameItem[]
  rows: number
  cols: number
  frameAspectRatio: string
}): Promise<{ imageUrl: string; filePath: string }> {
  const { frames, rows, cols, frameAspectRatio } = params
  const safeRows = Math.max(1, Math.floor(rows))
  const safeCols = Math.max(1, Math.floor(cols))
  const ratio = readRatio(frameAspectRatio)
  const cellW = 512
  const cellH = Math.max(128, Math.round(cellW / ratio))
  const gap = 8
  const padding = 16
  const titleH = 34

  const canvas = document.createElement('canvas')
  canvas.width = padding * 2 + safeCols * cellW + (safeCols - 1) * gap
  canvas.height = padding * 2 + safeRows * (cellH + titleH) + (safeRows - 1) * gap
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('无法初始化画布')

  ctx.fillStyle = '#10131a'
  ctx.fillRect(0, 0, canvas.width, canvas.height)
  ctx.font = '14px sans-serif'
  ctx.textBaseline = 'middle'

  const sorted = [...frames].sort((a, b) => a.order - b.order)
  for (let idx = 0; idx < Math.min(sorted.length, safeRows * safeCols); idx += 1) {
    const row = Math.floor(idx / safeCols)
    const col = idx % safeCols
    const x = padding + col * (cellW + gap)
    const y = padding + row * (cellH + titleH + gap)
    const frame = sorted[idx]

    if (frame.imageUrl) {
      try {
        const img = await loadImage(frame.imageUrl)
        ctx.drawImage(img, x, y, cellW, cellH)
      } catch {
        ctx.fillStyle = '#1f2937'
        ctx.fillRect(x, y, cellW, cellH)
      }
    } else {
      ctx.fillStyle = '#1f2937'
      ctx.fillRect(x, y, cellW, cellH)
    }

    ctx.fillStyle = '#0b0d12'
    ctx.fillRect(x, y + cellH, cellW, titleH)
    ctx.fillStyle = '#e5e7eb'
    const label = frame.note?.trim() ? `${idx + 1}. ${frame.note.trim()}` : `${idx + 1}.`
    ctx.fillText(label.slice(0, 58), x + 8, y + cellH + titleH / 2)
  }

  const dataUrl = canvas.toDataURL('image/png')
  const persisted = await saveBase64ToUploads(dataUrl)
  return { imageUrl: persisted.displaySrc, filePath: persisted.fullPath }
}
