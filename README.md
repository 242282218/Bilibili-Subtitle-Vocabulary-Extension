# Bilibili Subtitle Vocabulary Extension

一个面向视频场景的英语词汇学习浏览器扩展。它会在 Bilibili 和 YouTube 的字幕里插入英文词汇与释义，并结合 Popup 排行榜和高频复习弹幕，帮助用户在看视频时做被动记忆。

## 当前状态

截至 2026-03-06，项目主链路已打通并完成最近一轮稳定性收敛：

- 支持 Bilibili 与 YouTube 视频页字幕增强。
- 支持 Popup 设置、命中排行榜、选项页配置。
- 支持播放器内复习弹幕调度与关联词聚类。
- 已修复字幕二次翻译套娃、重复累计 `hitCount`、同轨弹幕重叠复用等问题。

## 核心功能

### 1. 字幕词汇替换

- 在中文字幕中插入英文词汇，格式为“英文词（原词语意思）”。
- 根据用户配置限制替换比例和单句替换上限。
- 支持按词库等级筛选词汇。
- 支持目标 CEFR 难度控制。

### 2. 命中统计与排行榜

- 每次真正渲染成功的词汇会记录 `hitCount` 和 `lastSeen`。
- Popup 中提供两种排序视图：
  - `急需巩固 ↑`：按 `hitCount` 升序，再按 `lastSeen` 升序。
  - `高频生词 ↓`：按 `hitCount` 降序，再按 `lastSeen` 降序。
- 同一条字幕在重渲染、设置切换或局部刷新时不会重复累计命中次数。

### 3. 复习弹幕引擎

- 在播放器上方持续发射已命中词汇的复习弹幕。
- 主词优先偏向低命中词，避免高频词长期霸屏。
- 支持形近词和近义词关联发射，形成短时“记忆聚堆”。
- 所有轨道忙时会丢弃当前调度帧，不会强行复用同轨。
- 同一轨道只会在前一条弹幕离场后复用。

## 支持站点

- `https://www.bilibili.com/video/*`
- `https://www.youtube.com/watch*`
- `https://www.youtube.com/live/*`
- `https://www.youtube.com/shorts/*`

## 安装方式

### 以 unpacked extension 方式加载

1. 打开 Edge 或 Chrome 的扩展管理页。
2. 开启“开发者模式”。
3. 选择“加载已解压的扩展程序”。
4. 指向 [`bilibili-vocab-extension/`](./bilibili-vocab-extension/) 目录。

## 使用方式

1. 打开带字幕的 Bilibili 或 YouTube 视频页面。
2. 点击扩展图标，打开 Popup。
3. 配置替换比例、单句替换上限、目标 CEFR 和激活词汇等级。
4. 播放视频后，字幕会按配置进行词汇增强，播放器顶部会出现复习弹幕。
5. 在 Popup 底部查看命中排行榜。

## 可配置项

- `enabled`
  - 是否启用字幕词汇替换。
- `replaceRatio`
  - 替换比例，范围 `0.1 - 0.3`。
- `maxReplaceCount`
  - 单句替换上限，范围 `1 - 5`。
- `targetCefr`
  - 目标难度，支持 `A1 - C2`。
- `activeLevels`
  - 激活词汇等级，当前支持 `CET4`、`CET6`、`KAOYAN`、`IELTS`、`TOEFL`。

## 目录结构

```text
.
├─ bilibili-vocab-extension/
│  ├─ manifest.json
│  ├─ contentScript.js
│  ├─ popup.js
│  ├─ options.js
│  ├─ renderer.js
│  ├─ subtitleParser.js
│  ├─ translator.js
│  ├─ vocabulary.js
│  ├─ scripts/
│  │  ├─ danmaku.js
│  │  └─ scheduler.js
│  └─ tests/
├─ docs/
└─ output/
```

## 开发验证

### 单元测试

在项目根目录执行：

```powershell
node --test bilibili-vocab-extension\tests\*.test.js
```

截至 2026-03-06，当前仓库结果为 `45/45` 通过。

### 浏览器冒烟测试

仓库内保留了基于本地浏览器扩展加载的冒烟脚本：

```powershell
node output\playwright\extension-cdp-smoke.js
```

截至 2026-03-06，最近一次冒烟验证结果：

- Popup 排序正常。
- YouTube 页面注入正常。
- 复习弹幕实际发射成功。

验证产物位于：

- [`output/playwright/extension-smoke-result.json`](./output/playwright/extension-smoke-result.json)
- [`output/playwright/popup.png`](./output/playwright/popup.png)
- [`output/playwright/youtube-page.png`](./output/playwright/youtube-page.png)

## 最近修复

- 已修复已渲染字幕再次参与解析时出现的嵌套翻译问题。
- 已修复设置变化或重渲染导致同一字幕重复累计 `hitCount` 的问题。
- 已修复复习弹幕在轨道未释放前重复占用同轨导致重叠的问题。

## 相关文档

- 详细设计说明：[docs/VOCAB_DANMAKU_SPEC.md](./docs/VOCAB_DANMAKU_SPEC.md)
- 词库来源说明：[docs/VOCAB_SOURCES.md](./docs/VOCAB_SOURCES.md)
- 多智能体执行记录：[docs/multi-agents/](./docs/multi-agents/)
