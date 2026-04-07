const DEFAULTS = {
  enabled: true,
  showPanel: true,
  aiEnabled: false,
  autoDeepScan: true,
  aiConsent: false,
  backendUrl: '',
  feedbackUrl: 'mailto:asishjpoonelil@gmail.com?subject=Scamly%20Beta%20Feedback',
  feedbackPageUrl: '',
  publicSiteUrl: ''
};

function getQueryFlag(name) {
  const params = new URLSearchParams(location.search);
  return params.get(name);
}

function sanitizeBaseUrl(rawUrl) {
  const value = String(rawUrl || '').trim();
  if (!value) return '';
  try {
    return new URL(value).origin;
  } catch {
    return '';
  }
}

async function requestBackendPermission(baseUrl) {
  const safeBaseUrl = sanitizeBaseUrl(baseUrl);
  if (!safeBaseUrl) return { ok: false, error: 'Add a valid backend URL first.' };
  const originPattern = `${safeBaseUrl}/*`;
  const alreadyHas = await chrome.permissions.contains({ origins: [originPattern] });
  if (alreadyHas) return { ok: true, originPattern };
  const granted = await chrome.permissions.request({ origins: [originPattern] });
  return granted
    ? { ok: true, originPattern }
    : { ok: false, originPattern, error: 'Chrome did not grant access to that backend origin.' };
}

async function load() {
  const enabledToggle = document.getElementById('enabledToggle');
  const panelToggle = document.getElementById('panelToggle');
  const aiToggle = document.getElementById('aiToggle');
  const autoDeepScanToggle = document.getElementById('autoDeepScanToggle');
  const aiConsentToggle = document.getElementById('aiConsentToggle');
  const backendUrl = document.getElementById('backendUrl');
  const publicSiteUrl = document.getElementById('publicSiteUrl');
  const feedbackPageUrl = document.getElementById('feedbackPageUrl');
  const feedbackUrl = document.getElementById('feedbackUrl');
  const saveBtn = document.getElementById('saveBtn');
  const saveStatus = document.getElementById('saveStatus');
  const testBackendBtn = document.getElementById('testBackendBtn');
  const backendStatus = document.getElementById('backendStatus');
  const welcomeCard = document.getElementById('welcomeCard');

  const settings = await chrome.storage.sync.get(DEFAULTS);
  enabledToggle.checked = Boolean(settings.enabled);
  panelToggle.checked = Boolean(settings.showPanel);
  aiToggle.checked = Boolean(settings.aiEnabled);
  autoDeepScanToggle.checked = Boolean(settings.autoDeepScan);
  aiConsentToggle.checked = Boolean(settings.aiConsent);
  backendUrl.value = settings.backendUrl || '';
  publicSiteUrl.value = settings.publicSiteUrl || '';
  feedbackPageUrl.value = settings.feedbackPageUrl || '';
  feedbackUrl.value = settings.feedbackUrl || '';

  if (getQueryFlag('welcome')) {
    welcomeCard.hidden = false;
  }

  testBackendBtn.addEventListener('click', async () => {
    backendStatus.textContent = 'Testing…';
    const safeBaseUrl = sanitizeBaseUrl(backendUrl.value);
    if (!safeBaseUrl) {
      backendStatus.textContent = 'Add a valid backend URL first.';
      return;
    }
    const perm = await requestBackendPermission(safeBaseUrl);
    if (!perm.ok) {
      backendStatus.textContent = perm.error || 'Permission not granted.';
      return;
    }
    const response = await chrome.runtime.sendMessage({ type: 'SCAMLY_PING_BACKEND', baseUrl: safeBaseUrl });
    backendStatus.textContent = response?.ok
      ? `Connected · ${response.data?.status || 'ok'}`
      : `Backend test failed · ${response?.error || 'unknown error'}`;
  });

  saveBtn.addEventListener('click', async () => {
    const safeBackendUrl = sanitizeBaseUrl(backendUrl.value);
    const safePublicSiteUrl = sanitizeBaseUrl(publicSiteUrl.value);
    const safeFeedbackPageUrl = sanitizeBaseUrl(feedbackPageUrl.value)
      ? new URL(feedbackPageUrl.value).toString()
      : (safePublicSiteUrl ? `${safePublicSiteUrl}/feedback.html` : '');

    if (aiToggle.checked) {
      if (!safeBackendUrl) {
        saveStatus.textContent = 'Deep AI Check needs a valid backend URL.';
        return;
      }
      const perm = await requestBackendPermission(safeBackendUrl);
      if (!perm.ok) {
        saveStatus.textContent = perm.error || 'Could not grant backend permission.';
        return;
      }
      if (!aiConsentToggle.checked) {
        saveStatus.textContent = 'Turn on the consent checkbox before enabling Deep AI Check.';
        return;
      }
    }

    const payload = {
      enabled: enabledToggle.checked,
      showPanel: panelToggle.checked,
      aiEnabled: aiToggle.checked,
      autoDeepScan: autoDeepScanToggle.checked,
      aiConsent: aiConsentToggle.checked,
      backendUrl: safeBackendUrl,
      publicSiteUrl: safePublicSiteUrl,
      feedbackPageUrl: safeFeedbackPageUrl,
      feedbackUrl: feedbackUrl.value.trim() || safeFeedbackPageUrl || DEFAULTS.feedbackUrl
    };

    await chrome.storage.sync.set(payload);
    saveStatus.textContent = 'Saved.';
    setTimeout(() => {
      saveStatus.textContent = '';
    }, 1800);
  });
}

load();
