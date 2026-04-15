# 迭代记录：Overlay 性能与构建链路清理（2026-04-16）

### 当前状态判断
- 工程门禁稳定：`lint/test/build/build:extension` 均可通过。
- Vite CJS Node API deprecation 告警已消除（配置入口迁移为 ESM `.mts`）。
- overlay 链路从“静态注入”改为“contentScript 动态加载”，并接入体积预算门禁。
- `dist/overlay.js` 体积显著下降：从 `494.37KB`（gzip `153.82KB`）降到 `227.60KB`（gzip `58.60KB`）。

### 对标项目可借鉴点
- 成熟扩展会把 UI 注入链路与核心处理链路解耦，降低首屏脚本注入开销。
- 对核心包体建立预算门禁，避免后续迭代出现“功能增长但性能静默回退”。
- 契约测试需要绑定架构边界（动态加载点、manifest 约束、依赖边界），而非仅校验页面存在性。

### 差距清单（按 P0/P1/P2/P3）
- P0：无。
- P1：
  - 问题：动态 `import()` 链路缺少浏览器矩阵级别验证记录。
  - 影响范围：极端环境下 overlay 可能加载失败。
  - 根因：当前验证集中在构建与单元契约，未覆盖实际浏览器行为采样。
  - 建议改法：补充最小 E2E 验证（Bilibili 页面注入、开关面板、刷新后恢复）。
  - 预期收益：降低线上兼容性不确定性。
  - 风险：中（需要真实浏览器环境）。
- P2：
  - 问题：overlay 轻量适配层与通用 settings/storage 仍是双实现边界。
  - 建议改法：增加跨入口一致性测试（profile/siteRules/overlayState）。
  - 风险：低。
- P3：
  - 问题：体积预算目前只在 `build:extension` 生效，未形成独立 CI 阶段。
  - 建议改法：将 `check:overlay-size` 纳入 CI 专用 job。
  - 风险：低。

### 本轮要做的优化项
- 清理构建告警根因，恢复高可信构建信号。
- 收缩 overlay 入口依赖与加载链路，降低注入成本。
- 增加 overlay 包体预算门禁，防止回归。

### 具体修改方案
- 构建链路
  - `vite.config.mts`、`vite.overlay.config.mts` 迁移为 ESM 配置入口。
  - `vite.overlay.config.mts` 改为 ESM 产物并设置 `process.env.NODE_ENV=production`，避免打入 React dev 分支。
- Overlay 依赖与加载
  - 新增轻量模块：`react-ui/src/overlay-settings.ts`、`react-ui/src/overlay-storage.ts`、`react-ui/src/use-overlay-settings.ts`。
  - `react-ui/src/overlay-entry.tsx` 切换到轻量模块，去除对重模块的直接依赖。
  - `contentScript.js` 新增 `loadOverlayModule()`，在初始化阶段通过 `import(chrome.runtime.getURL("dist/overlay.js"))` 动态加载 overlay。
  - `manifest.json` 移除 `content_scripts` 中的 `dist/overlay.js` 静态注入，并将其加入 `web_accessible_resources`。
- 质量门禁与契约
  - 新增 `scripts/check-overlay-size.js`，默认校验 overlay raw/gzip 阈值（`260KB / 70KB`）。
  - `package.json` 的 `build:extension` 接入 `check:overlay-size`。
  - `tests/react-ui-contract.test.js` 同步为动态加载契约断言。

### 验证方案
- `pnpm run lint -- --fix`：通过。
- `pnpm run test`：通过（162/162）。
- `pnpm run build`：通过，无 CJS deprecation 告警。
- `pnpm run build:extension`：通过，且触发 `check:overlay-size` 门禁通过。
- 关键构建指标：
  - overlay raw：`494.37KB -> 227.60KB`
  - overlay gzip：`153.82KB -> 58.60KB`

### 本轮风险
- 运行时动态加载引入了新的失败面（资源路径、运行上下文、异常重试）。
- 目前通过日志与契约测试覆盖了主路径，但尚未完成浏览器端手工场景回归矩阵。

### 下一轮建议
1. 补充浏览器 E2E 场景验证（页面首次打开、刷新、切标签、站点切换）。
2. 增加跨入口配置一致性测试，覆盖 overlay/options/popup 三端互操作。
3. 在 CI 中单独运行 `check:overlay-size` 并记录趋势。

---

## 补充迭代：Build 类型门禁回归修复（2026-04-16）

