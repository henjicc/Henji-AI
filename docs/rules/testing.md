# 验证与任务完成标准

> 读取时机：准备收尾任何代码改动前。
>
> 原则：**按改动类型选检查，不要全跑，也不要不跑。** `electron:build` / `electron:dist` 较费时，只在需要验证完整类型链路、最终产物或发布前执行。

## 一、任何改动都要跑

```bash
npm run lint
npx tsc -p tsconfig.json --noEmit
```

改了 `electron/` 下的代码再加：

```bash
npx tsc -p tsconfig.electron.json --noEmit
npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0
```

改了带测试的模块（或改动可能影响现有测试）再加 `npx vitest run` —— CI 会跑全量单测，本地漏跑等于把失败推到 CI。

## 二、按改动类型追加

### 界面改动

```bash
npm run check:colors
npm run check:surface        # 手写面板 / 卡片套卡片 / 手写弹窗三类
npm run check:icons
```

`check:surface:strict` 与 `check:icons:strict` 已接入 `build` / `electron:build` 链路，`check:surface:strict` 还在 CI 中，**违规直接构建失败**。确需例外时加**行级** `ui-surface-allow` 注释并写明理由，禁止文件级豁免。

需要看真实渲染结果时，先完成一次 `npm run electron:build`，再按职责运行：

```bash
npm run ui:tour              # 六类界面 × 1440×900 / 960×640，输出截图与 index.md，供人判断观感
npm run check:ui-visual      # 同一场景清单上执行十一条可判定 DOM 规则，失败退出码非 0
```

`ui:tour` 支持 `--only`、`--size`、`--out`（如 `npm run ui:tour -- --only 设置 --size 960x640`），截图差异不进 CI。`check:ui-visual` 覆盖表面叠层、对比度、圆角、阴影、CSS 隐藏定位、助手插入量逃逸、横向溢出、嵌套滚动、文本硬裁、过小命中区、页面标题字号一致性。两条命令都用隔离 userData，不读真实数据库和密钥；输出目录 `.ui-tour/`、`.ui-audit/` 已被 Git 忽略。

### 画布节点 DOM / 绘制样式 / LOD / 视口渲染

完成 Electron 构建后：

```bash
BENCH_MULT=4 npm run electron:pan-bench   # 真实内容连续扫掠，同启动交替采样 —— 唯一可作性能结论的命令
npm run check:canvas-visual               # 像素、节点盒、minimap、连线与溢出几何回归
```

### 模型 / 参数 schema

```bash
npm run gen:model-manifest
npm run check:model-i18n
```

### 智能助手能力

```bash
npm run check:assistant-capabilities
npm run test:assistant-production
```

### Electron 主进程能力

```bash
npm run electron:smoke        # 构建产物冒烟
npm run electron:dpi-check    # DPI/分辨率
npm run electron:updater-e2e  # 本地模拟 updater 端到端
```

## 三、人工核查（无对应命令）

```powershell
# 原生控件检查（命中应仅在 primitives.tsx）
$files = Get-ChildItem src -Recurse -Include *.tsx
$hits = $files | Select-String -Pattern '<button','<input','<select','<textarea' -CaseSensitive
$hits | Where-Object { $_.Path -notlike '*src\components\ui\primitives.tsx' }

# 文件行数治理（重点关注 > 500）
Get-ChildItem -Path src,electron -Recurse -Include *.ts,*.tsx |
  ForEach-Object { $n = (Get-Content $_.FullName).Count; if ($n -gt 500) { "$($_.FullName)`t$n" } }
```

## 四、必须交给用户测的场景

**涉及鼠标操作的验证不要自己上手**——拖拽、点击、悬浮、画布交互等需要实际操作 UI 才能确认的场景。改完后把具体操作步骤和验证点写清楚，交给用户测试。

同样交给用户的：真实 API key 下的生成链路、真实项目包导入导出、macOS 真机行为。

## 五、任务完成标准

一次改动可以视为完成，当且仅当：

1. 上面第一、二节中与本次改动相关的命令**全部实际执行且通过**（不是"应该能过"）
2. 有失败的，如实报告失败输出，不隐瞒、不淡化
3. 需要用户手动验证的部分，已写出可照做的操作步骤和验证点
4. 已明确告知用户本次改动**是否需要重启 `npm run electron:dev`**，格式：`✔️无需重启` / `⚠️ 需要重启`
5. 新增/改造的关键业务链路已按 [docs/rules/logging.md](../../docs/rules/logging.md) 补齐结构化日志

## CI 实际执行内容

`.github/workflows/build.yml` 的代码检查 job：

`gen:progress-seeds` → `gen:model-manifest` → `check:colors` → `check:surface:strict` → `check:model-i18n` → `lint` → `eslint electron` → `tsc`（渲染层 + 主进程）→ `vitest run`

构建 job 跑 `npm run electron:build` 并打包发布。
