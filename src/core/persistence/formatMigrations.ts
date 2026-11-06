import { migrateStyleAuthor, migrateTemplateAuthor, migrateStylePackageAuthor } from '../videoEdit/styles/authorVersionMigration'
import { migrateAudioMergedEffects, migrateAudioEffectLibraryV3, migrateAudioPresetPackageV11, migrateAudioEqualizerModes } from '../audio/effects/mergedEffectsMigration'
import { migrateVideoEditLibraryCatalog, migrateVideoEditPresetCatalogPreferences } from '../videoEdit/libraryCatalogMigration'
import { migrateVideoEditStylePiece } from '../videoEdit/effectPresets'
import { migrateVideoEditCaptionCollection } from '../videoEdit/captionOwnershipMigration'
import { migrateMcpConnectionStorageV1, migrateMcpConnectionIdentity } from './mcpConnectionSchema'
import type { PersistenceMigrations } from './migrations'
import { WEB_RECORDING_MIGRATIONS } from '../webReplay/schema'
import { migrateEmbeddedVideoColorGradesV1 } from '../videoEdit/colorGradeMigration'
import { migrateColorGradeParamsV1 } from '../imaging/adjustments/colorGradeMigration'
import { migrateVideoEditExportEntries } from '../videoEdit/exportEncodingMigration'
import { stripVideoEditClipFades } from '../videoEdit/fadeTransitionMigration'

/**
 * Add N → N+1 here for non-document formats. Document kinds own their own chain.
 * 2026-10-21 兼容起点：此前的开发期版本不再读取，表从空开始；之后每次升版本必须在这里补对应步骤。
 */
