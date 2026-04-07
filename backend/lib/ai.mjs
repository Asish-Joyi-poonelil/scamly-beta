function extractJsonObject(text) {
  const raw = String(text || '').trim();
  if (!raw) throw new Error('The model returned an empty response.');
  try {
    return JSON.parse(raw);
  } catch {}
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    const candidate = raw.slice(firstBrace, lastBrace + 1);
    return JSON.parse(candidate);
  }
  throw new Error('Could not parse model output as JSON.');
}

function clampScore(value) {
  const score = Number.isFinite(value) ? Math.round(value) : 0;
  return Math.max(0, Math.min(100, score));
}

function normalizeAiPayload(raw = {}) {
  const safeScore = clampScore(raw.score);
  return {
    verdict: String(raw.verdict || 'review needed').trim().toLowerCase(),
    score: safeScore,
    severity: String(raw.severity || '').trim().toLowerCase() || (safeScore >= 70 ? 'critical' : safeScore >= 40 ? 'high' : safeScore >= 20 ? 'moderate' : 'low'),
    confidence: String(raw.confidence || 'medium').trim().toLowerCase(),
    scam_type: String(raw.scam_type || 'general risk').trim().toLowerCase(),
    summary: String(raw.summary || '').trim(),
    explanation: String(raw.explanation || '').trim(),
    reasons: Array.isArray(raw.reasons) ? raw.reasons.map((x) => String(x).trim()).filter(Boolean).slice(0, 6) : [],
    advice: Array.isArray(raw.advice) ? raw.advice.map((x) => String(x).trim()).filter(Boolean).slice(0, 5) : []
  };
}

function buildPrompt(email, localResult) {
  return [
    'You are Scamly, an AI email scam analyst.',
    'Analyze the visible email content only. Do not assume hidden headers or attachments you cannot see.',
    'Return exactly one JSON object with these keys and no markdown:',
    '{',
    '  "verdict": "likely scam" | "possibly scam" | "likely safe",',
    '  "score": integer 0-100,',
    '  "severity": "low" | "moderate" | "high" | "critical",',
    '  "confidence": "low" | "medium" | "high",',
    '  "scam_type": short lowercase string,',
    '  "summary": short sentence,',
    '  "explanation": 2-4 sentences,',
    '  "reasons": array of 2-6 short strings,',
    '  "advice": array of 2-5 short strings',
    '}',
    'Heuristic result from local rules:',
    JSON.stringify(localResult),
    'Visible email payload:',
    JSON.stringify(email),
    'Important guidance:',
    '- Use high or critical when the message asks for passwords, OTPs, payments, gift cards, urgent account login, crypto returns, or suspicious links.',
    '- Use moderate when there are real concerns but the visible evidence is mixed.',
    '- Use likely safe only when the visible content looks routine and low-risk.',
    '- Keep all reasons concrete and based on the provided content.'
  ].join('\n');
}

export async function runAiAnalysis({ email, localResult }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing on the backend.');
  }
  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      reasoning: { effort: 'low' },
      input: buildPrompt(email, localResult)
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }
  const output = data.output_text || '';
  const parsed = extractJsonObject(output);
  return {
    model,
    request_id: data.id,
    ai: normalizeAiPayload(parsed)
  };
}
