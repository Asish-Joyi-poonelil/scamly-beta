(function () {
  const URL_SHORTENERS = [
    'bit.ly', 'tinyurl.com', 'goo.gl', 'rb.gy', 't.ly', 'cutt.ly', 'ow.ly', 'rebrand.ly', 'shorturl.at', 'tiny.one'
  ];

  const HIGH_RISK_TLDS = ['.zip', '.mov', '.quest', '.top', '.click', '.gq', '.work', '.cam', '.info'];

  const BRAND_HOSTS = {
    'paypal': ['paypal.com'],
    'microsoft': ['microsoft.com', 'microsoftonline.com', 'office.com', 'live.com', 'outlook.com'],
    'google': ['google.com', 'accounts.google.com', 'docs.google.com', 'mail.google.com'],
    'apple': ['apple.com', 'icloud.com'],
    'amazon': ['amazon.com', 'amazon.ca'],
    'canada revenue agency': ['canada.ca'],
    'cra': ['canada.ca'],
    'royal bank': ['rbc.com'],
    'rbc': ['rbc.com'],
    'td': ['td.com'],
    'scotiabank': ['scotiabank.com'],
    'cibc': ['cibc.com'],
    'bmo': ['bmo.com']
  };

  const RULES = [
    {
      id: 'urgent_pressure',
      label: 'Urgency or pressure',
      weight: 18,
      category: 'social-engineering',
      pattern: /\b(urgent|immediately|act now|within 24 hours|final notice|last warning|suspend(?:ed|ing)?|account will be closed|respond today|asap|avoid suspension|right away)\b/i,
      reason: 'Scammers often create pressure so people react before thinking.'
    },
    {
      id: 'credential_request',
      label: 'Login or credential request',
      weight: 28,
      category: 'credential-phishing',
      pattern: /\b(verify (?:your )?account|confirm (?:your )?(?:password|login)|reset (?:your )?password|sign in now|login now|security check|validate your mailbox|reauthenticate|keep your mailbox active)\b/i,
      reason: 'Requests to verify or reset accounts are common phishing tactics.'
    },
    {
      id: 'payment_request',
      label: 'Payment or invoice request',
      weight: 20,
      category: 'invoice-fraud',
      pattern: /\b(invoice attached|overdue payment|payment due|wire transfer|bank transfer|remit|outstanding balance|payment confirmation|settle now|accounts payable|invoice number)\b/i,
      reason: 'Unexpected payment language can signal invoice fraud or business email compromise.'
    },
    {
      id: 'gift_card',
      label: 'Gift card request',
      weight: 30,
      category: 'gift-card-scam',
      pattern: /\b(gift cards?|apple gift cards?|itunes cards?|steam cards?|amazon cards?|google play cards?)\b/i,
      reason: 'Gift cards are a classic scam payment method because they are hard to reverse.'
    },
    {
      id: 'job_scam',
      label: 'Job scam signal',
      weight: 24,
      category: 'job-scam',
      pattern: /\b(work from home|telegram interview|whatsapp interview|pay after training|no experience needed|kindly send your resume|deposit (?:a )?check|equipment purchase|training fee|remote personal assistant)\b/i,
      reason: 'Too-easy job offers and off-platform interviews are frequent scam patterns.'
    },
    {
      id: 'otp_request',
      label: 'Code or OTP request',
      weight: 26,
      category: 'account-takeover',
      pattern: /\b(one[- ]time pass(?:word|code)|otp|verification code|2fa code|security code|authentication code)\b/i,
      reason: 'Legitimate organizations rarely ask you to send security codes by email.'
    },
    {
      id: 'crypto_investment',
      label: 'Crypto or guaranteed return',
      weight: 26,
      category: 'investment-scam',
      pattern: /\b(bitcoin|btc|crypto|usdt|guaranteed return|double your money|investment opportunity|trading signal|forex mentor|wallet phrase|seed phrase)\b/i,
      reason: 'Guaranteed returns and crypto pitches are common fraud signals.'
    },
    {
      id: 'authority_impersonation',
      label: 'Authority impersonation',
      weight: 16,
      category: 'impersonation',
      pattern: /\b(canada revenue agency|cra|bank security team|payroll department|human resources|ceo|director|executive request|microsoft security|apple support|tax department|immigration office)\b/i,
      reason: 'Impersonation of trusted brands or leaders is a common tactic.'
    },
    {
      id: 'secrecy_request',
      label: 'Secrecy request',
      weight: 20,
      category: 'social-engineering',
      pattern: /\b(keep this confidential|do not tell anyone|between you and me|discreetly|confidential task|private request)\b/i,
      reason: 'Requests for secrecy are especially common in impersonation scams.'
    },
    {
      id: 'reward_prize',
      label: 'Prize or unexpected reward',
      weight: 18,
      category: 'lottery-scam',
      pattern: /\b(prize|winner|lottery|claim your reward|selected for a reward|gift offer|free voucher)\b/i,
      reason: 'Unexpected prizes are often used to lure users into clicking links or sharing data.'
    },
    {
      id: 'refund_or_tax',
      label: 'Refund or tax lure',
      weight: 16,
      category: 'tax-refund-scam',
      pattern: /\b(tax refund|refund pending|rebate|government refund|cra refund|irs refund|refund available)\b/i,
      reason: 'Refund lures are frequently used to steal personal or banking details.'
    },
    {
      id: 'delivery_or_toll',
      label: 'Delivery or toll scam signal',
      weight: 16,
      category: 'delivery-scam',
      pattern: /\b(package held|delivery failed|customs fee|toll notice|parking violation|outstanding toll|missed delivery|tracking update)\b/i,
      reason: 'Fake delivery and toll notices are common click-through scams.'
    },
    {
      id: 'remote_access',
      label: 'Remote access or tech support lure',
      weight: 22,
      category: 'tech-support-scam',
      pattern: /\b(anydesk|teamviewer|remote desktop|your computer is infected|call support now|virus detected)\b/i,
      reason: 'Scammers often push remote-access tools or fake support warnings.'
    },
    {
      id: 'attachment_or_shared_file_text',
      label: 'Attachment or shared file lure',
      weight: 10,
      category: 'malware-risk',
      pattern: /\b(zip|html|htm|iso|img|one drive shared file|shared document|open the attachment|enable content|view secure document)\b/i,
      reason: 'Scam and malware emails often use attachments or shared document lures.'
    }
  ];

  function normalizeWhitespace(input) {
    return (input || '').replace(/\s+/g, ' ').trim();
  }

  function sanitizeText(input) {
    return normalizeWhitespace(String(input || '').replace(/[\u200B-\u200D\uFEFF]/g, ''));
  }

  function collectUrlsFromText(text) {
    const matches = sanitizeText(text).match(/https?:\/\/[^\s)\]>"']+/gi) || [];
    return [...new Set(matches)];
  }

  function extractHostname(rawUrl) {
    try {
      return new URL(rawUrl).hostname.toLowerCase();
    } catch {
      return '';
    }
  }

  function parseSenderAddress(senderText) {
    const match = String(senderText || '').match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
    return match ? match[0].toLowerCase() : '';
  }

  function scoreSeverity(score) {
    if (score >= 70) return 'critical';
    if (score >= 40) return 'high';
    if (score >= 20) return 'moderate';
    return 'low';
  }

  function clamp(num, min, max) {
    return Math.min(max, Math.max(min, num));
  }

  function providerLabel(hostname) {
    if (/mail\.google\.com$/i.test(hostname)) return 'Gmail';
    if (/outlook\.(live|office)\.com$/i.test(hostname)) return 'Outlook';
    if (/mail\.yahoo\.com$/i.test(hostname)) return 'Yahoo Mail';
    return 'mail client';
  }

  function looksLikeBrandText(text) {
    const lower = sanitizeText(text).toLowerCase();
    return Object.keys(BRAND_HOSTS).find((brand) => lower.includes(brand)) || '';
  }

  function domainMatchesBrand(hostname, brand) {
    const allowed = BRAND_HOSTS[brand] || [];
    return allowed.some((domain) => hostname === domain || hostname.endsWith(`.${domain}`));
  }

  function analyzeLinks(links) {
    const signals = [];
    let score = 0;

    for (const link of links || []) {
      const href = link.href || '';
      const text = sanitizeText(link.text || '');
      const hostname = extractHostname(href);
      if (!hostname) continue;

      if (URL_SHORTENERS.includes(hostname)) {
        score += 20;
        signals.push({
          id: 'shortener',
          label: 'Shortened link',
          reason: `The link uses ${hostname}, which hides the real destination.`
        });
      }

      if (/^\d+\.\d+\.\d+\.\d+$/.test(hostname)) {
        score += 22;
        signals.push({
          id: 'raw_ip',
          label: 'Raw IP address link',
          reason: 'Links that use an IP address instead of a normal domain can be risky.'
        });
      }

      if (hostname.includes('xn--')) {
        score += 22;
        signals.push({
          id: 'punycode',
          label: 'Lookalike domain encoding',
          reason: 'The domain appears to use punycode, which can hide lookalike characters.'
        });
      }

      if (HIGH_RISK_TLDS.some((tld) => hostname.endsWith(tld))) {
        score += 12;
        signals.push({
          id: 'risky_tld',
          label: 'Unusual domain ending',
          reason: `The link ends with a higher-risk domain suffix (${hostname.split('.').pop()}).`
        });
      }

      if (text && /^https?:\/\//i.test(text)) {
        const textHost = extractHostname(text);
        if (textHost && textHost !== hostname) {
          score += 26;
          signals.push({
            id: 'mismatch',
            label: 'Displayed link mismatch',
            reason: `The visible link says ${textHost}, but the click target goes to ${hostname}.`
          });
        }
      }

      const brand = looksLikeBrandText(text);
      if (brand && !domainMatchesBrand(hostname, brand)) {
        score += 24;
        signals.push({
          id: 'brand_domain_mismatch',
          label: 'Brand-name link mismatch',
          reason: `The link text suggests ${brand}, but the destination domain is ${hostname}.`
        });
      }
    }

    return { score, signals };
  }

  function buildAdvice(result) {
    const advice = [];
    if (result.score >= 20) {
      advice.push('Do not click links or open attachments until you verify the sender another way.');
    }
    if (result.flags.some((f) => f.category === 'credential-phishing' || f.category === 'account-takeover')) {
      advice.push('Never send passwords, one-time codes, or sign-in details by email.');
    }
    if (result.flags.some((f) => f.category === 'invoice-fraud' || f.category === 'gift-card-scam')) {
      advice.push('Verify payment requests using a known phone number or a fresh website tab, not the email itself.');
    }
    if (result.flags.some((f) => f.category === 'job-scam')) {
      advice.push('Do not pay fees, buy equipment, or move interviews to WhatsApp or Telegram for a job offer.');
    }
    if (!advice.length) {
      advice.push('Still use care: scams can look normal, especially if they come from compromised accounts.');
    }
    return advice;
  }

  function dominantCategories(flags) {
    const totals = new Map();
    for (const flag of flags) {
      totals.set(flag.category, (totals.get(flag.category) || 0) + (flag.weight || 0));
    }
    return [...totals.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([category]) => category);
  }

  function analyzeEmail(input) {
    const subject = sanitizeText(input?.subject || '');
    const body = sanitizeText(input?.body || '');
    const sender = sanitizeText(input?.sender || '');
    const hostname = sanitizeText(input?.hostname || '');
    const sourceText = `${subject}\n${sender}\n${body}`.trim();
    const linkList = Array.isArray(input?.links) ? input.links : [];
    const inferredLinks = collectUrlsFromText(sourceText).map((href) => ({ href, text: href }));
    const links = [...linkList, ...inferredLinks].slice(0, 40);

    const flags = [];
    let total = 0;

    for (const rule of RULES) {
      if (rule.pattern.test(sourceText)) {
        total += rule.weight;
        flags.push({
          id: rule.id,
          label: rule.label,
          weight: rule.weight,
          category: rule.category,
          reason: rule.reason
        });
      }
    }

    const senderAddress = parseSenderAddress(sender);
    if (sender) {
      if (/\b(no[- ]reply|noreply|supportteam|adminteam|securemessage|mailnotice)\b/i.test(sender)) {
        total += 6;
        flags.push({
          id: 'generic_sender',
          label: 'Generic sender identity',
          weight: 6,
          category: 'sender-risk',
          reason: 'Generic sender naming can make impersonation easier.'
        });
      }
      if (/gmail\.com|outlook\.com|hotmail\.com|yahoo\.com/i.test(senderAddress) && /\b(ceo|finance|payroll|billing|security team|hr|human resources|director)\b/i.test(sourceText)) {
        total += 12;
        flags.push({
          id: 'consumer_mail_impersonation',
          label: 'Authority message from consumer mailbox',
          weight: 12,
          category: 'impersonation',
          reason: 'Authority-style messages from free email services deserve extra caution.'
        });
      }
    }

    const linkAnalysis = analyzeLinks(links);
    total += linkAnalysis.score;
    for (const signal of linkAnalysis.signals) {
      flags.push({
        id: signal.id,
        label: signal.label,
        weight: 0,
        category: 'link-risk',
        reason: signal.reason
      });
    }

    if (subject && subject === subject.toUpperCase() && subject.length > 8) {
      total += 4;
      flags.push({
        id: 'all_caps_subject',
        label: 'All-caps subject line',
        weight: 4,
        category: 'pressure',
        reason: 'Aggressive formatting can be a pressure tactic.'
      });
    }

    total = clamp(total, 0, 100);
    const severity = scoreSeverity(total);
    const categories = dominantCategories(flags);
    const summary = severity === 'critical'
      ? 'Very strong scam signals found.'
      : severity === 'high'
        ? 'Multiple scam signals found.'
        : severity === 'moderate'
          ? 'Some risk signals found. Verify carefully.'
          : 'No strong scam signals found in the visible email content.';

    return {
      score: total,
      severity,
      summary,
      subject,
      sender,
      provider: providerLabel(hostname),
      categories,
      flags,
      advice: buildAdvice({ score: total, flags }),
      scannedAt: new Date().toISOString()
    };
  }

  self.ScamlyCore = {
    RULES,
    analyzeEmail,
    sanitizeText,
    normalizeWhitespace,
    providerLabel,
    scoreSeverity,
    extractHostname,
    collectUrlsFromText,
    parseSenderAddress
  };
})();
