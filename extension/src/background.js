const DEFAULT_SYNC_SETTINGS = {
  enabled: true,
  showPanel: true,
  aiEnabled: false,
  autoDeepScan: true,
  aiConsent: false,
  backendUrl: '',
  feedbackUrl: '',
  feedbackPageUrl: '',
  publicSiteUrl: ''
};

chrome.runtime.onInstalled.addListener(async (details) => {
  chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS, async (items) => {
    const merged = { ...DEFAULT_SYNC_SETTINGS, ...items };
    if (!merged.feedbackPageUrl && merged.publicSiteUrl) {
      merged.feedbackPageUrl = `${sanitizeBaseUrl(merged.publicSiteUrl)}/feedback.html`;
    }
    if (!merged.feedbackUrl) {
      merged.feedbackUrl = merged.feedbackPageUrl || 'mailto:asishjpoonelil@gmail.com?subject=Scamly%20Beta%20Feedback';
    }
    chrome.storage.sync.set(merged);
  });

  if (details.reason === 'install') {
    chrome.tabs.create({ url: chrome.runtime.getURL('options.html?welcome=1') });
  }
});

function sanitizeBaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    const url = new URL(value);
    return url.origin;
  } catch {
    return '';
  }
}

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchWithTimeout(url, options = {}, timeoutMs = 18000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        ...(options.headers || {})
      }
    });
    return response;
  } finally {
    clearTimeout(timer);
  }
}

async function ensureOriginPermission(baseUrl) {
  const safeBaseUrl = sanitizeBaseUrl(baseUrl);
  if (!safeBaseUrl) return { ok: false, error: 'Add a valid backend URL first.' };
  const originPattern = `${safeBaseUrl}/*`;
  const hasPermission = await chrome.permissions.contains({ origins: [originPattern] });
  if (hasPermission) return { ok: true, originPattern };
  return { ok: false, originPattern, error: 'Host permission for the backend has not been granted yet.' };
}

async function analyzeRemotely(payload) {
  const settings = await chrome.storage.sync.get(DEFAULT_SYNC_SETTINGS);
  if (!settings.aiEnabled) {
    throw new Error('Deep AI Check is disabled in settings.');
  }
  if (!settings.aiConsent) {
    throw new Error('You must opt in before Scamly can send visible email text to your backend.');
  }
  const safeBaseUrl = sanitizeBaseUrl(settings.backendUrl);
  if (!safeBaseUrl) {
    throw new Error('A valid Scamly backend URL is required.');
  }

  const permission = await ensureOriginPermission(safeBaseUrl);
  if (!permission.ok) {
    throw new Error(permission.error || 'Backend permission is missing.');
  }

  const res = await fetchWithTimeout(`${safeBaseUrl}/api/analyze`, {
    method: 'POST',
    body: JSON.stringify({
      app: 'scamly-beta-extension',
      version: chrome.runtime.getManifest().version,
      ...payload
    })
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data?.error || `Backend request failed with status ${res.status}.`);
  }
  return data;
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (!message?.type) return false;

  if (message.type === 'SCAMLY_CHECK_BACKEND_PERMISSION') {
    ensureOriginPermission(message.baseUrl).then(sendResponse);
    return true;
  }

  if (message.type === 'SCAMLY_DEEP_ANALYZE') {
    analyzeRemotely(message.payload)
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  if (message.type === 'SCAMLY_PING_BACKEND') {
    const baseUrl = sanitizeBaseUrl(message.baseUrl);
    if (!baseUrl) {
      sendResponse({ ok: false, error: 'Invalid backend URL.' });
      return true;
    }
    fetchWithTimeout(`${baseUrl}/api/health`, { method: 'GET' }, 12000)
      .then((res) => res.json())
      .then((data) => sendResponse({ ok: true, data }))
      .catch((error) => sendResponse({ ok: false, error: error.message || String(error) }));
    return true;
  }

  return false;
});
