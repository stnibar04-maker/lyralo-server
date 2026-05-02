// Thin wrapper around Suno's third-party API (e.g. sunoapi.org / acedata).
// Most providers expose: POST /generate (returns job id) + GET /query?ids=...

const BASE = process.env.SUNO_API_BASE || 'https://api.sunoapi.org';
const KEY  = process.env.SUNO_API_KEY;
const MODEL = process.env.SUNO_MODEL || 'V4';

function headers() {
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${KEY}`
  };
}

// Submit a single song generation. Returns { jobId, raw }.
export async function submitGeneration({ title, lyrics, style, mood, instrumental = false }) {
  if (!KEY) throw new Error('SUNO_API_KEY missing');

  const body = {
    customMode: true,
    instrumental,
    prompt: lyrics,
    title,
    style: [style, mood].filter(Boolean).join(', '),
    model: MODEL,
    callBackUrl: process.env.SUNO_CALLBACK_URL || `${process.env.PUBLIC_BASE_URL || ''}/webhooks/suno`
  };

  const r = await fetch(`${BASE}/api/v1/generate`, {
    method: 'POST',
    headers: headers(),
    body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Suno submit failed: ${r.status} ${JSON.stringify(data)}`);

  // Most providers return { code: 200, data: { taskId } }
  const jobId = data?.data?.taskId || data?.data?.task_id || data?.id || data?.task_id;
  if (!jobId) throw new Error(`Suno: missing taskId in response: ${JSON.stringify(data)}`);

  return { jobId, raw: data };
}

// Poll a job. Returns { status, clips: [{ id, audioUrl, coverUrl, duration, ... }] }.
export async function getStatus(jobId) {
  if (!KEY) throw new Error('SUNO_API_KEY missing');

  const r = await fetch(`${BASE}/api/v1/generate/record-info?taskId=${encodeURIComponent(jobId)}`, {
    headers: headers()
  });
  const data = await r.json();
  if (!r.ok) throw new Error(`Suno status failed: ${r.status} ${JSON.stringify(data)}`);

  // Normalize response shape
  const items = data?.data?.response?.sunoData || data?.data?.response?.data || data?.data?.songs || [];
  const status = data?.data?.status || data?.status || (items.length ? 'SUCCESS' : 'PENDING');

  const clips = items
    .filter(c => c?.audioUrl || c?.audio_url || c?.streamAudioUrl)
    .map(c => ({
      id: c.id || c.clip_id,
      audioUrl: c.audioUrl || c.audio_url || c.streamAudioUrl,
      coverUrl: c.imageUrl || c.image_url || c.coverUrl,
      duration: Math.round(c.duration || c.durationSec || 0),
      title: c.title,
      tags: c.tags
    }));

  return { status, clips, raw: data };
}

// Bundle helper: how many takes for this bundle?
export function takesForBundle(bundle) {
  return bundle === 'complete' ? 2 : 1;
}

// Style variants used when generating the 2nd take of a Complete Gift order.
// The 2nd take should feel different but keep the same lyrics + emotion.
export function variantStyle(genre, takeIndex) {
  if (takeIndex === 0) return genre;
  // Pair each genre with a complementary alt
  const pairs = {
    pop:        'acoustic, intimate',
    acoustic:   'pop, upbeat',
    folk:       'pop, contemporary',
    'piano ballad': 'orchestral cinematic',
    rock:       'acoustic unplugged',
    'r&b / soul': 'jazzy lounge',
    country:    'folk, intimate',
    'hip-hop':  'lo-fi, mellow',
    jazz:       'soul ballad',
    gospel:     'piano ballad',
    electronic: 'acoustic stripped',
    classical:  'piano cinematic'
  };
  const key = String(genre || '').toLowerCase();
  return pairs[key] || 'acoustic, intimate';
}
