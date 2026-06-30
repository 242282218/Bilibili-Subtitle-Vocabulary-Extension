import { useEffect, useState } from 'react';
import {
  readActiveTabSitePermissionState,
  requestActiveTabSitePermission,
  removeActiveTabSitePermission,
  ActiveTabSitePermissionState,
} from '../lib/permission-service';
import { normalizeHostname } from '../lib/settings-bridge';

const EMPTY_SITE_PERMISSION: ActiveTabSitePermissionState = {
  hostname: '',
  originPattern: '',
  defaultSupported: false,
  authorized: false,
  canRequest: false,
  canRevoke: false,
  message: '正在读取当前站点授权状态...',
};

export function useSitePermission(setStatus: (status: string) => void): {
  sitePermission: ActiveTabSitePermissionState;
  hostname: string;
  permissionRequesting: boolean;
  onRequestSitePermission: () => Promise<void>;
  onRemoveSitePermission: () => Promise<void>;
  onToggleSitePermission: () => void;
} {
  const [sitePermission, setSitePermission] =
    useState<ActiveTabSitePermissionState>(EMPTY_SITE_PERMISSION);
  const [hostname, setHostname] = useState('');
  const [permissionRequesting, setPermissionRequesting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void readActiveTabSitePermissionState()
      .then((next) => {
        if (cancelled) return;
        setSitePermission(next);
        setHostname(normalizeHostname(next.hostname));
      })
      .catch(() => {
        if (!cancelled) {
          setSitePermission({
            ...EMPTY_SITE_PERMISSION,
            message: '当前站点授权状态读取失败，请稍后重试。',
          });
          setHostname('');
        }
      });

    return () => {
      cancelled = true;
    };
  }, [setStatus]);

  async function onRequestSitePermission() {
    setPermissionRequesting(true);
    try {
      const next = await requestActiveTabSitePermission();
      setSitePermission(next);
      setHostname(normalizeHostname(next.hostname));
      setStatus(next.authorized ? next.message : `${next.message} 拒绝授权不会恢复站点规则。`);
    } catch {
      setStatus('请求当前站点授权失败，请稍后重试。');
    } finally {
      setPermissionRequesting(false);
    }
  }

  async function onRemoveSitePermission() {
    setPermissionRequesting(true);
    try {
      const next = await removeActiveTabSitePermission();
      setSitePermission(next);
      setHostname(normalizeHostname(next.hostname));
      setStatus(next.message);
    } catch {
      setStatus('撤销当前站点授权失败，请稍后重试。');
    } finally {
      setPermissionRequesting(false);
    }
  }

  function onToggleSitePermission() {
    if (sitePermission.canRevoke) {
      void onRemoveSitePermission();
      return;
    }
    void onRequestSitePermission();
  }

  return {
    sitePermission,
    hostname,
    permissionRequesting,
    onRequestSitePermission,
    onRemoveSitePermission,
    onToggleSitePermission,
  };
}
