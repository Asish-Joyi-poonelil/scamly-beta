import { scoreSeverity } from './heuristics.mjs';

export function normalizeAiPayload(raw = {}) {
  const safeScore = Number.isFinite(raw.score) ? Math.max(0, Math.min(100, Math.round(raw.score))) : 0;
  const severity = typeof raw.severity === 'string' ? raw.severity : scoreSeverity(safeScore);
  return {
    verdict: String(raw.verdict || 'review needed').trim().toLowerCase(),
    score: safeScore,
    severity,
    confidence: String(raw.confidence || 'medium').trim().toLowerCase(),
    scam_type: String(raw.scam_type || 'general risk').trim().toLowerCase(),
    summary: String(raw.summary || '').trim(),
    explanation: String(raw.explanation || '').trim(),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
    advice: Array.isArray(raw.advice) ? raw.advice.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : []
  };
}

function normalizeVerdict(verdict = '') {
  const value = String(verdict || '').trim().toLowerCase();
  if (!value) return 'review';
  if (/(^|\b)(scam|phish|phishing|fraud|malicious|fake)(\b|$)/.test(value)) return 'scam';
  if (/(^|\b)(suspicious|maybe|possibly|review|uncertain|caution)(\b|$)/.test(value)) return 'suspicious';
  if (/(^|\b)(safe|legit|legitimate|benign|normal|trusted)(\b|$)/.test(value)) return 'safe';
  return 'review';
}

function confidenceValue(confidence = 'medium') {
  const value = String(confidence || '').trim().toLowerCase();
  if (value === 'high') return 1;
  if (value === 'low') return 0.35;
  return 0.65;
}

function combineSummary(localResult, aiResult, severity) {
  const aiSummary = String(aiResult.summary || '').trim();
  if (aiSummary) return aiSummary;
  if (severity === 'critical') return 'Likely scam email. Avoid clicking links or sharing information.';
  if (severity === 'high') return 'Suspicious email. Verify through an official channel before taking action.';
  if (severity === 'moderate') return 'Some risk signals found. Verify the sender carefully.';
  return localResult?.summary || 'Looks normal from the visible email.';
}

export function combineResults(localResult, aiResult) {
  const localScore = Number(localResult?.score || 0);
  const aiScore = Number(aiResult?.score || 0);
  const verdict = normalizeVerdict(aiResult?.verdict);
  const confidence = confidenceValue(aiResult?.confidence);
  let combinedScore;

  if (verdict === 'scam') {
    combinedScore = Math.round(localScore * (0.35 - confidence * 0.12) + aiScore * (0.65 + confidence * 0.12));
    const floor = confidence >= 0.95 ? 78 : confidence >= 0.6 ? 68 : 58;
    combinedScore = Math.max(combinedScore, floor, Math.round(aiScore * (0.88 + confidence * 0.08)));
  } else if (verdict === 'suspicious') {
    combinedScore = Math.round(localScore * 0.42 + aiScore * 0.58);
    const floor = confidence >= 0.95 ? 55 : 45;
    combinedScore = Math.max(combinedScore, floor);
  } else if (verdict === 'safe') {
    combinedScore = Math.round(localScore * 0.72 + aiScore * 0.28);
    if (confidence >= 0.95 && localScore < 45) {
      combinedScore = Math.min(combinedScore, Math.max(aiScore, Math.round(localScore * 0.55)));
    }
    if (localScore >= 70) {
      combinedScore = Math.max(combinedScore, 48);
    }
  } else {
    combinedScore = Math.round(localScore * 0.6 + aiScore * 0.4);
  }

  combinedScore = Math.max(0, Math.min(100, combinedScore));
  const severity = scoreSeverity(combinedScore);
  const reasons = [
    ...(aiResult.reasons || []),
    ...((localResult.flags || []).slice(0, 3).map((f) => f.reason || `${f.label}: ${f.reason}`))
  ].filter(Boolean).slice(0, 6);
  const advice = [...new Set([...(aiResult.advice || []), ...((localResult.advice || []).slice(0, 3))])].slice(0, 5);

  return {
    score: combinedScore,
    severity,
    summary: combineSummary(localResult, aiResult, severity),
    reasons,
    advice
  };
}
