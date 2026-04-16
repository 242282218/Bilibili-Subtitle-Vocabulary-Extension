export const MESSAGE_TYPES = {
  SETTINGS_COMMIT: 'BILI_VOCAB_SETTINGS_COMMIT',
  ADAPTIVE_SET_ENABLED: 'BILI_VOCAB_ADAPTIVE_SET_ENABLED',
} as const;

function getRuntimeError(): Error | null {
  if (typeof chrome === 'undefined' || !chrome.runtime || !chrome.runtime.lastError) {
    return null;
  }
  const message = String(chrome.runtime.lastError.message || '').trim();
  return new Error(message || 'chrome.runtime.sendMessage failed');
}

export function sendRuntimeMessage<T>(type: string, payload: Record<string, unknown>): Promise<T> {
  if (
    typeof chrome === 'undefined' ||
    !chrome.runtime ||
    typeof chrome.runtime.sendMessage !== 'function'
  ) {
    return Promise.reject(new Error('chrome.runtime.sendMessage unavailable'));
  }

  return new Promise<T>((resolve, reject) => {
    chrome.runtime.sendMessage({ type, payload }, (response) => {
      const runtimeError = getRuntimeError();
      if (runtimeError) {
        reject(runtimeError);
        return;
      }

      if (!response || response.ok !== true) {
        reject(
          new Error(String(response && response.error ? response.error : 'runtime bridge failed'))
        );
        return;
      }

      resolve(response.payload as T);
    });
  });
}
