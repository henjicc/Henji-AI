// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { z } from 'zod'
import { createHash } from 'node:crypto'
import { applicationCatalogSchemaHash, applicationToolSchemaHash, buildApplicationContract, buildApplicationToolCatalog, EXCLUDED_TOOLS, PROTOCOL_TOOL_SPECS, toolTier } from './toolCatalog'
import { BUILTIN_APPLICATION_CAPABILITY_REGISTRY } from '../../../../src/core/application-control/builtinApplicationCapabilityRegistry'
import { RESULT_DETAIL_FIELDS, resultDetailFields } from './resultProjection'
import {
  EXTERNAL_CONTRACT_VERSION, APPLICATION_CAPABILITY_IDS, APPLICATION_READ_CAPABILITY_IDS, APPLICATION_WRITE_CAPABILITY_IDS,
  type LocalDomainSurface, type LocalTool,
} from '../../../../src/core/application-control/localHostContracts'

/**
 * 宿主注册的工具正是渲染层的投影结果；这里用同一段投影重建，保证本测试盯的是真实声明，
 * 而不是测试里另写的一份假 schema。
 */
const hostTools: LocalTool[] = APPLICATION_CAPABILITY_IDS.map((id) => {
  const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)
  if (!definition) throw new Error(`能力目录缺少对外登记的能力：${id}`)
  return {
    id, version: definition.version, title: definition.title, description: definition.description,
    inputSchema: z.toJSONSchema(definition.inputSchema, { io: 'input', reused: 'ref' }) as Record<string, unknown>,
  }
})

const READ_ONLY = { allowWrites: false, allowDestructive: false, allowPaid: false }
const WRITE = { allowWrites: true, allowDestructive: false, allowPaid: false }
const PAID = { allowWrites: true, allowDestructive: true, allowPaid: true }
const catalog = (access: typeof READ_ONLY, operationsEnabled = true) => buildApplicationToolCatalog({ tools: hostTools, access, operationsEnabled })
const names = (access: typeof READ_ONLY, operationsEnabled = true) => catalog(access, operationsEnabled).tools.map((tool) => tool.name)

const domains: LocalDomainSurface[] = [
  { id: 'settings', readable: true, writable: true, entities: [{ id: 'settings.registry', title: '应用设置', writableProperties: 53, creatable: false, removable: false }] },
  { id: 'storyboard', readable: true, writable: false, entities: [{ id: 'storyboard.card', title: '分镜卡', writableProperties: 0, creatable: false, removable: false, readOnlyReason: '分镜是画布工程的只读摘要投影。' }] },
]