### 当前状态判断
- `pnpm run build` 一度因 `react-ui/src/overlay-settings.ts` 类型冲突失败；`build:extension` 当时仍可通过，存在“打包成功掩盖类型回归”的门禁缺口。
- 当前已恢复：`lint/test/build/build:extension` 全部通过，且 `build:extension` 先执行 TypeScript 检查。
- 已补充仓库级 CI（GitHub Actions），在 push/PR 自动执行同一套质量门禁。

### 对标项目可借鉴点
- 成熟扩展项目会在所有发布链路前置 typecheck，避免 JS 打包器放过 TS 类型破坏。
- 当出现“双实现边界”时（共享设置桥接与 overlay fallback），会优先统一类型边界，避免重复全局声明导致冲突。

### 差距清单（按 P0/P1/P2/P3）
- P0：
  - 问题：`overlay-settings.ts` 重复声明 `Window.SharedSettings`，与 `settings-bridge.ts` 发生合并冲突，`tsc` 失败。
  - 影响范围：`pnpm run build`/CI 类型门禁。
  - 根因：同名全局属性在不同模块用不同类型别名声明，且 fallback 中对 `unknown` 直接 spread。
  - 建议改法：移除重复全局声明，使用局部类型收窄；对象展开前做 `isRecord` 守卫。
  - 预期收益：恢复严格类型构建稳定性。
  - 改动风险：低（仅类型与归一化路径改动）。
- P1：
  - 问题：`build:extension` 之前未包含 typecheck。
  - 影响范围：发布链路可漏过 TS 回归。
  - 根因：构建脚本只串联 vite build 与体积门禁。
  - 建议改法：新增 `typecheck` 脚本并接入 `build` 与 `build:extension`。
  - 预期收益：构建门禁信号一致。
  - 改动风险：低（脚本编排层改动）。

### 本轮要做的优化项
- 修复 `overlay-settings` 类型冲突与不安全展开，恢复 `pnpm run build`。
- 将 `typecheck` 前置到 `build:extension`，对齐所有发布路径门禁。

### 具体修改方案
- `bilibili-vocab-extension/react-ui/src/overlay-settings.ts`
  - 删除重复 `declare global interface Window.SharedSettings`，改为局部 `OverlaySharedSettingsApi` 收窄读取。
  - 对 `profilesBuiltin.{gentle,balanced,intensive}` 先做 `isRecord` 判断再展开，消除 spread `unknown` 错误。
  - `listProfileOptions` 明确 `ProfileOption[]` 类型，避免 `concat` 推断冲突。
- `bilibili-vocab-extension/package.json`
  - 新增 `typecheck` 脚本：`tsc --noEmit`。
  - `build` 改为 `pnpm run typecheck && vite build`。
  - `build:extension` 改为 `pnpm run typecheck && vite build ... && pnpm run check:overlay-size`。
- `.github/workflows/ci.yml`
  - 新增 `quality-gates` job，在 `push(main)` 与 `pull_request` 执行 `pnpm run lint`、`pnpm run test`、`pnpm run build`、`pnpm run build:extension`。
  - 使用 `bilibili-vocab-extension` 作为工作目录，保证 CI 与本地命令路径一致。

### 验证方案
- `pnpm run lint -- --fix`：通过。
- `pnpm run test`：通过（162/162）。
- `pnpm run build`：通过（TypeScript 与 Vite 均通过）。
- `pnpm run build:extension`：通过，日志确认先执行 `typecheck`，随后打包与 overlay 体积门禁通过（raw `222.9KB` / gzip `57.26KB`）。

### 本轮风险
- 本轮修复聚焦类型边界与脚本门禁，未覆盖浏览器真实页面的 overlay 动态加载 E2E 兼容矩阵。
- CI 目前是单 Node 20 / 单平台（Linux）验证，还未覆盖浏览器端自动化与多版本矩阵。

### 下一轮建议
1. 补最小浏览器 E2E（Bilibili/YouTube 首次注入、刷新恢复、站点切换）验证动态加载链路。
2. 在 CI 中拆分 `typecheck`、`test`、`build:extension` 并缓存依赖，缩短反馈时延。
3. 增加 Node 版本矩阵或最小跨平台验证，降低环境相关回归风险。

---

## 补充迭代：动态加载回退测试 + CI 并行门禁（2026-04-16）

### 当前状态判断
- `contentScript` 动态加载已有字符串契约测试，但缺少运行时回退分支自动化断言。
- CI 虽已覆盖 `lint/test/build/build:extension`，但仍是单 job 串行，反馈耗时偏高。

### 对标项目可借鉴点
- 成熟浏览器扩展项目会把“动态模块加载成功/失败/缓存”作为独立单测维度，避免只靠静态字符串断言。
- 生产级 CI 常将 lint/test/build 拆分并行，同时配置依赖缓存和并发取消，提升反馈速度并节省资源。

