import { describe, expect, it } from 'vitest'

import { HENJI_SCRIPT_LANGUAGE } from '../../../../../src/core/assistant/capabilities/henjiScriptApplicationCapabilities'
import { compileHenjiScript } from './compiler'
import {
  cameraStageStateAnimationRecipeInputSchema,
  generationImageToCanvasRecipeInputSchema,
  HENJI_RECIPE_REGISTRY,
} from './recipes'
import { digest } from './runtime-values'
import { HenjiScriptError } from './types'

function compile(source: string) {
  return compileHenjiScript({ language: HENJI_SCRIPT_LANGUAGE, summary: '测试脚本', source })
}

describe('Henji Script compiler', () => {
  it('断点和计划摘要不受对象键顺序影响，可安全跨数据库 JSON 往返', () => {
    const original = {
      remainingInstructions: [{ stepId: 'step-1', kind: 'call', args: [{ value: 1, kind: 'literal' }] }],
      variables: [{ value: { z: 2, a: 1 }, name: 'result' }],
    }
    const persistedEquivalent = {
      variables: [{ name: 'result', value: { a: 1, z: 2 } }],
      remainingInstructions: [{ args: [{ kind: 'literal', value: 1 }], kind: 'call', stepId: 'step-1' }],
    }

    expect(digest(original)).toBe(digest(JSON.parse(JSON.stringify(persistedEquivalent))))
  })

  it('图片生成配方可安全复用当前草稿模型，不要求模型猜 modelId', () => {
    expect(generationImageToCanvasRecipeInputSchema.parse({
      projectName: '自动验收', prompt: '暖色极简几何山谷、无文字',
    })).toMatchObject({ projectName: '自动验收', params: {}, preferredProviderIds: [] })
  })

  it('图片生成成功前不创建画布，外部失败不会留下半成品工程', () => {
    const recipe = HENJI_RECIPE_REGISTRY.get('generation.image_to_canvas')
    if (!recipe) throw new Error('RECIPE_NOT_FOUND')
    const expansion = recipe.expand({
      projectName: '自动验收', prompt: '暖色极简几何山谷、无文字', params: {}, preferredProviderIds: [],
    }, 'step_1', { line: 1, column: 1 })
    const actions = expansion.instructions.flatMap((instruction) => (
      instruction.kind === 'call' && instruction.api === 'action'
        && instruction.args[0]?.kind === 'literal' && typeof instruction.args[0].value === 'string'
        ? [instruction.args[0].value]
        : []
    ))

    expect(actions.slice(0, 4)).toEqual([
      'resolve_generation_model', 'prepare_generation_task',
      'create_visible_generation_task', 'get_generation_task',
    ])
    expect(actions.indexOf('create_canvas_project')).toBeGreaterThan(actions.indexOf('get_generation_task'))
    expect(actions).not.toContain('open_canvas_project')
  })

  it('3D 状态动画配方同时记录对象与摄像机状态，不退化成独立轨迹', () => {
    const input = cameraStageStateAnimationRecipeInputSchema.parse({
      projectName: '复杂验收', object: { primitiveKind: 'sphere', name: '夕阳球体' },
      samples: [
        { time: 0, position: { y: 0 }, camera: { position: { z: 8 }, rotation: { y: 0 }, fov: 45 } },
        { time: 1, position: { y: 1.5 }, scale: { x: 1.2, y: 1.2, z: 1.2 }, camera: { position: { z: 7 }, rotation: { y: 10 }, fov: 50 } },
      ],
    })
    const recipe = HENJI_RECIPE_REGISTRY.get('camera_stage.state_animation')
    if (!recipe) throw new Error('RECIPE_NOT_FOUND')
    const serialized = JSON.stringify(recipe.expand(input, 'camera', { line: 1, column: 1 }))

    expect(serialized).toContain('camera_stage.object.animatable.transform.position.y')
    expect(serialized).toContain('camera_stage.camera.animatable.transform.position.z')
    expect(serialized).toContain('camera_stage.camera.animatable.transform.rotation.y')
    expect(serialized).toContain('camera_stage.camera.animatable.fov')
    expect(serialized).not.toContain('apply_camera_stage_camera_move')
  })

  it('把 action、实体写入、断言和有界循环编译为语义 IR', () => {
    const plan = compile(`
      const project = await app.action('create_camera_stage_project', { name: '浮动球' });
      const ball = await app.action('place_camera_stage_object', {
        projectId: project.projectId,
        primitiveKind: 'sphere',
        name: '球'
      });
      for (const y of app.take([0, 1.5, 0], 3)) {
        await app.entities.update(ball.resultRefs[0], {
          'camera_stage.object.animatable.transform.position.y': y
        });
      }
      app.assert.exists(ball.resultRefs);
    `)

    expect(plan.schemaVersion).toBe('henji-script-ir/v1')
    expect(plan.operationUpperBound).toBe(6)
    expect(plan.instructions.map((item) => item.kind)).toEqual([
      'call', 'call', 'call', 'call', 'call', 'assert',
    ])
    expect(plan.instructions.filter((item) => item.kind === 'call').map((item) => item.api)).toEqual([
      'action', 'action', 'entities.update', 'entities.update', 'entities.update',
    ])
  })

  it.each([
    ["import fs from 'node:fs';", 'SCRIPT_UNSUPPORTED_SYNTAX'],
    ["const p = process.env;", 'SCRIPT_UNSUPPORTED_SYNTAX'],
    ["while (true) { await app.action('x', {}); }", 'SCRIPT_UNSUPPORTED_SYNTAX'],
    ["const result = await app.action('x', {}); const key = 'id'; const value = result[key];", 'SCRIPT_UNSUPPORTED_SYNTAX'],
    ["const value = app.constructor;", 'SCRIPT_UNSUPPORTED_SYNTAX'],
  ])('在第一次写入前拒绝危险源码 %#', (source, code) => {
    expect(() => compile(source)).toThrowError(HenjiScriptError)
    try {
      compile(source)
    } catch (error) {
      expect(error).toMatchObject({ code })
    }
  })

  it('允许用静态字符串字面量读取带点号的公开属性 ID', () => {
    const plan = compile(`
      const entity = await app.entities.read(
        { kind: 'asset.library', id: 'library-1' },
        ['asset.library.name']
      );
      app.assert.equal(entity.properties['asset.library.name'], '已改名');
    `)
    expect(plan.instructions).toHaveLength(2)
  })

  it('允许确定性的三元表达式基于正式读取结果选择值', () => {
    const plan = compile(`
      const before = await app.entities.read(
        { kind: 'settings.registry', id: 'singleton' },
        ['interface.theme_tone']
      );
      const next = before.properties['interface.theme_tone'] === 'warm' ? 'cool' : 'warm';
      await app.entities.update(before.ref, { 'interface.theme_tone': next });
    `)
    expect(plan.instructions).toHaveLength(2)
    expect(plan.instructions[1]).toMatchObject({ kind: 'call', api: 'entities.update' })
  })

  it('拒绝超过 64 次的循环与超过 128 项的展开计划', () => {
    expect(() => compile(`
      for (const i of app.range(0, 65)) {
        await app.action('read_test', { i });
      }
    `)).toThrowError(expect.objectContaining({ code: 'SCRIPT_PLAN_REJECTED' }))
  })

  it('语法错误返回精确行列', () => {
    try {
      compile("const result = await app.action('x', {;")
      throw new Error('expected compile to fail')
    } catch (error) {
      expect(error).toMatchObject({
        code: 'SCRIPT_PARSE_FAILED', phase: 'parse',
        location: { line: 1 },
      })
    }
  })
})
