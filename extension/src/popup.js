const DEFAULTS = { enabled: true, aiEnabled: false };

async function getCurrentTab() {
  const tabs = await chrome.tabs.query({ active: true, currentWindow: true });
  return tabs[0] || null;
}

function formatScan(scan) {
  if (!scan) {
    return {
      title: 'No scan yet',
      summary: 'Open a supported email thread to see a score.',
      source: ''
    };
  }
  return {
    title: `${scan.score}/100 · ${scan.severity}`,
    summary: scan.summary,
    source: scan.source === 'hybrid'
      ? `Hybrid result · local ${scan.localScore ?? '-'} · AI ${scan.aiScore ?? '-'}`
      : 'Local result only'
  };
}

async function load() {
  const enabledToggle = document.getElementById('enabledToggle');
  const aiToggle = document.getElementById('aiToggle');
  const scoreText = document.getElementById('scoreText');
  const summaryText = document.getElementById('summaryText');
  const sourceText = document.getElementById('sourceText');
  const rescanBtn = document.getElementById('rescanBtn');
  const optionsBtn = document.getElementById('optionsBtn');

  const syncSettings = await chrome.storage.sync.get(DEFAULTS);
  const localSettings = await chrome.storage.local.get('lastScan');
  enabledToggle.checked = Boolean(syncSettings.enabled);
  aiToggle.checked = Boolean(syncSettings.aiEnabled);

  const formatted = formatScan(localSettings.lastScan);
  scoreText.textContent = formatted.title;
  summaryText.textContent = formatted.summary;
  sourceText.textContent = formatted.source;

  enabledToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ enabled: enabledToggle.checked });
  });

  aiToggle.addEventListener('change', async () => {
    await chrome.storage.sync.set({ aiEnabled: aiToggle.checked });
  });

  rescanBtn.addEventListener('click', async () => {
    const tab = await getCurrentTab();
    if (!tab?.id) return;
    await chrome.tabs.sendMessage(tab.id, { type: 'SCAMLY_RESCAN' }).catch(() => null);
    window.close();
  });

  optionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
}

load();
