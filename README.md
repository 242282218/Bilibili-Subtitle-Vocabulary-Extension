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
   - `pnpm run test:ui`
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
- React 源码入口位于 `bilibili-vocab-extension/react-ui/options.html` 与 `bilibili-vocab-extension/react-ui/popup.html`，构建后产物才会落到 `dist/`。
- 仓库根目录的 `bilibili-vocab-extension/options.html` / `popup.html` 是 legacy 页面，不是当前打包入口。
- 本地调试前建议先执行一次 `pnpm run build:extension`，确保 `dist/` 下页面与 overlay 产物为最新。
- 若仅修改内容脚本逻辑（非 React UI），可直接刷新扩展重载验证。

## 使用

1. 打开带字幕的 Bilibili 或 YouTube 视频
2. 点击扩展图标打开设置面板
3. 调整替换比例、难度等级等选项
4. 播放视频，字幕中会自动插入英文词汇
5. 播放器顶部会出现复习弹幕

## 快捷键

- `Ctrl+Shift+E`：切换字幕替换总开关
- `Ctrl+Shift+O`：切换悬浮学习面板
- `Ctrl+Shift+Up`：提高当前配置的替换比例
- `Ctrl+Shift+Down`：降低当前配置的替换比例
- macOS 默认使用 `Command` 替代 `Ctrl`
- shipped React `Popup / Options` 中的快捷键速览会读取浏览器当前已生效绑定；若某个命令未分配，会直接标记为“未分配”并给出推荐默认值
- 可在 `chrome://extensions/shortcuts` 或 `edge://extensions/shortcuts` 自定义

## 生词本导出

- Popup 可直接导出生词本为 `JSON`、`CSV`、`Anki TSV`
- `Anki TSV` 默认字段为 `Front / Back / Level / Phonetic / SavedAt`
- 完整配置、站点规则和悬浮面板参数可在选项页统一管理

## 配置备份与词库维护

- shipped React `Options` 支持直接导出当前配置；导出的是当前编辑稿，未保存修改也会一并带出
- `Options` 支持导入 legacy / v3 配置文件，导入后会自动迁移到 v3 并立即应用到真实运行时
- `Options` 支持一键恢复默认设置，适合策略漂移或调参过度后的快速回滚
- `Options` 支持清空“已收藏”生词；该操作只会撤销收藏状态，不会删除学习队列、命中统计或复习历史

## 快速复习与生词排行

- shipped React Popup 现在可直接处理待复习词：支持 `认识 / 模糊 / 不认识` 三种反馈，提交后会立即回写学习队列与学习概览
- Popup 内置“换一张”轮播当前复习池中的词卡，适合边看边做轻量 SRS 复习
- 生词排行支持在 `待巩固` 与 `最高频` 两种视角间切换，方便快速定位当前最值得补强的词
- quick review 反馈会继续透传自动调优链路；若触发调优，Popup 的自动调优状态与指标会同步刷新
- shipped React Overlay 会跟随学习状态实时刷新今日进度与最近词汇，视频内调参时不需要手动刷新页面确认学习面板是否同步

## 连续学习进度

- `learning streak` 现在不再只是 legacy / storage 里的静态字段；字幕命中、正文命中、tooltip 收藏/反馈、Popup quick review 都会把当天学习活动记入连续学习进度
- streak 同一天只会记录一次，不会因为一次观看里多次命中或多次复习把连续天数刷高
- shipped React `Popup / Options` 会实时显示 `连续学习 / 总学习天数 / 最长连续`，并随 storage 变化自动刷新

## 策略预设与实时预览

- `Options` 页提供 `轻量输入 / 均衡输入 / 强化曝光` 三档策略预设，点击后会直接填充当前配置档，保存后生效
- `Options` 与 `Popup` 都会基于当前参数生成实时学习预览，方便在保存前判断替换密度、复习节奏和目标难度
- shipped React `Options / Popup` 现已直接支持 `默认括号释义 / 双语对照 / 纯英文` 三种显示模式，预览区会同步反映整句对照效果
- shipped React `Options / Popup / Overlay` 现已支持 `跟随系统 / 浅色 / 深色` 三种主题模式；主题会跟随当前配置档同步到真实入口，而不再停留在 legacy 字段

## 自动调优与验收指标

- `Options` 与 `Popup` 都支持开关自动调优；开启后会结合最近反馈自动微调替换比例、单句上限与复习节奏
- UI 会展示近 7 天的关键指标，包括误替换反馈、自动调优执行次数、手动覆盖次数与开关禁用率
- 保存后会立即刷新自动调优状态；若状态刷新失败，会保留保存结果并提示重试

## 冲突提示与高风险撤销

- 如果其他页面先改了配置，`Options` / `Popup` 会提示并发冲突，并允许“应用远端版本”或“应用本地版本”
- 站点级启停等高风险操作会生成 6 秒撤销窗口，避免误关当前站点后只能手动找回
- 保存状态栏会同时显示状态码与建议文案，方便快速定位是保存成功、保留本地编辑，还是外部冲突

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
| 显示模式 | 默认括号释义、双语对照、纯英文 |

## 支持站点

- Bilibili 视频页
- YouTube 视频/直播/短视频
