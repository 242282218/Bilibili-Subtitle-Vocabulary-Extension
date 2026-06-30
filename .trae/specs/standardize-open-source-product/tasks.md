# Tasks

- [x] Task 1: 建立统一命名空间与品牌一致性
  - [x] SubTask 1.1: 审计并列出当前所有命名空间混用点（`ev-*`、`rv-*`、`ui-*`、`bili-vocab-*`）
  - [x] SubTask 1.2: 在不破坏 DOM / storage 兼容性的前提下，将用户可见 CSS 类名与 DOM ID 统一为 `bsv-*`
  - [x] SubTask 1.3: 确认 manifest、README、package.json、CHANGELOG 中品牌名称完全一致

- [x] Task 2: 完善设计系统文档
  - [x] SubTask 2.1: 创建 `docs/design-system.md`，包含 token 表、组件类名表、暗色模式规则
  - [x] SubTask 2.2: 在 `CONTRIBUTING.md` 中引用 `docs/design-system.md` 作为 UI 贡献规范

- [x] Task 3: 统一三入口 UI 状态模式
  - [x] SubTask 3.1: 提取可复用的 `LoadingPanel`、`ErrorPanel`、`EmptyState` 组件到 `react-ui/src/components/ui-shell.tsx`
  - [x] SubTask 3.2: 在 Popup、Options、Overlay 中替换各自实现的 loading / error 片段
  - [x] SubTask 3.3: 统一空列表提示文案与样式（最近词汇、站点规则、快速复习）

- [x] Task 4: Overlay 视觉与主设计系统对齐
  - [x] SubTask 4.1: 将 `overlay.css` 中的 `.rv-*` 硬编码值替换为 design tokens 或 `ui.css` 组件类
  - [x] SubTask 4.2: 统一 Overlay 的按钮、开关、下拉框、卡片与 Popup/Options 的交互反馈
  - [x] SubTask 4.3: 验证 Overlay 在 light / dark 主题下无样式回归

- [x] Task 5: 补齐无障碍标注
  - [x] SubTask 5.1: 为 Popup / Options / Overlay 中所有可交互元素添加或修正 `aria-label` / `aria-describedby`
  - [x] SubTask 5.2: 确保所有自定义开关使用可访问的 switch 模式（role="switch" + aria-checked）
  - [x] SubTask 5.3: 验证 Tab 焦点顺序与可见焦点环

- [x] Task 6: 开源治理与发布规范文档
  - [x] SubTask 6.1: 创建 `docs/architecture.md`，说明 content script、background、React UI、storage 的协作关系
  - [x] SubTask 6.2: 创建 `docs/release-checklist.md`，包含版本号、CHANGELOG、构建、截图、Release、商店素材步骤
  - [x] SubTask 6.3: 更新 `.github/PULL_REQUEST_TEMPLATE.md` 增加“是否符合 design-system.md”检查项

- [x] Task 7: README 产品化更新
  - [x] SubTask 7.1: 统一品牌描述与徽章链接
  - [x] SubTask 7.2: 添加设计系统、架构、发布检查单文档链接
  - [x] SubTask 7.3: 更新路线图到当前开源产品化阶段

- [x] Task 8: 验证与质量门禁
  - [x] SubTask 8.1: 运行 `pnpm run lint && pnpm run typecheck && pnpm run test && pnpm run test:ui`
  - [x] SubTask 8.2: 运行 `pnpm run build:extension` 并确认 overlay size 检查通过
  - [x] SubTask 8.3: 手动检查 Popup / Options / Overlay 在 light / dark 模式下的视觉一致性

# Task Dependencies

- Task 2 depends on Task 1（命名空间确定后设计系统文档中的类名引用才稳定）
- Task 4 depends on Task 1（Overlay 类名统一后才能完整替换 token）
- Task 7 depends on Task 2 和 Task 6（README 中引用新文档）
- Task 8 depends on Task 3、Task 4、Task 5（完成后统一验证）
