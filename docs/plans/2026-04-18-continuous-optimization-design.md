# 持续测试与持续优化设计（2026-04-18）

## 目标

在当前仓库上建立一个可重复执行的持续优化闭环，满足以下条件：

- 每轮都能自动跑完关键工程门禁与模块测试分片。
- 每轮都能产出结构化报告，记录通过、失败、耗时和下一步候选优化项。
- 每轮优化只做有边界的局部修改，修改后必须回归验证。
- 在 Codex 侧通过多个 `gpt-5.4` agent 并行分担分析、修复、验证，不把所有工作堆在单线程串行里。
- 通过当前线程 heartbeat 自动化反复唤醒，形成“单轮脚本 + 多 agent 执行 + 下一轮继续”的长期循环。

## 当前基线

本次实现前，仓库在 `D:\PROJECT_ZZZZZZZZZ\Bilibili-Subtitle-Vocabulary-Extension\bilibili-vocab-extension` 下的真实门禁状态如下：

- `pnpm run typecheck` 通过
- `pnpm run lint` 通过
- `pnpm run test` 通过，当前为 `334` 条
- `pnpm run test:ui` 通过，当前为 `116` 条
- `pnpm run build:extension` 通过
- `pnpm run pack` 通过

结论：当前主要问题不是“修复坏掉的仓库”，而是“把已有测试、构建、报告和 agent 调度编排成可持续执行的闭环”。

## 模块划分

### 1. MV3 控制面 / 后台服务

- `bilibili-vocab-extension/manifest.json`
- `bilibili-vocab-extension/background.js`
- `bilibili-vocab-extension/runtimeMessaging.js`

职责：

- 安装启动初始化
- 配置迁移
- 快捷键命令
- runtime message 串行处理

### 2. 设置模型 / 配置归一化

- `bilibili-vocab-extension/sharedSettings.js`
- `bilibili-vocab-extension/config.js`
- `bilibili-vocab-extension/settingsUiStateMachine.js`
- `bilibili-vocab-extension/react-ui/src/settings-bridge.ts`
- `bilibili-vocab-extension/react-ui/src/use-v3-settings.ts`

职责：

- V3 profile 与 global controls
- 站点规则
- overlay 状态
- 运行时配置展开
- UI 冲突与保存状态机

### 3. 内容脚本主链

- `bilibili-vocab-extension/contentScript.js`
- `bilibili-vocab-extension/subtitleParser.js`
- `bilibili-vocab-extension/subtitleNavigation.js`
- `bilibili-vocab-extension/renderer.js`
- `bilibili-vocab-extension/translator.js`
- `bilibili-vocab-extension/vocabulary.js`
- `bilibili-vocab-extension/segmenter.js`

职责：

- 字幕与正文识别
- 分词、候选词选择、DOM 渲染
- overlay 懒加载
- 句级导航

### 4. 学习与调优链

- `bilibili-vocab-extension/learningState.js`
- `bilibili-vocab-extension/adaptiveTuning.js`
- `bilibili-vocab-extension/experienceMetrics.js`
- `bilibili-vocab-extension/tooltip.js`
- `bilibili-vocab-extension/scripts/scheduler.js`
- `bilibili-vocab-extension/scripts/danmaku.js`

职责：

- 词汇命中与学习状态
- 复习队列与 streak
- 自动调优
- 体验指标
- 复习弹幕

### 5. UI 层

- `bilibili-vocab-extension/react-ui/src/options-main.tsx`
- `bilibili-vocab-extension/react-ui/src/popup-main.tsx`
- `bilibili-vocab-extension/react-ui/src/overlay-entry.tsx`
- `bilibili-vocab-extension/react-ui/src/storage.ts`
- `bilibili-vocab-extension/react-ui/src/overlay-storage.ts`
- `bilibili-vocab-extension/react-ui/src/use-overlay-settings.ts`

职责：

- options / popup / overlay 正式入口
- chrome storage 读写与订阅
- active tab 字幕导航桥接
- overlay 轻量设置适配

### 6. 工程门禁 / 打包 / 数据集

- `bilibili-vocab-extension/package.json`
- `bilibili-vocab-extension/scripts/check-overlay-size.js`
- `bilibili-vocab-extension/scripts/pack-extension.js`
- `bilibili-vocab-extension/scripts/refresh-overlay-size-baseline.js`
- `bilibili-vocab-extension/scripts/build-vocab-dataset.js`
- `.github/workflows/ci.yml`
- `.github/workflows/overlay-baseline-refresh.yml`

职责：

- 构建、打包、体积门禁
- 词库数据构建
- CI 执行与 baseline 刷新

## 测试分层

### 第 1 层：工程门禁

用途：快速拦截结构性问题。

命令：

- `pnpm run lint`
- `pnpm run typecheck`
- `pnpm run build:extension`
- `pnpm run pack`（可选）

### 第 2 层：分片测试

用途：缩小定位半径，让失败与模块边界对齐。

分片如下：

1. `runtime-state`
   - 范围：后台、学习状态、shared settings、adaptive tuning、experience metrics、vocabulary
2. `subtitle-content`
   - 范围：content script、subtitle parser、renderer、segmenter、translator、tooltip
3. `ui-overlay`
   - 范围：popup / options / overlay / React UI / overlay adapter
4. `build-contract-data`
   - 范围：构建契约、workflow 契约、打包、overlay size、数据集与脚本入口

补充边界：

