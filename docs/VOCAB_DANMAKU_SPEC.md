# 词汇排行榜与弹幕复习引擎 - 详细设计文档

> 本文档描述 **v9 新增功能**，前置版本基线：`DEV_SPEC.md v8.2`
> Updated: **2026-03-06**
> Audience: Developers, AI coding agents

---

## 1. 需求概述

为加强视频语境下的词汇记忆效果，v9 将增加以下两项核心功能：

1. **命中计数与排行榜**：统计已被成功替换并展示过的生词次数，并在 Popup 中生成"命中最少（急需巩固）"和"命中最多（高频词汇）"双向可切换的排行榜。
2. **高频沉浸式弹幕复习引擎**：以 **1 条/秒** 的高频速度在视频播放器上方连续发射已命中词汇的复习弹幕。算法保证优先发射命中次数极低的生词，并发射与之相关的**形近词**或**近义词**形成"记忆聚堆效应"。

---

## 2. 核心架构与数据流设计

### 2.1 数据层 (`vocabulary.js`)

- **结构扩充**：当前字典缓存从仅存词表的结构升级为带统计维度的结构：
  ```json
  {
    "word_key": {
      "word": "aberration",
      "translation": "n. 偏差，越轨",
      "level": "gre",
      "hitCount": 5,
      "lastSeen": 1718889999000
    }
  }
  ```
  - `hitCount`：成功替换的命中次数，初始化为 `0`。
  - `lastSeen`：时间戳（ms），最后一次命中时刻，初始化为 `null`。

- **存储引擎**：继续采用 `chrome.storage.local` 进行持久化，并实现高频写入节流（Throttle，间隔建议 `≥ 500ms`），防止批量字幕替换时触发 API 写入限制报错。

- **新增暴露接口**：
  - `recordHit(word)`：当且仅当成功将原文替换为带英文标记的 `<span>` 元素的那一瞬间调用，执行 `hitCount++` 并更新 `lastSeen = Date.now()`。

### 2.2 UI 层设计 (`popup.html` / `popup.js` / `styles.css`)

- **交互控件**：顶部增加选项卡切换（"急需巩固 ↑ / 高频生词 ↓"）。
- **渲染逻辑**：
  - 读取 `chrome.storage.local` 中全部 `hitCount > 0` 的已遇词汇。
  - **急需巩固**：按 `hitCount` **升序**排列（次数少的优先展示）。若 `hitCount` 相同，按 `lastSeen` **升序**（越久未见的优先）。
  - **高频生词**：按 `hitCount` **降序**排列。若 `hitCount` 相同，按 `lastSeen` **降序**（最近高频出现的优先）。
  - **列表项视觉**：每项显示 `[英文单词] — [中文释义] — [次数徽章 (Badge)]`。
  - 使用 Vanilla CSS 构建列表结构和 Tabs 菜单，使用 `Array.prototype.sort` 实现面板刷新逻辑。

---

## 3. 高强度弹幕复习引擎

### 3.1 弹幕 DOM 管理层 (`danmaku.js`)

- **容器注入**（`initDanmakuContainer()`）：
  - 优先选择器：`.bpx-player-video-wrap`（Bilibili 播放器包裹层）。
  - **降级策略**：若主选择器未找到，回退至 `document.querySelector('video')?.parentElement`。
  - 若播放器 DOM 尚未就绪，通过 `MutationObserver` 监听 DOM 变化，待元素插入后再执行挂载。
  - 容器样式：`pointer-events: none; z-index: 999; overflow: hidden; position: absolute; top: 0; left: 0; width: 100%; height: 100%;`。

- **动画机制**：
  - 完全摒弃重负载的 Canvas，采用**纯 CSS3 过渡动画**（`transform: translateX()`）生成弹幕。
  - **生命周期管理**：每次发射生成一个 `<div>` DOM 节点，监听 `transitionend` 事件，弹幕飞出屏幕后立即从 DOM 与内存中销毁，严防内存泄漏。
  - **同屏节点上限**：维持弹幕节点数 `≤ 15`，超出时丢弃当前调度帧，等待下个周期。

- **核心方法** `shootWordDanmaku(wordObj, isAssociated = false)`：
  - 生成带词义排版的弹幕节点，计算不重合的随机 Y 轴高度发射。
  - 伴生同义/形近词标注微小高亮色（如偏金色），提示强关联性。

### 3.2 弹幕词汇调度算法层 (`scheduler.js`)

