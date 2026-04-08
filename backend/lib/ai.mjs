function collectOutputText(data = {}) {
  if (typeof data.output_text === 'string' && data.output_text.trim()) {
    return data.output_text.trim();
  }

  const chunks = [];
  const outputItems = Array.isArray(data.output) ? data.output : [];
  for (const item of outputItems) {
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === 'output_text' && typeof part.text === 'string' && part.text.trim()) {
        chunks.push(part.text.trim());
      }
    }
  }
  return chunks.join('\n').trim();
}

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
  const numeric = Number(value);
  const score = Number.isFinite(numeric) ? Math.round(numeric) : 0;
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

function buildMessages(email, localResult) {
  return [
    {
      role: 'system',
      content: [
        {
          type: 'input_text',
          text: [
            'You are Scamly, an AI email scam analyst.',
            'Analyze only the visible email content supplied by the user.',
            'Return JSON only. Do not add markdown, backticks, headings, or extra prose.',
            'Keep the reasoning concrete and based on the supplied text.'
          ].join(' ')
        }
      ]
    },
    {
      role: 'user',
      content: [
        {
          type: 'input_text',
          text: [
            'Classify this visible email for scam risk.',
            'Use high or critical when the message asks for passwords, OTPs, payments, gift cards, urgent account login, crypto returns, remote access, or suspicious links.',
            'Use moderate when there are real concerns but the visible evidence is mixed.',
            'Use likely safe only when the visible content looks routine and low-risk.',
            'Heuristic result from local rules:',
            JSON.stringify(localResult),
            'Visible email payload:',
            JSON.stringify(email)
          ].join('\n')
        }
      ]
    }
  ];
}

const RESPONSE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdict: { type: 'string' },
    score: { type: 'integer' },
    severity: { type: 'string' },
    confidence: { type: 'string' },
    scam_type: { type: 'string' },
    summary: { type: 'string' },
    explanation: { type: 'string' },
    reasons: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 6
    },
    advice: {
      type: 'array',
      items: { type: 'string' },
      minItems: 1,
      maxItems: 5
    }
  },
  required: ['verdict', 'score', 'severity', 'confidence', 'scam_type', 'summary', 'explanation', 'reasons', 'advice']
};

export async function runAiAnalysis({ email, localResult }) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error('OPENAI_API_KEY is missing on the backend.');
  }

  const model = process.env.OPENAI_MODEL || 'gpt-5.4-mini';
  const response = await fetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: 'low' },
      input: buildMessages(email, localResult),
      text: {
        format: {
          type: 'json_schema',
          name: 'scamly_analysis',
          strict: true,
          schema: RESPONSE_SCHEMA
        }
      }
    })
  });

  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data?.error?.message || `OpenAI request failed with status ${response.status}.`;
    throw new Error(message);
  }

  const outputText = collectOutputText(data);
  const parsed = extractJsonObject(outputText);
  return {
    model,
    request_id: data.id,
    ai: normalizeAiPayload(parsed)
  };
}
