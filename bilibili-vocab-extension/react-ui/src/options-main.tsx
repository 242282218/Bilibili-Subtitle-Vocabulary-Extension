import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import {
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
  LearningStreak,
  clearVocabularyBook,
  readAdaptiveTuningState,
  readExperienceMetricsSnapshot,
  readLearningStreak,
  setAdaptiveTuningEnabled,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  subscribeLearningStreak,
} from './storage';
import {
  BUILTIN_PROFILE_IDS,
  CEFR_LEVELS,
  LEVELS,
  MAX_CUSTOM_PROFILES,
  PROFILE_META,
  REVIEW_DENSITIES,
  REVIEW_SPEEDS,
  SCENE_PRESETS,
  THEME_MODES,
  BilingualMode,
  ProfileConfig,
  ScenePresetKey,
  SettingsV3,
  ThemeMode,
  cloneSettingsV3,
  createResetSettingsSnapshot,
  getPresetKeyFromSettings,
  getReviewDanmakuDensityLabel,
  getReviewDanmakuSpeedLabel,
  listProfileOptions,
  normalizeDomainRules,
  normalizeHostname,
  parseImportedSettingsText,
  removeCustomProfile,
  resolveEffectiveRuntime,
  setActiveProfileConfig,
  setExactDomainRuleEnabled,
  upsertCustomProfile,
  getProfileConfigById,
} from './settings-bridge';
import { ShortcutGuide } from './shortcut-guide';
import { StudyPreview } from './study-preview';
import { getThemeModeLabel, useDocumentTheme } from './ui-theme';
import { useV3Settings } from './use-v3-settings';

type SectionKey = 'basic' | 'learning' | 'sites' | 'display' | 'data';
type MaintenanceAction = 'import' | 'reset' | 'clear';

const SECTION_META: Array<{ id: SectionKey; name: string; description: string }> = [
  { id: 'basic', name: '基础设置', description: '配置档、全局开关和状态摘要' },
  { id: 'learning', name: '学习策略', description: '替换强度、词库和复习节奏' },
  { id: 'sites', name: '站点管理', description: '域名规则和授权说明' },
  { id: 'display', name: '显示与交互', description: '主题、悬浮面板和快捷键' },
  { id: 'data', name: '数据与备份', description: '导入导出、恢复默认和清理' },
];

const HIGH_RISK_UNDO_WINDOW_MS = 6 * 1000;
const SCENE_PRESET_META: Record<ScenePresetKey, { title: string; summary: string }> = {
  light: {
    title: '轻量输入',
    summary: '适合首次接触内容，尽量降低理解干扰。',
  },
  balanced: {
    title: '均衡输入',
    summary: '适合日常稳定学习，在理解与曝光之间取平衡。',
  },
  intensive: {
    title: '强化曝光',
    summary: '适合复看或冲刺阶段，提高命中密度与复习节奏。',
  },
};

const EMPTY_STREAK: LearningStreak = {
  currentStreak: 0,
  maxStreak: 0,
  lastActiveDate: '',
  totalActiveDays: 0,
  activeDays: [],
};

interface PendingUndoAction {
  label: string;
  snapshot: SettingsV3;
  expiresAt: number;
}

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function isDefaultContentHost(hostname: string): boolean {
  const normalized = normalizeHostname(hostname);
  return normalized === 'www.bilibili.com' || normalized === 'www.youtube.com';
}

function formatProfileMeta(profileId: string): string {
  if (profileId in PROFILE_META) {
    return PROFILE_META[profileId as keyof typeof PROFILE_META].summary;
  }
  return '自定义配置档，可按你当前策略保存并独立调整。';
}

function formatAdaptiveMode(mode: string): string {
  const normalized = String(mode || '')
    .trim()
    .toLowerCase();
  if (normalized === 'ease-down') {
    return '最近一次自动动作：降低学习负载';
  }
  if (normalized === 'ramp-up') {
    return '最近一次自动动作：提升学习强度';
  }
  if (normalized === 'stabilize') {
    return '最近一次自动动作：节奏稳定化';
  }
  return '暂无自动动作';
}

function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value <= 0) {
    return '0%';
  }
  return `${Math.round(value * 100)}%`;
}

function getTodayDateString() {
  return new Date().toISOString().slice(0, 10);
}

function formatLearningStreakStatus(streak: LearningStreak): string {
  return streak.currentStreak > 0 ? `${streak.currentStreak} 天` : '未开始';
}

function formatLearningStreakLastActive(streak: LearningStreak): string {
  if (!streak.lastActiveDate) {
    return '完成任一学习动作后会开始记录';
  }
  if (streak.lastActiveDate === getTodayDateString()) {
    return '今天已记录学习活动';
  }
  return `上次活跃 ${streak.lastActiveDate}`;
}

function downloadTextFile(content: string, filename: string, mimeType: string) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.setAttribute('download', filename);
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function ToggleRow({
  title,
  description,
  checked,
  onChange,
}: {
  title: string;
  description: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="switch-row">
      <span>
        <strong>{title}</strong>
        <span className="desc">{description}</span>
      </span>
      <input
        aria-label={title}
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
    </label>
  );
}