**核心机制**：低频优选主词抽卡 + 发散式形近/近义词簇跟随。

**调度工作流（定时器频率：1 次/秒）：**

1. **主词候选池构建**
   - 读取本地字典，筛选出所有 `hitCount > 0` 的已遇词汇作为复习种子池。

2. **低频优先加权随机抽签**
   - 不进行死板的前 10 名纯正序轮播。
   - 采用反比例概率加权随机算法：`W = 1 / Math.pow(hitCount, 1.5)`。
   - 确保"命中极少的词"占有绝对高概率被当选，而"命中极高的高频词"依然有极小概率作为随机噪音出现。

3. **伴生词聚堆（Cluster 生成）**
   - 一旦主词被选中，立即独占接下来的 1~3 秒发射槽，专门发射关联词：
     - **形近词**：对种子池跑 `Levenshtein Distance` 算法，提取编辑距离 `<= 2` 且首字母或长度相近的候选组合（如 `adopt` / `adapt`）。
     - **近义词**：扫描词汇表 `translation` 字段，抽去标点后计算**汉字 Jaccard 相似度**：`|交集| / |并集| >= 0.4` 即判定为近义词候选。
   - 形近词与近义词候选按顺序压入最优先发射队列。

4. **防重复冷却（Cooldown / FIFO 队列）**
   - 任何被发射过的词汇压入一个定长 FIFO 冷却队列。
   - 冷却队列长度 `N = Math.min(30, Math.floor(种子池大小 * 0.6))`，防止词库较小时冷却池耗尽整个候选集导致引擎卡死。
   - 处于冷却期内的单词在主词抽签和伴生抽签阶段强制跳过，彻底解决刷屏与聚堆僵死问题。

5. **暂停联动**
   - 由 `contentScript.js` 在检测到 Bilibili 视频启动播放状态后唤醒 `startEngine()`。
   - 侦听 `<video>` 的 `play` 事件：恢复 `setInterval`。
   - 侦听 `<video>` 的 `pause` / `ended` 事件：暂停 `setInterval`，弹幕同步停止。

---

## 4. 各模块改造清单

| 文件 | 操作 | 核心变更 |
|---|---|---|
| `vocabulary.js` | 改造 | 新增 `hitCount`/`lastSeen` 字段；新增 `recordHit(word)` 接口；节流写入 |
| `popup.html` | 改造 | 新增 Tabs 切换控件与排行榜列表结构 |
| `popup.js` | 改造 | 读取并排序 `hitCount > 0` 词汇，渲染双向排行榜 |
| `styles.css` | 改造 | 新增 Tabs、Badge、排行榜项样式 |
| `scripts/danmaku.js` | 新增 | 弹幕容器注入、CSS 动画发射、生命周期销毁 |
| `scripts/scheduler.js` | 新增 | 加权调度算法、形近/近义词聚堆、冷却队列、暂停联动 |

---

## 5. 文件结构变更

```
bilibili-vocab-extension/
├── vocabulary.js          ← 改造（新增 recordHit + hitCount/lastSeen 字段）
├── popup.html             ← 改造（新增排行榜 Tabs UI）
├── popup.js               ← 改造（新增排序渲染逻辑）
├── styles.css             ← 改造（新增弹幕与排行榜样式）
└── scripts/
    ├── build-vocab-dataset.js   （不变）
    ├── danmaku.js               ← 新增
    └── scheduler.js             ← 新增
```

---

## 6. 非功能性约束

| 约束类型 | 规则 |
|---|---|
| **内存安全** | 每条弹幕 DOM 节点必须在 `transitionend` 后立即销毁，禁止积累 |
| **帧率保护** | 同屏弹幕节点数上限 `≤ 15`，超出时丢弃当前帧，等待下个调度周期 |
| **存储节流** | `chrome.storage.local` 写入节流间隔 `≥ 500ms`，防止写入频率超限 |
| **词库边界** | 冷却池大小不得超过 `种子池大小 * 0.6`，防止冷却池耗尽全部候选 |
| **暂停联动** | 视频 `pause`/`ended` 时停止 `setInterval`；`play` 时恢复 |
| **隐私安全** | `hitCount` / `lastSeen` 数据仅存 `chrome.storage.local`，不上报任何服务器 |
| **选择器健壮** | 播放器容器选择器必须提供降级回退方案，并配合 `MutationObserver` 等待 DOM 就绪 |
