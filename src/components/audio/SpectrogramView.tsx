import React from 'react'
import { SPECTROGRAM_COLORMAP_HEX } from '@/core/theme/colorTokens'
import { buildSpectrogramLut, rasterizeSpectrogram, type SpectrogramData, type SpectrogramScale } from '@/core/audio/spectrogram'
import { createSpectrogramGl, type SpectrogramGl } from './spectrogramGl'
import { createLogger } from '@/core/logging'

const logger = createLogger('components.audio.spectrogram')

let sharedLut: Uint8ClampedArray | undefined
const spectrogramLut = (): Uint8ClampedArray => (sharedLut ??= buildSpectrogramLut(SPECTROGRAM_COLORMAP_HEX))

export interface SpectrogramViewProps {
  data?: SpectrogramData
  /** 自上而下画哪些声道，每个声道各占一行；默认全部。 */
  lanes?: readonly number[]
  /** 可见区间（源采样帧）。 */
  startFrame: number
  endFrame: number
  minHz: number
  maxHz: number
  scale?: SpectrogramScale
  /** 亮度补偿（u8 读数加多少），让安静素材也看得清。 */
  boost?: number
  className?: string
  label?: string
}

/**
 * 频谱图（声音能量随时间与频率的分布）。只负责绘制；选区、画笔与缩放等交互由宿主叠在上面。
 * GPU 纹理仅随数据更新；设备丢失时用独立的二维画布回退，原画布保留以接收恢复事件。
 */
export const SpectrogramView = React.memo(function SpectrogramView({ data, lanes, startFrame, endFrame, minHz, maxHz, scale = 'log', boost, className, label }: SpectrogramViewProps) {
  const host = React.useRef<HTMLDivElement | null>(null)
  const canvas = React.useRef<HTMLCanvasElement | null>(null)
  const fallback = React.useRef<HTMLCanvasElement | null>(null)
  const renderer = React.useRef<SpectrogramGl | null>(null)
  const [cpu, setCpu] = React.useState(false)
  const [generation, setGeneration] = React.useState(0)
  const buffer = React.useRef<Uint8ClampedArray | undefined>(undefined)
  const [size, setSize] = React.useState({ width: 0, height: 0 })
  const pixelRatio = typeof window === 'undefined' ? 1 : Math.max(1, window.devicePixelRatio || 1)
  const laneKey = lanes?.join(',') ?? ''

  React.useLayoutEffect(() => {
    const element = canvas.current
    if (!element) return
    const initialize = (): void => {
      try {
        const gl = element.getContext('webgl2', { antialias: false, alpha: false, depth: false, stencil: false })
        if (!gl) { setCpu(true); return }
        renderer.current = createSpectrogramGl(gl, spectrogramLut())
        setCpu(false); setGeneration(value => value + 1)
      } catch (error) { logger.warn('频谱绘制回退到 CPU', { event: 'spectrogram.gpu.failed', error }); setCpu(true) }
    }
    const lost = (event: Event): void => { event.preventDefault(); renderer.current = null; setCpu(true) }
    const restored = (): void => initialize()
    element.addEventListener('webglcontextlost', lost)
    element.addEventListener('webglcontextrestored', restored)
    initialize()
    return () => {
      element.removeEventListener('webglcontextlost', lost); element.removeEventListener('webglcontextrestored', restored)
      renderer.current?.dispose(); renderer.current = null
    }
  }, [])

  React.useLayoutEffect(() => {
    const element = host.current
    if (!element) return
    const measure = (): void => {
      const rect = element.getBoundingClientRect()
      setSize(previous => previous.width === rect.width && previous.height === rect.height ? previous : { width: rect.width, height: rect.height })
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    let frame = 0
    const observer = new ResizeObserver(() => { cancelAnimationFrame(frame); frame = requestAnimationFrame(measure) })
    observer.observe(element)
    return () => { observer.disconnect(); cancelAnimationFrame(frame) }
  }, [])

  React.useLayoutEffect(() => {
    const frame = requestAnimationFrame(() => {
      const element = cpu ? fallback.current : canvas.current
      if (!element || size.width <= 0 || size.height <= 0) return
      const width = Math.max(1, Math.round(size.width * pixelRatio))
      const height = Math.max(1, Math.round(size.height * pixelRatio))
      if (element.width !== width) element.width = width
      if (element.height !== height) element.height = height
      const context = cpu ? element.getContext('2d') : null
      const gpu = cpu ? null : renderer.current
      if (!context && !gpu) return
      if (!data || !(endFrame > startFrame)) { context?.clearRect(0, 0, width, height); gpu?.clear(); element.dataset.spectrogramState = 'empty'; return }
      const channels = lanes ?? Array.from({ length: data.channelCount }, (_, index) => index)
      const laneHeight = Math.max(1, Math.floor(height / Math.max(1, channels.length)))
      const lut = spectrogramLut()
      try { gpu?.upload(data) } catch (error) { logger.warn('频谱纹理上传失败', { event: 'spectrogram.upload.failed', error }); gpu?.dispose(); renderer.current = null; setCpu(true); return }
      channels.forEach((channel, lane) => {
        const rows = lane === channels.length - 1 ? height - laneHeight * lane : laneHeight
        if (rows <= 0) return
        if (gpu) { gpu.draw({ channel, startFrame, endFrame, width, height: rows, minHz, maxHz, scale, boost }, height - laneHeight * lane - rows); return }
        const pixels = rasterizeSpectrogram(data, { channel, startFrame, endFrame, width, height: rows, minHz, maxHz, scale, boost }, lut,
          channels.length === 1 ? buffer.current : undefined)
        if (channels.length === 1) buffer.current = pixels
        context?.putImageData(new ImageData(pixels as Uint8ClampedArray<ArrayBuffer>, width, rows), 0, laneHeight * lane)
      })
      element.dataset.spectrogramState = 'ready'
    })
    return () => cancelAnimationFrame(frame)
  // eslint-disable-next-line react-hooks/exhaustive-deps -- laneKey stands for the lanes array
  }, [size, pixelRatio, data, laneKey, startFrame, endFrame, minHz, maxHz, scale, boost, cpu, generation])

  return <div ref={host} className={`relative h-full min-w-0 bg-media ${className ?? ''}`}>
    <canvas ref={canvas} className={cpu ? 'hidden' : 'block h-full w-full'} data-spectrogram-state={cpu ? undefined : 'empty'} {...(label && !cpu ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />
    <canvas ref={fallback} className={cpu ? 'block h-full w-full' : 'hidden'} data-spectrogram-state={cpu ? 'empty' : undefined} {...(label && cpu ? { role: 'img', 'aria-label': label } : { 'aria-hidden': true })} />
  </div>
})