describe('对外工具目录的投影与授权过滤', () => {
  it('公开 tools/list 的规范化指纹与契约版本绑定，变更须显式升级版本', () => {
    const normalize = (value: unknown): unknown => Array.isArray(value) ? value.map(normalize)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b, 'en')).map(([key, item]) => [key, normalize(item)])) : value
    const tools = buildApplicationToolCatalog({ tools: hostTools, access: PAID, operationsEnabled: true, includeSkillTool: true }).tools
    const fingerprint = createHash('sha256').update(JSON.stringify(normalize(tools))).digest('hex')
    // 仅维护当前契约；升级时记录新版本的审查指纹，不更新旧版本的指纹。
    const fingerprints: Record<string, string> = { '2.6.0': '9b0d406087bd594b3e14391ff7eb5ce4e23d26bed5fe6a7ba61071f06f83eac7', '2.5.3': '37f7befe616dc1e87e560cea231de947cb4db4cd514d4be35f910e5cb5967a34', '2.5.2': 'c711211caa843396a4499e054fdc37b8aee45cfa3104301691238728e05fb4d8', '2.5.1': '0479c44d18a556de524306b01fd69c3a8dffb654bd03e5c6ad9116cbcb39b6c0', '2.5.0': 'd6af5fea549d486fbc8973ed72ead33dfd841d0f5c7d4e49a5796789aaf52b64', '2.4.2': '9e51224a4222e9f6fb48df5a084d32e6b4d2c24f3443ff194f638e8c547cb791', '2.4.1': '5851a41c9490497dcce796a309e0eda8658f6b7fd7a865284be4a457e59dc2e2', '2.4.0': '7b0cdfd60bca3c8d91d35c5ea271ea396a4d95bf5c85a589a72a19c9851789af', '2.3.1': '13fec992cc2956160a986ad66fb41c74602c56ec417f791553c6fe15e1dd1891', '2.3.0': 'ac61a825abd3be956ee39fae8431215f6a9ebb419c8efba58318f3123a409609', '2.2.4': 'f81340d961f642497e4bc1d41494a3f51c3885a53c2f4d38625f0940d4ea1307', '2.2.3': '544a9e1f8468afbc961f0241a4f00f6ad83d13289171d0d8817b6664674752ca', '2.2.2': '44e51e1c66258c15ef9dd6359608a9f68d2ce3f1812085807f35b154e2c46619', '2.2.1': 'df8ac3b9e72c31fd17b119cd193de1b390d9f926cf25069ec9dd7496dbb9ea19', '2.2.0': '2ece81315e4c7f06f95d78e89e1dc75c2cc706c69fa4a1809e48f52ad1cd6673', '2.1.1': '652993365eb5eea750edb584853b59d459bb20da6b72fd855a0bc8f430aed77e', '2.1.2': 'b7c6ddb6093736c18e19e78ba59b059c672ca7c0bc8cd1a5cb92f23dbaa4ce9b' }
    fingerprints['2.7.0'] = '6182ccce31255de868e0b08bddec7fca07b77033d85b661cfae6bb4e20a41506'
    fingerprints['2.8.0'] = '565f9b8b0c99df05292b77c6aea0a01e321be7bcb6a018a7fdf595718d58b358'
    fingerprints['2.9.0'] = '30cf722e49b3221fd03ff045f8fd1e516ef20194a7d0931b970ec1ba200554ee'
    fingerprints['2.10.0'] = '9089a34c34e16d2af2812917a6f731cd43f94b4d907dc3ae04a12791a80cdc61'
    fingerprints['2.11.0'] = 'a9d9744dc747595d0f681cfe6ec6627c0ef79c9599c06caef2f3be056fdf792b'
    fingerprints['2.11.1'] = 'bcf92a505d5805268ba2e221e2e51f9edc9f2a4c68386c530c3ab8971cdfba19'
    fingerprints['2.12.0'] = 'ef1ac9d8abc684c7d54da686bbe494b77c055f2e590578883a2d2afdee6c7295'
    fingerprints['2.12.1'] = '98b68b462a7f2cb638c8276965c32ca6112fc8f07b451ca4d17288006893487b'
    fingerprints['2.13.0'] = 'bde08adc5a06d6f3639a65888c65e97e9767541ad4e7a6024c918377f3a4587b'
    // 3.1c（移除 OCR 档位参数）与 4.1（操作脚本与重录）各自登记了 2.13.0，合并后的目录为新版本。
    fingerprints['2.14.0'] = '14adceea5ccf8c82af575b95974367a4d4027918a1737dedc0b096a08e244b99'
    fingerprints['2.15.0'] = '6a7cc980f8cb632d673dd3607f03f3449cfb67440b9119c8f93516de1094dd37'
    // t97：预设实体、标题模板可省略模板、就地生成套用风格。
    fingerprints['2.16.0'] = 'ec894040fc50ae2b242156c34bf86b023ad29c29b9b376c2ee6941fc9e77dc2b'
    // t97：风格改为给 AI 的说明书，移除提取风格与插入风格组件三个能力。
    fingerprints['2.17.0'] = '8ac85639ad6c4b8bd8b2d5b13b801b850a94af9528728c702e9ea34617485ee4'
    fingerprints['2.18.0'] = '7bb232ec073247eb832d37f722ed714f1a373aa3c604e5016ea169ebfcd67494'
    fingerprints['2.19.0'] = '46929adeef99a4f47c6b854d625f19f8915bbff54c4f7162630de9a8b3e8769b'
    fingerprints['2.20.0'] = '7dad0f870114b60848e49c2e976f2fe5d31f9eff5743f0ad8fef829e777b3592'
    fingerprints['2.21.0'] = '9db7eb4c3beae3921e8bbe6fbbffecdcc1a72eee8696f63264068500f0ea5cbd'
    fingerprints['2.22.0'] = '7c66b7f175393987818d0611833a2deea87dba0f6a16f425ed16ba08ba0a713b'
    fingerprints['2.23.0'] = '24111e197dc1eeae75e77c388a958a677f121e4bc65f9d9172a32cd77130845b'
    // 2.24：新增字幕来源与复核实体属性，静态工具参数保持同源投影。
    fingerprints['2.24.0'] = '24111e197dc1eeae75e77c388a958a677f121e4bc65f9d9172a32cd77130845b'
    fingerprints['2.25.0'] = '24111e197dc1eeae75e77c388a958a677f121e4bc65f9d9172a32cd77130845b'
    fingerprints['2.26.0'] = '6ea50aa01ddffff51451bb25208a8db516bea571a4c8d3e24ad5a97bb4daef03'
    fingerprints['2.27.0'] = '5c9f802e44d5b3e21d290e9bad8df610e07263ca0daabd9d5368ead55ec9ffdd'
    fingerprints['2.28.0'] = '838c45d2f78b87f38ce1b12e8a24fa8663ef918c018862d1f3ecbaf2523f74f3'
    fingerprints['2.29.0'] = '46e88be3874db02eb6af3c75e8bec370be3e4fa30494687f4d3f2f0fcc912af9'
    fingerprints['2.30.0'] = '351531f48720d2f33b4c59f141341ac604c36f2bc0267f27b2ddba5050d2ce17'
    fingerprints['2.31.0'] = '8912f1132d2c83bf3a76ee6ded031f7debd81f6b2115fb2bddb2f8b4ad227469'
    fingerprints['2.32.0'] = 'e67127422dea95fd40660c2fc5985d6c04affdb74d253a4b709136463547d79e'
    fingerprints['2.33.0'] = '5881d086d7842a17f3b2db9ef9ee5ce9842694c689e97e0239541f1e0061901c'
    fingerprints['2.34.0'] = '980921318317317b3bbc2c7e84803af9d6f0927a00ade3fb2cb7b3e0ae4fe968'
    fingerprints['2.35.0'] = 'dd7b6a1538bb7739883ae0072440120cdbbfc427e0ff07dd5d0effcda64a0bd9'
    fingerprints['2.36.0'] = '3894b2307c13ef57be935d22e116169cf7071c0d92db44cac4a6450a0b9a5f35'
    fingerprints['2.37.0'] = '40809f1751a1946695ea24ea9ec34def0be2b5ad2c1a34e81ca0182cd30c9807'
    fingerprints['2.38.0'] = '055f6edf2abca27c86bc32f132aaecb0dda90e5f523bffa984ded4ad577fb1d7'
    fingerprints['2.39.0'] = 'a0864e9f0a043143224f44786314e5f3e94eb0a7a3f5f57a1491c716e2e64828'
    // API2 is exposed through the existing code-version entity, without new tools.
    fingerprints['2.40.0'] = 'a0864e9f0a043143224f44786314e5f3e94eb0a7a3f5f57a1491c716e2e64828'
    fingerprints['2.41.0'] = 'a0864e9f0a043143224f44786314e5f3e94eb0a7a3f5f57a1491c716e2e64828'
    // add_video_edit_frame_hold: new tool, declared to create clips.
    fingerprints['2.42.0'] = '67834fb9a8b01b9d92d00399e67adc023e41bc0c87d8f981f48988574ef188c4'
    // render_video_edit_preview: new tool that starts background preview rendering.
    fingerprints['2.43.0'] = '3b9842320c147772f238f5bc68cef197f83cef64bba54354860c7491a9b73cf0'
    // Color grade v2: new parameters in analyze_video_edit_color (mkl match); new observe_video_edit_color, observe_image_edit_color, analyze_image_edit_color.
    fingerprints['2.44.0'] = '81912b3cdcf8ab78dcb6a13cd789b6a843bf40a5dcc8ab5cae3a3503937ac13b'
    // Works-folder cache settings, proxy preset auto, render/proxy descriptions for full-quality pause.
    fingerprints['2.45.0'] = '8db0b496e74490d0b8b610ded4cad2e6f49686106dcb4676c6558bf0a85f45c1'
    // Sound library tools (add_sound_library_folder takes a path); download_canvas_media returns its directory.
    fingerprints['2.46.0'] = '611a5a557f4f7975d97ed23fe4c6edb4dca6f15fe1dfe2972468e3c056bd9fdc'
    // Time remapping: ramp_video_edit_clip_speed (speed ramps at moments/beats, curve presets); clip time_remap / frame_interpolation / pitch_semitones.
    fingerprints['2.47.0'] = '7d90fd86180e07cd0c3746ba7493b75c0085e6cd3c52711c01195274b16bf3ae'
    // Tracking and stabilization: follow_video_edit_tracker, stabilize_video_edit_clip, track_video_edit_recording; clip.stabilization, tracker.recording, follow.motion.
    fingerprints['2.48.0'] = '16b6db7b72216e5fb9e8d2adbd5fa4e6d2f0eef159408c994f197887bd4db873'
    // Music remix: remix_video_edit_music; video_edit.clip.remix and video_edit.media.music_structure read-only properties.
    fingerprints['2.49.0'] = '1161579fdd7999995d56058f93844af7fecab29e5605b0e27e052bd2874673fd'
    // Style presets and templates (Frameflow mechanism): render/import/export/bind style, apply/create/promote/update/detach template; title template tools removed.
    fingerprints['2.50.0'] = 'ac839b4f9cb9be7ed5e6ccc4e8fc777ede1527174987649714ba3ad5959ace45'
    fingerprints['2.51.0'] = '944ba245b4340c7ecf0d2aa1b7b1cd4f132586683a449a2f9078447d96f94111'
    // Spectrogram columns may be spaced wider than the FFT window (overview at screen resolution); brush strokes gain an optional vertical radius.
    fingerprints['2.52.0'] = '54c1286e84d7bdfa2158630b5d3df8ec7ef48806a589f99e1609a249fe8b556f'
    // 超级关键帧整组读取；本地整理允许模型指定动作和段落，默认一次事务应用。
    fingerprints['2.53.0'] = '8cbdf89d670bca4e74d943ebe2d1fe43c132a4fe613322374f491d556394e1da'
    // 预渲染按剪辑点细分段：渲染状态新增实测红黄与段性能，render_video_edit_preview 默认渲染范围内全部非就绪段；新增录音设备与参数通用属性。
    fingerprints['2.54.0'] = '3412c5b518ce66684fb80a4f40af3460e6736f2fc6184c9ad0479bb87db7e94e'
    // 音频编辑录音页与通用录音设置新增可导航 Surface；录音生命周期仍不开放。
    // 编辑器内拼接新增算法能力，删除独立全屏录音 Surface。
    fingerprints['2.56.0'] = '1e2815f71038792e779b3dc77ad0f5ce8d350670c1f22b0cbe96a142407b61ca'
    fingerprints['2.55.0'] = '9cca9214194f9f47b29e57e2cb398cf5ce0b34163faec81026ef5284a46d9a80'
    // 三层记忆实体替换旧摘要，新增撤回与整理算法能力。
    fingerprints['2.57.0'] = 'baff00c219912f3e84f0cdd1e59da24ad191ac53dd52db9495b1f2891d78c124'
    // 记忆冲突选择说明与项目条目层级预检。
    fingerprints['2.58.0'] = 'aaf71c5155285652a291b82101e9b92f2c6b5623025d8f8c3e99542da616518a'
    expect(fingerprints[EXTERNAL_CONTRACT_VERSION], `工具参数/说明/输出变化时须升级 EXTERNAL_CONTRACT_VERSION，再登记该版本指纹：${fingerprint}`).toBe(fingerprint)
  })
  it('媒体 mode 的枚举与说明经过目录授权投影仍完整保留', () => {
    for (const access of [READ_ONLY, WRITE, PAID]) {
      const tool = catalog(access).tools.find(item => item.name === 'read_application_media')!
      expect((tool.inputSchema.properties as Record<string, unknown>).mode).toEqual({ type: 'string', enum: ['chunk', 'image'], description: expect.stringContaining('图片默认 image') })
      expect(tool.inputSchema.additionalProperties).toBe(false)
      expect(tool.description).toContain('图片默认返回 image')
      expect((tool.inputSchema.properties as Record<string, unknown>).maxEdge).toMatchObject({ default: 1600 })
      expect((tool.inputSchema.properties as Record<string, unknown>).maxBytes).toMatchObject({ default: 614400, maximum: 1572864 })
    }
  })
  it('新增付费入口只需领域声明，目录自动要求付费授权', () => {
    const original = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get.bind(BUILTIN_APPLICATION_CAPABILITY_REGISTRY)
    const spy = vi.spyOn(BUILTIN_APPLICATION_CAPABILITY_REGISTRY, 'get').mockImplementation(id => {
      const value = original(id)
      return id === 'apply_canvas_image_capability' && value ? { ...value, paidGenerationPreparation: 'prepare_generation_task' } : value
    })
    try {
      expect(toolTier('apply_canvas_image_capability')).toBe('paid')
      expect(names(WRITE)).not.toContain('apply_canvas_image_capability')
      expect(names(PAID)).toContain('apply_canvas_image_capability')
    } finally { spy.mockRestore() }
  })
  it('所有公开生成创建能力都有可调用的只读费用准备入口', () => {
    for (const id of APPLICATION_WRITE_CAPABILITY_IDS) {
      const definition = BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)!
      if (definition.control.impacts.some(impact => impact.effect === 'create' && impact.entityTypes.includes('generation.task'))) {
        expect(definition.paidGenerationPreparation, id).toBeTruthy()
      }
      if (!definition.paidGenerationPreparation) continue
      expect(APPLICATION_READ_CAPABILITY_IDS, id).toContain(definition.paidGenerationPreparation)
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(definition.paidGenerationPreparation)?.readOnly, id).toBe(true)
    }
  })
  it('公开语义写入均有持久目标声明，创建图片能力节点无需付费权限', () => {
    for (const id of APPLICATION_WRITE_CAPABILITY_IDS) {
      if (id === 'change_application_entities') continue
      expect(BUILTIN_APPLICATION_CAPABILITY_REGISTRY.get(id)?.resolveOperationTargets, id).toBeTypeOf('function')
    }
    expect(names(WRITE)).toContain('apply_canvas_image_capability')
    expect(names(READ_ONLY)).not.toContain('apply_canvas_image_capability')
    for (const id of ['create_image_edit_preview', 'commit_image_edit']) {
      expect(names(WRITE)).toContain(id)
      expect(names(READ_ONLY)).not.toContain(id)
    }
    expect(names(WRITE)).toContain('resume_canvas_generation_task')
    expect(names(READ_ONLY)).not.toContain('resume_canvas_generation_task')
  })
  /**
   * 验收线：**工具 schema 与领域约束同源**。
   *
   * 这条红了就说明有人在 MCP 侧手抄了一份参数表——那正是"新增一个已登记业务字段还要回来改
   * MCP"的开始。读取工具必须逐字节等于能力定义的 Zod 输入投影；写入工具只允许多出协议信封。
   */
  it('能力工具的参数表逐字节来自能力定义，MCP 侧不存在第二份字段表', () => {
    const listed = new Map(catalog(PAID).tools.map((tool) => [tool.name, tool]))
    for (const tool of hostTools) {
      if (EXCLUDED_TOOLS.some((excluded) => excluded.name === tool.id)) continue
      const projected = listed.get(tool.id)
      expect(projected, tool.id).toBeDefined()
      if (APPLICATION_READ_CAPABILITY_IDS.some((id) => id === tool.id)) {
        expect(projected!.inputSchema, tool.id).toEqual({ ...tool.inputSchema, properties: { ...tool.inputSchema.properties as object, ...resultDetailFields(tool.id) }, type: 'object' })
        continue
      }
      const properties = projected!.inputSchema.properties as Record<string, unknown>
      const declared = tool.inputSchema.properties as Record<string, unknown>
      const withoutEnvelope = { ...properties }
      delete withoutEnvelope.operationId
      delete withoutEnvelope.baselineIds
      for (const key of Object.keys(RESULT_DETAIL_FIELDS)) delete withoutEnvelope[key]
      const declaredWithoutCompat = { ...declared }
      delete declaredWithoutCompat.expectedRevisions
      expect(withoutEnvelope, tool.id).toEqual(declaredWithoutCompat)
    }
  })

  it('operationId 必填、普通操作基线可省略，expectedRevisions 一律不对外', () => {
    const listed = catalog(PAID).tools.filter((tool) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === tool.name))
    expect(listed.map((tool) => tool.name).sort()).toEqual([...APPLICATION_WRITE_CAPABILITY_IDS].sort())
    for (const tool of listed) {
      const required = tool.inputSchema.required as string[]
      expect(required, tool.name).toContain('operationId')
      expect(required, tool.name).not.toContain('baselineIds')
      expect(required, tool.name).not.toContain('expectedRevisions')
      expect(Object.keys(tool.inputSchema.properties as object), tool.name).not.toContain('expectedRevisions')
      expect(tool.annotations?.readOnlyHint, tool.name).toBe(false)
    }
  })

  it('目录按授权档过滤，被挡住的工具指名道姓说明缺哪一档', () => {
    expect(names(READ_ONLY).filter((name) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === name))).toEqual([])
    expect(names(READ_ONLY)).not.toContain('get_application_operation')
    expect(names(READ_ONLY)).not.toContain('review_application_operation')
    expect(names(WRITE)).toContain('review_application_operation')
    expect(catalog(READ_ONLY).hidden.map((item) => item.name).sort())
      .toEqual([...APPLICATION_WRITE_CAPABILITY_IDS, 'get_application_operation', 'review_application_operation', 'retry_application_operation_save'].sort())
    expect(catalog(READ_ONLY).hidden.find((item) => item.name === 'create_visible_generation_task')?.tier).toBe('paid')

    // 改权限：写工具出现，付费工具仍然缺席，并且缺席原因写明缺付费档而不是缺修改档。
    expect(names(WRITE)).toEqual(expect.arrayContaining(['change_application_entities', 'get_application_operation', 'review_application_operation', 'retry_application_operation_save']))
    expect(names(WRITE)).not.toContain('create_visible_generation_task')
    expect(catalog(WRITE).hidden).toEqual(['create_visible_generation_task', 'submit_canvas_node_generation', 'generate_image_edit_outpaint', 'generate_video_edit_in_place']
      .map(name => ({ name, tier: 'paid', requires: '本连接未获「允许付费生成」授权' })))
    expect(names(PAID)).toContain('create_visible_generation_task')
    expect(catalog(PAID).hidden).toEqual([])
  })

  it('删除授权不改变目录，只在调用时校验；两条恢复能力任何档位都不作为独立工具出现', () => {
    expect(names({ allowWrites: true, allowDestructive: true, allowPaid: false })).toEqual(names(WRITE))
    for (const access of [READ_ONLY, WRITE, PAID]) {
      for (const excluded of EXCLUDED_TOOLS) expect(names(access), excluded.name).not.toContain(excluded.name)
    }
  })

  it('没有操作账本时写入与账本工具整体缺席，只读工具不受影响', () => {
    expect(names(PAID, false).filter((name) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === name))).toEqual([])
    expect(names(PAID, false)).not.toContain('get_application_operation')
    expect(names(PAID, false)).not.toContain('review_application_operation')
    expect(names(PAID, false)).toEqual(expect.arrayContaining([...APPLICATION_READ_CAPABILITY_IDS, 'read_application_media', 'describe_application_contract']))
  })

  it('协议工具的参数表在服务端只声明一次，目录与解析共用', () => {
    const listed = new Map(catalog(PAID).tools.map((tool) => [tool.name, tool]))
    for (const spec of PROTOCOL_TOOL_SPECS) {
      expect(listed.get(spec.name)?.inputSchema, spec.name).toEqual({ ...spec.inputSchema, properties: { ...spec.inputSchema.properties as Record<string, unknown>, ...RESULT_DETAIL_FIELDS } })
      expect(toolTier(spec.name), spec.name).toBe(spec.tier)
    }
  })
})

