# 开源产品化全维度规范 Spec

## Why

当前扩展已实现核心学习闭环与基础 UI，但 Popup、Options、Overlay 三入口在视觉语言、类名命名、空状态/错误态、无障碍等方面仍存在不一致；开源治理文档与品牌呈现也尚未完全对齐。本 Spec 将项目作为可发布、可协作的开源产品进行全维度规范，确保界面、代码、文档、发布流程具备一致的专业度。

## What Changes

- **品牌与命名统一**：统一 manifest、README、代码内部命名与 CSS 命名空间，消除 `ev-*` / `rv-*` / `ui-*` / `bili-vocab-*` 混用。
- **设计系统落地**：将所有 UI 表面（Popup、Options、Overlay）对齐到同一套 token 与组件模式，补齐 skeleton / empty / error 状态。
- **无障碍与交互规范**：统一焦点环、ARIA 标注、键盘快捷键说明、禁用态与加载态表达。
- **开源治理文档**：补齐设计系统说明、架构概览、Release 检查单与商店素材规范。
- **发布与版本规范**：统一版本号来源、构建产物命名、Release 附件与商店截图要求。

## Impact

- Affected specs: 无前置依赖 spec（本 spec 为根规范）。
- Affected code:
  - `bilibili-vocab-extension/manifest.json`
  - `bilibili-vocab-extension/react-ui/src/styles/tokens.css`
  - `bilibili-vocab-extension/react-ui/src/styles/ui.css`
  - `bilibili-vocab-extension/react-ui/src/styles/overlay.css`
  - `bilibili-vocab-extension/react-ui/src/components/*.tsx`
  - `bilibili-vocab-extension/react-ui/src/lib/ui-theme.ts`
  - `bilibili-vocab-extension/README.md`
  - `bilibili-vocab-extension/CHANGELOG.md`
  - `bilibili-vocab-extension/CONTRIBUTING.md`
  - 新增 `docs/design-system.md`、`docs/architecture.md`、`docs/release-checklist.md`

## ADDED Requirements

### Requirement: 品牌命名一致性

The system SHALL 在所有用户可见位置与代码内部标识中使用统一的品牌名称与命名空间。

#### Scenario: 用户安装扩展

- **WHEN** 用户在 Chrome Web Store / Edge Add-ons 浏览扩展
- **THEN** 名称固定为 `Bilibili Subtitle Vocabulary`，副标题固定为 `在 Bilibili / YouTube 字幕里低打扰插入英文词汇，把刷视频变成碎片时间英语输入`

#### Scenario: 开发者阅读代码

- **WHEN** 开发者查看 CSS 类名、DOM ID、storage key、message namespace
- **THEN** 统一使用 `bsv-*` 命名空间（Bilibili Subtitle Vocabulary 缩写），不再混用 `ev-*` / `rv-*` / `ui-*` / `bili-vocab-*`

### Requirement: 设计系统文档化

The system SHALL 提供一份可维护的设计系统文档，说明 token、组件模式与暗色模式规则。

#### Scenario: 贡献者新增 UI

- **WHEN** 贡献者需要新增一个设置面板或弹窗
- **THEN** 可通过 `docs/design-system.md` 明确知道应使用的颜色、间距、圆角、动效 token，以及 `.panel` / `.btn` / `.field` / `.switch-row` 等组件类名

### Requirement: UI 状态模式统一

The system SHALL 对 Popup、Options、Overlay 三类页面统一 loading / empty / error / success 状态组件与文案风格。

#### Scenario: 配置读取失败

- **WHEN** 任何设置页面读取 `chrome.storage` 失败
- **THEN** 显示一致的 error panel：标题 + 建议文案 + 重试按钮，使用 `AlertIcon` 与 `.btn.secondary`

#### Scenario: 列表数据为空

- **WHEN** 最近词汇、站点规则、快速复习等列表为空
- **THEN** 使用统一的 empty state 样式：柔和图标或提示文字，避免空白或仅显示“0”

### Requirement: Overlay 视觉与 Popup/Options 对齐

The system SHALL 让 Overlay 的按钮、卡片、开关、下拉框与 Popup/Options 使用同一套视觉变量与交互反馈。

#### Scenario: 用户在视频页打开 Overlay

- **WHEN** 用户悬停或点击 Overlay 内的按钮、开关、下拉框
- **THEN** 颜色、圆角、阴影、焦点环与 Popup/Options 一致，不再使用独立的 `.rv-*` 硬编码样式

### Requirement: 无障碍最低标准

The system SHALL 满足扩展 UI 的可访问性最低要求。

#### Scenario: 键盘用户操作

- **WHEN** 用户使用 Tab 键遍历 Popup / Options / Overlay
- **THEN** 所有可交互元素可见焦点环，按钮与链接可通过 Enter / Space 触发

#### Scenario: 屏幕阅读器用户

- **WHEN** 屏幕阅读器朗读设置页面
- **THEN** 主要区块带有 `aria-label` / `aria-labelledby`，状态变化使用 `aria-live="polite"` 或 `"assertive"`

### Requirement: 开源治理与发布规范

The system SHALL 提供完整的贡献与发布指南，使任何维护者都能按统一流程发版。

#### Scenario: 新维护者发布版本

- **WHEN** 维护者需要发布 `v0.2.0`
- **THEN** 按照 `docs/release-checklist.md` 逐步完成版本号更新、CHANGELOG 更新、构建、截图、GitHub Release 与商店素材准备

#### Scenario: 外部贡献者提交 PR

- **WHEN** 贡献者提交 PR
- **THEN** 通过 PR 模板与 CI 检查（lint / typecheck / test / test:ui / build:extension）验证改动是否符合项目规范

## MODIFIED Requirements

### Requirement: README 产品化呈现

README SHALL 保持现有结构，但统一品牌描述、添加设计系统入口、补充商店安装链接占位、并更新路线图到与当前开源产品化一致的阶段目标。

## REMOVED Requirements

无。
