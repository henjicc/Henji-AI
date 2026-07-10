# 日志调试中心 - 测试报告

## 1.1 主进程日志中枢与统一落盘

### 自动化检查（已执行，全部通过）

| 命令 | 结果 |
|---|---|
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无报错 |
| `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0` | 通过，无报错/警告 |
| `npm run lint`（`eslint src --ext ts,tsx --report-unused-disable-directives --max-warnings 0`） | 通过，无报错/警告 |
| 新增/修改文件裸 `any` 排查（`grep -rn '\bany\b'` 覆盖本次全部改动文件） | 无命中，未新增裸 `any` |

未执行 `npm run electron:build` / `npm run electron:smoke`：按项目约定这两个命令较费时间，只在确有需要（验证完整类型链路、最终产物）时才跑，本次纯类型/静态检查已覆盖改动风险面，不属于"确有需要"。

**修复记录（验收反馈）**：主控 agent 验收时发现 `retention.ts` 的 `listLogFiles()` 用 `entry.endsWith('.log')` 匹配文件名，会把旧的 `frontend-YYYY-MM-DD.log` 也纳入清理范围，与实施方案"旧文件不迁移不删除，自然过期"矛盾。已修复为 `entry.startsWith(MAIN_LOG_FILE_PREFIX) && entry.endsWith('.log')`（`MAIN_LOG_FILE_PREFIX` 提到 `types.ts` 共享，`writer.ts` 拼文件名与 `retention.ts` 扫描目录用同一个常量）。修复后重新跑了 `npx tsc -p tsconfig.electron.json --noEmit` 与 `npx eslint electron --ext ts --report-unused-disable-directives --max-warnings 0`，均通过。下方步骤 D/E 已同步修正，并新增步骤 F 专门验证旧 `frontend-*.log` 不会被清理逻辑动到。

### 验收标准逐项对照

| 验收标准 | 状态 | 说明 |
|---|---|---|
| 主进程试点模块记录的事件出现在 `henji-YYYY-MM-DD.log`，`source` 为 `backend`，不经过渲染层 | **待人工验证** | 需要真实触发一次生成任务，见下方步骤 A |
| 前端既有日志仍正常落盘到同一文件（`source: 'frontend'`），`createLogger` 调用方零改动 | **待人工验证** | `src/core/logging/logger.ts` 的 `createLogger` 本身未改一行，理论上零改动；实际落盘行为需人工确认，见步骤 B |
| 渲染层可通过新增订阅方法收到实时推送的日志事件 | **待人工验证** | 见步骤 C，验证后不需要改代码（直接在控制台调用即可，无需再删临时代码） |
| 保留清理逻辑正确（1 天前文件删除、总大小超限删最旧文件） | **待人工验证** | 见步骤 D、E；且只清理 `henji-*.log`，旧 `frontend-*.log` 不受影响（本轮验收反馈修复，见步骤 F） |
| `npx tsc` / eslint electron / `npm run lint` 通过；无新增裸 any | 已通过 | 见上表 |

以下步骤涉及启动真实 Electron 应用与手动操作，按项目约定交给用户执行，我没有自己上手操作。

---

### 步骤 A：验证 backend 事件直接落盘（试点：ai-runtime 的 generate）

