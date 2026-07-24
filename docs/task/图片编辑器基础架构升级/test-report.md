# 测试记录

## 测试策略

- 状态：统一后置
- 执行时机：全部任务完成后
- 当前阶段只登记测试范围、命令和人工验收项，不运行测试。

## 待执行自动测试

### 第一阶段

- V2 文档合法解析、序列化和默认值。
- V1 文档、纯标注数组、旧 `ImageEditState`、`ImageMarkSession` 兼容读取。
- 损坏 JSON、未知版本、非法操作参数和未知操作的确定回退。
- 操作注册重复 ID、默认参数、校验与执行 handler 分发。

### 第二阶段

- 统一历史、撤销重做和瞬时交互状态清理。
- 标注交互与右侧工具选择互不覆盖。
- 面板宽度约束、折叠、恢复、键盘调整和偏好持久化。
- 工具注册排序、可见性、参数面板切换和几何操作接入。

## 待执行检查命令

- 定向 Vitest。
- `npm run check:colors`
- `npm run lint`
- `npx tsc -p tsconfig.electron.json --noEmit`
- `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`
- 最终阶段按需执行 `npm run electron:build`、`npm run electron:smoke`、`npm run electron:dpi-check`。

## 待人工验收

- 标注选择、绘制、文字编辑、裁剪、旋转、镜像与撤销重做。
- 右侧面板拖动、键盘调整、折叠、恢复和小窗口布局。
- 顶部标注切换与右侧参数工具切换互不丢失状态。

## 当前结果

- 尚未执行测试。
- 第一阶段代码已完成，1.1、1.2 因统一后置策略保持“待验证”。
- 第二阶段新增的会话、历史、外壳和工具注册测试项会继续追加，当前不执行。
- 第二阶段代码已完成，2.1、2.2、2.3 因统一后置策略保持“待验证”。
