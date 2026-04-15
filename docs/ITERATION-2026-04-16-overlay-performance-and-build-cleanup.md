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
  - 新增 `scripts/check-overlay-size.js`，默认校验 overlay raw/gzip 阈值。
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
