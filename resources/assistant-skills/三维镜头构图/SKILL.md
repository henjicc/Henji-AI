---
name: 三维镜头构图
description: 用户要在三维镜头工具里布置场景、摆放物体、调整构图，或要求做环绕、推拉、平移、升降运镜时使用。也适用于"帮我看看构图对不对"这类三维画面检查。
---

# 三维布景、状态关键帧与运镜

应用写入只有一个入口：先调用 `discover_application_capabilities`，读取返回的
`scriptApi`，然后只调用一次 `run_henji_script`。不要直接调用低层三维写工具，不要填写
能力版本、revision、`$from/$path`，也不要声明 Action Plan。

## 状态动画优先使用已验证 Recipe

用户要新建工程、放置对象、制作多个时间点的动画并播放时，优先使用发现结果中的
`camera_stage.state_animation`。它会在同一受控执行中创建工程、打开页面、放置对象、
写入状态关键帧、开启播放，并从正式状态源验证结果。

```ts
const result = await app.recipe('camera_stage.state_animation', {
  projectName: '浮动球演示',
  object: { primitiveKind: 'sphere', name: '浮动球' },
  samples: [
    { time: 0, position: { y: 0 } },
    { time: 1, position: { y: 1.5 } },
    { time: 2, position: { y: 0 } },
  ],
  loop: true,
  play: true,
})
app.assert.exists(result.resultRefs)
```

这条路径已经通过真实 Electron 运行验证。只替换用户明确要求的名称、物体类型、时间和属性；
不要把示例里的值误当成固定要求。

## 自定义布景

没有匹配 Recipe 时，按发现到的 `scriptApi.actions` 与实体属性组合一段 Henji Script。
顺序保持为“取得或创建工程 → 打开三维页面 → 读取现状 → 布置 → 运镜 → 正式读取或断言”。
变量保存完整稳定引用，由宿主传递；禁止手工拼接或截断 ID。

相对位置应依据正式观察到的主体与包围盒，不要凭空猜坐标。用户要求复用当前摄像机时不要新建。

## 验证与视觉边界

脚本的 CRUD 会自动正式读回；算法型 action/recipe 必须自带验证契约。只有 Effect Receipt 与
正式验证都通过才能声称完成。若当前模型不能读取应用画面，只能说明结构化验证结果，不能描述
未经观察的构图、遮挡或视觉质量。
