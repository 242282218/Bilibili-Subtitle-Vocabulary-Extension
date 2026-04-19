import { ChangeEvent, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import './ui.css';
import {
  AdaptiveTuningState,
  ExperienceMetricsSnapshot,
  clearVocabularyBook,
  readExperienceMetricsSnapshot,
  readAdaptiveTuningState,
  readLearningStreak,
  setAdaptiveTuningEnabled,
  subscribeAdaptiveTuningState,
  subscribeExperienceMetricsSnapshot,
  subscribeLearningStreak,
  LearningStreak,
} from './storage';
import {
  BUILTIN_PROFILE_IDS,
  CEFR_LEVELS,
  SCENE_PRESETS,
  ScenePresetKey,
  cloneSettingsV3,
  createResetSettingsSnapshot,
  getPresetKeyFromSettings,
  getReviewDanmakuSpeedLabel,
  LEVELS,
  MAX_CUSTOM_PROFILES,
  parseImportedSettingsText,
  PROFILE_META,
  REVIEW_SPEEDS,
  THEME_MODES,
  SettingsV3,
  getProfileConfigById,
  listProfileOptions,
  normalizeDomainRules,
  normalizeHostname,
  resolveEffectiveRuntime,
  setExactDomainRuleEnabled,
  setActiveProfileConfig,
  upsertCustomProfile,
  removeCustomProfile,
} from './settings-bridge';
import { ShortcutGuide } from './shortcut-guide';
import { StudyPreview } from './study-preview';
import { getThemeModeLabel, useDocumentTheme } from './ui-theme';
import { useV3Settings } from './use-v3-settings';

type SectionKey = 'profiles' | 'learning' | 'siteRules' | 'overlay';
type MaintenanceAction = 'import' | 'reset' | 'clear';

const SECTION_META: Array<{ id: SectionKey; name: string }> = [
  { id: 'profiles', name: '配置档' },
  { id: 'learning', name: '学习参数' },
  { id: 'siteRules', name: '站点规则' },
  { id: 'overlay', name: '悬浮面板' },
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

interface PendingUndoAction {
  label: string;
  snapshot: SettingsV3;
  expiresAt: number;
}

const EMPTY_STREAK: LearningStreak = {
  currentStreak: 0,
  maxStreak: 0,
  lastActiveDate: '',
  totalActiveDays: 0,
  activeDays: [],
};

function asNumber(value: string, fallback: number): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
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
  return '';
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
  if (streak.currentStreak > 0) {
    return `${streak.currentStreak} 天`;
  }
  return '未开始';
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
  const [section, setSection] = useState<SectionKey>('profiles');
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

  function applyAdaptiveSnapshot(
    nextAdaptive: AdaptiveTuningState,
    nextMetrics: ExperienceMetricsSnapshot
  ) {
    setAdaptiveState(nextAdaptive);
    setExperienceMetrics(nextMetrics);
  }

  const activeProfile = useMemo(() => {
    if (!working) {
      return null;
    }
    return getProfileConfigById(working, working.activeProfileId);
  }, [working]);
  useDocumentTheme(activeProfile ? activeProfile.themeMode : 'auto');

  const profileOptions = useMemo(() => {
    if (!working) {
      return [];
    }
    return listProfileOptions(working);
  }, [working]);

  const siteRules = useMemo(() => {
    if (!working) {
      return [];
    }
    return Object.entries(working.globalControls.siteRules).sort(([left], [right]) =>
      left.localeCompare(right)
    );
  }, [working]);

  const runtimePreview = useMemo(() => {
    if (!working) {
      return null;
    }
    return resolveEffectiveRuntime(working, 'www.bilibili.com');
  }, [working]);

  const activePresetKey = useMemo<ScenePresetKey>(() => {
    if (!activeProfile) {
      return 'balanced';
    }
    return getPresetKeyFromSettings(activeProfile);
  }, [activeProfile]);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([readAdaptiveTuningState(), readExperienceMetricsSnapshot(7)])
      .then(([nextAdaptive, nextMetrics]) => {
        if (!cancelled) {
          applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setStatus('自动调优状态读取失败，请稍后重试。');
        }
      });
    const unsubscribeAdaptive = subscribeAdaptiveTuningState((next) => {
      setAdaptiveState(next);
    });
    const unsubscribeMetrics = subscribeExperienceMetricsSnapshot((next) => {
      setExperienceMetrics(next);
    }, 7);
    return () => {
      cancelled = true;
      unsubscribeAdaptive();
      unsubscribeMetrics();
    };
  }, []);

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
    const unsubscribeLearningStreak = subscribeLearningStreak((next) => {
      setLearningStreak(next);
    });
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
        setPendingUndo((current) => {
          if (!current || current.expiresAt !== pendingUndo.expiresAt) {
            return current;
          }
          return null;
        });
      },
      Math.max(0, pendingUndo.expiresAt - Date.now())
    );

    return () => {
      window.clearTimeout(timeout);
    };
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

  function patchActiveProfile(patch: Partial<NonNullable<typeof activeProfile>>) {
    mutateWorking((draft) => {
      return setActiveProfileConfig(draft, draft.activeProfileId, patch);
    });
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
    const normalized = next;
    const created = normalized.profilesCustom.find(
      (item) =>
        item.name === profileName ||
        item.id === profileName.trim().toLowerCase().replace(/\s+/g, '-')
    );
    const finalState = {
      ...normalized,
      activeProfileId: created ? created.id : normalized.activeProfileId,
    };
    setWorkingDirect(finalState);
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
    const next = removeCustomProfile(working, String(working.activeProfileId));
    setWorkingDirect(next);
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
      applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
      setStatus(
        saveResult.preservedLocalEdits
          ? `最近一次保存已完成，当前仍有未保存修改。${nextAdaptive.hint}`
          : `配置已保存并应用到扩展。${nextAdaptive.hint}`
      );
    } catch {
      setStatus(
        saveResult.preservedLocalEdits
          ? '最近一次保存已完成，当前仍有未保存修改；自动调优状态刷新失败，请稍后重试。'
          : '配置已保存，但自动调优状态刷新失败，请稍后重试。'
      );
    }
  }

  async function onToggleAdaptive(checked: boolean) {
    try {
      const [nextAdaptive, nextMetrics] = await Promise.all([
        setAdaptiveTuningEnabled(checked),
        readExperienceMetricsSnapshot(7),
      ]);
      applyAdaptiveSnapshot(nextAdaptive, nextMetrics);
      setStatus(
        checked
          ? '已启用自动调优，后续会根据反馈微调参数。'
          : '已关闭自动调优，后续仅按手动参数运行。'
      );
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
    if (saving || maintenanceBusy) {
      return;
    }
    importSettingsInputRef.current?.click();
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
          <h1 className="studio-title">配置中心加载中</h1>
          <p className="studio-subtitle">{status}</p>
        </section>
      </main>
    );
  }

  const isBuiltinActive = BUILTIN_PROFILE_IDS.includes(
    working.activeProfileId as (typeof BUILTIN_PROFILE_IDS)[number]
  );

  return (
    <main className="studio-shell">
      <section className="studio-hero stagger-enter" data-index="0">
        <span className="studio-eyebrow">Curated Study Console</span>
        <h1 className="studio-title">字幕学习配置中心</h1>
        <p className="studio-subtitle">
          统一管理 Popup / Overlay / Content Script
          的学习策略。采用手动保存主流程，避免误触导致策略漂移。
        </p>
        <div className="studio-status-row">
          <span className={`status-pill ${dirty ? 'warn' : 'good'}`}>
            <strong>{dirty ? '未保存' : '已同步'}</strong>
            {dirty ? '你有待提交修改' : '当前状态与扩展一致'}
          </span>
          <span className="status-pill">
            <strong>当前配置档</strong>
            {profileOptions.find((item) => item.id === working.activeProfileId)?.name || '均衡输入'}
          </span>
          <span className="status-pill">
            <strong>站点规则</strong>
            {siteRules.length} 条
          </span>
          <span className="status-pill">
            <strong>自动调优</strong>
            {adaptiveState
              ? adaptiveState.enabled
                ? adaptiveState.manualOverrideActive
                  ? '手动配置优先'
                  : '运行中'
                : '已关闭'
              : '读取中'}
          </span>
          <span className="status-pill">
            <strong>连续学习</strong>
            {formatLearningStreakStatus(learningStreak)}
          </span>
        </div>
      </section>

      <nav className="chip-nav stagger-enter" data-index="1" aria-label="配置分区">
        {SECTION_META.map((item) => (
          <button
            key={item.id}
            type="button"
            className="chip-button"
            aria-current={section === item.id}
            onClick={() => setSection(item.id)}
          >
            {item.name}
          </button>
        ))}
      </nav>

      <section className="save-bar stagger-enter" data-index="2">
        <p className="save-meta">
          <strong>状态：</strong>
          {status}
          {statusCode ? `（${statusCode}）` : ''}
          {feedback && feedback.suggestion ? ` · 建议：${feedback.suggestion}` : ''}
        </p>
        <div className="btn-row">
          <button type="button" className="btn ghost" onClick={onReset} disabled={!dirty || saving}>
            撤销未保存修改
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
      </section>

      {conflict && (
        <section className="save-bar">
          <p className="save-meta">
            <strong>检测到并发修改：</strong>
            其他页面已更新配置。冲突范围：{conflict.summary}
            。你可以一键应用远端版本，或保存本地版本覆盖远端（最后写入生效）。
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
          <div className="btn-row">
            <button type="button" className="btn ghost" onClick={undoHighRiskAction}>
              撤销该操作
            </button>
          </div>
        </section>
      )}

      <section className="panel-grid">
        {section === 'profiles' && (
          <>
            <article className="panel stack stagger-enter" data-index="3">
              <h2>学习配置档</h2>
              <p className="panel-subtitle">内置三档 + 自定义档位，策略切换会实时作用于三端。</p>
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
                    value={
                      profileOptions.find((item) => item.id === working.activeProfileId)?.name || ''
                    }
                    onChange={(event) => onRenameActiveCustomProfile(event.target.value)}
                  />
                  <div className="btn-row">
                    <button
                      type="button"
                      className="btn warn"
                      onClick={onDeleteCurrentCustomProfile}
                    >
                      删除当前自定义档
                    </button>
                  </div>
                </div>
              )}
            </article>
            <aside className="panel stack stagger-enter" data-index="3">
              <h3>全局行为控制</h3>
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
              {runtimePreview && (
                <div className="summary-list">
                  <div className="summary-item">
                    <strong>运行态预览</strong>
                    <span>
                      站点 `www.bilibili.com` 当前为 {runtimePreview.siteEnabled ? '启用' : '暂停'}
                      ，替换比例
                      {Math.round(runtimePreview.replaceRatio * 100)}%，单句最多{' '}
                      {runtimePreview.maxReplaceCount} 词。
                    </span>
                  </div>
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
              <ShortcutGuide />
            </aside>
            <article className="panel stack stagger-enter" data-index="4">
              <div>
                <h3>设置备份与词库维护</h3>
                <p className="panel-subtitle">
                  把真实入口常用的备份、迁移、回滚和词库清理动作收口到这里。
                </p>
              </div>
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
                  <span>会导出当前 React 选项页里的工作副本，未保存修改也会被包含。</span>
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
          </>
        )}

        {section === 'learning' && (
          <>
            <article className="panel stack stagger-enter" data-index="3">
              <h2>学习参数</h2>
              <p className="panel-subtitle">
                当前编辑目标：
                {profileOptions.find((item) => item.id === working.activeProfileId)?.name}
              </p>
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
                          {getReviewDanmakuSpeedLabel(preset.reviewDanmakuSpeed)}
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
                        reviewDanmakuSpeed: event.target.value as 'slow' | 'normal' | 'fast',
                      })
                    }
                  >
                    {REVIEW_SPEEDS.map((speed) => (
                      <option key={speed} value={speed}>
                        {speed}
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
                      patchActiveProfile({ vocabularyMode: event.target.value as 'core' | 'full' })
                    }
                  >
                    <option value="core">core</option>
                    <option value="full">full</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="examPreference">筛选偏好</label>
                  <select
                    id="examPreference"
                    value={activeProfile.examPreference}
                    onChange={(event) =>
                      patchActiveProfile({
                        examPreference: event.target.value as 'balanced' | 'exam-first',
                      })
                    }
                  >
                    <option value="balanced">balanced</option>
                    <option value="exam-first">exam-first</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="bilingualMode">双语显示模式</label>
                  <select
                    id="bilingualMode"
                    value={activeProfile.bilingualMode}
                    onChange={(event) =>
                      patchActiveProfile({
                        bilingualMode: event.target.value as
                          | 'default'
                          | 'bilingual'
                          | 'english-only',
                      })
                    }
                  >
                    <option value="default">默认模式（词汇 + 括号释义）</option>
                    <option value="bilingual">双语模式（整句对照）</option>
                    <option value="english-only">纯英文模式（不显示括号）</option>
                  </select>
                </div>
                <div className="field">
                  <label htmlFor="themeMode">主题模式</label>
                  <select
                    id="themeMode"
                    value={activeProfile.themeMode}
                    onChange={(event) =>
                      patchActiveProfile({
                        themeMode: event.target.value as 'auto' | 'light' | 'dark',
                      })
                    }
                  >
                    {THEME_MODES.map((mode) => (
                      <option key={mode} value={mode}>
                        {getThemeModeLabel(mode)}
                      </option>
                    ))}
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
                subtitle="根据当前参数即时生成学习示意，方便在保存前判断节奏。"
                sentenceVariant="options"
              />
              <ToggleRow
                title="启用自动调优"
                description="根据最近反馈自动微调替换比例、单句上限与复习节奏。"
                checked={adaptiveState ? adaptiveState.enabled : true}
                onChange={(checked) => {
                  void onToggleAdaptive(checked);
                }}
              />
              <div className="summary-item">
                <strong>自动调优状态</strong>
                <span>{adaptiveState ? adaptiveState.hint : '正在读取自动调优状态...'}</span>
              </div>
              {adaptiveState && adaptiveState.lastAppliedMode && (
                <div className="summary-item">
                  <strong>最近自动动作</strong>
                  <span>{formatAdaptiveMode(adaptiveState.lastAppliedMode)}</span>
                </div>
              )}
              <div className="summary-item">
                <strong>
                  {profileOptions.find((item) => item.id === working.activeProfileId)?.name}
                </strong>
                <span>{formatProfileMeta(String(working.activeProfileId))}</span>
              </div>
              <div className="summary-item">
                <strong>当前参数摘要</strong>
                <span>
                  {Math.round(activeProfile.replaceRatio * 100)}% 曝光 · 单句{' '}
                  {activeProfile.maxReplaceCount} 词 · 目标 {activeProfile.targetCefr}
                </span>
              </div>
              <div className="summary-item">
                <strong>当前界面主题</strong>
                <span>{getThemeModeLabel(activeProfile.themeMode)}</span>
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
                  <strong>自动调优关闭率（近 7 天）</strong>
                  <span>
                    {formatPercent(experienceMetrics.adaptiveToggleDisableRate)}（共{' '}
                    {experienceMetrics.adaptiveToggleTotal} 次开关）
                  </span>
                </div>
              )}
            </aside>
          </>
        )}

        {section === 'siteRules' && (
          <>
            <article className="panel stack stagger-enter" data-index="3">
              <h2>站点规则</h2>
              <p className="panel-subtitle">按域名控制页面模式启停，支持子域名独立管理。</p>
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
                    <span>未命中的站点默认保持启用。</span>
                  </div>
                )}
                {siteRules.map(([hostname, rule]) => (
                  <div className="site-rule-item" key={hostname}>
                    <span>{hostname}</span>
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
              <h3>规则行为说明</h3>
              <div className="summary-item">
                <strong>命中优先</strong>
                <span>域名命中后按规则执行，未命中站点默认启用页面模式。</span>
              </div>
              <div className="summary-item">
                <strong>推荐策略</strong>
                <span>在阅读密集站点启用，工具类后台站点按域名暂停，避免干扰。</span>
              </div>
            </aside>
          </>
        )}

        {section === 'overlay' && (
          <>
            <article className="panel stack stagger-enter" data-index="3">
              <h2>悬浮面板参数</h2>
              <p className="panel-subtitle">统一定义 Overlay 外观，运行时支持拖动与折叠。</p>
              <div className="grid-three">
                <div className="field">
                  <label htmlFor="overlayWidth">宽度</label>
                  <input
                    id="overlayWidth"
                    type="number"
                    min={320}
                    max={560}
                    value={working.globalControls.overlayState.width}
                    onChange={(event) => {
                      const width = asNumber(
                        event.target.value,
                        working.globalControls.overlayState.width
                      );
                      setGlobalControls({
                        overlayState: {
                          ...working.globalControls.overlayState,
                          width,
                        },
                      });
                    }}
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
                    onChange={(event) => {
                      const height = asNumber(
                        event.target.value,
                        working.globalControls.overlayState.height
                      );
                      setGlobalControls({
                        overlayState: {
                          ...working.globalControls.overlayState,
                          height,
                        },
                      });
                    }}
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
                    onChange={(event) => {
                      const offsetRight = asNumber(
                        event.target.value,
                        working.globalControls.overlayState.offsetRight
                      );
                      setGlobalControls({
                        overlayState: {
                          ...working.globalControls.overlayState,
                          offsetRight,
                        },
                      });
                    }}
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
                    onChange={(event) => {
                      const offsetBottom = asNumber(
                        event.target.value,
                        working.globalControls.overlayState.offsetBottom
                      );
                      setGlobalControls({
                        overlayState: {
                          ...working.globalControls.overlayState,
                          offsetBottom,
                        },
                      });
                    }}
                  />
                </div>
              </div>
              <div className="grid-two">
                <ToggleRow
                  title="默认折叠 Overlay"
                  description="开启后初始以紧凑模式展示。"
                  checked={working.globalControls.overlayState.collapsed}
                  onChange={(collapsed) => {
                    setGlobalControls({
                      overlayState: {
                        ...working.globalControls.overlayState,
                        collapsed,
                      },
                    });
                  }}
                />
                <ToggleRow
                  title="默认隐藏 Overlay"
                  description="仅显示呼出按钮，不自动展开面板。"
                  checked={working.globalControls.overlayState.hidden}
                  onChange={(hidden) => {
                    setGlobalControls({
                      overlayState: {
                        ...working.globalControls.overlayState,
                        hidden,
                      },
                    });
                  }}
                />
              </div>
            </article>
            <aside className="panel stack stagger-enter" data-index="3">
              <h3>布局提醒</h3>
              <div className="summary-item">
                <strong>桌面端</strong>
                <span>推荐宽度 400-460，高度 560-700，既能容纳学习信息又不遮挡字幕。</span>
              </div>
              <div className="summary-item">
                <strong>移动端</strong>
                <span>移动端会自动改为贴边紧凑布局，避免影响手势区域。</span>
              </div>
            </aside>
          </>
        )}
      </section>
    </main>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root for options app');
}
createRoot(rootElement).render(<OptionsApp />);
