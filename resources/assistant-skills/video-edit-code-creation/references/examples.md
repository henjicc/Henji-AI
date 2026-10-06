# 两个小样例

样例只演示写法；做用户的作品时按用户要求重新设计画面和参数，不要原样提交。引用 id 换成实际返回值，外部连接的写入调用另加 operationId。

## 样例一：滑入标题条（生成器 + 关键帧）

```ts
export default {
  apiVersion: 1, name: "滑入标题条", kind: "generator", mode: "dynamic",
  width: 1920, height: 1080, durationSeconds: 4, seed: 1,
  parameters: {
    title: { type: "text", title: "标题", default: "新的标题", maxLength: 40 },
    accent: { type: "color", title: "强调色", default: [1, 0.55, 0.1, 1], animatable: true },
    slide: { type: "number", title: "滑入进度", default: 1, min: 0, max: 1, step: 0.01, animatable: true }
  },
  render(ctx) {
    const barX = mix(-900, 120, ctx.params.slide)
    const fade = ctx.params.slide
    return [
      rect({ x: barX, y: 820, width: 860, height: 120, fill: [0, 0, 0, 0.6 * fade], radius: 16 }),
      rect({ x: barX, y: 820, width: 12, height: 120, fill: ctx.params.accent }),
      text({ x: barX + 48, y: 880, text: ctx.params.title, fontSize: 64, color: [1, 1, 1, fade], align: "left" })
    ]
  }
}
```

提交源码并找到新的代码项目项后，第二次调用插入片段，同时写参数和 0–0.5 秒的滑入关键帧：

```json
{
  "summary": "插入滑入标题条并设置滑入动画",
  "changes": [{
    "kind": "create_items",
    "entityType": "video_edit.clip",
    "parent": { "kind": "video_edit.sequence", "id": "剪辑id:序列id" },
    "items": [{ "properties": {
      "video_edit.clip.item_id": "项目项id",
      "video_edit.clip.kind": "code",
      "video_edit.clip.name": "滑入标题条",
      "video_edit.clip.start": 120,
      "video_edit.clip.track": 2,
      "video_edit.clip.code_parameters": { "title": "第一章 出发", "accent": [1, 0.55, 0.1, 1], "slide": 0 },
      "video_edit.clip.code_curves": { "slide": [
        { "id": "slide-start", "sourceInUs": 0, "sourceRemainder": { "numerator": 0, "denominator": 1 }, "value": 0, "interpolation": "ease" },
        { "id": "slide-end", "sourceInUs": 500000, "sourceRemainder": { "numerator": 0, "denominator": 1 }, "value": 1, "interpolation": "hold" }
      ] }
    } }]
  }]
}
```

检查：30fps 序列取第 120、127、135 帧合成画面，应看到标题条从左侧滑入到 x=120 并完全显示。

## 样例二：暖色暗角（滤镜效果）

```ts
export default {
  apiVersion: 1, name: "暖色暗角", kind: "filter", mode: "static",
  width: 1920, height: 1080, durationSeconds: 10, seed: 1,
  parameters: {
    warmth: { type: "number", title: "暖色", default: 0.4, min: 0, max: 1, step: 0.01, animatable: true },
    vignette: { type: "number", title: "暗角", default: 0.5, min: 0, max: 1, step: 0.01 }
  },
  render(ctx) {
    const c = sample(ctx.u, ctx.v)
    const dx = ctx.u - 0.5
    const dy = ctx.v - 0.5
    const k = 1 - ctx.params.vignette * smoothstep(0.05, 0.5, dx * dx + dy * dy)
    return rgba(clamp(c.r * (1 + ctx.params.warmth * 0.2) * k, 0, 1), c.g * k, c.b * (1 - ctx.params.warmth * 0.2) * k, c.a)
  }
}
```

提交源码得到 `video_edit.code_material` 后，把它加到已有画面片段上：

```json
{
  "summary": "给选中片段加暖色暗角",
  "changes": [{
    "kind": "create_items",
    "entityType": "video_edit.effect",
    "parent": { "kind": "video_edit.clip", "id": "剪辑id:片段id" },
    "items": [{ "properties": {
      "video_edit.effect.definition_id": "素材定义id",
      "video_edit.effect.name": "暖色暗角",
      "video_edit.effect.parameters": { "warmth": 0.6, "vignette": 0.4 }
    } }]
  }]
}
```

检查：分别取加效果前后同一帧的合成画面，四角应变暗、整体偏暖，主体细节仍在。
