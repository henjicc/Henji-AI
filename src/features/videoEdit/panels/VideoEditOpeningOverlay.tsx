import { UiLoading } from '@/components/ui'

/** 仅展示文档打开状态，代码参数由实际消费者按需读取。 */
export function VideoEditOpeningOverlay({ name }: { name: string }): JSX.Element {
  return <div className="absolute inset-0 z-sticky flex items-center justify-center bg-window" data-video-edit-opening>
    <UiLoading message={`正在打开「${name}」…`} />
  </div>
}
