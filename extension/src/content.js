(function () {
  const ROOT_ID = 'scamly-root';
  const SCAN_INTERVAL_MS = 350;
  let observer;
  let lastFingerprint = '';
  let lastRenderAt = 0;
  let scanTimeout;
  const aiCache = new Map();
  const aiPending = new Set();
  const uiState = {
    expanded: false,
    dismissedFingerprint: '',
    activeFingerprint: ''
  };
  const guardState = {
    active: false,
    fingerprint: '',
    sourceNode: null,
    email: null,
    localResult: null,
    settings: null
  };

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

  function isAiReady(settings) {
    return Boolean(settings.aiEnabled && settings.aiConsent && settings.backendUrl);
  }

  function shouldAutoDeepScan(settings) {
    return Boolean(isAiReady(settings) && settings.autoDeepScan);
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
      sourceNode: bodyEl || subjectEl,
      messageOpen: Boolean(subjectEl && bodyEl)
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
      sourceNode: bodyEl || subjectEl,
      messageOpen: Boolean(bodyEl && (textFrom(subjectEl) || textFrom(senderEl)))
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
      sourceNode: bodyEl || subjectEl,
      messageOpen: Boolean(bodyEl && (textFrom(subjectEl) || textFrom(senderEl)))
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
      sourceNode: bodyEl || subjectEl,
      messageOpen: Boolean(bodyEl && subjectEl)
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
      sourceNode: raw.sourceNode,
      messageOpen: raw.messageOpen
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

  function removeRoot() {
    document.getElementById(ROOT_ID)?.remove();
    clearGuardState();
  }

  function clearGuardState() {
    guardState.active = false;
    guardState.fingerprint = '';
    guardState.sourceNode = null;
    guardState.email = null;
    guardState.localResult = null;
    guardState.settings = null;
  }

  function colorLabel(severity) {
    switch (severity) {
      case 'critical': return 'Critical risk';
      case 'high': return 'High risk';
      case 'moderate': return 'Caution';
      case 'checking': return 'Checking';
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

  function shorten(text, max = 120) {
    const value = ScamlyCore.sanitizeText(text || '');
    if (!value) return '';
    if (value.length <= max) return value;
    return `${value.slice(0, max - 1).trimEnd()}…`;
  }

  function buildFeedbackHref(settings, email, displayedResult, aiState) {
    const fallback = settings.feedbackUrl || settings.feedbackPageUrl || 'mailto:asishjpoonelil@gmail.com?subject=Scamly%20Beta%20Feedback';
    const safeFeedbackPageUrl = String(settings.feedbackPageUrl || '').trim();
    if (safeFeedbackPageUrl) {
      try {
        const url = new URL(safeFeedbackPageUrl);
        url.searchParams.set('provider', email.provider || 'unknown');
        url.searchParams.set('subject', email.subject || '');
        url.searchParams.set('score', String(displayedResult.score || ''));
        url.searchParams.set('severity', displayedResult.severity || '');
        if (aiState?.status === 'done') {
          url.searchParams.set('verdict', aiState.analysis.ai?.verdict || '');
        }
        return url.toString();
      } catch {
        return fallback;
      }
    }
    return fallback;
  }

  function localSignalsText(flags) {
    const list = (flags || []).slice(0, 3).map((flag) => flag.reason || flag.label).filter(Boolean);
    return list.length ? list : ['No strong local scam signals in the visible email.'];
  }

  function adviceList(items) {
    const list = (items || []).slice(0, 3).filter(Boolean);
    return list.length ? list : ['Use normal caution before clicking links or sharing codes.'];
  }

  function aiStatusText(aiState, settings) {
    if (!settings.aiEnabled) return 'Local only';
    if (!settings.aiConsent) return 'AI ready after consent';
    if (!settings.backendUrl) return 'AI needs backend';
    if (!aiState) return 'AI ready';
    if (aiState.status === 'loading') return aiState.warning || 'AI checking…';
    if (aiState.status === 'error') return 'AI unavailable';
    return 'AI checked';
  }

  function detailReasonList(localResult, displayedResult, aiState) {
    if (aiState?.status === 'done') {
      const aiReasons = aiState.analysis.ai?.reasons || [];
      if (aiReasons.length) return aiReasons.slice(0, 4);
      if (displayedResult.reasons?.length) return displayedResult.reasons.slice(0, 4);
    }
    return localSignalsText(localResult.flags);
  }

  function compactSummary(displayedResult) {
    return shorten(displayedResult.summary || 'Review the email carefully before taking action.', 95);
  }

  function buildPendingDisplayedResult(localResult, aiState) {
    const localScore = Number(localResult?.score || 0);
    if (localScore >= 40) {
      return {
        ...localResult,
        summary: aiState?.warning || 'Possible risk found. Hold before clicking until AI finishes checking.'
      };
    }
    return {
      ...localResult,
      severity: 'checking',
      summary: aiState?.warning || 'Checking links and content before showing the final risk.'
    };
  }

  function buildCollapsedMarkup(displayedResult, settings, aiState) {
    const compact = displayedResult.severity === 'low';
    return `
      <div class="scamly-strip scamly-${compact ? 'compact' : 'standard'} sev-${displayedResult.severity}">
        <div class="scamly-strip-main">
          <div class="scamly-brand-wrap">
            <span class="scamly-shield">🛡</span>
            <span class="scamly-brand">Scamly</span>
            <span class="scamly-beta">beta</span>
          </div>
          <div class="scamly-score-wrap">
            <span class="scamly-score">${displayedResult.score}</span>
            <span class="scamly-score-suffix">/100</span>
            <span class="scamly-risk-pill">${escapeHtml(colorLabel(displayedResult.severity))}</span>
          </div>
          <div class="scamly-summary-text" title="${escapeHtml(displayedResult.summary || '')}">${escapeHtml(compactSummary(displayedResult))}</div>
          <div class="scamly-status ${aiState?.status === 'error' ? 'error' : ''}">${escapeHtml(aiStatusText(aiState, settings))}</div>
          <button class="scamly-icon-btn scamly-toggle" type="button" aria-label="Show why Scamly flagged this email" aria-expanded="false">ⓘ</button>
          <button class="scamly-icon-btn scamly-close" type="button" aria-label="Hide Scamly for this email">×</button>
        </div>
      </div>
    `;
  }

  function buildExpandedMarkup(localResult, displayedResult, settings, aiState, email) {
    const feedbackHref = buildFeedbackHref(settings, email, displayedResult, aiState);
    const reasons = detailReasonList(localResult, displayedResult, aiState)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const advice = adviceList(displayedResult.advice || localResult.advice)
      .map((item) => `<li>${escapeHtml(item)}</li>`)
      .join('');
    const explanation = aiState?.status === 'done'
      ? shorten(aiState.analysis.ai?.explanation || aiState.analysis.ai?.summary || displayedResult.summary, 220)
      : shorten(displayedResult.summary, 220);
    const primaryAction = aiState?.status === 'done' ? 'Run again' : 'Deep AI Check';

    return `
      <div class="scamly-strip scamly-expanded sev-${displayedResult.severity}">
        <div class="scamly-strip-main">
          <div class="scamly-brand-wrap">
            <span class="scamly-shield">🛡</span>
            <span class="scamly-brand">Scamly</span>
            <span class="scamly-beta">beta</span>
          </div>
          <div class="scamly-score-wrap">
            <span class="scamly-score">${displayedResult.score}</span>
            <span class="scamly-score-suffix">/100</span>
            <span class="scamly-risk-pill">${escapeHtml(colorLabel(displayedResult.severity))}</span>
          </div>
          <div class="scamly-summary-text" title="${escapeHtml(displayedResult.summary || '')}">${escapeHtml(compactSummary(displayedResult))}</div>
          <div class="scamly-status ${aiState?.status === 'error' ? 'error' : ''}">${escapeHtml(aiStatusText(aiState, settings))}</div>
          <button class="scamly-icon-btn scamly-toggle" type="button" aria-label="Hide details" aria-expanded="true">⌃</button>
          <button class="scamly-icon-btn scamly-close" type="button" aria-label="Hide Scamly for this email">×</button>
        </div>
        <div class="scamly-detail-panel">
          <div class="scamly-detail-col">
            <div class="scamly-detail-title">Why?</div>
            <div class="scamly-detail-copy">${escapeHtml(explanation)}</div>
            <ul class="scamly-list">${reasons}</ul>
          </div>
          <div class="scamly-detail-col">
            <div class="scamly-detail-title">What to do</div>
            <ul class="scamly-list">${advice}</ul>
            <div class="scamly-actions">
              <button class="scamly-btn scamly-btn-rescan" type="button">Rescan</button>
              <button class="scamly-btn scamly-btn-ai" type="button">${escapeHtml(primaryAction)}</button>
              <a class="scamly-link" href="${feedbackHref}" target="_blank" rel="noopener noreferrer">Send feedback</a>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  function syncGuardState(email, localResult, settings, aiState) {
    if (!email?.sourceNode || aiState?.status !== 'loading') {
      clearGuardState();
      return;
    }
    guardState.active = true;
    guardState.fingerprint = fingerprintEmail(email);
    guardState.sourceNode = email.sourceNode;
    guardState.email = email;
    guardState.localResult = localResult;
    guardState.settings = settings;
  }

  function attachHandlers(root, email, localResult, settings) {
    root.querySelector('.scamly-toggle')?.addEventListener('click', () => {
      uiState.expanded = !uiState.expanded;
      renderResult(localResult, settings, null, email, { preserveAiState: true });
    });

    root.querySelector('.scamly-close')?.addEventListener('click', () => {
      uiState.dismissedFingerprint = uiState.activeFingerprint;
      removeRoot();
    });

    root.querySelector('.scamly-btn-rescan')?.addEventListener('click', () => {
      uiState.expanded = false;
      scheduleScan(true);
    });

    root.querySelector('.scamly-btn-ai')?.addEventListener('click', () => {
      startDeepAnalyze(email, localResult, settings, true);
    });
  }

  function getLastAiStateForFingerprint(fingerprint) {
    const cached = aiCache.get(fingerprint);
    return cached ? { status: 'done', analysis: cached } : null;
  }

  function renderResult(localResult, settings, aiState, email, options = {}) {
    if (!settings.showPanel) return;
    const root = ensureRoot();
    const fingerprint = fingerprintEmail(email);
    uiState.activeFingerprint = fingerprint;
    const effectiveAiState = options.preserveAiState ? getLastAiStateForFingerprint(fingerprint) || aiState : aiState;
    let displayedResult;
    if (effectiveAiState?.status === 'done') {
      displayedResult = effectiveAiState.analysis.combined;
    } else if (effectiveAiState?.status === 'loading') {
      displayedResult = buildPendingDisplayedResult(localResult, effectiveAiState);
    } else {
      displayedResult = localResult;
    }

    root.className = `sev-${displayedResult.severity}`;
    root.innerHTML = uiState.expanded
      ? buildExpandedMarkup(localResult, displayedResult, settings, effectiveAiState, email)
      : buildCollapsedMarkup(displayedResult, settings, effectiveAiState);

    attachHandlers(root, email, localResult, settings);
    syncGuardState(email, localResult, settings, effectiveAiState);
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
      const aiState = { status: 'done', analysis: cached };
      renderResult(localResult, settings, aiState, email);
      updateLastScanStorage(localResult, email, aiState);
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
      removeRoot();
      return;
    }

    const email = getCurrentEmail();
    if (!email.messageOpen || (!email.subject && !email.body)) {
      uiState.activeFingerprint = '';
      uiState.expanded = false;
      removeRoot();
      return;
    }

    const fingerprint = fingerprintEmail(email);
    if (!fingerprint) {
      removeRoot();
      return;
    }
    if (uiState.dismissedFingerprint === fingerprint && !force) {
      removeRoot();
      return;
    }
    if (fingerprint !== uiState.activeFingerprint) {
      uiState.expanded = false;
      uiState.dismissedFingerprint = '';
    }

    const justRendered = Date.now() - lastRenderAt < 220;
    if (!force && (fingerprint === lastFingerprint || justRendered)) return;

    lastFingerprint = fingerprint;
    const localResult = ScamlyCore.analyzeEmail(email);
    const cachedAi = aiCache.get(fingerprint);
    const aiState = cachedAi ? { status: 'done', analysis: cachedAi } : null;
    const shouldStartAi = shouldAutoDeepScan(settings) && !cachedAi;

    if (shouldStartAi) {
      renderResult(localResult, settings, { status: 'loading' }, email);
    } else {
      renderResult(localResult, settings, aiState, email);
    }
    lastRenderAt = Date.now();
    updateLastScanStorage(localResult, email, aiState);

    if (shouldStartAi) {
      startDeepAnalyze(email, localResult, settings, false);
    }
  }

  function scheduleScan(force = false) {
    clearTimeout(scanTimeout);
    scanTimeout = setTimeout(() => scanNow(force), force ? 40 : SCAN_INTERVAL_MS);
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

  document.addEventListener('click', (event) => {
    const anchor = event.target?.closest?.('a[href]');
    if (!anchor || !guardState.active || !guardState.sourceNode) return;
    if (!guardState.sourceNode.contains(anchor)) return;
    if (!/^https?:/i.test(anchor.href || '')) return;

    event.preventDefault();
    event.stopPropagation();
    event.stopImmediatePropagation?.();
    uiState.expanded = false;
    renderResult(
      guardState.localResult,
      guardState.settings,
      { status: 'loading', warning: 'Link paused while Scamly finishes checking this email.' },
      guardState.email
    );
    lastRenderAt = Date.now();
  }, true);

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
