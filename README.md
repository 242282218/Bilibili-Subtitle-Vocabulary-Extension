# Bilibili Subtitle Vocabulary Extension

在 Bilibili 和 YouTube 字幕中插入英文词汇，帮助你在看视频时被动记忆单词。

## 环境要求

- Node.js 20+
- pnpm 9+

## 本地开发

1. 安装依赖：`cd bilibili-vocab-extension && pnpm install --frozen-lockfile`
2. 本地 UI 开发：`pnpm run dev`
3. 质量门禁：
   - `pnpm run lint -- --fix`
   - `pnpm run typecheck`
   - `pnpm run test`
4. 构建扩展产物：`pnpm run build:extension`
5. 打包发布产物：`pnpm run pack`（输出 `bilibili-vocab-extension/extension.zip`）

### 行尾规范（Windows 首次同步）

- 仓库使用 `.gitattributes` 统一文本文件为 LF。
- 若你在拉取前已产生 CRLF 噪声改动，可在仓库根目录执行一次：
  - `git add --renormalize .`
  - `git status` 确认仅为行尾归一化后再继续开发。

## 浏览器安装

1. 下载或克隆本项目
2. 打开 Chrome/Edge 扩展管理页 (`chrome://extensions/` 或 `edge://extensions/`)
3. 开启「开发者模式」
4. 点击「加载已解压的扩展程序」，选择 `bilibili-vocab-extension` 目录

## 构建后加载说明

- `manifest.json` 已配置 `dist/options.html` 与 `dist/popup.html`。
- 本地调试前建议先执行一次 `pnpm run build:extension`，确保 `dist/` 下页面与 overlay 产物为最新。
- 若仅修改内容脚本逻辑（非 React UI），可直接刷新扩展重载验证。

## 使用

1. 打开带字幕的 Bilibili 或 YouTube 视频
2. 点击扩展图标打开设置面板
3. 调整替换比例、难度等级等选项
4. 播放视频，字幕中会自动插入英文词汇
5. 播放器顶部会出现复习弹幕

## 网页模式行为

- 非视频网页默认使用 `SubtitleParser.getCurrentSubtitleItems()` 的段落级单链路替换，避免重复扫描与重复改写 DOM。
- 当关闭「网页文本模式」后，已替换段落会按 `data-bili-vocab-original-text` 恢复为原文。
- 旧版文本节点扫描链路默认关闭，仅用于调试回退：在页面控制台设置 `window.__BILI_VOCAB_ENABLE_LEGACY_WEB_TEXT_PIPELINE__ = true`。

## 配置项

| 选项 | 说明 |
|------|------|
| 替换比例 | 字幕中被替换为英文的比例 (10%-30%) |
| 单句上限 | 每句字幕最多替换几个词 (1-5) |
| 目标难度 | CEFR 等级 (A1-C2) |
| 词库等级 | CET4、CET6、考研、IELTS、TOEFL |

## 支持站点

- Bilibili 视频页
- YouTube 视频/直播/短视频
