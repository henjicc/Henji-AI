import { useSyncExternalStore } from 'react'
import { UiLoading } from '@/components/ui'
import { ProgressBar } from '@/components/ui/ProgressBar'
import { subscribeVideoEditCodePreparation, videoEditCodePreparationProgress } from '../application/videoEditCodeState'

/** 打开项目期间盖住项目列表：说明正在打开哪个项目；检查代码素材较慢时显示进度。 */
export function VideoEditOpeningOverlay({ name }: { name: string }): JSX.Element {
  const progress = useSyncExternalStore(subscribeVideoEditCodePreparation, videoEditCodePreparationProgress)
  return <div className="absolute inset-0 z-sticky flex items-center justify-center bg-window" data-video-edit-opening>
    <UiLoading message={progress ? `正在检查代码素材 ${progress.done}/${progress.total}` : `正在打开「${name}」…`}>
      {progress && <ProgressBar className="mt-3 w-64" progress={progress.done / progress.total * 100} showPercentage={false} />}
    </UiLoading>
  </div>
}
