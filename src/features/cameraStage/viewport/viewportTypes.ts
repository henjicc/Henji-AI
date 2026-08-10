/**
 * 四窗格的默认布局按**这个工具是干什么的**来定，不照抄建模软件。
 *
 * Maya / Blender / 3ds Max 的默认四视图是 顶 / 正 / 侧 / 透视——那是为建模服务的：三个正交
 * 视图各锁一个轴，用来对齐点线面。但这里是**运镜工具**，产出物是"镜头里看到的画面"，正交
 * 视图再多也答不了"这一帧好不好看"。所以右上角换成摄像机视角，和左上角的自由透视并排：
 * 左边调场面调度，右边直接看成片构图。
 *
 * 砍掉的是右视图而不是顶视图：顶视图管地面上的走位与距离，是运镜里真正常用的一张；
 * 正视图管高度；X 轴的信息在自由透视里已经够读了。
 */
export const STAGE_VIEWPORT_IDS = ['perspective', 'camera', 'top', 'front'] as const

export type StageViewportId = typeof STAGE_VIEWPORT_IDS[number]
export type StageFixedView = 'top' | 'bottom' | 'front' | 'back' | 'left' | 'right'

export type StageViewportSource =
  | { kind: 'director' }
  | { kind: 'fixed'; view: StageFixedView }
  /**
   * 跟随当前活动摄像机，不绑定具体 id。
   *
   * 这一档存在的理由是**视口配置持久化在本机、而摄像机 id 属于工程**：绑死 id 之后换一个
   * 工程，那个 id 就不存在了，窗格只能退回自由透视——于是四窗格里出现两个一模一样的透视画面。
   * 跟随活动机位则天然跨工程成立，摄像机被删、被换、被重命名都不受影响。
   */
  | { kind: 'active_camera' }
  | { kind: 'camera'; cameraId: string }

export interface StageViewportConfig {
  id: StageViewportId
  source: StageViewportSource
}

export const DEFAULT_STAGE_VIEWPORTS: Record<StageViewportId, StageViewportConfig> = {
  perspective: { id: 'perspective', source: { kind: 'director' } },
  camera: { id: 'camera', source: { kind: 'active_camera' } },
  top: { id: 'top', source: { kind: 'fixed', view: 'top' } },
  front: { id: 'front', source: { kind: 'fixed', view: 'front' } },
}

export function cloneDefaultStageViewports(): Record<StageViewportId, StageViewportConfig> {
  return structuredClone(DEFAULT_STAGE_VIEWPORTS)
}
