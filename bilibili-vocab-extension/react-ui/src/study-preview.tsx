import {
  ProfileConfig,
  buildSettingsPreview,
  getLearningProfile,
  getMockPreviewData,
  getReviewDanmakuSpeedLabel,
} from './settings-bridge';

interface StudyPreviewProps {
  profile: ProfileConfig;
  title: string;
  subtitle: string;
  sentenceVariant: 'options' | 'popup';
  compact?: boolean;
}

function renderPreviewSentence(words: string[], variant: StudyPreviewProps['sentenceVariant']) {
  const [firstWord = 'establish', secondWord = 'vocabulary', thirdWord = 'context'] = words;

  if (variant === 'popup') {
    return (
      <>
        预览：我今天想 <span className="preview-word">{firstWord}</span> 提升英语{' '}
        <span className="preview-word">{secondWord}</span>
        {words[2] ? (
          <>
            {' '}
            和 <span className="preview-word">{thirdWord}</span>
          </>
        ) : null}
        。
      </>
    );
  }

  return (
    <>
      预览：这段视频会帮你 <span className="preview-word">{firstWord}</span> 稳定的{' '}
      <span className="preview-word">{secondWord}</span>
      {words[2] ? (
        <>
          {' '}
          与 <span className="preview-word">{thirdWord}</span>
        </>
      ) : null}{' '}
      输入节奏。
    </>
  );
}

export function StudyPreview({
  profile,
  title,
  subtitle,
  sentenceVariant,
  compact = false,
}: StudyPreviewProps) {
  const learningProfile = getLearningProfile(profile);
  const previewWords = getMockPreviewData(
    profile.targetCefr,
    profile.replaceRatio,
    profile.maxReplaceCount
  );
  const summary = buildSettingsPreview(profile);

  return (
    <div className={`study-preview stack${compact ? ' study-preview--compact' : ''}`}>
      <div className="inline">
        <div>
          <h3>{title}</h3>
          <p className="panel-subtitle">{subtitle}</p>
        </div>
        <span className={`badge preview-tone preview-tone--${learningProfile.tone}`}>
          {learningProfile.label}
        </span>
      </div>

      <div className="preview-metrics-grid">
        <div className="preview-metric-card">
          <span>替换比例</span>
          <strong>{Math.round(profile.replaceRatio * 100)}%</strong>
        </div>
        <div className="preview-metric-card">
          <span>单句上限</span>
          <strong>{profile.maxReplaceCount} 词</strong>
        </div>
        <div className="preview-metric-card">
          <span>复习节奏</span>
          <strong>{getReviewDanmakuSpeedLabel(profile.reviewDanmakuSpeed)}</strong>
        </div>
      </div>

      <div className="summary-item">
        <strong>策略摘要</strong>
        <span>{summary}</span>
      </div>

      <div className="preview-card">
        <div className="preview-card__head">
          <span className="preview-card__label">学习预览</span>
          <span className={`preview-card__tag preview-card__tag--${learningProfile.tone}`}>
            {learningProfile.label}
          </span>
        </div>
        <p className="preview-card__sentence">
          {renderPreviewSentence(previewWords, sentenceVariant)}
        </p>
        <p className="preview-card__caption">
          {learningProfile.summary} 当前目标难度：{profile.targetCefr}。
        </p>
      </div>
    </div>
  );
}
