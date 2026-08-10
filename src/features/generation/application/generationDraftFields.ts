import {
  type ApplicationFieldDefinition,
  type ApplicationPropertyDescriptor,
  type JsonValue,
} from '@/core/application-control'
import { APPLICATION_CAPABILITY_CATALOG_VERSION } from '@/core/assistant/applicationCapabilities'
import { registry } from '@/core/ModelRegistry'
import {
  compactPromptMediaReferenceSpacing,
  parseLegacyPromptString,
  toLegacyPromptString,
} from '@/core/inputs/promptDocument'
import {
  createMediaGeneratorPromptReferences,
  reconcileMediaGeneratorPromptImages,
} from '@/components/MediaGenerator/promptState'

import { useGenerationDraftStore } from '../store/generationDraftStore'
import type { GenerationDraft } from '../domain/generationDraft'

export const GENERATION_DRAFT_ENTITY_TYPE = 'generation.draft' as const
/*
 * 字面量常量，不从 generationReflection.ts 导入 GENERATION_ENTITY_TYPES.model——那边反过来
 * 要 import GENERATION_DRAFT_FIELDS 来注册 generation.draft 实体，两边互相 import 会在模块
 * 求值阶段循环，导致这个文件顶层的 GENERATION_DRAFT_FIELDS 数组字面量在构造时读到还没
 * 初始化完的 GENERATION_ENTITY_TYPES（实测报的是 "Cannot read properties of undefined
 * (reading 'model')"）。generation.model 的实体 id 是稳定字符串，不会变，直接写字面量更安全。
 */
const GENERATION_MODEL_ENTITY_REF_KIND = 'generation.model'

/** 属性写入的累积器：跟 canvasFields.ts / cameraStageObjectFields.ts 的写入表模式一致，
 * 一次 mutation 步骤里的多条属性先累进同一个 patch，执行器最后一次性 store.patch(draft)。 */
export type GenerationDraftPatch = Partial<GenerationDraft>

function digest(seed: string): string {
  const value = [...seed].reduce((total, char) => (total * 33 + char.charCodeAt(0)) >>> 0, 5381).toString(16)
  return `sha256:${value.padEnd(64, value).slice(0, 64)}`
}

function schemaRef(id: string) {
  return { catalogVersion: APPLICATION_CAPABILITY_CATALOG_VERSION, kind: 'property' as const, id, version: 1, digest: digest(`property:${id}`) }
}

function draftDescriptor(
  suffix: string,
  title: string,
  value: ApplicationPropertyDescriptor['value'],
  readOnlyReason?: string,
): ApplicationPropertyDescriptor {
  const id = `${GENERATION_DRAFT_ENTITY_TYPE}.${suffix}`
  return {
    id,
    entityType: GENERATION_DRAFT_ENTITY_TYPE,
    version: 1,
    title,
    description: `生成草稿${title}。`,
    value,
    nullable: false,
    dataClass: 'C1',
    exposures: ['ui', 'assistant', 'local_adapter'],
    requiredPermissions: { read: ['generation_draft:read'], write: readOnlyReason ? [] : ['generation_draft:write'] },
    revisionScopes: ['generation_draft'],
    schemaRef: schemaRef(id),
    ...(readOnlyReason ? { readOnlyReason } : {}),
  }
}

/** 读取时用 patch 里已经累积的值，没有才回落到活的 store——同一次 mutation 里先后写
 * uploaded_images 与 prompt_text 时，prompt_text 的联动要看到刚写的图片，不是旧值。 */
function currentDraftValue<K extends keyof GenerationDraft>(patch: GenerationDraftPatch, key: K): GenerationDraft[K] {
  return (patch[key] ?? useGenerationDraftStore.getState().draft[key]) as GenerationDraft[K]
}

/*
 * 18 个字段的归类结论（详见 5.4 执行记录）：
 * - promptDocument → 折叠成 prompt_text（旧版纯文本，带 @图N 内联引用），复用
 *   setLegacyInput 的解析逻辑，不是暴露 PromptDocumentV1 的原始 json 结构。
 * - selectedProvider/selectedModel → 折叠成一条 selected_model（ref 指向
 *   generation.model），provider 由 model 反查得出，不单独暴露。
 * - uploadedPromptImages/uploadedFilePaths → 折叠成 uploaded_images（url 数组）。
 * - uploadedVideos/uploadedVideoFilePaths → 折叠成 uploaded_videos。
 * - uploadedAudios/uploadedAudioFilePaths → 折叠成 uploaded_audios。
 * - uploadedVideoFiles（浏览器 File 对象数组）→ 不暴露：不可序列化，且与
 *   uploadedVideoFilePaths 信息冗余。
 * - fileOrder → 不暴露：只是上传托盘的展示排列，不改变各类型内部的语义顺序。
 * - uploadedVideoDuration → 只读：视频真实时长，是上传文件本身的元数据，助手不能
 *   凭空声明一个不匹配文件的时长。
 * - uploadedVideoTrimStart/End → 直接映射为两条可写属性。
 * - modelFilterProvider/Type/Function → 不暴露：只影响选择器 UI 里看到哪些模型，
 *   不影响生成结果；助手搜模型走 search_models 自己的筛选参数，不经过这层。
 * - favoriteModels → 不暴露：不影响生成结果，是个人收藏偏好而不是生成输入；这个
 *   store 没有持久化（不带 zustand persist），目前实际上和其他草稿字段一样是会话级
 *   状态，但语义上更接近设置而非草稿内容，归为已知范围外。
 */
