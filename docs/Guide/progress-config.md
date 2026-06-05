# 进度条配置说明（当前框架）

当前项目的进度条默认时间**不再建议**通过模型里的 `meta.progress.baseDurationMs`、`baseAttempts` 这类字段手动配置。

现在统一走这套顺序：

1. 后端学习到的本机样本
2. 打包内置的 `progress-seeds.json`
3. 模型自身的轮询信息（仅 `meta.polling`）
4. 通用类型兜底

## 当前原则

- 不再为单个模型手动写自定义默认耗时
- 不再通过 `meta.progress` 给某个模型单独指定基础秒数
- 进度条预计时间由后端统一计算
- 生成页和画布页共用同一套估时逻辑

## 仍然保留的模型配置

### `meta.polling`

异步模型仍然应该保留 `meta.polling`，因为后端需要它来决定轮询间隔和最大轮询次数。

```ts
polling: {
  interval: 3000,
  maxAttempts: 120,
  expectedAttempts: 20
}
```

说明：

- `interval`：真实轮询间隔
- `maxAttempts`：真实最大轮询次数
- `expectedAttempts`：当没有学习样本和种子时，可作为后端估时参考

### `meta.progress`

`meta.progress` 仍然被代码兼容读取，但**新模型和现有模型都不应再继续新增或维护它作为默认耗时来源**。

也就是说：

- 存量可以逐步移除
- 新增模型不要再写 `baseDurationMs` / `baseAttempts`

## 默认估时的通用兜底

当模型既没有学习样本，也没有种子时，后端会按类型走通用估时：

- `image`：基础 60s
- `video`：基础 120s
- `audio`：基础 10s

其中：

- 图片会按张数做简单放大
- 视频会按时长做简单放大
- 音频会按文本长度做简单放大

## 开发期种子导出

如果你本机已经积累了一些样本，可以导出本地默认值：

```bash
npm run progress:export-seeds
```

导出文件位置：

```text
dev-data/progress-seeds.local.json
```

后续执行以下命令时，会自动把这个本地文件合并进最终打包资源：

- `npm run dev`
- `npm run build`
- `npm run tauri:dev`
- `npm run tauri:build`

## 建议

- 如果你觉得某个模型的默认时间不合理，优先通过真实生成样本和种子修正
- 不要重新回到“每个模型手写一个秒数”的旧模式
- 如果确实需要排查来源，先看日志里的：
  - `本轮预计时间`
  - `本轮实际时间`
  - `预计来源`
  - `最近全局样本`
  - `最近时段样本`
