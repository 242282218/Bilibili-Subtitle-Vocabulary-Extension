export interface SiteToggleUiState {
  buttonLabel: string;
  buttonDisabled: boolean;
  hint: string;
}

interface SiteToggleUiStateInput {
  hostname: string;
  profileEnabled: boolean;
  siteRuleEnabled: boolean;
}

export function getSiteToggleUiState({
  hostname,
  profileEnabled,
  siteRuleEnabled,
}: SiteToggleUiStateInput): SiteToggleUiState {
  if (!hostname) {
    return {
      buttonLabel: '当前页面无法识别域名',
      buttonDisabled: true,
      hint: '当前页面无法识别域名，无法调整站点级控制。',
    };
  }

  if (!profileEnabled) {
    return {
      buttonLabel: '总开关关闭中',
      buttonDisabled: true,
      hint: `字幕替换总开关当前关闭；站点规则保持${siteRuleEnabled ? '启用' : '暂停'}，恢复总开关后按此规则生效。`,
    };
  }

  return {
    buttonLabel: siteRuleEnabled ? '暂停当前站点' : '恢复当前站点',
    buttonDisabled: false,
    hint: siteRuleEnabled ? '当前站点规则处于启用状态。' : '当前站点规则处于暂停状态。',
  };
}