### 差距清单（按 P0/P1/P2/P3）
- P1：
  - 问题：overlay 动态加载缺少异常/回退路径行为测试。
  - 影响范围：加载失败或缓存失效时可能静默回归。
  - 根因：此前只验证“是否包含 import 语句”，未验证分支行为。
  - 建议改法：导出最小测试钩子，补分支单测。
  - 预期收益：降低动态加载链路回归风险。
  - 改动风险：低（仅测试可见导出）。
- P2：
  - 问题：CI 单 job 串行导致反馈慢。
  - 影响范围：PR 迭代效率与故障定位速度。
  - 根因：任务未并行、依赖缓存策略缺失、旧流水线不取消。
  - 建议改法：拆分为并行 jobs + pnpm cache + concurrency cancel。
  - 预期收益：更快失败反馈与更低资源浪费。
  - 改动风险：低（工作流编排层）。

### 本轮要做的优化项
- 为 overlay 动态加载补齐回退路径自动化测试。
- 重构 CI 为并行门禁并启用缓存，保持原有覆盖范围不降级。

### 具体修改方案
- `bilibili-vocab-extension/contentScript.js`
  - 在 Node 导出分支新增 `loadOverlayModule` 与 `__resetOverlayModuleStateForTest`，仅供测试使用。
- `bilibili-vocab-extension/tests/contentScript-overlay-loader.test.js`
  - 新增 4 个用例：全局模块命中、runtime 缺失回退、成功加载缓存复用、无效模块重试回退。
- `.github/workflows/ci.yml`
  - 引入 `concurrency`（同分支新流水线触发时取消旧运行）。
  - 将单 job 拆分为 `lint` / `test` / `build-react-ui` / `build-extension` 四个并行 jobs。
  - 使用 `actions/setup-node` 的 `cache: pnpm` 与 `cache-dependency-path`。

### 验证方案
- `node --test tests/contentScript-overlay-loader.test.js tests/contentScript-hit-tracking.test.js`：通过。
- `pnpm run lint -- --fix`：通过。
- `pnpm run test`：通过（166/166）。
- `pnpm run build`：通过。
- `pnpm run build:extension`：通过（含 `typecheck` 与 `check:overlay-size`）。

### 本轮风险
- CI 缓存键目前基于 `package.json`，若依赖解析策略变化仍可能出现缓存抖动。
- 浏览器真实环境兼容矩阵（尤其不同 Chromium 版本）仍未完全自动化覆盖。

### 下一轮建议
1. 落地最小 Playwright smoke：Bilibili/YouTube 打开页面后 overlay 可挂载与可交互。
2. 引入 Node 版本矩阵（20 + 22）验证依赖兼容性。
3. 追加 CI 产物留存（overlay 体积日志）用于趋势追踪。

---

## 补充迭代：CI Node 矩阵兼容性加固（2026-04-16）

### 当前状态判断
- 已完成并行门禁与缓存，但运行时环境仍以 Node 20 为单点，无法提前暴露版本兼容问题。

### 对标项目可借鉴点
- 成熟前端/扩展项目常将快速门禁（lint/test）做多版本 Node 矩阵，构建门禁维持单版本以平衡时延与覆盖。

### 差距清单（按 P0/P1/P2/P3）
- P2：
  - 问题：CI 缺少跨 Node 版本兼容验证。
  - 影响范围：升级 Node 或依赖后可能出现延迟暴雷。
  - 根因：流水线为单版本配置。
  - 建议改法：为 lint/test 增加 Node 20/22 矩阵，构建任务保持单版本。
  - 预期收益：更早发现生态兼容问题，且总耗时可控。
  - 改动风险：低（CI 编排）。

### 本轮要做的优化项
- 为 `lint` 与 `test` job 增加 Node 20/22 矩阵，保持 `build-react-ui` 与 `build-extension` 单版本执行。

### 具体修改方案
- `.github/workflows/ci.yml`
  - `lint`/`test` 增加 `strategy.matrix.node-version: [20, 22]`，并关闭 `fail-fast` 以保留完整版本结果。
  - `actions/setup-node` 在矩阵 job 使用 `matrix.node-version`。
  - `build-react-ui`/`build-extension` 继续使用 `env.NODE_VERSION=20`，控制构建时长。

### 验证方案
- 本地复验质量门禁命令：
  - `pnpm run lint -- --fix`：通过。
  - `pnpm run test`：通过（166/166）。
  - `pnpm run build`：通过。
  - `pnpm run build:extension`：通过（含 overlay 体积门禁）。
- 工作流结构审查：
  - `lint` 与 `test` 已切换矩阵版本；
  - 构建 job 仍为单版本，符合“快门禁多版本、重构建单版本”策略。

