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

export function combineResults(localResult, aiResult) {
  const localScore = Number(localResult?.score || 0);
  const aiScore = Number(aiResult?.score || 0);
  let combinedScore = Math.round(localScore * 0.42 + aiScore * 0.58);

  if (localScore >= 70 && aiScore >= 55) combinedScore = Math.max(combinedScore, 78);
  if (aiResult.verdict === 'likely scam' && aiResult.confidence === 'high') combinedScore = Math.max(combinedScore, aiScore, localScore);
  if (aiResult.verdict === 'possibly scam') combinedScore = Math.max(combinedScore, Math.round((localScore + aiScore) / 2));
  if (aiResult.verdict === 'likely safe' && localScore < 35) combinedScore = Math.min(combinedScore, Math.max(localScore, Math.round(aiScore * 0.9)));

  combinedScore = Math.max(0, Math.min(100, combinedScore));
  const severity = scoreSeverity(combinedScore);
  const reasons = [
    ...(aiResult.reasons || []),
    ...((localResult.flags || []).slice(0, 3).map((f) => `${f.label}: ${f.reason}`))
  ].filter(Boolean).slice(0, 6);
  const advice = [...new Set([...(aiResult.advice || []), ...((localResult.advice || []).slice(0, 3))])].slice(0, 5);

  const summary = severity === 'critical'
    ? 'Strong scam indicators from local rules and AI review.'
    : severity === 'high'
      ? 'Several scam indicators found. Verify before taking action.'
      : severity === 'moderate'
        ? 'Mixed signals found. Treat carefully and verify the sender.'
        : 'No strong scam indicators found from the current local and AI review.';

  return {
    score: combinedScore,
    severity,
    summary,
    reasons,
    advice
  };
}
