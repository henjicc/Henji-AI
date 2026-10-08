import { z } from 'zod'

import type { DocumentKindDescriptor } from './registry'

/*
 * 镜头参考（`.henji-stage`，3.2 镜头参考接入，工具接入的样板）。
 * 可以独立存放（作品目录“镜头参考”文件夹），也可以放进项目。
 *
 * 内容 = 三维场景的持久部分（内存形态，位置都是绝对路径）：
 * - objects：场景对象（几何体、角色、摄像机），每项至少有 id / type / name；
 * - activeCameraId：当前取景摄像机；
 * - sceneSettings：地面、天空（含全景环境图路径）、阳光、雾、渲染方式、标签显示；
 * - stateKeyframes：状态关键帧，唯一可编辑的时间轴真相源（派生动画只在运行时编译，不进文件）。
 *
 * 这里只校验外层结构，对象、关键帧与场景设置的细节由工具读取时逐字段规范化
 * （`sceneFromDocumentContent`，与旧工程数据的读取规则相同）。嵌套对象一律保留未知字段：
 * 主进程保存时持久化的是 schema 解析结果，剥掉字段就等于丢数据。
 *
 * 本文件主进程与渲染层共用，只用相对导入（不依赖界面颜色令牌等渲染层模块），
 * 所以“空内容”是一份什么都没有的场景：工具打开空场景时自己补上默认摄像机与第一张状态关键帧。
 */

const stageObjectSchema = z.looseObject({
  id: z.string().min(1),
  type: z.enum(['primitive', 'character', 'camera']),
  name: z.string(),
})

const stateKeyframeSchema = z.looseObject({
  id: z.string().min(1),
})

export const cameraStageContentSchema = z.object({
  objects: z.array(stageObjectSchema),
  activeCameraId: z.string().nullable(),
  /** 场景级设置；缺字段或不合法时工具按默认值补齐。 */
  sceneSettings: z.record(z.string(), z.unknown()),
  stateKeyframes: z.array(stateKeyframeSchema),
})

export type CameraStageDocumentContent = z.infer<typeof cameraStageContentSchema>

/** 场景里引用了图片的唯一位置：天空的全景环境图。 */
function environmentImageOf(content: CameraStageDocumentContent): unknown {
  const sky = content.sceneSettings.sky
  return sky && typeof sky === 'object' ? (sky as Record<string, unknown>).environmentImageUrl : null
}

/**
 * 空内容：除了（最多）一台摄像机外没有任何对象，状态关键帧不超过一张，也没有全景环境图。
 * 新建后只是挪了挪摄像机、改了改天空颜色的草稿离开时直接删除，不询问。
 */
function isEmptyCameraStageContent(content: CameraStageDocumentContent): boolean {
  const cameras = content.objects.filter((object) => object.type === 'camera').length
  const others = content.objects.length - cameras
  const environmentImage = environmentImageOf(content)
  return others === 0
    && cameras <= 1
    && content.stateKeyframes.length <= 1
    && !(typeof environmentImage === 'string' && environmentImage.trim().length > 0)
}

export const cameraStageDocumentKind: DocumentKindDescriptor<CameraStageDocumentContent> = {
  id: 'camera_stage',
  extension: '.henji-stage',
  standaloneFolderNames: { zh: '镜头参考', en: 'Camera Stages' },
  untitledNames: { zh: '未命名镜头参考', en: 'Untitled Camera Stage' },
  storage: 'json',
  // 版本 1 = 旧工程场景数据第 14 版的持久字段（去掉 schemaVersion，由外壳的 kindVersion 表达）。
  version: 1,
  contentSchema: cameraStageContentSchema,
  migrations: {},
  createEmptyContent: () => ({ objects: [], activeCameraId: null, sceneSettings: {}, stateKeyframes: [] }),
  isEmptyContent: isEmptyCameraStageContent,
  summarize: (content) => ({
    objects: content.objects.length,
    stateKeyframes: content.stateKeyframes.length,
  }),
}