export const FORMAT_MIGRATIONS: Readonly<Record<string, PersistenceMigrations>> = {
  // 1 → 2：导出预设新增可选 usePreviews，历史预设缺省不使用预览，最低可读版本保持 1。
  // 2 → 3：新增可选 renderAtOutputResolution，历史预设缺省为开，最低可读版本保持 1。
  // 3 → 4：高级编码为可选字段，旧预设继续直接导出，最低可读版本保持 1。
  // 1 → 2：调色格式升级；2 → 3：旧预设补空的风格件字段，收藏与效果原样保留。
  // 4 → 5：收藏里的旧过渡、效果引用迁到条目 ID，合并后去重，最低可读版本提高到 5。
  // 5 → 6：代码快照内联源码读取后转入内容存储，明确保存才写摘要引用；历史效果与收藏保持。
  // 6 → 7：代码快照接受作者接口 10，旧快照的接口与库原样保留。
  // 7 → 8：风格件代码快照接受作者接口 11（效果 key），旧程序不能执行，最低可读版本提高到 8。
  // 8 → 9：风格件代码快照接受作者接口 12（网页文本声明），旧程序不能执行，最低可读版本提高到 9。
  // 9 → 10：风格件代码快照接受作者接口 13（累积模拟），旧程序不能执行，最低可读版本提高到 10。
  // 10 → 11：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 4 → 5：空间曲线进入动作候选与参照快照；旧数据保持二维语义，不添加空间字段。
  // 5 → 6：片段关键帧新增发光强度 spaceEmission；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 6 → 7：片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 7 → 8：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  'creative-intent-candidate': { 7: value => ({ ...structuredClone(value) as object, version: 8 }), 6: value => ({ ...structuredClone(value) as object, version: 7 }), 5: value => ({ ...structuredClone(value) as object, version: 6 }), 4: value => ({ ...structuredClone(value) as object, version: 5 }) },
  // 11 → 12：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 12 → 13：风格件的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。风格件拒绝片段引用，新程序写不出这一分支，最低可读版本保持不变。
  // 13 → 14：风格件代码快照接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 14。
  // 14 → 15：风格件代码快照接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 15。
  // 15 → 16：风格件的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 16。
  // 16 → 17：风格件代码快照接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'video-effect-library': { 16: value => structuredClone(value), 15: value => structuredClone(value), 14: value => structuredClone(value), 13: value => structuredClone(value), 12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value),  9: value => structuredClone(value), 8: value => structuredClone(value), 7: value => structuredClone(value), 6: value => structuredClone(value), 5: value => structuredClone(value), 4: migrateVideoEditLibraryCatalog, 3: value => migrateAudioEqualizerModes(migrateAudioEffectLibraryV3(value)), 1: migrateEmbeddedVideoColorGradesV1, 2: value => { const library = structuredClone(value) as { presets: unknown[] }; return { ...library, presets: library.presets.map(migrateVideoEditStylePiece) } } },
  // 1 → 2：评分引用使用合并后的目录 ID，重复项保留最高评分与默认标记，最低可读版本提高到 2。
  'preset-preferences': { 1: migrateVideoEditPresetCatalogPreferences },
  // 4 → 5：导出设置新增可选 useWebCache，缺省不用网页缓存，最低可读版本保持 1。
  'export-presets': { 1: value => structuredClone(value), 2: value => structuredClone(value), 3: value => structuredClone(value), 4: value => structuredClone(value) },
  // 1 → 2：新增可选请求文件名与响度意图；兼容初版记忆中的重复目标码率，最低可读版本保持 1。2 → 3：导出设置新增可选 useWebCache，内容原样保留。
  'export-memory': { 1: migrateVideoEditExportEntries, 2: value => structuredClone(value) },
  // 3 → 4：历史风格源码取消长度上限；1 → 2：音效文件夹数量不设上限，内容原样保留。
  'style-kits': { 3: value => value },
  'sound-library-folders': { 1: value => value },
  // 1 → 2：包说明里的文档条目不设数量上限。
  'project-package': { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  'mcp-connections': { 1: migrateMcpConnectionStorageV1, 2: migrateMcpConnectionIdentity },
  // 1 → 2：转写选择缺省为空，保留供应商及全部已有模型选择；只读迁移不改写原键。
  'model-defaults': { 1: value => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    const record = value as Record<string, unknown>
    if (!record.models || typeof record.models !== 'object' || Array.isArray(record.models)) return value
    const models = record.models as Record<string, unknown>
    return { ...record, version: 2, models: { ...models, transcription: models.transcription === undefined ? '' : models.transcription } }
  } },
  // 版本位置支持 git:；纯格式迁移保留已有位置，磁盘导入由显式项目操作执行。
  // 3 → 4：新增可选内置库 libraries，并接受作者接口 v5；旧记录原样有效，没有 libraries 的按第一套内置库运行。
  // 4 → 5：接受作者接口 v6；旧记录的源码、接口与库版本原样保留。
  // 5 → 6：新增可选外来来源，历史版本保持没有标记的本机身份。
  // 6 → 7：作者源码与固定组件依赖取消容量和深度上限。
  // 7 → 8：允许作者接口 7；不重写旧版本源码、接口或库。
  // 8 → 9：容器接受作者接口 v8，历史代码版本不自动提升接口。
  // 9 → 10：容器接受作者接口 v9，保留历史源码、接口与库锁定。
  // 10 → 11：容器接受作者接口 10，旧源码、接口与库保持原值。
  // 11 → 12：容器接受作者接口 11（效果 key），历史固定版本不提升。
  // 12 → 13：容器接受作者接口 12（网页文本声明），历史固定版本不提升。
  // 13 → 14：容器接受作者接口 13（累积模拟），历史固定版本不提升。
  // 14 → 15：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 15 → 16：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 16 → 17：接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。
  // 17 → 18：接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。
  // 18 → 19：新建代码版本接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'code-version': { 18: value => structuredClone(value), 17: value => structuredClone(value), 16: value => structuredClone(value), 15: value => structuredClone(value), 14: value => structuredClone(value),  13: value => structuredClone(value), 12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value), 9: value => structuredClone(value), 8: value => structuredClone(value), 7: value => structuredClone(value), 6: value => structuredClone(value), 1: value => structuredClone(value), 2: value => structuredClone(value), 3: value => structuredClone(value), 4: value => structuredClone(value), 5: value => structuredClone(value) },
  // 作者宿主接口 4 → 5：v5 起可声明片子数据参数与使用内置库；宿主按 apiVersion 保持 v4 代码原行为，不迁移源码。
  // 5 → 6：新增版本化排版库；迁移不把旧素材提升到新作者接口。
  // 6 → 7：增加图层效果描述；旧作者接口原样保留。
  // 7 → 8：作者参数可声明 visibleWhen.all；旧接口和源码保持原样。
  // 8 → 9：增加代码调整层；旧接口按其固定版本执行。
  // 9 → 10：HarfBuzz 文字准备与单一几何；旧接口继续沿用各自行为。
  // 10 → 11：效果描述可指定稳定 key，旧代码仍按固定接口执行。
  // 11 → 12：代码可声明网页文本 webText 并读取同帧网页文本几何，旧代码仍按固定接口执行。
  // 12 → 13：代码可声明 createSimulation 累积模拟并导入冻结 Rapier，旧代码仍按固定接口执行。
  // 13 → 14：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 14 → 15：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 15 → 16：新增 info.elements；旧代码按自己记录的接口版本保持原行为。
  // 16 → 17：新增 host.time、host.space（标准材质与环境）与元素轮廓 outline；旧代码按自己记录的接口版本保持原行为。
  // 17 → 18：新增接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'code-author-api': { 17: value => structuredClone(value), 16: value => structuredClone(value), 15: value => structuredClone(value), 14: value => structuredClone(value), 13: value => structuredClone(value),  12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value), 9: value => structuredClone(value), 8: value => structuredClone(value), 7: value => structuredClone(value), 6: value => structuredClone(value), 4: value => structuredClone(value), 5: value => structuredClone(value) },
  // 7 → 8：代码视频参数新增可选取帧时间表 spans，旧资产原样有效，最低可读版本仍为 7。
  // 8 → 9：源码版本新增可选内置库 libraries 并接受作者接口 v5；资产不携带片子数据，不能引用它。旧资产原样有效，最低可读版本仍为 7。
  // 9 → 10：资产可携带作者接口 v6；只升容器版本，保留 sourceVersion。
  // 10 → 11：源码长度不设产品上限，保留所有源码与最低可读版本。
  // 11 → 12：代码图片参数新增网页画面引用 {kind:'web'}，旧资产原样有效，最低可读版本不变。
  // 12 → 13：容器可携带 API 7；源码版本的接口与库不自动升级。
  // 13 → 14：容器接受作者接口 v8，旧源码、参数与库版本原样保留。
  // 14 → 15：容器接受作者接口 v9，保留 sourceVersion。
  // 15 → 16：容器接受作者接口 10，不自动升级资产中的源码版本。
  // 16 → 17：资产可携带作者接口 11（效果 key）与可选元素效果覆盖，最低可读版本提高到 17。
  // 17 → 18：资产可携带作者接口 12（网页文本声明），最低可读版本提高到 18。
  // 18 → 19：资产可携带作者接口 13（累积模拟），最低可读版本提高到 19。
  // 19 → 20：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 20 → 21：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 21 → 22：代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。资产里这类参数只能为空，最低可读版本保持 21。
  // 22 → 23：接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 23。
  // 23 → 24：接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 24。
  // 24 → 25：代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 25。
  // 25 → 26：代码资产接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；保留历史内容、源码及固定接口，只提高版本。
  // 26 → 27：代码元素覆盖新增 motionBlur（true 强制打开、false 关），旧程序读不了，提高最低可读版本。
  'code-asset': { 26: value => ({ ...structuredClone(value) as object, version: 27, minReaderVersion: 27 }), 25: value => ({ ...structuredClone(value) as object, version: 26, minReaderVersion: 26 }), 24: value => ({ ...structuredClone(value) as object, version: 25, minReaderVersion: 25 }), 23: value => ({ ...structuredClone(value) as object, version: 24, minReaderVersion: 24 }), 22: value => ({ ...structuredClone(value) as object, version: 23, minReaderVersion: 23 }), 21: value => ({ ...structuredClone(value) as object, version: 22 }), 20: value => ({ ...structuredClone(value) as object, version: 21, minReaderVersion: 21 }), 19: value => ({ ...structuredClone(value) as object, version: 20, minReaderVersion: 20 }),  18: value => ({ ...structuredClone(value) as object, version: 19, minReaderVersion: 19 }), 17: value => ({ ...structuredClone(value) as object, version: 18, minReaderVersion: 18 }), 16: value => ({ ...structuredClone(value) as object, version: 17, minReaderVersion: 17 }), 15: value => ({ ...structuredClone(value) as object, version: 16, minReaderVersion: 16 }), 14: value => ({ ...structuredClone(value) as object, version: 15, minReaderVersion: 15 }), 13: value => ({ ...structuredClone(value) as object, version: 14, minReaderVersion: 14 }), 12: value => ({ ...structuredClone(value) as object, version: 13, minReaderVersion: 13 }), 11: value => ({ ...value as object, version: 12 }), 10: value => ({ ...value as object, version: 11 }), 6: value => ({ ...structuredClone(value) as object, version: 7, minReaderVersion: 7 }), 7: value => ({ ...structuredClone(value) as object, version: 8, minReaderVersion: 7 }), 8: value => ({ ...structuredClone(value) as object, version: 9, minReaderVersion: 7 }), 9: value => ({ ...structuredClone(value) as object, version: 10, minReaderVersion: 10 }) },
  // 2 → 3：新增可选外来来源，历史工程保持本机身份。
  project: { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }), 2: value => ({ ...value as object, version: 3 }) },
  // 2 → 3：样片画布放宽到 3840×2160、60 帧，旧内容原样有效。
  // 3 → 4：样片时长放宽到 30 秒、锚点 10 张，旧内容原样有效。
  // 4 → 5：新增可选 foreign，已有 imported 只表示文字来源，不赋予代码来源。
  // 5 → 6：风格中的源码与组件依赖取消容量和深度上限。
  // 6 → 7：新增随风格保存的可选风格件；归属由风格容器决定，旧内容保持不带风格件。
  // 8 → 9：风格件可带固定代码快照，历史风格原样保留。
  // 9 → 10：接受作者接口 10，样片补固定历史版本。
  // 10 → 11：风格件代码快照接受作者接口 11（效果 key），最低可读版本提高到 11。
  // 11 → 12：风格件代码快照接受作者接口 12（网页文本声明），最低可读版本提高到 12。
  // 12 → 13：风格件代码快照接受作者接口 13（累积模拟），最低可读版本提高到 13。
  // 13 → 14：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 14 → 15：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 15 → 16：风格件的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。风格件拒绝片段引用，新程序写不出这一分支，最低可读版本保持不变。
  // 16 → 17：风格件与样片接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。
  // 17 → 18：风格件与样片接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。
  // 18 → 19：风格件与样片的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 19。
  // 19 → 20：风格件与样片接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'video-style-library': { 19: value => structuredClone(value), 18: value => structuredClone(value), 17: value => structuredClone(value), 16: value => structuredClone(value), 15: value => structuredClone(value), 14: value => structuredClone(value), 13: value => structuredClone(value),  12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value), 9: migrateStyleAuthor, 8: value => structuredClone(value), 7: value => migrateAudioEqualizerModes(migrateAudioMergedEffects(value)), 6: value => structuredClone(value), 5: value => structuredClone(value), 1: value => value, 2: value => value, 3: value => value, 4: value => structuredClone(value) },
  // 1 → 2：模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 2 → 3：原生模板片段新增可选 enabled:false；代码参数值新增片子数据引用 {kind:'scene'}（模板不携带片子数据，实际不会出现）。
  // 旧内容原样有效；旧程序会把停用的模板片段当成启用，最低可读版本提高到 3。
  // 3 → 4：新增可选 foreign，已有 imported 不转成外来代码标记。
  // 4 → 5：模板中的源码与组件依赖取消容量和深度上限。
  // 5 → 6：模板里的代码图片参数新增网页画面引用 {kind:'web'}，旧内容原样有效。
  // 6 → 7：接受作者接口 10，模板补固定历史接口与库版本。
  // 7 → 8：模板代码可用作者接口 11（效果 key），旧程序不能执行，最低可读版本提高到 8。
  // 8 → 9：模板代码可用作者接口 12（网页文本声明），旧程序不能执行，最低可读版本提高到 9。
  // 9 → 10：模板代码可用作者接口 13（累积模拟），旧程序不能执行，最低可读版本提高到 10。
  // 10 → 11：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 11 → 12：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 12 → 13：原生模板片段新增发光强度 spaceEmission 及其关键帧；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 13 → 14：模板片段图形对象的代码参数里，图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。图形对象只声明数值、颜色与文字参数，新程序写不出这一分支，最低可读版本保持不变。
  // 14 → 15：代码模板接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。
  // 15 → 16：代码模板接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。
  // 16 → 17：原生模板片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 17 → 18：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  // 18 → 19：模板里的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 19。
  // 19 → 20：代码模板接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'video-template-library': { 19: value => structuredClone(value), 18: value => structuredClone(value), 17: value => structuredClone(value), 16: value => structuredClone(value), 15: value => structuredClone(value), 14: value => structuredClone(value), 13: value => structuredClone(value), 12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value),  9: value => structuredClone(value), 8: value => structuredClone(value), 7: value => structuredClone(value), 6: migrateTemplateAuthor, 5: value => structuredClone(value), 4: value => structuredClone(value), 1: value => value, 2: value => value, 3: value => structuredClone(value) },
  // 6 → 7：本机标题模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 7 → 8：代码参数值新增片子数据引用 {kind:'scene'}（标题模板不携带片子数据，实际不会出现），旧内容原样有效。
  // 8 → 9：代码图片参数新增网页画面引用 {kind:'web'}，旧内容原样有效。
  // 9 → 10：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 10 → 11：片段新增发光强度 spaceEmission 及其关键帧；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 11 → 12：片段的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。标题模板只读不写，新程序写不出这一分支，最低可读版本保持不变。
  // 12 → 13：片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 13 → 14：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  // 14 → 15：片段的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 15。
  'title-templates': { 14: value => structuredClone(value), 13: value => structuredClone(value), 12: value => structuredClone(value), 11: value => structuredClone(value), 10: value => structuredClone(value), 9: value => structuredClone(value), 6: value => value, 7: value => value, 8: value => value },
  // 4 → 5：成员模板里的代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 5 → 6：成员原生模板的片段新增可选 enabled:false；代码参数值新增片子数据引用 {kind:'scene'}（风格包不携带片子数据，实际不会出现）。
  // 旧内容原样有效；旧程序会把停用的模板片段当成启用，最低可读版本提高到 6。
  // 6 → 7：嵌套风格和模板新增可选来源；导入宿主负责生成标记，包内标记不表示批准。
  // 7 → 8：分享包中的源码与组件依赖取消容量和深度上限。
  // 8 → 9：成员模板里的代码图片参数新增网页画面引用 {kind:'web'}，旧内容原样有效。
  // 9 → 10：风格可携带可选风格件，随分享包保留；已有风格和模板原样有效。
  // 11 → 12：风格件可携带固定代码快照，历史分享包原样保留。
  // 12 → 13：成员样片与模板接受作者接口 10，补固定历史版本。
  // 13 → 14：风格件代码快照接受作者接口 11（效果 key），最低可读版本提高到 14。
  // 14 → 15：风格件代码快照接受作者接口 12（网页文本声明），最低可读版本提高到 15。
  // 15 → 16：风格件代码快照接受作者接口 13（累积模拟），最低可读版本提高到 16。
  // 16 → 17：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 17 → 18：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 18 → 19：成员模板的片段新增发光强度 spaceEmission 及其关键帧；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 19 → 20：风格件与成员模板的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。两处都写不出片段引用，新程序写不出这一分支，最低可读版本保持不变。
  // 20 → 21：风格件、样片与代码模板接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。
  // 21 → 22：风格件、样片与代码模板接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。
  // 22 → 23：成员模板片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 23 → 24：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  // 24 → 25：风格件、样片与成员模板的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 25。
  // 25 → 26：风格包接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；旧代码按自己记录的接口版本保持原行为。
  'video-style-package': { 25: value => structuredClone(value), 24: value => structuredClone(value), 23: value => structuredClone(value), 22: value => structuredClone(value), 21: value => structuredClone(value), 20: value => structuredClone(value), 19: value => structuredClone(value), 18: value => structuredClone(value), 17: value => structuredClone(value), 16: value => structuredClone(value),  15: value => structuredClone(value), 14: value => structuredClone(value), 13: value => structuredClone(value), 12: migrateStylePackageAuthor, 11: value => structuredClone(value), 10: value => migrateAudioEqualizerModes(migrateAudioMergedEffects(value)), 9: value => structuredClone(value), 8: value => structuredClone(value), 7: value => structuredClone(value), 1: value => value, 2: value => value, 3: value => value, 4: value => value, 5: value => value, 6: value => structuredClone(value) },
  'recording-setup': { 1: value => value, 2: value => { const { microphoneId: _legacyDevice, ...rest } = value as Record<string, unknown>; return rest }, 3: value => value, 4: value => value },
  'screen-capture': { 1: value => ({ ...value as object, version: 2, minReaderVersion: 1 }) },
  'audio-capture-recovery': { 1: value => ({ ...value as object, version: 2 }) },
  // 实验性功能开关 experimentalWebAppRecording（2026-10-23）：只新增可选字段，缺省即关闭。
  // 剪辑片段缩略图模式 videoEditClipThumbnails（2026-10-24）：只新增可选字段，缺省即“只在开头”。
  // 播放时时间线自动滚动 videoEditTimelineAutoScroll（2026-11-05）：只新增可选字段，缺省即开启。
  settings: { 14: value => value, 15: value => value, 16: value => value },
  // 网页录制：步骤与 `.hjweb` 文档类型共用（同一份 recording.json）。
  'web-recording': WEB_RECORDING_MIGRATIONS,
  // 全能调色参数格式 v2（2026-10-21）：开尔文白平衡、创意分离色调并入色轮。
  // 6 → 7：代码视频参数新增可选取帧时间表 spans，旧内容原样有效。
  // 7 → 8：代码参数值新增片子数据引用 {kind:'scene'}（预设不携带片子数据，实际不会出现），旧内容原样有效。
  // 8 → 9：嵌入的源码不设长度上限。
  // 9 → 10：代码图片参数新增网页画面引用 {kind:'web'}，旧内容原样有效。
  // 10 → 11：效果预设补空的说明、用途和旋钮；已有参数、曲线与蒙版原样保留。
  // 12 → 13：风格件可携带固定代码快照，保留既有参数、曲线与来源。
  // 13 → 14：风格件代码快照接受作者接口 10，旧快照的接口与库原样保留。
  // 14 → 15：风格件代码快照接受作者接口 11（效果 key），最低可读版本提高到 15。
  // 15 → 16：风格件代码快照接受作者接口 12（网页文本声明），最低可读版本提高到 16。
  // 16 → 17：风格件代码快照接受作者接口 13（累积模拟），最低可读版本提高到 17。
  // 17 → 18：接受作者接口 14 的 fill 图层画面来源；保留历史源码、接口与库锁定。
  // 18 → 19：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 19 → 20：标题条目的片段新增发光强度 spaceEmission 及其关键帧；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 20 → 21：标题条目与风格件的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。标题条目只出现在旧文件里、风格件拒绝片段引用，新程序写不出这一分支，最低可读版本保持不变。
  // 21 → 22：风格件代码快照接受作者接口 16（三维作者的 info.elements）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 22。
  // 22 → 23：风格件代码快照接受作者接口 17（三维作者的 host.time、host.space 标准材质与环境、元素轮廓 outline）；保留历史内容、源码及固定接口，只更新版本戳。旧程序无法执行，最低可读版本提高到 23。
  // 23 → 24：标题条目片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 24 → 25：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  // 25 → 26：标题条目与风格件的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 26。
  // 26 → 27：剪辑预设接受作者接口 18（没有位姿的图层比较相邻帧的绘制指令，draw 里的动画也有运动模糊）；保留历史内容、源码及固定接口，只提高版本。
  'video-preset-package': { 26: value => ({ ...structuredClone(value) as object, version: 27, minReaderVersion: 27 }), 25: value => ({ ...structuredClone(value) as object, version: 26, minReaderVersion: 26 }), 24: value => ({ ...structuredClone(value) as object, version: 25, minReaderVersion: 25 }), 23: value => ({ ...structuredClone(value) as object, version: 24, minReaderVersion: 24 }), 22: value => ({ ...structuredClone(value) as object, version: 23, minReaderVersion: 23 }), 21: value => ({ ...structuredClone(value) as object, version: 22, minReaderVersion: 22 }), 20: value => ({ ...structuredClone(value) as object, version: 21 }), 19: value => ({ ...structuredClone(value) as object, version: 20, minReaderVersion: 20 }), 18: value => ({ ...structuredClone(value) as object, version: 19, minReaderVersion: 19 }), 17: value => ({ ...structuredClone(value) as object, version: 18, minReaderVersion: 18 }),  16: value => ({ ...structuredClone(value) as object, version: 17, minReaderVersion: 17 }), 15: value => ({ ...structuredClone(value) as object, version: 16, minReaderVersion: 16 }), 14: value => ({ ...structuredClone(value) as object, version: 15, minReaderVersion: 15 }), 13: value => ({ ...structuredClone(value) as object, version: 14, minReaderVersion: 14 }), 12: value => ({ ...structuredClone(value) as object, version: 13, minReaderVersion: 13 }), 11: value => migrateAudioEqualizerModes(migrateAudioPresetPackageV11(value)), 10: value => { const pack = structuredClone(value) as { items: { category: string; preset: unknown }[] }; return { ...pack, version: 11, items: pack.items.map(item => item.category === 'effect' ? { ...item, preset: migrateVideoEditStylePiece(item.preset) } : item) } }, 9: value => ({ ...value as object, version: 10 }), 8: value => ({ ...value as object, version: 9 }), 5: value => ({ ...migrateEmbeddedVideoColorGradesV1(value) as object, version: 6 }), 6: value => ({ ...value as object, version: 7 }), 7: value => ({ ...value as object, version: 8 }) },
  // 工作副本 15 → 16、图片包 13 → 14、画布图层包 13 → 14：全能调色新增可选参数 hue_shift（色相旋转），
  // 缺省 0 不改变画面；旧内容没有该参数，只更新版本戳，其余原样保留。
  'image-working-copy': { 14: value => migrateImageWorkingCopyColorGrades(value, 15), 15: value => ({ ...structuredClone(value) as object, formatVersion: 16 }) },
  'image-package': {
    12: value => ({ ...value as object, packageVersion: 13, document: migrateImageWorkingCopyColorGrades((value as { document?: unknown }).document, 15) }),
    13: value => { const pack = structuredClone(value) as { document?: unknown }; return { ...pack, packageVersion: 14, ...(pack.document && typeof pack.document === 'object' ? { document: { ...pack.document, formatVersion: 16 } } : {}) } },
  },
  'canvas-layer-package': { 12: value => ({ ...value as object, version: 13 }), 13: value => ({ ...value as object, version: 14 }) },
  // 片段速度曲线、补帧与变调（2026-10-22）：字幕回填记录里的声音片段只新增可选字段。
  // 跟踪与防抖（2026-10-22）、音频重构 remix（2026-10-22）：同上，只新增可选字段。
  // 原生模板实例标记（2026-10-22）：字幕回填记录里的声音片段只新增可选的 templateId。
  // 非等比缩放（2026-10-24）：字幕回填记录里的声音片段只新增可选的 scaleAspect。
  // 代码视频参数取帧时间表（2026-10-28）：声音片段的代码参数只新增可选的 spans。
  // 片段启用开关（2026-10-28）：声音片段新增可选 enabled:false，代码参数值新增片子数据引用；旧记录原样有效。
  // 网页画面（2026-10-30）：声音片段的代码图片参数新增网页画面引用 {kind:'web'}；旧记录原样有效。
  // 23 → 24：删除旧程序依赖的 linkedCaptionId；防止回填恢复动态链接语义，最低可读版本提高到 24。
  // 25 → 26：声音片段只新增可选的元素效果覆盖与代码修改记录 edits；旧记录原样有效。
  // 26 → 27：支持空间属性、右边界关键帧或作者接口 15；保留历史内容、源码及固定接口。
  // 27 → 28：声音片段新增发光强度 spaceEmission 及其关键帧；旧内容没有 spaceEmission，缺省 0 不改变画面，只更新版本戳。
  // 28 → 29：声音片段的代码图片参数新增片段引用 {kind:'clip', clipId}；旧内容没有这一分支，只更新版本戳。
  // 29 → 30：声音片段片段新增三维表面：厚度 spaceThickness（可关键帧）、受光 spaceLit、材质 spaceMaterial、倒角 spaceBevel、投影 spaceCastShadow / spaceReceiveShadow；旧内容没有这些字段，缺省为平面画面，画面不变；关键帧键是封闭枚举，旧程序读到 curves.spaceThickness 会拒读，最低可读版本随版本提高。
  // 30 → 31：新增灯光片段与灯光素材项（kind light，字段 lightKind、lightColor、lightIntensity 可关键帧、lightCastShadow、lightSoftness、lightAngle），序列 spaceRender 新增 defaultLighting；旧内容没有灯光，画面不变；片段与素材项的 kind、关键帧键是封闭枚举，旧程序读到 light 或 curves.lightIntensity 会拒读，最低可读版本随版本提高。
  // 31 → 32：声音片段的代码图片参数网页图片引用新增可选 layer（{ only: [选择器] } 或 { hide: [选择器] }，按文字拆层）；旧内容没有该字段，画面不变。旧程序的网页引用是严格结构且画不出拆层，读到会把内容判成无效，最低可读版本随版本提高到 32。
  // 32 → 33：片段快照接受 motionBlur:true；旧内容原样有效。
  // 33 → 34：片段快照去掉 fadeInFrames / fadeOutFrames（淡化并进过渡，快照只用来比对声音，淡化不参与字幕识别）。
  'subtitle-manifest': { 33: value => ({ ...stripVideoEditClipFades(value) as object, version: 34 }), 32: value => ({ ...structuredClone(value) as object, version: 33 }), 31: value => ({ ...structuredClone(value) as object, version: 32 }), 30: value => ({ ...structuredClone(value) as object, version: 31 }), 29: value => ({ ...structuredClone(value) as object, version: 30 }), 28: value => ({ ...structuredClone(value) as object, version: 29 }), 27: value => ({ ...structuredClone(value) as object, version: 28 }), 26: value => ({ ...structuredClone(value) as object, version: 27 }), 25: value => ({ ...structuredClone(value) as object, version: 26 }), 24: value => ({ ...migrateAudioEqualizerModes(migrateAudioMergedEffects(value)) as object, version: 25 }), 23: value => ({ ...migrateVideoEditCaptionCollection(value) as object, version: 24 }), 22: value => ({ ...value as object, version: 23 }), 21: value => ({ ...value as object, version: 22 }), 20: value => ({ ...value as object, version: 21 }), 19: value => ({ ...value as object, version: 20 }), 18: value => ({ ...value as object, version: 19 }), 17: value => ({ ...value as object, version: 18 }), 16: value => ({ ...value as object, version: 17 }), 15: value => ({ ...value as object, version: 16 }), 11: value => ({ ...value as object, version: 12 }), 12: value => ({ ...value as object, version: 13 }), 13: value => ({ ...value as object, version: 14 }), 14: value => ({ ...value as object, version: 15 }) },
}
/** Image layers (any depth, including smart-object documents): every `color_grade` adjustment layer's params. */
function migrateImageColorGradeLayers(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(migrateImageColorGradeLayers)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const result = Object.fromEntries(Object.entries(record).map(([key, child]) => [key, migrateImageColorGradeLayers(child)]))
  if (record.type === 'adjustment' && record.adjustmentId === 'color_grade' && record.params && typeof record.params === 'object' && !Array.isArray(record.params)) result.params = migrateColorGradeParamsV1(record.params as Record<string, unknown>)
  return result
}
function migrateImageWorkingCopyColorGrades(value: unknown, formatVersion: number): unknown {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return value
  return { ...migrateImageColorGradeLayers(value) as object, formatVersion }
}
export function formatMigrations(id: string): PersistenceMigrations { return FORMAT_MIGRATIONS[id] ?? {} }
