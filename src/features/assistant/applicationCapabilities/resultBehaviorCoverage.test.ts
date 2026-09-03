// @vitest-environment jsdom
import fs from 'node:fs'
import path from 'node:path'
import { beforeAll, describe, expect, it } from 'vitest'

import type { ApplicationMutationExecutor } from '@/core/application-control'
import { loadRealModelsIntoRegistry } from '@/tests/loadRealModels'

import { getApplicationControlExecutionEngine, getApplicationReflectionRegistry } from './applicationControlRegistry'

type Scenario = { file: string; title: string }

/** 每条登记都必须在对应测试里从正式状态源断言结果，不能只看 completed/evidence。 */
const RESULT_SCENARIOS: Record<string, Scenario[]> = {
  settings: [
    { file: 'src/features/settings/application-control/settingsReflectionResult.test.ts', title: '通过 describe 与 change 切换 general.language，正式读取值随之变化' },
    { file: 'src/features/settings/application-control/settingsReflectionResult.test.ts', title: '通过通用 change 修改 interface.theme_tone，zustand 真相源与反射读回一致' },
  ],
  assets: [
    { file: 'src/features/assets/application/assetMutationExecutor.test.ts', title: '名称与标签写入委托正式领域服务' },
    { file: 'src/features/assets/application/assetLibraryExecutors.test.ts', title: '创建集合后可通过补偿 token 删除创建结果' },
    { file: 'src/features/assets/application/assetLibraryExecutors.test.ts', title: '集合名称修改后可恢复包含冒号的原名称' },
  ],
  canvas: [
    { file: 'src/features/canvas/application/canvasReflection.test.ts', title: '原子更新节点标题与位置并可整体撤销' },
    { file: 'src/features/canvas/application/canvasApplicationService.test.ts', title: '按目录 schema 添加、确定性布局、合法连接并逐步撤销' },
  ],
  generation: [
    { file: 'src/features/generation/application/generationModelMutationExecutor.test.ts', title: '通过统一计划提交把模型隐藏，值真的落到 hidden_models，且可撤销' },
    { file: 'src/features/generation/application/generationDraftMutationExecutor.test.ts', title: '助手写提示词、换模型，草稿真的变了，且可撤销' },
  ],
  image_mark: [
    { file: 'src/features/imageMark/application/imageMarkReflection.test.ts', title: '打开编辑器后能读到默认文档，改裁剪与旋转可撤销' },
    { file: 'src/features/imageMark/application/imageMarkReflection.test.ts', title: '能新建一条矩形标注、改它的颜色与位置，再删掉它' },
    { file: 'src/features/imageMark/application/imageMarkReflection.test.ts', title: '多会话隔离：往一个会话写标注不影响另一个会话' },
  ],
  image_edit: [
    { file: 'src/features/imageEdit/v3/application/imageEditV3ApplicationControl.test.ts', title: '实时 V3 图层属性和蒙版反相经通用事务写回同一命令总线并可撤销' },
    { file: 'src/features/imageEdit/v3/application/imageEditV3ApplicationControl.test.ts', title: '通用集合创建删除图层并把 V3 标注别名写回所属标注图层' },
    { file: 'src/features/canvas/application/multiLayerDocumentNodeCanvasAdapter.test.ts', title: '原子创建普通图片节点和稳定连线，并保持编辑器、选择与原文档不变' },
  ],
  camera_stage: [
    { file: 'src/features/cameraStage/application/cameraStageStateKeyframeAnimationResult.test.ts', title: '一次 change 内连续定位播放头并写属性，也会落成多个状态关键帧' },
    { file: 'src/features/cameraStage/application/cameraStageStateKeyframeAnimationResult.test.ts', title: '摄像机位置、旋转与 fov 写入会自动记录完整状态关键帧，同一时间只更新不重复' },
    { file: 'src/features/cameraStage/application/cameraStageArchitectureResult.test.ts', title: '建模写入同步全部状态关键帧且不产生意外动画' },
  ],
}

const RESULT_SCENARIO_BASELINE: Record<keyof typeof RESULT_SCENARIOS, number> = {
  settings: 2,
  assets: 3,
  canvas: 2,
  generation: 2,
  image_mark: 3,
  image_edit: 3,
  camera_stage: 3,
}

function writableDomains(): string[] {
  const registry = getApplicationReflectionRegistry()
  const engine = getApplicationControlExecutionEngine() as unknown as {
    mutationExecutors: Map<string, ApplicationMutationExecutor>
    collectionExecutors: Map<string, unknown>
  }
  const entityTypes = new Set([
    ...engine.mutationExecutors.keys(),
    ...engine.collectionExecutors.keys(),
  ])
  const description = registry.describe({}, {
    exposure: 'assistant',
    permissions: new Set(registry.listDeclaredPropertyPermissions()),
    acceptedDataClasses: new Set(['C0', 'C1', 'C2']),
  })
  return [...new Set(description.entities
    .filter((entity) => entityTypes.has(entity.id))
    // 模型目录与生成草稿在反射目录里分属 models/generation，但同属用户定义的 generation 写域。
    .map((entity) => entity.id.startsWith('generation.') ? 'generation' : entity.domain))].sort()
}

describe('写领域结果级能力覆盖', () => {
  beforeAll(async () => {
    await loadRealModelsIntoRegistry()
  })

  it('每个拥有 mutation/collection 执行器的领域都登记 2–3 条结果场景', () => {
    const domains = writableDomains()
    expect(Object.keys(RESULT_SCENARIOS).sort()).toEqual(domains)
    for (const domain of domains) {
      expect(RESULT_SCENARIOS[domain]?.length, `${domain} 结果场景数量`).toBe(RESULT_SCENARIO_BASELINE[domain])
    }
  })

  it('登记的场景文件和测试标题真实存在', () => {
    for (const [domain, scenarios] of Object.entries(RESULT_SCENARIOS)) {
      for (const scenario of scenarios) {
        const file = path.resolve(process.cwd(), scenario.file)
        expect(fs.existsSync(file), `${domain}: ${scenario.file}`).toBe(true)
        expect(fs.readFileSync(file, 'utf8'), `${domain}: ${scenario.title}`).toContain(`it('${scenario.title}'`)
      }
    }
  })
})
