# Henji-AI 重构执行计划

> 最后更新：2026-01-22

## 总体进度

- Phase 0: ██████████ 100% (3/3) ✅
- Phase 1: ██████████ 100% (11/11) ✅
- Phase 2: ██████████ 100% (9/9) ✅
- Phase 3: ██████████ 100% (6/6) ✅
- Phase 4: ███████░░░ 75% (3/4)
- Phase 5: ██████████ 100% (3/3) ✅
- Phase 6: ████████░░ 67% (4/6)

**总计：39/42 任务完成 (92.9%)**

---

## Phase 0：验证与准备

### 0.1 数据安全验证

- [x] 0-1-1：检查所有Adapter返回值结构 → `phase0/0-1-1_检查Adapter返回值.md` ✅ 检查报告：`phase0/0-1-1_检查报告.md`
- [x] 0-1-2：验证历史记录保存逻辑 → `phase0/0-1-2_验证历史记录保存.md` ✅ 检查报告：`phase0/0-1-2_检查报告.md`

### 0.2 硬编码排查

- [x] 0-2-1：建立模型标签系统 → `phase0/0-2-1_建立模型标签系统.md` ✅ 执行报告：`phase0/0-2-1_执行报告.md`, 硬编码清单：`phase0/硬编码清单.md`

---

## Phase 1：核心架构

### 1.1 类型系统

- [x] 1-1-1：定义ModelDefinition接口 → `phase1/1-1-1_定义ModelDefinition接口.md` ✅ 执行报告：`phase1/1-1-1_执行报告.md`
- [x] 1-1-2：定义参数类型系统 → `phase1/1-1-2_定义参数类型系统.md` ✅ 执行报告：`phase1/1-1-2_执行报告.md`
- [x] 1-1-3：定义联动系统接口 → `phase1/1-1-3_定义联动系统接口.md` ✅ 执行报告：`phase1/1-1-3_执行报告.md`

### 1.2 ModelRegistry系统

- [x] 1-2-1：实现ModelRegistry核心 → `phase1/1-2-1_实现ModelRegistry.md` ✅ 执行报告：`phase1/1-2-1_执行报告.md`
- [x] 1-2-2：实现自动发现机制 → `phase1/1-2-2_实现自动发现机制.md` ✅ 执行报告：`phase1/1-2-2_执行报告.md`

### 1.3 动态参数系统

- [x] 1-3-1：实现useModelParams Hook → `phase1/1-3-1_实现useModelParams.md` ✅ 执行报告：`phase1/1-3-1_执行报告.md`
- [x] 1-3-2：实现参数联动引擎 → `phase1/1-3-2_实现联动引擎.md` ✅ 执行报告：`phase1/1-3-2_执行报告.md`
- [x] 1-3-3：实现AutoSwitch机制 → `phase1/1-3-3_实现AutoSwitch.md` ✅ 执行报告：`phase1/1-3-3_执行报告.md`

### 1.4 请求构建系统

- [x] 1-4-1：实现RequestBuilder → `phase1/1-4-1_实现RequestBuilder.md` ✅ 执行报告：`phase1/1-4-1_执行报告.md`
- [x] 1-4-2：实现端点选择器 → `phase1/1-4-2_实现端点选择器.md` ✅ 执行报告：`phase1/1-4-2_执行报告.md`

### 1.5 完整重构与迁移

- [x] 1-5-1：集成新系统到 MediaGenerator → `phase1/1-5-1_集成方案.md` ✅ 执行报告：`phase1/1-5-1_执行报告.md`

---

## Phase 2：组件与UI

### 2.1 基础组件

- [x] 2-1-1：实现基础输入组件 → `phase2/2-1-1_实现基础输入组件.md` ✅ 执行报告：`phase2/2-1-1_执行报告.md`
- [x] 2-1-2：实现下拉和开关组件 → `phase2/2-1-2_实现下拉开关组件.md` ✅ 执行报告：`phase2/2-1-2_执行报告.md`
- [x] 2-1-3：实现上传组件 → `phase2/2-1-3_实现上传组件.md` ✅ 执行报告：`phase2/2-1-3_执行报告.md`

### 2.2 特殊面板系统

- [x] 2-2-1：实现PanelRegistry → `phase2/2-2-1_实现PanelRegistry.md` ✅ 执行报告：`phase2/2-2-1_执行报告.md`
- [x] 2-2-2：重构ResolutionPanel → `phase2/2-2-2_重构ResolutionPanel.md` ✅ 执行报告：`phase2/2-2-2_执行报告.md`
- [x] 2-2-3：实现CompositePanel → `phase2/2-2-3_实现CompositePanel.md` ✅ 执行报告：`phase2/2-2-3_执行报告.md`

