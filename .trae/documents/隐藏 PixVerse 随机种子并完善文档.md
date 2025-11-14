## 目标
- 参考 Hailuo 的处理，在 UI 中隐藏 PixVerse 的随机种子控件，并避免向后端传递该参数。
- 同步更新 PixVerse 文档，去除/标注随机种子参数不在应用内使用。

## UI 改动（MediaGenerator.tsx）
- 随机种子输入的条件中加入 `selectedModel !== 'pixverse-v4.5'`，使其在 PixVerse 下不渲染。
- 其他控件保持不变（负面提示、风格、fast_mode）。

## 适配器改动（PPIOAdapter.ts）
- PixVerse 分支中移除 `seed` 字段或仅在定义时传递；UI隐藏后该字段为 `undefined`，不再出现在请求体。

## 文档改动
- `API文档/派欧云/PixVerse_V4.5_图生视频.md` 与 `PixVerse_V4.5_文生视频.md`：删除或标注 `seed` 字段不在当前应用配置中使用，保持其余字段不变。

## 验证
- 选择 PixVerse 时，不显示随机种子输入；抓请求体确认没有 `seed`。
- 文档中不再出现 `seed` 参数，或说明未使用。

确认后我将进行上述修改并验证。