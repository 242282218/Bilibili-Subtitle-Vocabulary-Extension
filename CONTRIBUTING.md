# 贡献指南

感谢你对 Bilibili Subtitle Vocabulary 的兴趣！本文档说明如何参与贡献。

## 行为准则

参与本项目即表示你同意遵守 [Code of Conduct](./CODE_OF_CONDUCT.md)。请保持友善、尊重、包容。

## 如何贡献

### 报告 Bug

1. 在 [Issues](https://github.com/242282218/Bilibili-Subtitle-Vocabulary-Extension/issues) 搜索是否已有相同问题
2. 使用 Bug Report 模板创建新 Issue
3. 提供复现步骤、期望行为、实际行为和浏览器/扩展版本

### 提交功能建议

1. 先开 Issue 讨论功能需求和实现方案
2. 达成共识后，在分支上实现
3. 提交 PR 时使用 Pull Request 模板

### 提交代码

#### 开发环境

```bash
git clone https://github.com/242282218/Bilibili-Subtitle-Vocabulary-Extension.git
cd Bilibili-Subtitle-Vocabulary-Extension/bilibili-vocab-extension
pnpm install --frozen-lockfile
```

#### 开发流程

1. 从 `main` 创建分支：`git checkout -b feat/your-feature`
2. 开发并测试：
   ```bash
   pnpm run lint
   pnpm run typecheck
   pnpm run test
   pnpm run test:ui
   ```
3. 提交代码，遵循 [Conventional Commits](https://www.conventionalcommits.org/):
   - `feat:` 新功能
   - `fix:` Bug 修复
   - `docs:` 文档
   - `style:` 格式
   - `refactor:` 重构
   - `test:` 测试
   - `chore:` 构建/工具
4. 推送并创建 PR

#### 代码规范

- **TypeScript**: `strict: true`，显式类型优先
- **React**: 函数组件 + Hooks，避免 class 组件
- **CSS**: 使用 design tokens（`--bsv-*`），不硬编码颜色
- **命名**: 自解释，不依赖注释补救
- **函数**: 单一职责，单函数尽量小于 40 行
- **注释**: 只写 why，不写 how

#### UI 贡献规范

新增或修改 UI 时，必须遵循 [Design System](./docs/design-system.md)：

- 使用文档中记录的 `--bsv-*` design tokens，不硬编码颜色、间距、圆角、阴影、字体或动效值。
- 优先复用文档中的 component classes（如 `.panel`、`.btn`、`.field`、`.switch-row`、`.status-pill`、`.skeleton` 等），避免为同一模式重复写样式。
- 主题变更必须通过现有机制生效：Popup / Options 使用 `useDocumentTheme` 设置 `data-bsv-theme`，Overlay 使用 `.bsv-overlay-root` 上的 `data-theme`。
- 满足文档列出的可访问性最低要求：可见焦点环、图标按钮 `aria-label`、状态 `aria-live`、自定义开关 `role="switch"`。

#### 测试要求

- 核心业务逻辑必须有单元测试
- 对外接口必须有集成测试覆盖主路径
- 不为 trivial getter/setter 写测试
- 改动后必须通过 `pnpm run lint && pnpm run test && pnpm run test:ui`

#### 提交前检查

```bash
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:ui
pnpm run build:extension
```

### 词库数据贡献

向词库贡献数据时，请：

1. 确保数据来源明确，附上原始 URL
2. 许可证状态可验证（MIT / CC BY-SA 3.0 优先）
3. 在 `data/sources.json` 中更新数据源清单
4. 不引入 `needs-review` 状态的数据到发布包

详见 [词库来源与许可证](./docs/词库来源与许可证.md)。

## 项目结构

```
bilibili-vocab-extension/
├── contentScript/        # 内容脚本模块
├── data/                 # 词库数据（publish-safe）
├── react-ui/             # React UI（Popup/Options/Overlay）
│   ├── src/components/   # UI 组件
│   ├── src/hooks/        # React Hooks
│   ├── src/lib/          # 业务逻辑
│   └── src/styles/       # 样式与 design tokens
├── scripts/              # 构建/测试脚本
├── sources/              # 原始数据源（不发布）
├── tests/                # 测试
└── manifest.json         # 扩展清单
```

## Release 流程

1. 更新 `manifest.json` 和 `package.json` 的版本号
2. 更新 `CHANGELOG.md`
3. 创建 git tag：`git tag v0.x.y`
4. 推送 tag 触发 Release 构建
5. 在 Release 附件上传扩展包

## 许可证

贡献的代码遵循 [MIT License](./LICENSE)。