### 2.3 渲染系统

- [x] 2-3-1：实现ParamRenderer → `phase2/2-3-1_实现ParamRenderer.md` ✅ 执行报告：`phase2/2-3-1_执行报告.md`
- [x] 2-3-2：实现ParamsPanel → `phase2/2-3-2_实现ParamsPanel.md` ✅ 执行报告：`phase2/2-3-2_执行报告.md`

### 2.4 集成与优化

- [x] 2-4-1：集成ImageEditor → `phase2/2-4-1_集成ImageEditor.md` ✅ 执行报告：`phase2/2-4-1_执行报告.md`

---

## Phase 3：数据与存储

### 3.1 SQLite集成

- [x] 3-1-1：设计数据库表结构 → `phase3/3-1-1_设计数据库表.md` ✅ 执行报告：`phase3/3-1-1_执行报告.md`
- [x] 3-1-2：实现数据库操作层 → `phase3/3-1-2_实现数据库操作.md` ✅ 执行报告：`phase3/3-1-2_执行报告.md`
- [x] 3-1-3：迁移历史数据 → `phase3/3-1-3_迁移历史数据.md` ✅ 执行报告：`phase3/3-1-3_执行报告.md`

### 3.2 预设系统

- [x] 3-2-1：重构预设存储 → `phase3/3-2-1_重构预设存储.md` ✅ 执行报告：`phase3/3-2-1_执行报告.md`
- [x] 3-2-2：实现预设加载逻辑 → `phase3/3-2-2_实现预设加载.md` ✅ 执行报告：`phase3/3-2-2_执行报告.md`

### 3.3 自定义模型

- [x] 3-3-1：实现自定义模型MVP → `phase3/3-3-1_自定义模型MVP.md` ✅ 执行报告：`phase3/3-3-1_执行报告.md`

---

## Phase 4：i18n与调试

### 4.1 国际化

- [x] 4-1-1：集成i18next → `phase4/4-1-1_集成i18next.md` ✅ 执行报告：`phase4/4-1-1_执行报告.md`
- [x] 4-1-2：抽取文本到locales → `phase4/4-1-2_抽取文本.md` ✅ 执行报告：`phase4/4-1-2_执行报告.md` (MVP)

### 4.2 调试工具

- [x] 4-2-1：实现参数流转追踪 → `phase4/4-2-1_实现参数流转追踪.md` ✅ 执行报告：`phase4/4-2-1_执行报告.md`
- [x] 4-2-2：实现配置导出功能 → `phase4/4-2-2_实现配置导出功能.md` ✅ 执行报告：`phase4/4-2-2_执行报告.md`

---

## Phase 5：节点系统准备

### 5.1 节点接口

- [x] 5-1-1：设计ModelNode接口 → `phase5/5-1-1_设计ModelNode接口.md` ✅ 执行报告：`phase5/5-1-1_执行报告.md`
- [x] 5-1-2：实现模型到节点转换 → `phase5/5-1-2_模型转节点.md` ✅ 执行报告：`phase5/5-1-2_执行报告.md`

### 5.2 扩展点

- [x] 5-2-1：预留工具节点接口 → `phase5/5-2-1_工具节点接口.md` ✅ 执行报告：`phase5/5-2-1_执行报告.md`

---

## Phase 6：全面迁移与清理

### 6.1 模型迁移

- [x] 6-1-1：迁移PPIO模型 → `phase6/6-1-1_迁移PPIO模型.md` ✅ 执行报告：`phase6/6-1-1_执行报告.md`
- [x] 6-1-2：迁移Fal模型 → `phase6/6-1-2_迁移Fal模型.md` ✅ 进度报告：`phase6/fal-progress.md`
- [x] 6-1-3：迁移KIE和ModelScope模型 → `phase6/6-1-3_迁移其他模型.md` ✅ 进度报告：`phase6/kie-progress.md`

### 6.2 清理旧代码（暂缓）

⚠️ **评估结果**：需要先完成新旧系统集成（Phase 1.5）才能安全删除旧代码
详见：`phase6/6-2_评估报告.md`
这一步也许已经完成了，有待检查
- [ ] 6-2-1：删除useMediaGeneratorState → `phase6/6-2-1_删除旧状态管理.md`
- [ ] 6-2-2：删除旧optionsBuilder → `phase6/6-2-2_删除旧构建器.md`

### 6.3 文档

- [x] 6-3-1：更新开发文档 → `phase6/6-3-1_更新文档.md` ✅ 已完成新架构文档

---

## 依赖关系

详见 `DEPENDENCIES.md`

## 验收标准

详见 `REFACTOR_PLAN.md` 第十六节
