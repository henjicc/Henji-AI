# 进度条配置说明（meta.progress）

本说明用于新架构下的进度条配置。进度条的速度与联动规则全部由模型的 `meta.progress` 控制，UI 不再写模型特定逻辑。

## 配置位置

在模型定义文件中：

```ts
export const xxxModel = defineModel({
  meta: {
    // ...
    progress: { /* 见下方配置 */ }
  },
  // ...
})
```

## 两种模式

### 1) 同步模型：time

用于同步请求（没有轮询的模型），通过“预计耗时”驱动进度。

```ts
progress: {
  mode: 'time',
  baseDurationMs: 20000,
  perUnitMs: 15000,
  scaleWith: 'maxImages',
  maxDurationMs: 180000
}
```

说明：
- `baseDurationMs`：基础耗时（毫秒）。
- `perUnitMs`：联动参数每增加 1 单位时的额外耗时。
- `scaleWith`：联动参数 ID（如数量参数）。
- `minDurationMs` / `maxDurationMs`：上下限夹紧（可选）。
- `tickMs`：进度更新间隔（可选，默认 300ms）。
- `curve`：曲线配置（可选，见下文）。

### 2) 异步模型：polling

用于异步轮询模型，通过“预计轮询次数 + 轮询间隔”估算耗时驱动进度。

```ts
progress: {
  mode: 'polling',
  baseAttempts: 28,
  perUnitAttempts: 2,
  scaleWith: 'ppioWan25VideoDuration',
  minDurationMs: 40000,
  maxDurationMs: 180000
}
```

说明：
- `baseAttempts`：基础预计轮询次数。
- `perUnitAttempts`：联动参数每增加 1 单位时，额外增加的轮询次数。
- `scaleWith`：联动参数 ID（如时长、数量）。
- `intervalMs`：轮询间隔覆盖值（可选，默认取 `meta.polling.interval`）。
- `minDurationMs` / `maxDurationMs`：最终耗时的上下限夹紧（可选）。
- `tickMs`：进度更新间隔（可选，默认 300ms）。
- `curve`：曲线配置（可选，见下文）。

## 曲线配置（curve）

默认曲线：先快后慢，并持续前进，避免卡住。

```ts
progress: {
  // ...
  curve: {
    slowStart: 80,
    slowEnd: 95,
    cap: 99,
    tailFactor: 1.2
  }
}
```

说明：
- `slowStart`：开始减速的进度点（默认 80）。
- `slowEnd`：减速阶段结束的进度点（默认 95）。
- `cap`：完成前允许达到的最高进度（默认 99）。
- `tailFactor`：尾段趋近速度因子（越大越慢）。

## 联动规则（scaleWith）

- 支持数值或数组：
  - 数值：直接作为数量
  - 数组：使用数组长度
- 不存在或无法解析时，默认按 1 处理
- 公式（默认）：`base + perUnit * (n - 1)`

## 运行行为

- 进度会按 `tickMs` 持续更新，即使时间估算已超过预期，也会缓慢向 `cap` 逼近，确保始终在动。
- 请求完成时，会快速动画到 100% 并展示结果。

## 示例：Seedream 4.0

```ts
progress: {
  mode: 'time',
  baseDurationMs: 20000,
  perUnitMs: 15000,
  scaleWith: 'maxImages',
  maxDurationMs: 180000
}
```

## 示例：Wan 2.5 Preview

```ts
progress: {
  mode: 'polling',
  baseAttempts: 28,
  perUnitAttempts: 2,
  scaleWith: 'ppioWan25VideoDuration',
  minDurationMs: 40000,
  maxDurationMs: 180000
}
```