function OptionsApp() {
  const {
    working,
    saving,
    dirty,
    conflict,
    status,
    statusCode,
    feedback,
    setStatus,
    setWorkingDirect,
    mutateWorking,
    save,
    reset,
    resolveConflictUseRemote,
    resolveConflictUseLocal,
  } = useV3Settings();
  const [section, setSection] = useState<SectionKey>('basic');
  const [newSite, setNewSite] = useState('');
  const [newProfileName, setNewProfileName] = useState('');
  const [adaptiveState, setAdaptiveState] = useState<AdaptiveTuningState | null>(null);
  const [experienceMetrics, setExperienceMetrics] = useState<ExperienceMetricsSnapshot | null>(
    null
  );
  const [learningStreak, setLearningStreak] = useState<LearningStreak>(EMPTY_STREAK);
  const [pendingUndo, setPendingUndo] = useState<PendingUndoAction | null>(null);
  const [maintenanceBusy, setMaintenanceBusy] = useState<MaintenanceAction | null>(null);
  const importSettingsInputRef = useRef<HTMLInputElement | null>(null);

  const activeProfile = useMemo(() => {
    if (!working) {
      return null;
    }
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);
  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

  const profileOptions = useMemo(() => (working ? listProfileOptions(working) : []), [working]);
  const activeProfileName =
    profileOptions.find((item) => working && item.id === working.activeProfileId)?.name ||
    '均衡输入';
  const siteRules = useMemo(() => {
    if (!working) {
      return [];
    }
    return Object.entries(working.globalControls.siteRules).sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [working]);
  const runtimePreview = useMemo(
    () => (working ? resolveEffectiveRuntime(working, 'www.bilibili.com') : null),
    [working]
  );
  const activePresetKey = useMemo<ScenePresetKey>(
    () => (activeProfile ? getPresetKeyFromSettings(activeProfile) : 'balanced'),
    [activeProfile]
  );

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)])
      .then(([nextAdaptive, nextMetrics]) => {
        if (!cancelled) {
          setAdaptiveState(nextAdaptive);
          setExperienceMetrics(nextMetrics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('自动调优状态读取失败，请稍后重试。');
        }
      });
    const unsubscribeAdaptive = subscribeAdaptiveTuningState(setAdaptiveState);
    const unsubscribeMetrics = subscribeExperienceMetricsSnapshot(setExperienceMetrics, 7);
    return () => {
      cancelled = true;
      unsubscribeAdaptive();
      unsubscribeMetrics();
    };
  }, [setStatus]);

  useEffect(() => {
    let cancelled = false;
    void readLearningStreak()
      .then((next) => {
        if (!cancelled) {
          setLearningStreak(next);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('连续学习进度读取失败，请稍后重试。');
        }
      });
    const unsubscribeLearningStreak = subscribeLearningStreak(setLearningStreak);
    return () => {
      cancelled = true;
      unsubscribeLearningStreak();
    };
  }, [setStatus]);

  useEffect(() => {
    if (!pendingUndo) {
      return () => {};
    }
    const timeout = window.setTimeout(
      () => {
        setPendingUndo((current) =>
          current && current.expiresAt === pendingUndo.expiresAt ? null : current
        );
      },
      Math.max(0, pendingUndo.expiresAt - Date.now())
    );
    return () => window.clearTimeout(timeout);
  }, [pendingUndo]);

  function updateWorking(updater: (draft: SettingsV3) => SettingsV3) {
    mutateWorking(updater);
  }

  function registerHighRiskUndo(snapshot: SettingsV3, label: string) {
    setPendingUndo({
      label,
      snapshot: cloneSettingsV3(snapshot),
      expiresAt: Date.now() + HIGH_RISK_UNDO_WINDOW_MS,
    });
    setStatus(`${label}，可在 6 秒内撤销。`);
  }

  function undoHighRiskAction() {
    if (!pendingUndo) {
      return;
    }
    setWorkingDirect(cloneSettingsV3(pendingUndo.snapshot));
    setPendingUndo(null);
    setStatus('已撤销刚才的高风险操作。');
  }

  function patchActiveProfile(patch: Partial<ProfileConfig>) {
    mutateWorking((draft) => setActiveProfileConfig(draft, draft.activeProfileId, patch));
  }

  function setGlobalControls(patch: Partial<SettingsV3['globalControls']>) {
    updateWorking((draft) => {
      draft.globalControls = {
        ...draft.globalControls,
        ...patch,
      };
      return draft;
    });
  }

  function onLevelToggle(level: string, checked: boolean) {
    if (!activeProfile) {
      return;
    }
    const selected = new Set(activeProfile.activeLevels);
    if (checked) {
      selected.add(level);
    } else {
      selected.delete(level);
    }
    patchActiveProfile({ activeLevels: Array.from(selected) });
  }

  function applyScenePreset(presetKey: ScenePresetKey) {
    patchActiveProfile(SCENE_PRESETS[presetKey]);
    setStatus(`已应用${SCENE_PRESET_META[presetKey].title}预设，记得保存配置。`);
  }

  function onAddCustomProfile() {
    if (!working || !activeProfile) {
      return;
    }
    if (working.profilesCustom.length >= MAX_CUSTOM_PROFILES) {
      setStatus(`最多创建 ${MAX_CUSTOM_PROFILES} 个自定义配置档。`);
      return;
    }
    const fallbackName = `自定义 ${working.profilesCustom.length + 1}`;
    const profileName = newProfileName.trim() || fallbackName;
    const next = upsertCustomProfile(working, {
      name: profileName,
      config: activeProfile,
    });
    const created = next.profilesCustom.find(
      (item) =>
        item.name === profileName ||
        item.id === profileName.trim().toLowerCase().replace(/\s+/g, '-')
    );
    setWorkingDirect({
      ...next,
      activeProfileId: created ? created.id : next.activeProfileId,
    });
    setNewProfileName('');
    setStatus(`已创建配置档：${created ? created.name : profileName}`);
  }

  function onDeleteCurrentCustomProfile() {
    if (
      !working ||
      BUILTIN_PROFILE_IDS.includes(working.activeProfileId as (typeof BUILTIN_PROFILE_IDS)[number])
    ) {
      return;
    }
    const before = cloneSettingsV3(working);
    setWorkingDirect(removeCustomProfile(working, String(working.activeProfileId)));
    registerHighRiskUndo(before, '已删除当前自定义配置档');
  }

  function onRenameActiveCustomProfile(value: string) {
    if (!working) {
      return;
    }
    const profileId = String(working.activeProfileId);
    if (BUILTIN_PROFILE_IDS.includes(profileId as (typeof BUILTIN_PROFILE_IDS)[number])) {
      return;
    }
    updateWorking((draft) => {
      draft.profilesCustom = draft.profilesCustom.map((item) =>
        item.id === profileId ? { ...item, name: value || item.name, updatedAt: Date.now() } : item
      );
      return draft;
    });
  }

  function onAddSiteRule() {
    if (!working) {
      return;
    }
    const hostname = normalizeHostname(newSite);
    if (!hostname) {
      setStatus('站点格式无效，请输入例如 example.com。');
      return;
    }
    updateWorking((draft) => {
      draft.globalControls.siteRules = setExactDomainRuleEnabled(
        draft.globalControls.siteRules,
        hostname,
        true
      );
      return draft;
    });
    setNewSite('');
    setStatus(`已添加站点规则：${hostname}`);
  }

  function onDeleteSiteRule(hostname: string) {
    if (!working) {
      return;
    }
    const before = cloneSettingsV3(working);
    const nextRules = { ...working.globalControls.siteRules };
    delete nextRules[hostname];
    setWorkingDirect({
      ...working,
      globalControls: {
        ...working.globalControls,
        siteRules: normalizeDomainRules(nextRules),
      },
    });
    registerHighRiskUndo(before, `已删除站点规则：${hostname}`);
  }

  async function onSave() {
    const saveResult = await save('配置已保存并应用到扩展。');
    if (!saveResult) {
      return;
    }
    setPendingUndo(null);
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        readAdaptiveTuningState(),
        readExperienceMetricsSnapshot(7),
      ]);
      setAdaptiveState(nextAdaptive);
      setExperienceMetrics(nextMetrics);
      setStatus(
        saveResult.preservedLocalEdits
          ? `最近一次保存已完成，当前仍有未保存修改。${nextAdaptive.hint}`
          : `配置已保存并应用到扩展。${nextAdaptive.hint}`
      );
    } catch {
      setStatus('配置已保存，但自动调优状态刷新失败，请稍后重试。');
    }
  }

  async function onToggleAdaptive(checked: boolean) {
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        setAdaptiveTuningEnabled(checked),
        readExperienceMetricsSnapshot(7),
      ]);
      setAdaptiveState(nextAdaptive);
      setExperienceMetrics(nextMetrics);
      setStatus(checked ? '已启用自动调优。' : '已关闭自动调优。');
    } catch {
      setStatus('切换自动调优失败，请稍后重试。');
    }
  }

  function onReset() {
    reset('已撤销未保存修改。');
    setPendingUndo(null);
  }

  function onExportSettings() {
    if (!working) {
      setStatus('当前配置尚未加载完成，暂时无法导出。');
      return;
    }
    try {
      downloadTextFile(
        `${JSON.stringify(cloneSettingsV3(working), null, 2)}\n`,
        `bilibili-vocab-settings-${new Date().toISOString().slice(0, 10)}.json`,
        'application/json'
      );
      setStatus('当前配置已导出。');
    } catch {
      setStatus('导出配置失败，请重试。');
    }
  }

  function onTriggerImportSettings() {
    if (!saving && !maintenanceBusy) {
      importSettingsInputRef.current?.click();
    }
  }

  async function onImportSettingsFileChange(event: ChangeEvent<HTMLInputElement>) {
    const input = event.target;
    const file = input.files && input.files[0];
    input.value = '';
    if (!file) {
      return;
    }
    setMaintenanceBusy('import');
    try {
      const importedSettings = parseImportedSettingsText(await file.text());
      setWorkingDirect(importedSettings);
      const saveResult = await save('设置导入并应用到扩展。');
      if (!saveResult) {
        setStatus('配置已导入当前编辑稿，但保存失败，请重试。');
      }
      setPendingUndo(null);
    } catch {
      setStatus('导入失败，请检查 JSON 格式或配置内容。');
    } finally {
      setMaintenanceBusy(null);
    }
  }

  async function onResetToDefaults() {
    if (saving || maintenanceBusy) {
      return;
    }
    if (!window.confirm('确定要恢复默认设置吗？所有自定义配置将会丢失。')) {
      return;
    }
    setMaintenanceBusy('reset');
    try {
      const defaults = createResetSettingsSnapshot();
      setWorkingDirect(defaults);
      const saveResult = await save('已恢复默认设置。');
      if (!saveResult) {
        setStatus('默认配置已应用到当前编辑稿，但保存失败，请重试。');
      }
      setPendingUndo(null);
    } finally {
      setMaintenanceBusy(null);
    }
  }

  async function onClearVocabularyBook() {
    if (saving || maintenanceBusy) {
      return;
    }
    if (!window.confirm('确定要清空所有已收藏的单词吗？此操作不可恢复。')) {
      return;
    }
    setMaintenanceBusy('clear');
    try {
      const clearedCount = await clearVocabularyBook();
      setStatus(
        clearedCount > 0
          ? `已清空 ${clearedCount} 个已收藏单词。`
          : '当前没有已收藏单词，无需清空。'
      );
    } catch {
      setStatus('清空已收藏生词失败，请重试。');
    } finally {
      setMaintenanceBusy(null);
    }
  }

  if (!working || !activeProfile) {
    return (
      <main className="studio-shell">
        <section className="studio-hero">
          <span className="studio-eyebrow">Bilibili Vocabulary</span>
          <h1 className="studio-title">设置中心加载中</h1>
          <p className="studio-subtitle">{status}</p>
        </section>
      </main>
    );
  }

  const isBuiltinActive = BUILTIN_PROFILE_IDS.includes(
    working.activeProfileId as (typeof BUILTIN_PROFILE_IDS)[number]
  );
  const currentSection = SECTION_META.find((item) => item.id === section) || SECTION_META[0];

  return (
    <main className="settings-shell">
      <aside className="settings-sidebar stagger-enter" data-index="0">
        <div className="settings-brand">
          <span className="studio-eyebrow">Settings</span>
          <h1>字幕学习设置</h1>
          <p>按任务分类管理扩展行为。</p>
        </div>
        <nav className="settings-nav" aria-label="设置分类">
          {SECTION_META.map((item) => (
            <button
              key={item.id}
              type="button"
              className="settings-nav__item"
              aria-current={section === item.id}
              onClick={() => setSection(item.id)}
            >
              <strong>{item.name}</strong>
              <span>{item.description}</span>
            </button>
          ))}
        </nav>
      </aside>

      <section className="settings-main">
        <section className="studio-hero settings-hero stagger-enter" data-index="1">
          <div className="inline wrap">
            <div>
              <span className="studio-eyebrow">{currentSection.name}</span>
              <h2 className="studio-title">{currentSection.description}</h2>
              <p className="studio-subtitle">
                当前配置档：{activeProfileName} · {dirty ? '有未保存修改' : '已同步'}
              </p>
            </div>
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={onReset}
                disabled={!dirty || saving}
              >
                撤销修改
              </button>
              <button
                type="button"
                className="btn primary"
                onClick={onSave}
                disabled={!dirty || saving}
              >
                {saving ? '保存中...' : '保存配置'}
              </button>
            </div>
          </div>
          <div className="studio-status-row">
            <span className={`status-pill ${dirty ? 'warn' : 'good'}`}>
              <strong>{dirty ? '未保存' : '已同步'}</strong>
              {dirty ? '待提交修改' : '当前状态已生效'}
            </span>
            <span className="status-pill">
              <strong>站点规则</strong>
              {siteRules.length} 条
            </span>
            <span className="status-pill">
              <strong>自动调优</strong>
              {adaptiveState ? (adaptiveState.enabled ? '运行中' : '已关闭') : '读取中'}
            </span>
            <span className="status-pill">
              <strong>连续学习</strong>
              {formatLearningStreakStatus(learningStreak)}
            </span>
          </div>
        </section>

        <section className="save-bar stagger-enter" data-index="2">
          <p className="save-meta">
            <strong>状态：</strong>
            {status}
            {statusCode ? `（${statusCode}）` : ''}
            {feedback && feedback.suggestion ? ` · 建议：${feedback.suggestion}` : ''}
          </p>
        </section>

        {conflict && (
          <section className="save-bar">
            <p className="save-meta">
              <strong>检测到并发修改：</strong>
              冲突范围：{conflict.summary}。
            </p>
            <div className="btn-row">
              <button
                type="button"
                className="btn ghost"
                onClick={() => resolveConflictUseRemote()}
                disabled={saving}
              >
                应用远端版本
              </button>
              <button
                type="button"
                className="btn warn"
                onClick={() => void resolveConflictUseLocal()}
                disabled={saving || !dirty}
              >
                应用本地版本
              </button>
            </div>
          </section>
        )}

        {pendingUndo && (
          <section className="save-bar">
            <p className="save-meta">
              <strong>高风险操作：</strong>
              {pendingUndo.label}。6 秒内可撤销。
            </p>
            <button type="button" className="btn ghost" onClick={undoHighRiskAction}>
              撤销该操作
            </button>
          </section>
        )}

        <section className="settings-content panel-grid">
          {section === 'basic' && (
            <>
              <article className="panel stack stagger-enter" data-index="3">
                <h2>基础设置</h2>
                <p className="panel-subtitle">
                  配置档和全局行为放在最前面，避免把 profile 单独做成技术分类。
                </p>
                <div className="profile-list">
                  {profileOptions.map((option) => (
                    <button
                      type="button"
                      key={option.id}
                      className="profile-card"
                      data-active={option.id === working.activeProfileId}
                      onClick={() => {
                        updateWorking((draft) => {
                          draft.activeProfileId = option.id;
                          return draft;
                        });
                      }}
                    >
                      <strong>{option.name}</strong>
                      <span>{formatProfileMeta(String(option.id))}</span>
                    </button>
                  ))}
                </div>
                <div className="field">
                  <label htmlFor="customProfileName">新建自定义配置档</label>
                  <div className="inline wrap">
                    <input
                      id="customProfileName"
                      type="text"
                      value={newProfileName}
                      placeholder="例如：晚间冲刺"
                      onChange={(event) => setNewProfileName(event.target.value)}
                    />
                    <button type="button" className="btn" onClick={onAddCustomProfile}>
                      从当前策略创建
                    </button>
                  </div>
                  <span className="hint">最多 {MAX_CUSTOM_PROFILES} 个自定义档。</span>
                </div>
                {!isBuiltinActive && (
                  <div className="field">
                    <label htmlFor="renameActiveProfile">重命名当前自定义档</label>
                    <input
                      id="renameActiveProfile"
                      type="text"
                      value={activeProfileName}
                      onChange={(event) => onRenameActiveCustomProfile(event.target.value)}
                    />
                    <button
                      type="button"
                      className="btn warn"
                      onClick={onDeleteCurrentCustomProfile}
                    >
                      删除当前自定义档
                    </button>
                  </div>
                )}
              </article>
              <aside className="panel stack stagger-enter" data-index="3">
                <h3>全局行为</h3>
                <ToggleRow
                  title="启用字幕替换"
                  description="总开关关闭后，站点规则会保留但不会执行替换。"
                  checked={activeProfile.enabled}
                  onChange={(checked) => patchActiveProfile({ enabled: checked })}
                />
                <ToggleRow
                  title="启用网页正文模式"
                  description="除字幕外，也对正文文本进行词汇曝光。"
                  checked={working.globalControls.webPageEnabled}
                  onChange={(checked) => setGlobalControls({ webPageEnabled: checked })}
                />
                <ToggleRow
                  title="启用复习弹幕"
                  description="学习队列词汇会按节奏回灌到播放过程。"
                  checked={working.globalControls.reviewDanmakuEnabled}
                  onChange={(checked) => setGlobalControls({ reviewDanmakuEnabled: checked })}
                />
                <ToggleRow
                  title="启用自动调优"
                  description="根据最近反馈自动微调学习负载。"
                  checked={adaptiveState ? adaptiveState.enabled : true}
                  onChange={(checked) => void onToggleAdaptive(checked)}
                />
                {runtimePreview && (
                  <div className="summary-item">
                    <strong>运行态预览</strong>
                    <span>
                      Bilibili 当前为 {runtimePreview.siteEnabled ? '启用' : '暂停'}，替换比例{' '}
                      {Math.round(runtimePreview.replaceRatio * 100)}%，单句最多{' '}
                      {runtimePreview.maxReplaceCount} 词。
                    </span>
                  </div>
                )}
                <div className="progress-metrics">
                  <div className="popup-metric">
                    <span>连续学习</span>
                    <strong>{learningStreak.currentStreak}</strong>
                  </div>
                  <div className="popup-metric">
                    <span>总学习天数</span>
                    <strong>{learningStreak.totalActiveDays}</strong>
                  </div>
                  <div className="popup-metric">
                    <span>最长连续</span>
                    <strong>{learningStreak.maxStreak}</strong>
                  </div>
                </div>
                <div className="summary-item">
                  <strong>学习进度</strong>
                  <span>{formatLearningStreakLastActive(learningStreak)}</span>
                </div>
              </aside>
            </>
          )}

          {section === 'learning' && (
            <>
              <article className="panel stack stagger-enter" data-index="3">
                <h2>学习策略</h2>
                <p className="panel-subtitle">当前编辑目标：{activeProfileName}</p>
                <div className="field">
                  <label>策略预设</label>
                  <div className="scene-preset-grid">
                    {(Object.keys(SCENE_PRESET_META) as ScenePresetKey[]).map((presetKey) => {
                      const preset = SCENE_PRESETS[presetKey];
                      const meta = SCENE_PRESET_META[presetKey];
                      return (
                        <button
                          key={presetKey}
                          type="button"
                          className="scene-preset-card"
                          data-active={activePresetKey === presetKey}
                          onClick={() => applyScenePreset(presetKey)}
                        >
                          <span className="scene-preset-card__kicker">
                            {Math.round(preset.replaceRatio * 100)}% · {preset.maxReplaceCount} 词 ·{' '}
                            {getReviewDanmakuSpeedLabel(preset.reviewDanmakuSpeed)} ·{' '}
                            {getReviewDanmakuDensityLabel(preset.reviewDanmakuDensity)}
                          </span>
                          <strong>{meta.title}</strong>
                          <span>{meta.summary}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
                <div className="grid-two">
                  <div className="field">
                    <label htmlFor="replaceRatio">
                      替换比例：{Math.round(activeProfile.replaceRatio * 100)}%
                    </label>
                    <input
                      id="replaceRatio"
                      type="range"
                      min={0.1}
                      max={0.3}
                      step={0.01}
                      value={activeProfile.replaceRatio}
                      onChange={(event) =>
                        patchActiveProfile({
                          replaceRatio: asNumber(event.target.value, activeProfile.replaceRatio),
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="maxReplaceCount">单句替换上限</label>
                    <input
                      id="maxReplaceCount"
                      type="number"
                      min={1}
                      max={5}
                      value={activeProfile.maxReplaceCount}
                      onChange={(event) =>
                        patchActiveProfile({
                          maxReplaceCount: asNumber(
                            event.target.value,
                            activeProfile.maxReplaceCount
                          ),
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="targetCefr">目标 CEFR</label>
                    <select
                      id="targetCefr"
                      value={activeProfile.targetCefr}
                      onChange={(event) => patchActiveProfile({ targetCefr: event.target.value })}
                    >
                      {CEFR_LEVELS.map((cefr) => (
                        <option key={cefr} value={cefr}>
                          {cefr}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reviewDanmakuSpeed">复习节奏</label>
                    <select
                      id="reviewDanmakuSpeed"
                      value={activeProfile.reviewDanmakuSpeed}
                      onChange={(event) =>
                        patchActiveProfile({
                          reviewDanmakuSpeed: event.target
                            .value as ProfileConfig['reviewDanmakuSpeed'],
                        })
                      }
                    >
                      {REVIEW_SPEEDS.map((speed) => (
                        <option key={speed} value={speed}>
                          {getReviewDanmakuSpeedLabel(speed)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="reviewDanmakuDensity">复习弹幕密度</label>
                    <select
                      id="reviewDanmakuDensity"
                      value={activeProfile.reviewDanmakuDensity}
                      onChange={(event) =>
                        patchActiveProfile({
                          reviewDanmakuDensity: event.target
                            .value as ProfileConfig['reviewDanmakuDensity'],
                        })
                      }
                    >
                      {REVIEW_DENSITIES.map((density) => (
                        <option key={density} value={density}>
                          {getReviewDanmakuDensityLabel(density)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="vocabularyMode">词库模式</label>
                    <select
                      id="vocabularyMode"
                      value={activeProfile.vocabularyMode}
                      onChange={(event) =>
                        patchActiveProfile({
                          vocabularyMode: event.target.value as ProfileConfig['vocabularyMode'],
                        })
                      }
                    >
                      <option value="core">核心词库</option>
                      <option value="full">完整词库</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="examPreference">筛选偏好</label>
                    <select
                      id="examPreference"
                      value={activeProfile.examPreference}
                      onChange={(event) =>
                        patchActiveProfile({
                          examPreference: event.target.value as ProfileConfig['examPreference'],
                        })
                      }
                    >
                      <option value="balanced">均衡筛选</option>
                      <option value="exam-first">考试优先</option>
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="bilingualMode">双语显示模式</label>
                    <select
                      id="bilingualMode"
                      value={activeProfile.bilingualMode}
                      onChange={(event) =>
                        patchActiveProfile({ bilingualMode: event.target.value as BilingualMode })
                      }
                    >
                      <option value="default">默认模式（词汇 + 括号释义）</option>
                      <option value="bilingual">双语模式（整句对照）</option>
                      <option value="english-only">纯英文模式（不显示括号）</option>
                    </select>
                  </div>
                </div>
                <div className="field">
                  <label>词库范围</label>
                  <div className="checkbox-grid">
                    {LEVELS.map((level) => (
                      <label key={level} className="checkbox-chip">
                        <input
                          type="checkbox"
                          checked={activeProfile.activeLevels.includes(level)}
                          onChange={(event) => onLevelToggle(level, event.target.checked)}
                        />
                        {level}
                      </label>
                    ))}
                  </div>
                </div>
              </article>
              <aside className="panel stack stagger-enter" data-index="3">
                <StudyPreview
                  profile={activeProfile}
                  title="实时策略预览"
                  subtitle="保存前先判断当前学习节奏。"
                  sentenceVariant="options"
                />
                <div className="summary-item">
                  <strong>自动调优状态</strong>
                  <span>{adaptiveState ? adaptiveState.hint : '正在读取自动调优状态...'}</span>
                </div>
                <div className="summary-item">
                  <strong>最近自动动作</strong>
                  <span>
                    {adaptiveState
                      ? formatAdaptiveMode(adaptiveState.lastAppliedMode)
                      : '正在读取...'}
                  </span>
                </div>
                <div className="summary-item">
                  <strong>当前参数摘要</strong>
                  <span>
                    {Math.round(activeProfile.replaceRatio * 100)}% 曝光 · 单句{' '}
                    {activeProfile.maxReplaceCount} 词 · 目标 {activeProfile.targetCefr}
                  </span>
                </div>
                <div className="summary-item">
                  <strong>近 7 天验收指标</strong>
                  <span>
                    {experienceMetrics
                      ? `误替换反馈 ${experienceMetrics.contextMisreplaceReported} 次 · 自动调优执行 ${experienceMetrics.adaptiveDecisionApplied} 次 · 手动覆盖 ${experienceMetrics.adaptiveManualOverride} 次`
                      : '正在统计近 7 天指标...'}
                  </span>
                </div>
                {experienceMetrics && experienceMetrics.adaptiveToggleTotal > 0 && (
                  <div className="summary-item">
                    <strong>自动调优关闭率</strong>
                    <span>{formatPercent(experienceMetrics.adaptiveToggleDisableRate)}</span>
                  </div>
                )}
              </aside>
            </>
          )}

          {section === 'sites' && (
            <>
              <article className="panel stack stagger-enter" data-index="3">
                <h2>站点管理</h2>
                <p className="panel-subtitle">
                  按域名保存本地启停规则；非默认站点仍需在 Popup 对当前标签页授权。
                </p>
                <div className="field">
                  <label htmlFor="newSiteRule">新增站点规则</label>
                  <div className="inline wrap">
                    <input
                      id="newSiteRule"
                      type="text"
                      value={newSite}
                      placeholder="example.com"
                      onChange={(event) => setNewSite(event.target.value)}
                    />
                    <button type="button" className="btn" onClick={onAddSiteRule}>
                      添加
                    </button>
                  </div>
                </div>
                <div className="stack">
                  {siteRules.length === 0 && (
                    <div className="summary-item">
                      <strong>暂无规则</strong>
                      <span>未命中的站点默认保持本地启用；非默认站点仍需授权。</span>
                    </div>
                  )}
                  {siteRules.map(([hostname, rule]) => (
                    <div className="site-rule-item" key={hostname}>
                      <span>{hostname}</span>
                      <span className="badge">
                        {isDefaultContentHost(hostname) ? '默认授权' : '需 Popup 授权'}
                      </span>
                      <span className={`badge ${rule.enabled ? 'good' : 'warn'}`}>
                        {rule.enabled ? '启用' : '暂停'}
                      </span>
                      <div className="btn-row">
                        <button
                          type="button"
                          className="btn ghost"
                          onClick={() => {
                            updateWorking((draft) => {
                              draft.globalControls.siteRules = setExactDomainRuleEnabled(
                                draft.globalControls.siteRules,
                                hostname,
                                rule.enabled === false
                              );
                              return draft;
                            });
                          }}
                        >
                          {rule.enabled ? '暂停' : '启用'}
                        </button>
                        <button
                          type="button"
                          className="btn ghost warn"
                          onClick={() => onDeleteSiteRule(hostname)}
                        >
                          删除
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </article>
              <aside className="panel stack stagger-enter" data-index="3">
                <h3>规则说明</h3>
                <div className="summary-item">
                  <strong>默认支持站点</strong>
                  <span>Bilibili 和 YouTube 已随扩展安装授权。</span>
                </div>
                <div className="summary-item">
                  <strong>非默认站点</strong>
                  <span>需要打开目标网页后，从 Popup 点击授权当前站点。</span>
                </div>
                <div className="summary-item">
                  <strong>站点规则</strong>
                  <span>这里保存的是启停规则；浏览器授权仍由 Popup 基于当前 tab 处理。</span>
                </div>
              </aside>
            </>
          )}

          {section === 'display' && (
            <>
              <article className="panel stack stagger-enter" data-index="3">
                <h2>显示与交互</h2>
                <p className="panel-subtitle">主题、悬浮面板和快捷键集中放在一个显示分类。</p>
                <div className="field">
                  <label htmlFor="themeMode">主题模式</label>
                  <select
                    id="themeMode"
                    value={activeProfile.themeMode}
                    onChange={(event) =>
                      patchActiveProfile({ themeMode: event.target.value as ThemeMode })
                    }
                  >
                    {THEME_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {getThemeModeLabel(mode)}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="grid-three">
                  <div className="field">
                    <label htmlFor="overlayWidth">宽度</label>
                    <input
                      id="overlayWidth"
                      type="number"
                      min={320}
                      max={560}
                      value={working.globalControls.overlayState.width}
                      onChange={(event) =>
                        setGlobalControls({
                          overlayState: {
                            ...working.globalControls.overlayState,
                            width: asNumber(
                              event.target.value,
                              working.globalControls.overlayState.width
                            ),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="overlayHeight">高度</label>
                    <input
                      id="overlayHeight"
                      type="number"
                      min={360}
                      max={760}
                      value={working.globalControls.overlayState.height}
                      onChange={(event) =>
                        setGlobalControls({
                          overlayState: {
                            ...working.globalControls.overlayState,
                            height: asNumber(
                              event.target.value,
                              working.globalControls.overlayState.height
                            ),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="overlayOffsetRight">右偏移</label>
                    <input
                      id="overlayOffsetRight"
                      type="number"
                      min={12}
                      max={360}
                      value={working.globalControls.overlayState.offsetRight}
                      onChange={(event) =>
                        setGlobalControls({
                          overlayState: {
                            ...working.globalControls.overlayState,
                            offsetRight: asNumber(
                              event.target.value,
                              working.globalControls.overlayState.offsetRight
                            ),
                          },
                        })
                      }
                    />
                  </div>
                  <div className="field">
                    <label htmlFor="overlayOffsetBottom">下偏移</label>
                    <input
                      id="overlayOffsetBottom"
                      type="number"
                      min={24}
                      max={240}
                      value={working.globalControls.overlayState.offsetBottom}
                      onChange={(event) =>
                        setGlobalControls({
                          overlayState: {
                            ...working.globalControls.overlayState,
                            offsetBottom: asNumber(
                              event.target.value,
                              working.globalControls.overlayState.offsetBottom
                            ),
                          },
                        })
                      }
                    />
                  </div>
                </div>
                <div className="grid-two">
                  <ToggleRow
                    title="默认折叠悬浮面板"
                    description="开启后初始以紧凑模式展示。"
                    checked={working.globalControls.overlayState.collapsed}
                    onChange={(collapsed) =>
                      setGlobalControls({
                        overlayState: { ...working.globalControls.overlayState, collapsed },
                      })
                    }
                  />
                  <ToggleRow
                    title="默认隐藏悬浮面板"
                    description="仅显示呼出按钮，不自动展开面板。"
                    checked={working.globalControls.overlayState.hidden}
                    onChange={(hidden) =>
                      setGlobalControls({
                        overlayState: { ...working.globalControls.overlayState, hidden },
                      })
                    }
                  />
                </div>
              </article>
              <aside className="panel stack stagger-enter" data-index="3">
                <ShortcutGuide title="快捷键" />
                <div className="summary-item">
                  <strong>布局建议</strong>
                  <span>桌面端推荐宽度 400-460，高度 560-700，避免遮挡字幕。</span>
                </div>
              </aside>
            </>
          )}

          {section === 'data' && (
            <>
              <article className="panel stack stagger-enter" data-index="3">
                <h2>数据与备份</h2>
                <p className="panel-subtitle">
                  维护性、低频和高风险操作统一放在这里，避免日常设置误触。
                </p>
                <input
                  ref={importSettingsInputRef}
                  type="file"
                  accept=".json,application/json"
                  hidden
                  onChange={onImportSettingsFileChange}
                />
                <div className="summary-list">
                  <div className="summary-item">
                    <strong>导出当前编辑稿</strong>
                    <span>会导出当前设置页里的工作副本，未保存修改也会被包含。</span>
                  </div>
                  <div className="summary-item">
                    <strong>导入或恢复默认</strong>
                    <span>导入 legacy / v3 配置后会自动迁移到 v3，并立即走真实保存链路。</span>
                  </div>
                  <div className="summary-item">
                    <strong>清空已收藏生词</strong>
                    <span>仅撤销“已收藏”状态，不删除学习队列、命中统计和复习历史。</span>
                  </div>
                </div>
                <div className="btn-row">
                  <button type="button" className="btn secondary" onClick={onExportSettings}>
                    导出当前配置
                  </button>
                  <button
                    type="button"
                    className="btn ghost"
                    onClick={onTriggerImportSettings}
                    disabled={saving || maintenanceBusy !== null}
                  >
                    {maintenanceBusy === 'import' ? '导入中...' : '导入配置'}
                  </button>
                  <button
                    type="button"
                    className="btn ghost warn"
                    onClick={onResetToDefaults}
                    disabled={saving || maintenanceBusy !== null}
                  >
                    {maintenanceBusy === 'reset' ? '恢复中...' : '恢复默认设置'}
                  </button>
                </div>
                <div className="btn-row">
                  <button
                    type="button"
                    className="btn warn"
                    onClick={onClearVocabularyBook}
                    disabled={saving || maintenanceBusy !== null}
                  >
                    {maintenanceBusy === 'clear' ? '清空中...' : '清空已收藏生词'}
                  </button>
                </div>
              </article>
              <aside className="panel stack stagger-enter" data-index="3">
                <h3>风险说明</h3>
                <div className="summary-item">
                  <strong>恢复默认</strong>
                  <span>会丢弃所有自定义配置档，需要确认后执行。</span>
                </div>
                <div className="summary-item">
                  <strong>清空生词</strong>
                  <span>该操作不可撤销，但不会删除命中历史。</span>
                </div>
              </aside>
            </>
          )}
        </section>
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for options app');
}
createRoot(rootElement).render(<OptionsApp />);
