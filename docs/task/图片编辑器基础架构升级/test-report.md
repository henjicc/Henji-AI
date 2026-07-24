# 测试记录

## 测试策略

- 状态：自动验证已完成，人工交互验收待执行。
- 执行时机：第一至第三阶段累计测试项，第四阶段统一执行自动测试和命令检查。
- 交互边界：鼠标绘制、拖拽、点击、真实剪贴板和画布连线不由执行 AI 操作，只保留最终人工验收项。

## 自动测试结果

### 图片编辑定向测试

- 命令：`npx vitest run src/core/imageEdit/imageEdit.test.ts src/features/imageEdit/editor/useImageEditorSession.test.tsx src/features/canvas/tools/registry.test.ts src/features/canvas/application/toolProcessor.test.ts src/features/assistant/imageEditAdapter.test.ts`
- 结果：5 个测试文件、17 个用例全部通过。
- 覆盖：V1/V2/旧会话迁移、未知操作保留、非法参数、操作注册与执行端口、统一历史、检查器宽度、画布双格式读取与助手操作转换。

### 全量单元与组件测试

- 命令：`npx vitest run`
- 结果：94 个测试文件、404 个用例通过；2 个测试文件、7 个用例按仓库既有条件跳过。
- 结论：未发现本次架构升级导致的自动化回归。

## 命令检查结果

| 检查 | 结果 | 说明 |
|---|---|---|
| `npm run check:colors` | 通过 | 未新增违规颜色字面量 |
| `npm run lint` | 通过 | 前端 ESLint 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 | Electron TypeScript 通过 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过 | 主进程 ESLint 通过 |
| `npm run electron:build` | 通过 | manifest/seeds、校验、TypeScript 与 electron-vite 构建通过 |
| `npm run electron:smoke` | 通过 | 使用隔离用户目录，原生桥与主流程冒烟通过 |
| `npm run electron:dpi-check` | 通过 | 6 组分辨率/DPI 均无水平溢出或控制台错误 |
| `git diff --check` | 通过 | 仅出现仓库换行风格提示，无格式错误 |

## 环境处理记录

- Electron 自动化首次运行遇到 `better-sqlite3` ABI 137/146 不匹配。
- 已执行 `npm run electron:rebuild` 重建 Electron 原生依赖，随后 build、smoke 和 DPI 检查通过。
- smoke/DPI 使用临时隔离的 `userData`、`LOCALAPPDATA` 和 `APPDATA`，不读取真实用户数据库、媒体授权或历史记录。

## 最终人工验收项

### 编辑器与标注

- 从工具箱打开图片，分别切换矩形、椭圆、箭头、画笔、文字、编号和马赛克并完成一次绘制。
- 验证标注选择、移动、删除、文字确认、样式调整、裁剪、旋转、镜像、撤销和重做。
- 在标注工具之间快速切换时，右侧几何参数面板保持原选择；切换右侧工具时，顶部标注状态不被意外清空。

### 右侧检查器与窗口

- 拖动检查器分隔条到最小和最大宽度，使用键盘调整宽度，再执行折叠、展开和恢复默认。
- 在 960×640、1280×720 和高 DPI 显示环境观察标题、工具栏、画布与检查器，确认文字和控件不重叠。
- 关闭并重新打开图片编辑器，确认面板宽度与折叠偏好符合持久化预期。

### 工具箱与图片查看器

- 验证打开、拖入、粘贴、复制、另存为和加入资产库；确认失败时仍能看到现有日志入口中的结构化错误。
- 在图片查看器中分别取消和保存，确认取消不写回，保存产生新图片且可再次编辑，原图不被覆盖。
- 在多张生成图片之间切换，确认每张图片会话独立；重放历史任务并确认旧会话可恢复。

### 画布与智能助手

- 在画布图片节点打开“编辑”，保存后确认产生新的结果节点与连线，来源节点不被覆盖；取消并重开时状态正确。
- 对旧 `markDoc` 画布数据执行编辑；验证“切割分镜”仍产生正确结果节点和连线。
- 通过 `create_image_edit_preview` 与 `commit_image_edit` 验证预览不修改原资产、提交创建新资产，并观察未知引用、重复提交和失败重试行为。

## 当前结论

- 第一至第四阶段的代码实现与自动验证均已完成。
- 九个任务继续标记为“待验证”，只等待上述真实 Electron 人工交互验收统一关闭。
- 本任务未实现黑柔、白柔、灰光、调色算法、正式效果节点或空 IPC。
