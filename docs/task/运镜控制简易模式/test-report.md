# 运镜控制简易模式 · 测试报告

## 2.3 过渡细节层面板

### 自动验证

| 命令 | 结果 |
|---|---|
| `npm run test` | 通过，5 文件 39/39 用例 |
| `npm run lint` | 通过，0 warnings |
| `npx tsc -p tsconfig.json --noEmit` | 通过 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过 |
| `npm run check:colors` | 通过，无颜色硬编码 |
| 原生控件扫描 | 通过，业务文件无原生控件命中 |
| `git diff --check` | 通过 |

### 用户手动验证（真实 Electron 窗口）

1. 用 `npm run electron:dev` 打开简易模式，准备相邻两卡，令 box、摄像机和角色位置均有变化。
2. 确认详情默认收起；点击前卡下方“过渡细节”，确认只列出实际变化对象，再次点击可收起。
3. 切换 box 的速度预设并调整正/负延迟，播放确认节奏与错峰变化立即生效。
4. 摄像机依次选择环绕、推进/拉远、横移、升降并调参；确认出现终点提示且播放效果变化。
5. 角色依次选择自动、无动作和指定 clip，播放确认移动期间覆盖行为；低位移角色不应原地跑动。
6. 对上述单项修改执行撤销，确认配置和播放效果同步回退。
7. 将相邻两卡改为完全一致，确认抽屉显示“这两个片段之间没有变化”。

说明：按项目约定，agent 未代替用户执行点击、播放和撤销等真实鼠标交互。

## 1.1 简易模式数据模型与工程持久化

### 静态检查

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过，无输出 |
| `npx tsc -p tsconfig.json`（前端类型） | 通过，无输出 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无输出 |

### 迁移与往返序列化验证

项目当前没有 vitest/ts-node 等测试基建，未新增测试框架依赖。改用临时脚本验证：用 `esbuild`（已是 vite 依赖，`node_modules/.bin/esbuild`）把
`src/features/cameraStage/domain/__tmp_verify_v11__.ts` 打包为单文件 CJS，`node` 直接执行，验证完成后已删除该临时源文件与打包产物。

验证用例（共 21 项断言，全部通过）：

1. **v10 → v11 迁移**：构造一份 `schemaVersion: 10` 的旧工程 JSON（摄像机对象手动删掉 `effectors` 字段，模拟真实旧数据），`deserializeScene` 后：
   - `schemaVersion` 为当前版本（11）
   - `editorMode === 'pro'`
   - `shots.length === 0`
   - 摄像机对象补上了空数组 `effectors`
   - `objects.length` 与迁移前一致（3 个对象）
   - `sceneSettings` 与默认值逐字段一致
   - `activeCameraId` 与迁移前一致
2. **v11 往返序列化无损**：用 `createShot` 生成一张含 3 个对象状态的镜头卡，`editorMode: 'simple'` 一起 `serializeScene` → `deserializeScene`：
   - `editorMode`、`shots.length`、`shot.id` 保持一致
   - `objectStates` 深度 JSON 比较无损
   - 摄像机对象 `effectors` 字段仍存在
3. **`captureShotObjectState` 分支正确性**：摄像机快照含 `fov`/`lookAt`、不含 `pose`；角色快照含 `pose`/`motion`、不含 `fov`。
4. **`normalizeShots` 容错**：`null`、非数组、结构不完整的元素分别得到空数组 / 空数组 / 补默认值后的合法 `StageShot`。
5. **版本上限保护**：`schemaVersion` 高于当前支持版本（12）时 `deserializeScene` 抛错，符合"高于 v11 的工程仍按现状报错"验收标准。

### 未覆盖 / 后续建议

- 未做真实 Electron 窗口内的手动保存/加载工程回归（本任务是纯 domain 层改动，UI 尚未接入 `editorMode`/`shots`，无可交互界面可测；2.1+ 接入 UI 后需要用户手动验证真实保存/加载）。
- 未验证真实项目包导入导出链路（`project-package`）是否需要感知新字段——已确认该链路只把 `sceneJson` 当不透明字符串搬运（见 `electron/main/ipc/camera-stage-projects.ts`），不需要改动。