export const GENERATION_DRAFT_FIELDS: ApplicationFieldDefinition<GenerationDraft, GenerationDraftPatch>[] = [
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.prompt_text`,
    descriptor: draftDescriptor('prompt_text', '提示词文本', { kind: 'string', maxLength: 32 * 1024 }),
    read: (draft) => toLegacyPromptString(draft.promptDocument, {
      references: createMediaGeneratorPromptReferences(draft.uploadedPromptImages),
    }),
    writer: {
      write(patch, mutation) {
        if (typeof mutation.value !== 'string') throw new Error('INVALID_INPUT')
        const images = currentDraftValue(patch, 'uploadedPromptImages')
        const references = createMediaGeneratorPromptReferences(images)
        patch.promptDocument = compactPromptMediaReferenceSpacing(
          parseLegacyPromptString(mutation.value, { references }),
        )
      },
    },
    storeActions: ['setLegacyInput'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.selected_model`,
    descriptor: draftDescriptor('selected_model', '选中模型', { kind: 'ref', refKinds: [GENERATION_MODEL_ENTITY_REF_KIND] }),
    read: (draft) => (draft.selectedModel
      ? { kind: GENERATION_MODEL_ENTITY_REF_KIND, id: draft.selectedModel }
      : null) as JsonValue,
    writer: {
      write(patch, mutation) {
        const ref = mutation.value as { kind?: string; id?: string } | null
        if (!ref || typeof ref.id !== 'string' || ref.kind !== GENERATION_MODEL_ENTITY_REF_KIND) {
          throw new Error('INVALID_INPUT')
        }
        const model = registry.getModel(ref.id)
        if (!model) throw new Error(`NOT_FOUND:${ref.id}`)
        patch.selectedModel = ref.id
        patch.selectedProvider = model.meta.provider
      },
    },
    storeActions: ['patchField'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_images`,
    descriptor: draftDescriptor('uploaded_images', '已上传图片', { kind: 'json', schemaRef: schemaRef(`${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_images.value`) }),
    read: (draft) => draft.uploadedPromptImages.map((image) => image.url) as JsonValue,
    writer: {
      write(patch, mutation) {
        if (!Array.isArray(mutation.value) || mutation.value.some((item) => typeof item !== 'string')) {
          throw new Error('INVALID_INPUT')
        }
        const urls = mutation.value as string[]
        const currentImages = currentDraftValue(patch, 'uploadedPromptImages')
        patch.uploadedPromptImages = reconcileMediaGeneratorPromptImages(currentImages, urls)
        patch.uploadedFilePaths = urls
      },
    },
    storeActions: ['patchUploadedImages'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_videos`,
    descriptor: draftDescriptor('uploaded_videos', '已上传视频', { kind: 'json', schemaRef: schemaRef(`${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_videos.value`) }),
    read: (draft) => [...draft.uploadedVideos] as JsonValue,
    writer: {
      write(patch, mutation) {
        if (!Array.isArray(mutation.value) || mutation.value.some((item) => typeof item !== 'string')) {
          throw new Error('INVALID_INPUT')
        }
        const urls = mutation.value as string[]
        patch.uploadedVideos = urls
        patch.uploadedVideoFilePaths = urls
      },
    },
    storeActions: ['patchField'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_audios`,
    descriptor: draftDescriptor('uploaded_audios', '已上传音频', { kind: 'json', schemaRef: schemaRef(`${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_audios.value`) }),
    read: (draft) => [...draft.uploadedAudios] as JsonValue,
    writer: {
      write(patch, mutation) {
        if (!Array.isArray(mutation.value) || mutation.value.some((item) => typeof item !== 'string')) {
          throw new Error('INVALID_INPUT')
        }
        const urls = mutation.value as string[]
        patch.uploadedAudios = urls
        patch.uploadedAudioFilePaths = urls
      },
    },
    storeActions: ['patchField'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_video_duration`,
    descriptor: draftDescriptor('uploaded_video_duration', '已上传视频时长', { kind: 'number', hardRange: { min: 0 } },
      '视频真实时长是上传文件本身的元数据，由上传流程读取并回填，不是助手可以声明的值。'),
    read: (draft) => draft.uploadedVideoDuration,
    storeActions: [],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_video_trim_start`,
    descriptor: { ...draftDescriptor('uploaded_video_trim_start', '视频裁剪起点（秒）', { kind: 'number', hardRange: { min: 0 } }), nullable: true },
    read: (draft) => draft.uploadedVideoTrimStart,
    writer: {
      write(patch, mutation) {
        if (mutation.value !== null && typeof mutation.value !== 'number') throw new Error('INVALID_INPUT')
        patch.uploadedVideoTrimStart = mutation.value as number | null
      },
    },
    storeActions: ['patchField'],
  },
  {
    propertyId: `${GENERATION_DRAFT_ENTITY_TYPE}.uploaded_video_trim_end`,
    descriptor: { ...draftDescriptor('uploaded_video_trim_end', '视频裁剪终点（秒）', { kind: 'number', hardRange: { min: 0 } }), nullable: true },
    read: (draft) => draft.uploadedVideoTrimEnd,
    writer: {
      write(patch, mutation) {
        if (mutation.value !== null && typeof mutation.value !== 'number') throw new Error('INVALID_INPUT')
        patch.uploadedVideoTrimEnd = mutation.value as number | null
      },
    },
    storeActions: ['patchField'],
  },
]
