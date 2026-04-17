const SHORTCUTS = [
  {
    id: 'toggle-enabled',
    label: '切换字幕替换',
    keys: 'Ctrl+Shift+E',
    description: '快速开关字幕替换，不必打开 Popup。',
  },
  {
    id: 'toggle-overlay',
    label: '切换悬浮面板',
    keys: 'Ctrl+Shift+O',
    description: '随时呼出或收起 Overlay 学习面板。',
  },
  {
    id: 'increase-ratio',
    label: '提高替换比例',
    keys: 'Ctrl+Shift+↑',
    description: '在当前视频页直接提升单句词汇曝光强度。',
  },
  {
    id: 'decrease-ratio',
    label: '降低替换比例',
    keys: 'Ctrl+Shift+↓',
    description: '在阅读压力过高时即时降低曝光强度。',
  },
] as const;

export function ShortcutGuide({
  title = '快捷操作',
  compact = false,
}: {
  title?: string;
  compact?: boolean;
}) {
  return (
    <section className="shortcut-guide stack">
      <div className="inline">
        <h3>{title}</h3>
        <span className="badge">命令已内置</span>
      </div>
      <div className={`shortcut-guide__list${compact ? ' shortcut-guide__list--compact' : ''}`}>
        {SHORTCUTS.map((item) => (
          <div className="shortcut-guide__item" key={item.id}>
            <div className="shortcut-guide__content">
              <strong>{item.label}</strong>
              <span>{item.description}</span>
            </div>
            <kbd>{item.keys}</kbd>
          </div>
        ))}
      </div>
      <p className="shortcut-guide__note">
        macOS 使用 Command 替代 Ctrl。快捷键可在 chrome://extensions/shortcuts 自定义。
      </p>
    </section>
  );
}

export { SHORTCUTS };
