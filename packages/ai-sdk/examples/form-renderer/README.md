# form-renderer

无框架、无 DOM 依赖的参数表单契约示例。它从 `client.catalog` 读取真实模型，使用
`evaluateRuntimeCondition()` 处理显隐/禁用，使用 `getRuntimeMediaInputContract()` 生成媒体上传入口。

```bash
npm install
npm start
```

入口会真实渲染 5 个差异模型，覆盖普通下拉与数值、条件显隐、动态 input limits、通用与特殊媒体、
`composite` 宿主钩子。输出是最小 HTML 骨架，不包含痕迹AI 的名称、i18n、面板布局或专属组件。

媒体控件只负责让宿主选择本地/受管资源，不能降级为 URL 文本框；实际上传仍由 SDK 在请求边界调用
当前供应商的官方上传能力。`composite` 只输出 `data-control="custom"`，宿主按参数 ID 注入自己的组件。