## 1.2 快照差异编译器

### 测试基建

- 项目原无 vitest/jest。新增 `vitest@^1.6.1` devDependency + `vitest.config.ts`（`include: ['src/**/*.test.ts']`，含 `@/` alias 对齐 `vite.config.ts`）+ `package.json` `"test": "vitest run"`。此配置是通用最小配置，未针对本任务写死内容，供 1.3/1.4 等后续任务直接复用。

### 单元测试

| 命令 | 结果 |
|---|---|
| `npm run test`（vitest run） | 1 个测试文件，13 个用例，13 通过 / 0 失败 |

用例清单（`src/features/cameraStage/domain/shotCompiler.test.ts`）：

1. 两卡仅一个 box 位置变化 → 只产生 `transform.position.x` 一条轨道，关键帧时间与 hold/过渡时长吻合，`propertyPath` 可被 `getAnimatablePropByPath` 解析。
2. 未变化对象 → 零轨道。
3. 三卡中间卡 hold>0 → 用 `sampleTrack` 在停留段起点/中点/终点三处采样均为恒定值（10），验证停留段守护点生效。
4. 速度预设四种（`it.each`）→ `uniform/easeInOut/fastStart/slowStart` 分别映射为 `linear/easeInOut/easeOut/easeIn`。
5. 错峰延迟：
   - 正延迟（0.5）→ 起止时间整体后移，超出部分钳制在过渡结束时间。
   - 负延迟（-0.3）→ 起止时间整体前移，超出部分钳制在过渡开始时间。
   - 超界延迟（±100）→ 起止时间钳制到同一边界，退化为单点跳变（去重规则保留后写入的终值点，1 个关键帧）。
6. 空 shots 数组 → 空轨道、`duration === 0`；单卡 → 空轨道、`duration` 等于该卡 `hold`。
7.（补充）多对象（primitive/character/camera）综合场景：产物全部 `propertyPath` 均能被 `getAnimatablePropByPath` 解析；模拟对象在某卡缺快照时，该对象不参与该段差异（无对应轨道）。

### 静态检查

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过，无输出 |
| `npx tsc -p tsconfig.json --noEmit` | 通过，无输出 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无输出 |

### 联调中定位的问题（已修复，见 decisions.md）

- 轨道 key 反解析时按分隔符长度切片错误（`::` 是 2 字符，误用 `+1` 切片导致 `propertyPath` 带前导冒号），首轮跑测试时通过 13 个用例中 10 个失败精确定位。
- 修复过程中一度遗漏 `TRACK_KEY_SEPARATOR` 常量声明导致 `ReferenceError`，随即修复。
- 均已修复并通过全部 13 个用例回归验证。

## 1.3 摄像机运镜预设编译

### 单元测试

| 命令 | 结果 |
|---|---|
| `npm run test`（vitest run） | 2 个测试文件，25 个用例，25 通过 / 0 失败（含 1.2 遗留 13 个用例，仍全部通过） |

新增用例清单：

`shotCameraMovePresets.test.ts`（10 个用例，纯几何测试，不依赖 shotCompiler）：

1. orbit 180°：全程到目标距离恒定（半径不变）、起终角度差 180°。
2. orbit 180°：产生 13 个采样点（12 段，对应 ~15°/点）。
3. orbit 90°：cw/ccw 终点角度变化符号相反、幅度均为 90°。
4. orbit degrees=0：退化为首尾两点、位置均等于起点。
5. dollyIn distanceRatio=0.5：终点在起点→目标连线中点。
6. dollyOut distanceRatio=2：终点到目标距离是起点的两倍。
7. truck offset=3：终点垂直于水平视线方向平移，位移量等于 offset，沿视线方向分量不变。
8. crane height=1.5：终点沿世界 Y 轴平移，X/Z 不变。
9. 时间重映射：easeInOut 下中段采样点时间间隔小于两端（验证缓动生效）。
10. 时间重映射：linear 下所有采样点时间间隔均匀。

`shotCompiler.test.ts` 新增 `摄像机运镜预设接入（1.3）` 描述块（2 个用例）：

