# 迭代记录：Overlay 体积优化与构建告警清理（2026-04-16）

### 当前状态判断
- 工程门禁稳定：`lint/test/build/build:extension` 均可通过。
- 构建链路已消除 Vite CJS Node API deprecation 告警。
- overlay 注入包仍偏大，但已从 `494.37KB` 降到 `490.03KB`（gzip `153.82KB` -> `151.83KB`）。

### 对标项目可借鉴点
- 同类成熟扩展通常把“运行时热路径”依赖做最小化，避免将通用后台/设置逻辑直接打入页面注入包。
- 构建入口优先保持 ESM 一致性，避免工具链 deprecation 噪声污染发布信号。
- 契约测试应约束关键架构边界（如入口依赖），防止后续重构导致包体回弹。

### 差距清单（按 P0/P1/P2/P3）
- P0：无。
- P1：
  - 问题：`dist/overlay.js` 仍接近 500KB。
  - 影响范围：内容脚本注入与解析时延。
  - 根因：React overlay 仍承担完整交互视图，且尚未做加载时机优化。
  - 建议改法：下一轮评估按需加载 overlay UI。
  - 预期收益：首帧注入负担下降，弱设备更稳定。
  - 风险：中（涉及加载模型调整）。
- P2：
  - 问题：overlay 轻量适配层与通用 settings/storage 的行为一致性需长期守护。
  - 建议改法：补充跨入口行为一致性用例（overlay/options/popup）。
  - 风险：低。
- P3：
  - 问题：缺少 overlay 包体积预算门禁。
  - 建议改法：加入构建后体积阈值检查脚本。
  - 风险：低。

### 本轮要做的优化项
- 消除构建链路 CJS deprecation 根因。
- 在不改 manifest 加载链路的前提下，收缩 overlay 入口依赖边界。

### 具体修改方案
- ESM 构建入口
  - 将 Vite 配置迁移为 `.mts`：`vite.config.mts`、`vite.overlay.config.mts`。
  - `package.json` 的 `build:extension` 脚本同步改为 `.mts` 配置入口。
- Overlay 轻量适配层
  - 新增 `react-ui/src/overlay-settings.ts`：只保留 overlay 所需的 settings 能力。
  - 新增 `react-ui/src/overlay-storage.ts`：只保留 overlay 所需的读写与订阅能力。
  - 新增 `react-ui/src/use-overlay-settings.ts`：替代通用 `use-v3-settings`，减少无关冲突管理逻辑进入 overlay 包。
  - `react-ui/src/overlay-entry.tsx` 切换到上述轻量模块。
- 防回归契约
  - `tests/react-ui-contract.test.js` 新增断言：overlay entry 不可回退到重模块导入。

### 验证方案
- `pnpm run lint -- --fix`：通过。
- `pnpm run test`：通过（161/161）。
- `pnpm run build`：通过，无 CJS deprecation 告警。
- `pnpm run build:extension`：通过，overlay 体积从 `494.37KB` 降至 `490.03KB`。

### 本轮风险
- overlay 轻量适配层与通用设置模块存在双实现边界；虽已优先复用 `window.SharedSettings`，但仍需持续监控行为一致性。
- 当前优化主要是“去重无关依赖”，尚未触及“加载时机”层面的性能瓶颈。

### 下一轮建议
1. 评估 overlay UI 按需加载（首屏只注入最小控制能力）。
2. 增加跨入口一致性测试，重点覆盖 profile 切换、siteRules、overlayState。
3. 引入 overlay 产物体积预算阈值（例如在 CI 中执行 build 后检查）。