- `ui-overlay` 默认只覆盖 shipped React / overlay 契约测试，与 `manifest.json` / pack 真实交付入口 `dist/popup.html`、`dist/options.html` 对齐。
- 仍直接锁定 root `popup.js` / `options.js` 且主要保护 legacy shell 行为的 Node 测试不混入默认 optimize lane，而是在 continuous optimization 报告中作为 `Legacy Deferred Tests` 单独暴露。
- 仍需保护共享默认值 / fallback 兼容时，不通过 legacy shell UI 测试兜底，而是保留 `shared-settings-integration.test.js`、`standalone-init.test.js` 这类共享合同测试继续进入 optimize lane。

当前仓库入口脚本：

- `pnpm run test:shards`
- `pnpm run optimize:continuous`

### 第 3 层：长期盲区追踪

当前已知盲区：

- 缺浏览器级 E2E 冒烟
- runtime bridge / 轻量适配层直接测试不足
- React 与 legacy 双栈并存
- `contentScript.js` 复杂度偏高

这些盲区不一定阻塞每轮提交，但必须持续在报告中显式列出，避免“全绿错觉”。

## 单轮持续优化循环

### 执行顺序

1. 跑工程门禁
2. 并行跑 4 个测试 shard
3. 汇总结果，写入 `bilibili-vocab-extension/test-results/continuous-optimization/`
4. 如果有失败：
   - 优先收敛首个失败 gate 或失败 shard
5. 如果全绿：
   - 从已知盲区里选 1 个高价值目标进入下一轮
6. 分配多个 `gpt-5.4` agent：
   - agent A：读报告和日志，定位根因
   - agent B：在明确写入范围内做修复
   - agent C：跑受影响测试与回归验证
7. 本轮修改完成后回跑受影响 shard，必要时回跑 `pnpm run optimize:continuous`
8. 写出下一轮候选项，等待 heartbeat 或人工继续

### 输出产物

目录：

- `bilibili-vocab-extension/test-results/continuous-optimization/latest.json`
- `bilibili-vocab-extension/test-results/continuous-optimization/latest.md`

报告包含：

- 每个 gate / shard 的状态
- 耗时
- 命令
- 失败摘要
- 下一步候选优化项
- 当前盲区列表

## 多 agent 执行策略

每轮默认使用多个 `gpt-5.4` agent，但必须满足写入边界明确。

推荐角色：

1. `explorer`
   - 只读分析代码、日志、测试结果
2. `worker`
   - 只在指定文件范围内改代码
3. `worker`
   - 专做验证、补测试、修 CI / 文档

规则：

- 同一轮不同 agent 不写同一文件
- 不允许 agent 回滚其他人的改动
- 不允许在失败尚未定位清楚前同时开多个互相重叠的修复 agent

## 自动化方式

采用当前线程 heartbeat，而不是新开独立 cron 线程。

原因：

- 上下文连续
- 能直接复用上轮结论
- 更适合“分析 -> 修复 -> 回归 -> 下一轮”这种闭环

heartbeat 唤醒后执行原则：

1. 先读取上轮 `latest.json` / `latest.md`
2. 再决定本轮跑 `test:shards` 还是 `optimize:continuous`
3. 如果上一轮已全绿，则优先推进一个盲区优化项
4. 如果上一轮失败，则优先修复失败目标

## 风险边界

### 1. 不做无边界死循环

“持续运行”不等于当前 turn 内无限循环。实际落地是：

- 本地脚本只跑一轮
- 自动化 heartbeat 负责下一轮唤醒

### 2. 不自动接受回归

`overlay-baseline-refresh.yml` 保持手动触发，不自动刷新 baseline。

### 3. 不顺手清理 legacy

当前目标是建立持续优化闭环，不是一次性清空 legacy `popup.js` / `options.js` / `overlayPanel.js`。

因此，对仍然服务于 legacy shell 的 Node 测试，默认策略是“显式报告、单独复核、暂不并入 shipped optimize shard”，只有当它们迁移到真实交付入口或被明确收编为独立 legacy shard 时才进入默认 lane。

已确认当前策略继续保持为 defer，而不是直接纳入 shipped optimize lane。理由是：

- `manifest.json` / `pack` 只认 `dist/popup.html`、`dist/options.html` 真实交付入口，root `popup.js` / `options.js` 失败不会直接代表 shipped UI 回归。
- 仍需保留的共享兼容合同已经由 `shared-settings-integration.test.js`、`standalone-init.test.js` 继续覆盖，无需靠整份 legacy shell 测试兜底。
- deferred 这批测试的下一步应是“迁移可复用逻辑到 shared helper”或“收编成独立 legacy lane / 删除冗余测试”，而不是并入 shipped optimize shard 制造目标漂移。

### 4. 不在无浏览器环境假装有 E2E

浏览器级 E2E 需要独立补充，不用脚本报告掩盖这个事实。

## 验证方案

本轮实现完成后至少验证：

- `node --test tests/continuous-optimization.test.js`
- `pnpm run test:shards`
- `pnpm run optimize:continuous`
- `pnpm run test:ui`
- `pnpm run lint`

如本轮修改影响 CI 契约，再补：

- `node --test tests/workflow-lockfile-contract.test.js`

## 后续阶段

### Phase 1

- 落地脚本、报告、CI 可见性、heartbeat

### Phase 2

- 补最小浏览器级 E2E 冒烟
- 目标优先放在 popup / options / overlay / content script 懒加载

### Phase 3

- 基于报告趋势继续补 coverage gap
- 逐步降低 React / legacy 双栈漂移
- 围绕 `contentScript.js` 做局部拆分或加固测试
