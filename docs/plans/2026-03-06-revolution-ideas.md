# 《颠覆式创意报告》— Bilibili Subtitle Vocabulary Extension

- 日期：2026-03-06
- 方法：`revolution-analysis`（含 Step 0 联网情报侦察）
- 范围：仅创新推演，不含代码实现

## 0. 必需上下文

- 项目名称与核心价值：`Bilibili Vocabulary Subtitle`，把视频字幕消费改造成被动词汇学习流程（中英混排替换 + 释义提示 + 难度控制）。
- 当前技术栈摘要：Chrome MV3 扩展；`contentScript + subtitleParser + renderer + tooltip`；本地 JSON 词库；支持 Bilibili/YouTube。
- 已有功能：CEFR/频次排序、替换比例控制、tooltip 元数据展示、Bilibili API fallback、YouTube 字幕路由。
- 目标用户画像：
  - 普通学习者：边看边学，低设置成本。
  - 极客学习者：偏好 Anki/自动化/可编排学习流。

---

## 🔍 情报摘要（Step 0 产出）

### 赛道格局关键发现

1. 赛道明显分化为两类：实时观看增强 vs. 字幕挖卡流水线；`asbplayer` 直指后者。
2. 替代工具快速涌现，`Lingarr` 强调本地与 SaaS 翻译引擎可切换，功能商品化速度高。
3. 2026-01-20 仍有字幕翻译工具在 Product Hunt 上线，说明入口多、同质竞争高。
4. 本项目当前差异化不再只是“字幕替换”，而是“可控难度学习引擎”（CEFR + 频次 + 双站点）。

### 可移植的跨界机制

1. Discord Quests 的“完全 opt-in 任务激励”。
2. visionOS 的“眼+手主交互 + 多层空间信息呈现”。
3. （推断）Fintech 的“即时收益反馈”机制。

### 近期可用的技术假设

1. Realtime API 已进入 GA 更新节奏，可用于低延迟语音/实时交互。
2. 空间计算交互规范成熟，可迁移为字幕分层注意力设计。
3. AI companion 从聊天走向场景化关系交互（产品侧已落地）。

### 极客用户未被满足的隐性需求

1. 字幕到卡片流程仍“点击过多”，追求更低摩擦。
2. 希望具备可脚本化、可导出的自动化学习管线。
3. 期待按视频类型/频道动态切换策略，而不是全局固定参数。

### 高效游戏化机制参考

1. opt-in 任务流（非强迫）。
2. 奖励设计从“积分”转为“即时可用能力解锁”。
3. 社交证明通过“同类轨迹对照”，而非排行榜内卷。

### 最大的惊喜发现

- 教育场景最可迁移的机制并非传统学习产品，而是 Discord 的任务激励模型。

---

## 1. 项目本质（Step 1）

**本项目的本质是：把视频消费界面改造成实时词汇行为系统。**

- 是否被情报修正：是。
- 修正前：字幕替换工具。
- 修正后：学习行为操作层（任务、反馈、沉淀、再利用）。

---

## 2. 四维推演（Step 2）

### 维度一：跨界脑洞碰撞（Cross-pollination）

1. `Quest 字幕跑图`
   - 借鉴：Discord Quests 的 opt-in 任务机制（Step 0 跨界机制）。
   - 机制：观看前选“本集掌握 3 个 B2 动词”，字幕层实时反馈任务进度。

2. `Layered Caption HUD`
   - 借鉴：visionOS 分层信息空间（Step 0 跨界机制）。
   - 机制：字幕分基础层/挑战层/解释层，按交互焦点动态显隐。

3. `Word Yield Engine`
   - 借鉴：（推断）Fintech 即时收益反馈（Step 0 跨界机制）。
   - 机制：每次词汇命中立即显示“收益回显”（复现次数、语境覆盖度、遗忘风险）。

4. `Dual-Engine Translation Switch`
   - 借鉴：Lingarr 双引擎路由（Step 0 赛道发现）。
   - 机制：一键切本地/云翻译策略，按隐私、速度、质量自动分流。

### 维度二：痛点逆向工程（Pain-point Reverse-Engineering）

1. 淘汰假设
   - 若明天被替代，不会是“另一个替换插件”，而是“实时语音学习代理”。

2. 替代形态描述
   - 用户只表达意图（如“今天 B1 口语风格”），系统实时调整替换密度与解释颗粒度。

3. 极客对照矩阵