1. 重启 `npm run electron:dev`（本次改动涉及主进程与 preload，必须重启才生效）。
2. 在应用内正常触发一次任意 AI 生成任务（图片/视频/音频任一均可）。
3. 打开日志目录：`%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，找到当天的 `henji-YYYY-MM-DD.log`。
4. 用文本编辑器或 `Get-Content` 搜索 `ai_runtime.generate.start` / `ai_runtime.generate.result`（生成失败的话是 `ai_runtime.generate.failed`），确认：
   - 这些行存在；
   - 每行 JSON 的 `"source":"backend"`；
   - `domain` 为 `"ai-runtime"`。
5. 生成过程中**不要**打开开发者工具网络面板去确认"是否经过渲染层"——这条判断标准本身就是"文件里能看到即代表主进程直接落盘"，不需要额外验证渲染层收没收到（渲染层收到与否是步骤 C 的事，两者互不冲突：同一批事件既落盘也会推送）。

### 步骤 B：验证前端日志仍正常落盘同一文件

1. 承接步骤 A 的窗口，正常使用应用一段时间（比如切换几个页面、生成失败一次触发 error 日志）。
2. 在同一份 `henji-YYYY-MM-DD.log` 中搜索 `"source":"frontend"`，确认既有前端日志（如 `generation.generate.start` 等 `src/core/logging/logger.ts` 里定义的事件名）仍然在持续写入同一个文件。
3. 确认没有再生成新的 `frontend-YYYY-MM-DD.log`（旧文件如果之前存在会保留，但不会有新内容追加）。

### 步骤 C：验证渲染层实时订阅

1. 应用运行中打开开发者工具（`Ctrl+Shift+I` 或标题栏菜单），切到 Console。
2. 执行：
   ```js
   window.henjiNative.logging.onLogEvent((events) => console.log('log-event', events))
   ```
3. 触发任意会产生日志的操作（比如再跑一次生成任务，或者任意会调用 `createLogger(...).info(...)` 的前端操作）。
4. 观察控制台是否打印出 `log-event` 数组，数组内每个对象应包含 `timestamp/level/domain/event/message/source` 等字段。
5. 这一步是纯 devtools 控制台命令，不需要改动任何源码，验证完直接关闭 devtools 或刷新页面即可，不留痕迹。

### 步骤 D：验证 1 天保留清理

1. 关闭应用。
2. 进入日志目录 `%LOCALAPPDATA%\com.henji.ai\Henji-AI\logs\`，手动复制一份现有 `henji-*.log`（或新建一个空文件也可以），重命名为例如 `henji-2026-07-08.log`（比当天早 2 天以上）。
3. 用文件属性或 PowerShell 把它的"修改时间"改到 2 天前（如果文件名日期够早，`mtime` 也要相应调整，因为清理逻辑按文件的实际修改时间判断，不是按文件名）：
   ```powershell
   (Get-Item "$env:LOCALAPPDATA\com.henji.ai\Henji-AI\logs\henji-2026-07-08.log").LastWriteTime = (Get-Date).AddDays(-2)
   ```
4. 重新启动 `npm run electron:dev`。
5. 确认该文件在应用启动后被自动删除（`runLogRetention()` 在 `app.whenReady()` 时执行一次）。

### 步骤 E：验证总大小超限清理（从最旧文件删起）

1. 关闭应用。
2. 在日志目录里人为制造总大小超过 256MB 的情况：可以复制若干份任意大文件并重命名为 `henji-2026-07-0X.log`（**必须同时满足 `henji-` 前缀 + `.log` 后缀才会被清理逻辑扫描到**，只改后缀不改前缀不会被纳入清理范围），累计体积故意做到 300MB+，并让不同文件的"修改时间"错开（用上面 PowerShell 命令分别设置成不同天数，最旧的设置为例如 20 小时前，避免被步骤 D 的 1 天规则先删掉）。
3. 重新启动 `npm run electron:dev`。
4. 确认应用启动后，目录总大小回落到 256MB 以内，且是从**修改时间最早**的文件开始删的（可以提前记录每个测试文件的体积和顺序，删除后核对剩余文件是否符合"保留较新的、删掉较旧的"预期）。

### 步骤 F：验证旧 `frontend-*.log` 不被清理逻辑动到

1. 关闭应用。
2. 在日志目录里放一个旧命名规则的文件，例如复制任意 `.log` 文件重命名为 `frontend-2026-07-01.log`，并把它的"修改时间"改到很久以前（比如 10 天前），确保无论按"1 天保留"还是"总大小超限"哪条规则判断都会被判定为"该删"：
   ```powershell
   (Get-Item "$env:LOCALAPPDATA\com.henji.ai\Henji-AI\logs\frontend-2026-07-01.log").LastWriteTime = (Get-Date).AddDays(-10)
   ```
3. 如果条件允许，同时按步骤 E 的方法让日志目录总大小超过 256MB（`frontend-2026-07-01.log` 保持最旧的修改时间，理论上"从最旧文件删起"应该第一个轮到它）。
4. 重新启动 `npm run electron:dev`。
5. 确认应用启动后 `frontend-2026-07-01.log` 依然存在、没有被删除——这是本次修复要保证的行为：清理逻辑只扫描 `henji-*.log`，旧文件完全不在扫描范围内，不会被"总大小超限"或"1 天保留"任何一条规则误删。

---

以上 A~F 步骤中，A/B/C 只需要一次正常的 `electron:dev` 会话即可覆盖；D/E/F 需要额外制造测试文件，做完记得手动清理测试用的假日志文件，避免污染真实日志目录。
