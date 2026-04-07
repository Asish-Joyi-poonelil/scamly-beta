import fs from 'node:fs/promises';
import path from 'node:path';

export async function storeFeedback(payload) {
  const enriched = {
    provider: payload.provider || 'unknown',
    subject: payload.subject || '',
    score: Number.isFinite(payload.score) ? payload.score : null,
    severity: payload.severity || '',
    verdict: payload.verdict || '',
    feedback_type: payload.feedback_type || 'general',
    message: payload.message || '',
    email: payload.email || '',
    created_at: new Date().toISOString(),
    user_agent: payload.user_agent || '',
    page_url: payload.page_url || ''
  };

  if (process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) {
    const table = process.env.SUPABASE_FEEDBACK_TABLE || 'feedback_submissions';
    const url = `${process.env.SUPABASE_URL.replace(/\/$/, '')}/rest/v1/${table}`;
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        'apikey': process.env.SUPABASE_SERVICE_ROLE_KEY,
        'Authorization': `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal'
      },
      body: JSON.stringify(enriched)
    });
    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Supabase insert failed: ${text || response.status}`);
    }
    return { storage: 'supabase', table };
  }

  const dir = path.resolve('data');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'feedback.jsonl');
  await fs.appendFile(file, `${JSON.stringify(enriched)}\n`, 'utf8');
  return { storage: 'local-file', file };
}
