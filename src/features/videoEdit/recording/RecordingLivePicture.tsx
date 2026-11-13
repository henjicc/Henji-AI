import { useEffect, useRef, useState } from 'react'
import { getPlatform } from '@/platform'
import type { VideoFramePortFrameMessage, VideoFramePortReleaseMessage } from '@/platform/contracts/videoFrames'
import { createLogger } from '@/core/logging'

const logger = createLogger('features.videoEdit.recordingLivePicture')

/**
 * 录制中的实时画面：采集进程把缩小的画面画进共享纹理，经显卡帧通道送到这里，按显示器的刷新节奏只画最新的一张，
 * 画完立刻交还（帧由 preload 在主线程关闭）。这次录法给不出实时画面、或还没收到第一张时显示 `fallback`（来源缩略图）。
 */
export function RecordingLivePicture({ sessionId, fallback }: { sessionId: string; fallback: React.ReactNode }): React.ReactElement {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [shown, setShown] = useState(false)

  useEffect(() => {
    const platform = getPlatform()
    let disposed = false, route: string | null = null, port: MessagePort | null = null, frameRequest = 0
    let latest: VideoFramePortFrameMessage | null = null
    const release = (message: VideoFramePortFrameMessage): void => {
      const reply: VideoFramePortReleaseMessage = { type: 'release', frame: message.frame, token: message.token }
      try { port?.postMessage(reply, [message.frame]) } catch { /* 端口已关：帧随通道回收 */ }
    }
    const draw = (): void => {
      frameRequest = 0
      const message = latest, element = canvas.current
      latest = null
      if (!message || !element) return
      const { displayWidth: width, displayHeight: height } = message.frame
      if (element.width !== width || element.height !== height) { element.width = width; element.height = height }
      element.getContext('2d')?.drawImage(message.frame, 0, 0)
      release(message)
      setShown(true)
    }
    void (async () => {
      const channel = await platform.videoFrames.connect()
      if (disposed) { platform.videoFrames.disconnect(channel.route); return }
      route = channel.route; port = channel.port
      port.onmessage = event => {
        const message = event.data as VideoFramePortFrameMessage | null
        if (message?.type !== 'frame' || !message.frame) return
        if (disposed) { release(message); return }
        // 来得比画得快时只留最新的一张。
        if (latest) release(latest)
        latest = message
        frameRequest ||= requestAnimationFrame(draw)
      }
      const size = await platform.screenRecording.capture({ operation: 'preview', sessionId, route })
      if (!size) logger.info('暂时没有实时画面（这次录法给不出，或画面采集正在续录、续好后自动接上），先显示来源缩略图', { event: 'recording.live_picture.unavailable', context: { sessionId } })
    })().catch(error => logger.warn('录制的实时画面没能打开，显示来源缩略图', { event: 'recording.live_picture.failed', error, context: { sessionId } }))
    return () => {
      disposed = true
      cancelAnimationFrame(frameRequest)
      if (latest) release(latest)
      latest = null
      // 录制已经结束时主进程不再认这次会话，关预览的请求被拒无妨：录制收尾时主进程已经停掉了预览。
      if (!route) return
      const closing = route
      void platform.screenRecording.capture({ operation: 'preview', sessionId, route: null }).catch(() => undefined)
      // 刚交还的帧还在端口的消息队列里：等它们送到 preload 关掉，再断开通道。
      setTimeout(() => platform.videoFrames.disconnect(closing), 100)
    }
  }, [sessionId])

  return <>
    {!shown && fallback}
    <canvas ref={canvas} className={shown ? 'max-h-full max-w-full' : 'hidden'} data-recording-live-picture />
  </>
}
