(function () {
  const ROOT_ID = 'scamly-root';
  const SCAN_INTERVAL_MS = 1200;
  let observer;
  let lastFingerprint = '';
  let lastRenderAt = 0;
  let scanTimeout;
  const aiCache = new Map();
  const aiPending = new Set();

  const DEFAULT_SETTINGS = {
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

  function getSettings() {
    return new Promise((resolve) => {
      chrome.storage.sync.get(DEFAULT_SETTINGS, (items) => resolve(items));
    });
  }

  function getProvider() {
    const host = location.hostname.toLowerCase();
    if (host === 'mail.google.com') return 'gmail';
    if (host === 'outlook.live.com' || host === 'outlook.office.com') return 'outlook';
    if (host === 'mail.yahoo.com') return 'yahoo';
    return 'unknown';
  }

  function textFrom(el) {
    return ScamlyCore.sanitizeText(el?.innerText || el?.textContent || '');
  }

  function linkObjectsFrom(root) {
    if (!root) return [];
    return [...root.querySelectorAll('a[href]')]
      .slice(0, 30)
      .map((a) => ({ href: a.href, text: textFrom(a) }));
  }

  function pickLargestTextContainer(candidates) {
    const valid = candidates
      .map((el) => ({ el, text: textFrom(el) }))
      .filter((x) => x.text.length > 40)
      .sort((a, b) => b.text.length - a.text.length);
    return valid[0]?.el || null;
  }

  function gmailExtract() {
    const subjectEl = document.querySelector('h2.hP, h2[data-thread-perm-id], [role="main"] h2');
    const senderEl = document.querySelector('span[email], h3.iw span[email], .gD');
    const bodyCandidates = [...document.querySelectorAll('.a3s.aiL, .ii.gt .a3s, div[role="listitem"] .a3s, [role="main"] .a3s')];
    const bodyEl = pickLargestTextContainer(bodyCandidates);
    return {
      subject: textFrom(subjectEl),
      sender: textFrom(senderEl),
      body: textFrom(bodyEl),
      links: linkObjectsFrom(bodyEl),
      sourceNode: bodyEl || subjectEl
    };
  }

  function outlookExtract() {
    const subjectEl = document.querySelector('[role="heading"] span, [role="heading"], h1');
    const senderEl = document.querySelector('[title*="@"], [aria-label*="From"]');
    const bodyCandidates = [
      ...document.querySelectorAll('[aria-label^="Message body"], div[role="document"], .ReadingPaneContainer [contenteditable="true"], .rps_')
    ];
    const bodyEl = pickLargestTextContainer(bodyCandidates);
    return {
      subject: textFrom(subjectEl),
      sender: textFrom(senderEl),
      body: textFrom(bodyEl),
      links: linkObjectsFrom(bodyEl),
      sourceNode: bodyEl || subjectEl
    };
  }

  function yahooExtract() {
    const subjectEl = document.querySelector('h1, [data-test-id="message-group-subject-text"]');
    const senderEl = document.querySelector('[data-test-id="message-group-sender"], [data-test-id="message-view-from"]');
    const bodyCandidates = [
      ...document.querySelectorAll('[data-test-id="message-view-body"], [data-test-id="message-body"], [role="main"] article')
    ];
    const bodyEl = pickLargestTextContainer(bodyCandidates);
    return {
      subject: textFrom(subjectEl),
      sender: textFrom(senderEl),
      body: textFrom(bodyEl),
      links: linkObjectsFrom(bodyEl),
      sourceNode: bodyEl || subjectEl
    };
  }

  function genericExtract() {
    const subjectEl = document.querySelector('h1, h2, [role="heading"]');
    const main = document.querySelector('main, [role="main"], article');
    const bodyEl = pickLargestTextContainer(main ? [main] : []);
    return {
      subject: textFrom(subjectEl),
      sender: '',
      body: textFrom(bodyEl),
      links: linkObjectsFrom(bodyEl),
      sourceNode: bodyEl || subjectEl
    };
  }

  function getCurrentEmail() {
    const provider = getProvider();
    const raw = provider === 'gmail'
      ? gmailExtract()
      : provider === 'outlook'
        ? outlookExtract()
        : provider === 'yahoo'
          ? yahooExtract()
          : genericExtract();

    return {
      hostname: location.hostname,
      provider,
      subject: raw.subject,
      sender: raw.sender,
      body: raw.body,
      links: raw.links,
      sourceNode: raw.sourceNode
    };
  }

  function fingerprintEmail(email) {
    return [email.subject, email.sender, email.body.slice(0, 700)].join('|');
  }

  function ensureRoot() {
    let root = document.getElementById(ROOT_ID);
    if (!root) {
      root = document.createElement('div');
      root.id = ROOT_ID;
      document.documentElement.appendChild(root);
    }
    return root;
  }

  function colorLabel(severity) {
    switch (severity) {
      case 'critical': return 'Critical risk';
      case 'high': return 'High risk';
      case 'moderate': return 'Moderate risk';
      default: return 'Low risk';
    }
  }

  function escapeHtml(text) {
    return String(text || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function signalItems(flags) {
    return flags.slice(0, 4).map((flag) => `<li><strong>${escapeHtml(flag.label)}:</strong> ${escapeHtml(flag.reason)}</li>`).join('');
  }

  function adviceItems(advice) {
    return advice.slice(0, 3).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  function aiReasonItems(reasons) {
    return (reasons || []).slice(0, 4).map((item) => `<li>${escapeHtml(item)}</li>`).join('');
  }

  function buildFeedbackHref(settings, email, displayedResult) {
    const fallback = settings.feedbackUrl || settings.feedbackPageUrl || 'mailto:asishjpoonelil@gmail.com?subject=Scamly%20Beta%20Feedback';
    const safeFeedbackPageUrl = String(settings.feedbackPageUrl || '').trim();
    if (safeFeedbackPageUrl) {
      try {
        const url = new URL(safeFeedbackPageUrl);
        url.searchParams.set('provider', email.provider || 'unknown');
        url.searchParams.set('subject', email.subject || '');
        url.searchParams.set('score', String(displayedResult.score || ''));
        url.searchParams.set('severity', displayedResult.severity || '');
        return url.toString();
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  function createAiStatusHtml(aiState) {
    if (!aiState) {
      return `<div class="scamly-ai-state muted">Deep AI Check is off. Turn it on in settings to analyze the visible email through your Scamly backend.</div>`;
    }
    if (aiState.status === 'loading') {
      return `<div class="scamly-ai-state">Deep AI Check is running…</div>`;
    }
    if (aiState.status === 'error') {
      return `<div class="scamly-ai-state error">Deep AI Check unavailable: ${escapeHtml(aiState.message)}</div>`;
    }
    const ai = aiState.analysis?.ai || {};
    return `
      <div class="scamly-ai-row">
        <div>
          <div class="scamly-ai-title">AI verdict: ${escapeHtml(ai.verdict || 'Review needed')}</div>
          <div class="scamly-ai-meta">${escapeHtml((ai.confidence || 'medium') + ' confidence')} · ${escapeHtml(ai.scam_type || 'general risk')}</div>
        </div>
        <div class="scamly-ai-chip">${escapeHtml(ai.score || 0)}/100</div>
      </div>
      <div class="scamly-ai-summary">${escapeHtml(ai.summary || '')}</div>
      <ul class="scamly-ai-reasons">${aiReasonItems(ai.reasons) || '<li>No extra AI reasons returned.</li>'}</ul>
    `;
  }

  function renderResult(localResult, settings, aiState, email) {
    if (!settings.showPanel) return;
    const root = ensureRoot();
    const displayedResult = aiState?.status === 'done' ? aiState.analysis.combined : localResult;
    const scoreLabel = aiState?.status === 'done' ? 'Hybrid score' : 'Local score';
    const feedbackHref = buildFeedbackHref(settings, email, displayedResult);
    root.className = `sev-${displayedResult.severity}`;
    root.innerHTML = `
      <div class="scamly-card sev-${displayedResult.severity}">
        <div class="scamly-header">
          <div class="scamly-title-wrap">
            <div class="scamly-title">Scamly</div>
            <div class="scamly-badge">beta</div>
          </div>
          <button class="scamly-close" aria-label="Hide Scamly panel">×</button>
        </div>
        <div class="scamly-body">
          <div class="scamly-score-row">
            <div>
              <div class="scamly-score">${displayedResult.score}/100</div>
              <div class="scamly-score-kicker">${escapeHtml(scoreLabel)}</div>
              <div class="scamly-summary">${escapeHtml(displayedResult.summary)}</div>
            </div>
            <div class="scamly-level">${escapeHtml(colorLabel(displayedResult.severity))}</div>
          </div>
          <div class="scamly-meter"><span style="width:${displayedResult.score}%"></span></div>
          <div class="scamly-label">Top signals</div>
          <ul class="scamly-signals">${signalItems(localResult.flags) || '<li>No strong signals from the visible email text.</li>'}</ul>
          <div class="scamly-label">Deep AI Check</div>
          <div class="scamly-ai-box">${createAiStatusHtml(aiState)}</div>
          <div class="scamly-label">What to do</div>
          <ul class="scamly-advice">${adviceItems(displayedResult.advice || localResult.advice)}</ul>
          <div class="scamly-footer">
            <button class="scamly-btn scamly-btn-rescan" type="button">Rescan</button>
            <button class="scamly-btn scamly-btn-ai" type="button">Deep AI Check</button>
            <a class="scamly-link" href="${feedbackHref}" target="_blank" rel="noopener noreferrer">Send feedback</a>
          </div>
        </div>
      </div>
    `;

    root.querySelector('.scamly-btn-rescan')?.addEventListener('click', () => scheduleScan(true));
    root.querySelector('.scamly-btn-ai')?.addEventListener('click', () => startDeepAnalyze(email, localResult, settings, true));
    root.querySelector('.scamly-close')?.addEventListener('click', () => root.remove());
  }

  async function updateLastScanStorage(localResult, email, aiState) {
    const displayedResult = aiState?.status === 'done' ? aiState.analysis.combined : localResult;
    await chrome.storage.local.set({
      lastScan: {
        score: displayedResult.score,
        severity: displayedResult.severity,
        summary: displayedResult.summary,
        source: aiState?.status === 'done' ? 'hybrid' : 'local',
        localScore: localResult.score,
        aiScore: aiState?.status === 'done' ? aiState.analysis.ai.score : null,
        email: {
          subject: email.subject,
          sender: email.sender,
          hostname: email.hostname,
          provider: email.provider
        }
      }
    });
  }

  function buildDeepPayload(email, localResult) {
    return {
      email: {
        provider: email.provider,
        hostname: email.hostname,
        subject: email.subject.slice(0, 300),
        sender: email.sender.slice(0, 300),
        body: email.body.slice(0, 5000),
        links: (email.links || []).slice(0, 20)
      },
      localResult: {
        score: localResult.score,
        severity: localResult.severity,
        summary: localResult.summary,
        flags: (localResult.flags || []).slice(0, 8),
        advice: (localResult.advice || []).slice(0, 4),
        categories: (localResult.categories || []).slice(0, 4)
      }
    };
  }

  async function startDeepAnalyze(email, localResult, settings, force = false) {
    const fingerprint = fingerprintEmail(email);
    if (!settings.aiEnabled) {
      renderResult(localResult, settings, { status: 'error', message: 'Deep AI Check is turned off in Scamly settings.' }, email);
      return;
    }
    if (!settings.aiConsent) {
      renderResult(localResult, settings, { status: 'error', message: 'Turn on AI consent in Scamly settings before using Deep AI Check.' }, email);
      return;
    }
    if (!settings.backendUrl) {
      renderResult(localResult, settings, { status: 'error', message: 'Add your Scamly backend URL in settings first.' }, email);
      return;
    }
    if (!force && aiCache.has(fingerprint)) {
      const cached = aiCache.get(fingerprint);
      renderResult(localResult, settings, { status: 'done', analysis: cached }, email);
      updateLastScanStorage(localResult, email, { status: 'done', analysis: cached });
      return;
    }
    if (aiPending.has(fingerprint)) return;

    aiPending.add(fingerprint);
    renderResult(localResult, settings, { status: 'loading' }, email);
    try {
      const response = await chrome.runtime.sendMessage({
        type: 'SCAMLY_DEEP_ANALYZE',
        payload: buildDeepPayload(email, localResult)
      });
      if (!response?.ok) {
        throw new Error(response?.error || 'The backend did not return a usable result.');
      }
      aiCache.set(fingerprint, response.data.analysis);
      const aiState = { status: 'done', analysis: response.data.analysis };
      renderResult(localResult, settings, aiState, email);
      updateLastScanStorage(localResult, email, aiState);
    } catch (error) {
      const message = error?.message || String(error);
      renderResult(localResult, settings, { status: 'error', message }, email);
      updateLastScanStorage(localResult, email, { status: 'error', message });
    } finally {
      aiPending.delete(fingerprint);
    }
  }

  async function scanNow(force = false) {
    const settings = await getSettings();
    if (!settings.enabled) {
      document.getElementById(ROOT_ID)?.remove();
      return;
    }

    const email = getCurrentEmail();
    if (!email.subject && !email.body) return;

    const fingerprint = fingerprintEmail(email);
    const justRendered = Date.now() - lastRenderAt < 500;
    if (!force && (fingerprint === lastFingerprint || justRendered)) return;

    lastFingerprint = fingerprint;
    const localResult = ScamlyCore.analyzeEmail(email);
    const cachedAi = aiCache.get(fingerprint);
    const aiState = cachedAi ? { status: 'done', analysis: cachedAi } : null;
    renderResult(localResult, settings, aiState, email);
    lastRenderAt = Date.now();
    updateLastScanStorage(localResult, email, aiState);

    if (settings.aiEnabled && settings.aiConsent && settings.backendUrl && settings.autoDeepScan) {
      startDeepAnalyze(email, localResult, settings, false);
    }
  }

  function scheduleScan(force = false) {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => scanNow(force), force ? 80 : SCAN_INTERVAL_MS);
  }

  function setupObserver() {
    if (observer) observer.disconnect();
    observer = new MutationObserver(() => scheduleScan(false));
    observer.observe(document.documentElement, {
      childList: true,
      subtree: true,
      characterData: false
    });
  }

  chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
    if (message?.type === 'SCAMLY_RESCAN') {
      scheduleScan(true);
      sendResponse({ ok: true });
      return true;
    }
    return false;
  });

  getSettings().then((settings) => {
    if (!settings.enabled) return;
    setupObserver();
    scheduleScan(true);
  });
})();
