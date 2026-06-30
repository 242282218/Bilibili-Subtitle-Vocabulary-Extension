const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', 'react-ui', 'src');

const moves = [
  ['icons.tsx', 'components/icons.tsx'],
  ['onboarding.tsx', 'components/onboarding.tsx'],
  ['options-main.tsx', 'components/options-main.tsx'],
  ['options-sections.tsx', 'components/options-sections.tsx'],
  ['overlay-entry.tsx', 'components/overlay-entry.tsx'],
  ['popup-main.tsx', 'components/popup-main.tsx'],
  ['popup-sections.tsx', 'components/popup-sections.tsx'],
  ['shortcut-guide.tsx', 'components/shortcut-guide.tsx'],
  ['study-preview.tsx', 'components/study-preview.tsx'],
  ['use-adaptive-tuning.ts', 'hooks/use-adaptive-tuning.ts'],
  ['use-learning-streak.ts', 'hooks/use-learning-streak.ts'],
  ['use-onboarding.ts', 'hooks/use-onboarding.ts'],
  ['use-overlay-settings.ts', 'hooks/use-overlay-settings.ts'],
  ['use-quick-review.ts', 'hooks/use-quick-review.ts'],
  ['use-site-permission.ts', 'hooks/use-site-permission.ts'],
  ['use-subtitle-status.ts', 'hooks/use-subtitle-status.ts'],
  ['use-undo-action.ts', 'hooks/use-undo-action.ts'],
  ['use-v3-settings.ts', 'hooks/use-v3-settings.ts'],
  ['learning-dashboard.ts', 'lib/learning-dashboard.ts'],
  ['overlay-settings.ts', 'lib/overlay-settings.ts'],
  ['overlay-storage.ts', 'lib/overlay-storage.ts'],
  ['runtime-messaging.ts', 'lib/runtime-messaging.ts'],
  ['settings-bridge.ts', 'lib/settings-bridge.ts'],
  ['settings-normalizer.ts', 'lib/settings-normalizer.ts'],
  ['site-toggle-state.ts', 'lib/site-toggle-state.ts'],
  ['storage.ts', 'lib/storage.ts'],
  ['subtitle-navigation.ts', 'lib/subtitle-navigation.ts'],
  ['bsv-theme.ts', 'lib/bsv-theme.ts'],
  ['overlay.css', 'styles/overlay.css'],
  ['tokens.css', 'styles/tokens.css'],
  ['ui.css', 'styles/ui.css'],
  ['vite-env.d.ts', 'types/vite-env.d.ts'],
];

function updateImports(content, targetDir) {
  if (targetDir === 'components') {
    return content
      .replace(/from '\.\/use-/g, "from '../hooks/use-")
      .replace(/from '\.\/storage'/g, "from '../lib/storage'")
      .replace(/from '\.\/settings-bridge'/g, "from '../lib/settings-bridge'")
      .replace(/from '\.\/site-toggle-state'/g, "from '../lib/site-toggle-state'")
      .replace(/from '\.\/learning-dashboard'/g, "from '../lib/learning-dashboard'")
      .replace(/from '\.\/ui-theme'/g, "from '../lib/bsv-theme'")
      .replace(/from '\.\/overlay-settings'/g, "from '../lib/overlay-settings'")
      .replace(/from '\.\/overlay-storage'/g, "from '../lib/overlay-storage'")
      .replace(/from '\.\/subtitle-navigation'/g, "from '../lib/subtitle-navigation'")
      .replace(/import '\.\/ui\.css'/g, "import '../styles/ui.css'")
      .replace(/from '\.\/overlay\.css\?inline'/g, "from '../styles/overlay.css?inline'");
  }
  if (targetDir === 'hooks') {
    return content
      .replace(/from '\.\/storage'/g, "from '../lib/storage'")
      .replace(/from '\.\/settings-bridge'/g, "from '../lib/settings-bridge'")
      .replace(/from '\.\/overlay-settings'/g, "from '../lib/overlay-settings'")
      .replace(/from '\.\/overlay-storage'/g, "from '../lib/overlay-storage'")
      .replace(/from '\.\/learning-dashboard'/g, "from '../lib/learning-dashboard'")
      .replace(/from '\.\/onboarding'/g, "from '../components/onboarding'");
  }
  if (targetDir === 'styles') {
    return content.replace(/@import '\.\/tokens\.css'/g, "@import './tokens.css'");
  }
  return content;
}

for (const [relFrom, relTo] of moves) {
  const from = path.join(root, relFrom);
  const to = path.join(root, relTo);
  if (!fs.existsSync(from)) {
    console.log('skip missing', relFrom);
    continue;
  }
  let content = fs.readFileSync(from, 'utf8');
  const targetDir = relTo.split('/')[0];
  content = updateImports(content, targetDir);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, content, 'utf8');
  fs.unlinkSync(from);
  console.log('moved', relFrom, '->', relTo);
}