### 本轮风险
- Node 22 下若未来引入原生模块依赖，可能出现平台细分问题，仍需后续在真实 CI 运行中观察。

### 下一轮建议
1. 引入浏览器侧 smoke（Playwright）覆盖 overlay 动态加载真实页面行为。
2. 将 `check:overlay-size` 结果写入 CI summary，形成趋势观察面板。

---

## 补充迭代：Overlay 体积门禁 CI Summary（2026-04-16）

### 当前状态判断
- `check:overlay-size` 已能阻断超预算，但 CI 页面缺少可读的结构化结果展示。

### 对标项目可借鉴点
- 成熟 CI 会把体积门禁结果写入 Step Summary，便于在 PR 页面直接查看关键指标，无需翻日志。

### 差距清单（按 P0/P1/P2/P3）
- P2：
  - 问题：overlay 体积结果仅存在于控制台日志。
  - 影响范围：评审时读取成本高，趋势对比困难。
  - 根因：门禁脚本未输出 GitHub Summary。
  - 建议改法：在脚本中检测 `GITHUB_STEP_SUMMARY` 并输出表格。
  - 预期收益：提升门禁可读性与评审效率。
  - 改动风险：低（脚本输出增强）。

### 本轮要做的优化项
- 为 `check:overlay-size` 增加 GitHub Step Summary 输出（raw/gzip 与预算对比）。

### 具体修改方案
- `bilibili-vocab-extension/scripts/check-overlay-size.js`
  - 新增 `writeGithubSummary(rawKb, gzipKb)`；
  - 当存在 `GITHUB_STEP_SUMMARY` 时输出 markdown 表格与 PASS/FAIL 总结；
  - 保持原有退出码语义不变（超预算仍 `exit(1)`）。

### 验证方案
- 本地注入 `GITHUB_STEP_SUMMARY` 临时文件运行 `node scripts/check-overlay-size.js`：
  - 校验 summary 文件包含 Raw/Gzip 对比表与 Overall 结果。
- `pnpm run build:extension`：通过，`check:overlay-size` 仍按预算门禁执行并通过。

### 本轮风险
- Summary 仅在 GitHub Actions 环境输出；其他 CI 平台仍需从控制台日志读取。

### 下一轮建议
1. 引入浏览器侧 smoke（Playwright）覆盖 overlay 动态加载真实页面行为。
2. 在 CI 中归档 overlay 体积报告，支持跨提交趋势对比。

---

## 补充迭代：Overlay 体积报告 Artifact 化（2026-04-16）

### 当前状态判断
- 已有 Step Summary，但缺少可下载的结构化报告，不利于跨提交自动分析。

### 对标项目可借鉴点
- 成熟项目会将关键质量门禁结果输出为 JSON artifact，便于后续做趋势看板或告警集成。

### 差距清单（按 P0/P1/P2/P3）
- P2：
  - 问题：overlay 体积数据未沉淀为可复用产物。
  - 影响范围：无法低成本做历史对比和自动化消费。
  - 根因：门禁脚本只输出日志和 summary，没有结构化文件。
  - 建议改法：脚本产出 `overlay-size-report.json`，CI 上传 artifact。
  - 预期收益：支持跨提交趋势追踪与后续自动分析。
  - 改动风险：低（脚本/CI增强）。

### 本轮要做的优化项
- 生成 overlay 体积结构化报告，并在 `build-extension` job 上传 artifact。

### 具体修改方案
- `bilibili-vocab-extension/scripts/check-overlay-size.js`
  - 新增 `OVERLAY_REPORT_FILE` 指向 `dist/overlay-size-report.json`。
  - 新增 `writeOverlaySizeReport(rawKb, gzipKb)` 输出时间戳、预算、实际值与结果状态。
  - 保持原预算门禁与退出码逻辑不变。
- `.github/workflows/ci.yml`
  - 在 `build-extension` job 追加 `actions/upload-artifact@v4` 上传 `dist/overlay-size-report.json`（`if: always()`）。

### 验证方案
- `pnpm run build:extension`：通过。
- 校验 `dist/overlay-size-report.json`：
  - 包含 `budgetKb`、`actualKb`、`result.overall` 字段；
  - 当前结果为 `pass`，数值与门禁日志一致。

### 本轮风险
- 目前 artifact 仅保留单文件，若后续需趋势可视化，还需追加汇总脚本或外部分析流程。

### 下一轮建议
1. 引入浏览器侧 smoke（Playwright）覆盖 overlay 动态加载真实页面行为。
2. 增加一个聚合脚本，将历史 artifact 汇总成趋势图数据。
