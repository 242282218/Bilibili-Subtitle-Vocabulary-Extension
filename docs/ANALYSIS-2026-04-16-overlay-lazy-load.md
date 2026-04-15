# 评估：Overlay 按需加载链路（2026-04-16）

## 目标
在不破坏现有内容脚本初始化顺序的前提下，评估 `overlay` 从“总是随 content_scripts 注入”迁移到“按需加载”的可行性。

## 现状约束
- `manifest.json` 的 `content_scripts.js` 当前固定包含 `dist/overlay.js`，且位于 `contentScript.js` 之前。
- `contentScript.js` 初始化阶段硬依赖 `globalThis.ReactOverlayModule || globalThis.OverlayPanelModule`，缺失时直接报错退出。
- `vite.overlay.config.mts` 当前输出为 `iife`，且 `inlineDynamicImports: true`，天然偏向一次性注入。

## 可选方案对比
### 方案 A：维持现状（不做按需）
- 优点：零风险。
- 缺点：无法降低首帧注入解析负担，性能收益为 0。

### 方案 B：ESM + `import()` 按需加载（推荐）
- 做法：
  1. `overlay` 构建产物改为 `es` 格式（仍产出 `dist/overlay.js`）。
  2. 从 `manifest.content_scripts.js` 移除 `dist/overlay.js`。
  3. 在 `contentScript.js` 初始化中增加 `ensureOverlayModule()`：
     - 先检查 `globalThis.ReactOverlayModule` 已存在则直接复用。
     - 否则执行 `await import(chrome.runtime.getURL("dist/overlay.js"))`，从模块导出获取 `mountOverlayPanel`。
  4. 仅在 `init` 即将挂载面板前触发加载，维持其余模块初始化顺序不变。
- 优点：可把 overlay 解析成本从“总是启动即发生”改为“初始化阶段按需发生”，并为后续细粒度延迟加载打基础。
- 风险：中；需验证 MV3 content script 对动态 `import()` 的兼容性与错误回退路径。

### 方案 C：在页面注入 `<script src=...>` 懒加载（不推荐）
- 问题：页面上下文与扩展内容脚本隔离，容易出现模块实例与全局对象不可见问题。
- 结论：放弃。

## 推荐实施路径（下一轮）
1. 修改 overlay 构建格式为 ESM（保留文件名 `dist/overlay.js`）。
2. 在 `contentScript.js` 添加 `ensureOverlayModule()` 并改造 `init` 调用链。
3. 调整契约测试：
   - 旧断言“manifest 必须包含 dist/overlay.js 并位于 contentScript 前”需替换。
   - 新断言改为“contentScript 含动态加载 overlay 的调用点与错误处理”。
4. 回归验证：
   - `pnpm run test`
   - `pnpm run build:extension`
   - 视频页手动验证（首次加载、刷新、切换页面、关闭/打开面板）

## 风险与回滚
- 风险：
  - 动态 `import()` 在部分环境受 CSP/执行上下文影响。
  - 初始化失败会导致 overlay 不可用，需要明确降级日志与兜底分支。
- 回滚策略：
  - 仅恢复 `manifest` 中 `dist/overlay.js` 静态注入；
  - 删除 `contentScript` 的动态加载逻辑；
  - 不影响词汇替换主链路。
