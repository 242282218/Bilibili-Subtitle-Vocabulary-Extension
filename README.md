# Bilibili Subtitle Vocabulary Extension

在 Bilibili 和 YouTube 字幕里低打扰插入英文词汇，帮助用户边看视频边被动记忆单词。

## 功能概览

- 字幕词汇替换：按替换比例、单句上限、目标难度和词库等级控制曝光密度。
- 视频内学习面板：支持开关、策略调节、今日进度、最近词汇和字幕句级导航。
- 轻量复习闭环：支持 tooltip 收藏、Popup 快速复习、生词排行、复习弹幕和连续学习进度。
- 多入口同步：Popup、Options、Overlay 共享同一套设置和学习状态。
- 最小权限发布：默认自动注入范围仅限 Bilibili 和 YouTube；非默认站点需要用户主动授权。

## 当前版本

- 版本：`0.1.2`
- Release：<https://github.com/242282218/Bilibili-Subtitle-Vocabulary-Extension/releases/tag/v0.1.2>
- 可加载扩展包：Release 附件 `bilibili-vocab-extension-v0.1.2.zip`

## 安装使用

1. 下载 Release 附件并解压，或克隆仓库后执行构建。
2. 打开 Chrome / Edge 的扩展管理页。
3. 开启开发者模式。
4. 选择“加载已解压的扩展程序”，加载 `bilibili-vocab-extension` 目录。
5. 打开带字幕的 Bilibili 或 YouTube 视频，点击扩展图标调整策略。

## 本地开发

```bash
cd bilibili-vocab-extension
pnpm install --frozen-lockfile
pnpm run lint
pnpm run typecheck
pnpm run test
pnpm run test:ui
pnpm run build:extension
pnpm run pack
```

常用脚本：

- `pnpm run dev`：启动 React UI 本地开发。
- `pnpm run build`：构建 Options / Popup。
- `pnpm run build:extension`：构建完整扩展产物。
- `pnpm run release:check`：串行执行发布候选检查。
- `pnpm run pack`：生成 `bilibili-vocab-extension/extension.zip`。

## 隐私与权限

- 设置、生词本、复习队列和学习指标存储在 `chrome.storage.local`。
- 扩展没有项目自有账号、云同步、广告、遥测或远程翻译服务。
- 默认自动注入范围仅限 Bilibili 和 YouTube。
- `optional_host_permissions: *://*/*` 只用于用户主动授权后的非默认站点网页正文模式。
- Bilibili 字幕导航会请求 Bilibili 官方播放器 / 字幕 API。
- YouTube 字幕从页面 caption DOM 读取。
- 权限细节见 [权限说明](docs/权限说明.md)，数据处理见 [隐私政策](docs/隐私政策.md)。

## 数据与许可证

- 项目代码使用 MIT License。
- 词库数据由多个公开来源构建，发布包会使用 publish-safe 数据集。
- 词库来源、署名和再分发边界见 [词库来源与许可证](docs/词库来源与许可证.md)。

## 支持站点

- Bilibili 视频页
- YouTube 视频 / 直播 / Shorts
