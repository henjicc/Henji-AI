import { z } from 'zod'
import { SPACE_LIGHT_KINDS } from './spatialSchema'

const vector3 = z.tuple([z.number().finite(), z.number().finite(), z.number().finite()]).readonly()
const box = z.object({ min: vector3, max: vector3 }).strict()

/**
 * 一帧三维画面里实际画了什么：只有执行过作者代码、走过渲染管线才知道的事实。
 * 由画这一帧的同一次渲染记下，随 observe_video_edit_frame 返回；verify_video_edit_space 不执行作者代码，看不到这些。
 */
export const spatialFrameObservationSchema = z.object({
  /** 这一帧用的三维显示方式：realtime 实时、render 路径追踪、solid 实体、wireframe 线框。 */
  display: z.enum(['realtime', 'render', 'solid', 'wireframe']),
  groups: z.array(z.object({
    groupId: z.string(),
    /** 时间线片段在三维里的形态：card 平面卡片，solid 有厚度或受光的实体。 */
    clips: z.array(z.object({ clipId: z.string(), form: z.enum(['card', 'solid']), material: z.string(), lit: z.boolean(), thickness: z.number().finite() }).strict()),
    /** 作者场景里的物体，按片段、物体类型与材质合并计数，包围盒为世界坐标（1 = 一个画面高度）。 */
    objects: z.array(z.object({ clipId: z.string(), type: z.string(), material: z.string(), count: z.number().int().positive(), bounds: box.nullable() }).strict()),
    /** 这一组透出下方画面（组里有玻璃、亚克力或透射材质）。 */
    seesBelow: z.boolean(),
  }).strict()),
  lights: z.array(z.object({ source: z.enum(['clip', 'default']), clipId: z.string().optional(), kind: z.enum(SPACE_LIGHT_KINDS), intensity: z.number().finite(), castShadow: z.boolean() }).strict()),
  environment: z.string(),
  /** 用户要知道才能判断结果的近似与自动行为（中文短句）。 */
  facts: z.array(z.string()),
}).strict()
export type SpatialFrameObservation = z.infer<typeof spatialFrameObservationSchema>