describe('契约发现的投影', () => {
  it('schema 哈希不受对象键和目录顺序影响，变化可按 names 取服务端完整 schema', () => {
    const current = catalog(WRITE)
    const tool = current.tools.find(item => item.name === 'get_video_edit_clip_pauses')!
    const reordered = (value: unknown): unknown => Array.isArray(value) ? value.map(reordered)
      : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).reverse().map(([key, item]) => [key, reordered(item)])) : value
    expect(applicationToolSchemaHash({ ...tool, inputSchema: reordered(tool.inputSchema) as typeof tool.inputSchema })).toBe(applicationToolSchemaHash(tool))
    expect(applicationCatalogSchemaHash({ ...current, tools: [...current.tools].reverse() })).toBe(applicationCatalogSchemaHash(current))
    for (const changed of [{ ...tool, name: `${tool.name}_new` }, { ...tool, description: `${tool.description}变更` }, { ...tool, inputSchema: { ...tool.inputSchema, required: [] } }]) {
      expect(applicationToolSchemaHash(changed)).not.toBe(applicationToolSchemaHash(tool))
    }
    const contract = buildApplicationContract({ domains, access: WRITE, catalog: current, port: 0, requestedDomains: [], names: [tool.name], includeSchemas: true })
    expect(contract.toolSchemas).toEqual([{ name: tool.name, schemaHash: applicationToolSchemaHash(tool), description: tool.description, inputSchema: tool.inputSchema }])
    expect(contract.catalogSchemaHash).toBe(applicationCatalogSchemaHash(current))
    expect(buildApplicationContract({ domains, access: READ_ONLY, catalog: catalog(READ_ONLY), port: 0, requestedDomains: [], names: ['change_application_entities'], includeSchemas: true }).toolSchemas).toEqual([])
  })
  it('域级摘要默认不展开实体；点名的域才展开，避免一次注入全部属性', () => {
    const summary = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: [] })
    const listed = summary.domains as Array<Record<string, unknown>>
    expect(listed.every((domain) => !('entities' in domain))).toBe(true)
    expect(listed.find((domain) => domain.id === 'settings')).toMatchObject({ readable: true, writable: true, entityTypes: 1, writableEntityTypes: 1 })
    expect(listed.find((domain) => domain.id === 'storyboard')).toMatchObject({ writable: false, writableEntityTypes: 0 })

    const expanded = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: ['storyboard'] })
    const storyboard = (expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'storyboard')!
    expect(expanded.access).toHaveProperty('alternativeRoutes')
    expect((storyboard.entities as Array<{ readOnlyReason?: string }>)[0].readOnlyReason).toContain('只读摘要投影')
    expect((expanded.domains as Array<Record<string, unknown>>).find((domain) => domain.id === 'settings')).not.toHaveProperty('entities')
  })

  it('契约固定版本矩阵，并把"清单里没有"与"调用被拒"讲清楚', () => {
    const contract = buildApplicationContract({ domains, access: WRITE, catalog: catalog(WRITE), port: 43821, requestedDomains: [], detail: 'full' })
    expect(contract.contract).toMatchObject({
      externalContractVersion: EXTERNAL_CONTRACT_VERSION,
      applicationCapabilityCatalog: 'application-capabilities/v2',
      sdkVersion: '2.0.0',
      protocolVersions: ['2026-07-28'],
      server: { name: 'henji', version: '2.0.0' },
    })
    expect((contract.contract as { transport: { url: string } }).transport.url).toBe('http://127.0.0.1:43821/mcp')
    const access = contract.access as { paid: boolean; note: string; hiddenTools: Array<{ name: string }>; excludedTools: Array<{ reason: string }> }
    expect(access.paid).toBe(false)
    expect(access.hiddenTools.map((item) => item.name)).toEqual(['create_visible_generation_task', 'submit_canvas_node_generation', 'generate_image_edit_outpaint', 'generate_video_edit_in_place'])
    expect(access.note).toContain('PERMISSION_DENIED')
    expect(access.excludedTools).toHaveLength(EXCLUDED_TOOLS.length)
    expect(access.excludedTools.every((item) => item.reason.length > 10)).toBe(true)
    // 降级路径必须写在契约里：通知改轮询、资源读取保留工具入口、审批留在应用内。
    const workflows = (contract.workflows as string[]).join('\n')
    expect(workflows).toContain('不需要客户端支持通知扩展')
    expect(workflows).toContain('read_application_media')
    expect(workflows).toContain('痕迹 AI')
    expect((contract.tools as Array<{ name: string; envelope: string }>).filter((tool) => tool.envelope === 'operationId+baselineIds').map((tool) => tool.name))
      .toEqual(names(WRITE).filter((name) => APPLICATION_WRITE_CAPABILITY_IDS.some((id) => id === name)))
  })

  it('契约本身足够小，不会挤占单次结果上限', () => {
    const contract = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 43821, requestedDomains: domains.map((domain) => domain.id) })
    expect(Buffer.byteLength(JSON.stringify(contract))).toBeLessThan(64 * 1024)
  })
  it('内置助手契约指向对话权限，不让用户创建 MCP 连接；全权限可发现付费生成', () => {
    const contract = buildApplicationContract({ domains, access: PAID, catalog: catalog(PAID), port: 0, requestedDomains: [], callerKind: 'embedded', detail: 'full' })
    expect(contract.contract).toMatchObject({ transport: { kind: 'embedded', requiresExternalConnection: false } })
    expect(contract.access).toMatchObject({ paid: true, destructive: true, note: expect.stringContaining('助手操作权限') })
    expect(contract.tools).toEqual(expect.arrayContaining([expect.objectContaining({ name: 'create_visible_generation_task' })]))
  })
})