| 维度 | 普通用户（98%） | 硬核极客用户（1%） |
|---|---|---|
| 核心需求 | 看视频顺手学词 | 构建可复用词汇资产管线 |
| 最大痛点 | 打断观看体验 | 导出/清洗/同步链路太重 |
| 愿意付费功能 | 自动难度匹配 | 一键导出 + 脚本 API + 跨工具同步 |

4. Pro 极客彩蛋设计
   - `Zero-Click Mining Bus`：字幕命中即自动进入 Anki/Notion/Obsidian（Webhook 可配）。
   - `Policy DSL`：按频道/UP 主定义策略脚本（例：科技类优先 C1 名词）。

### 维度三：游戏化与心流设计（Gamification & Engagement）

1. `Contract Quest`
   - Octalysis 驱动力：使命感、稀缺、损失规避。
   - 触发：开播前自选任务。
   - 即时反馈：字幕边缘进度环 + 剩余挑战提示。
   - 自传播：可分享“本集任务完成卡”。

2. `Prediction Duel`
   - Octalysis 驱动力：成就、创造、不可预测性。
   - 触发：词义揭示前 2 秒快速竞猜。
   - 即时反馈：立即判定并按表现微调难度。
   - 自传播：生成可转发的猜词片段。

3. `Shadow Cohort`
   - Octalysis 驱动力：社交影响、拥有感。
   - 触发：进入同级用户学习轨迹对照。
   - 即时反馈：显示“你与同类用户进度差”。
   - 自传播：邀请同级好友组队挑战。

### 维度四：未来场景推演（Future Scenario）

【概念原型卡片】  
名称：WhisperLoop Agent  
技术假设：Realtime API（Step 0 第三批）  
交互方式：耳机低延迟语音提示 + 字幕词汇即时解释  
颠覆点：从“读字幕”转为“与学习代理共学”  
与当前技术栈的距离：近期

【概念原型卡片】  
名称：Ambient Caption Space  
技术假设：visionOS 交互范式（Step 0 第三批）  
交互方式：字幕、释义、复习卡按空间层级显示  
颠覆点：从平面叠层 UI 进化为环境式学习界面  
与当前技术栈的距离：中期

【概念原型卡片】  
名称：NeuroAdaptive Difficulty  
技术假设：BCI 消费化早期进展（Step 0 第三批，低置信推断）  
交互方式：根据认知负荷信号动态调节替换密度  
颠覆点：从“用户手调难度”变为“系统感知自适应”  
与当前技术栈的距离：远期

---

## 3. 自检（Step 3）

- 保守评审不适感：通过（核心改的是关系模型，不是小修小补）。
- 是否改变价值交付：通过（从工具功能转向行为系统）。
- 情报引用充分性：通过（跨 GitHub/Apple/Discord/OpenAI/社区来源）。

---

## 4. 落地建议（Step 4 / MVI）

### MVI-01：Quest 字幕跑图

- **来源维度**：跨界碰撞 + 游戏化
- **情报依据**：Discord Quests 的 opt-in 机制 + 当前字幕替换链路能力
- **核心颠覆逻辑**：把“被动替换”改为“任务驱动学习闭环”
- **当前技术栈可行性**：复用 `contentScript/subtitleParser/renderer/background/storage` 即可起步
- **预计实现复杂度**：中
- **进入编码条件**：用户明确说“帮我做这个”

### MVI-02：Zero-Click Mining Bus

- **来源维度**：痛点逆向
- **情报依据**：极客社区低点击挖卡诉求 + asbplayer 句子挖掘方向
- **核心颠覆逻辑**：把“看完再复习”改为“观看即沉淀资产”
- **当前技术栈可行性**：新增导出适配层（AnkiConnect/Webhook）+ 复用现有 token 元数据链
- **预计实现复杂度**：中-高
- **进入编码条件**：用户明确说“帮我做这个”

---

## Sources

- 项目文档：`docs/DEV_SPEC.md`
- https://github.com/killergerbah/asbplayer
- https://github.com/lingarr-translate/lingarr
- https://www.producthunt.com/products/translator
- https://developer.apple.com/visionos/pathway/
- https://support.discord.com/hc/en-us/articles/22225719947543-Discord-Quests-FAQ
- https://discord.com/blog/introducing-orbs
- https://openai.com/index/introducing-the-realtime-api/
- https://www.reddit.com/r/LearnJapanese/comments/pvcr7f/anime_subs_to_anki_with_asbplayer/
- https://techcrunch.com/2025/09/25/ai-companion-apps-are-booming-but-researchers-warn-theyre-not-safe-for-kids/
- https://character.ai/community-hub/introducing-character-ai-avatarfx-and-scenes/