1. 含 orbit 180° 的两卡编译产物：x/y/z 三条轨道均存在，`sampleTrack` 在过渡中间 3 个时刻采样得到的位置到目标距离与起点距离偏差 < 0.15（容差覆盖 15° 分段的弦-弧近似误差），终点落在环绕几何算出的落点（z≈-5），而非 B 卡快照中未改动的原始机位（z≈5）——验证重要记录 003"环绕终点由几何决定，覆盖 B 卡机位"的定稿。
2. dollyIn 运镜 + fov 同时变化：fov 轨道仍是标准两点直插（2 个关键帧），未被摄像机位置运镜预设分支误伤。

### 静态检查

| 命令 | 结果 |
|---|---|
| `npm run lint` | 通过，无输出 |
| `npx tsc --noEmit`（前端根 tsconfig） | 通过，无输出 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无输出 |

### 回归确认

- 1.2 交付的 13 个 `shotCompiler.test.ts` 用例（差异检测、速度预设映射、错峰延迟、停留段守护点等）在本次改动后全部保持通过，未受摄像机运镜预设接入影响。

## 1.4 角色自动走跑与朝向推断

### 自动验证

| 命令 | 结果 |
|---|---|
| `npm run test` | 3 个测试文件，32/32 通过（新增 7 个） |
| `npm run lint` | 通过，无错误 |
| `npx tsc --noEmit` | 通过，无错误 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无错误 |

新增覆盖：Walk/Jog/Sprint 三个边界值、低于阈值不推断、跨 ±180° 最短朝向、motionOverride 优先级、编译产物四点 yaw 轨道与 motionSchedule/afterMotion。

### 用户手动验证（待 2.2 界面完成后）

1. 建两张镜头卡，让角色水平位移，播放确认先转向、移动期间播放走/跑/冲刺、到位转回 B 卡朝向并恢复 B 卡 motion。
2. 调整位移/时长跨过 1.8m/s、4m/s 阈值，确认动作分级；设置 motionOverride 后确认覆盖自动分级。
3. 拖动播放头到过渡前/中/后并反复定位同一时间，确认动作切换和姿态结果确定一致。

本阶段未自行操作真实 UI，符合鼠标/UI 验证由用户执行的约定。

## 2.1 简易模式 store 分片与自动记录

### 自动验证

| 命令 | 结果 |
|---|---|
| `npm run test` | 4 个测试文件，36/36 通过（新增 store 用例 4 个） |
| `npm run lint` | 通过，无错误 |
| `npx tsc --noEmit` | 通过，无错误 |
| `npx tsc -p tsconfig.electron.json --noEmit` | 通过，无错误 |

新增覆盖：编辑动作原子写回卡片并重编译/单步撤销、播放态不自动记录、对象增删同步全部卡片、选卡应用快照与定位播放头。测试显式断言 `animation.motionSchedule` 存在且未被旁路处理丢弃。

### 用户手动验证（待 2.2 UI 接入后）

1. 新增第二张卡，移动对象，确认选中卡快照实时变化，播放能看到两卡过渡。
2. 撤销一次，确认对象、镜头卡快照与编译动画同时回退；重做后同时恢复。
3. 播放或拖动播放头，确认采样只改变视口对象，不反向改写镜头卡。
4. 新增/复制/删除对象，确认所有镜头卡无缺失或悬空对象。

本阶段未自行执行鼠标/UI 验证。

## 2.2 镜头卡时间轴面板

| 命令 | 结果 |
|---|---|
| `npm run test` | 5 文件，39/39 通过（时间工具 2 个 + 零轨道播放回归 1 个） |
| `npm run lint` / `npx tsc --noEmit` | 通过 |
| Electron tsc / `npm run check:colors` | 通过 |
| 原生控件检查 / `git diff --check` | 无命中 / 通过 |

新文件 22~78 行。手动验证：新建简易工程并添加 3 卡，验证播放高亮、点卡回跳、拖拽、双击重命名、时长修改、删除、撤销重做；加载旧工程确认专业时间轴。按约定未自行操作真实鼠标 UI。

阻断修复验证：新增 store 用例断言两张状态相同的简易镜头卡编译结果 `tracks=[]`、`duration>0` 时 `play()` 可启动；切到专业模式且零轨道时仍不可启动。
