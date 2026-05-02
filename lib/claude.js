import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-6';

const SYSTEM_PROMPT = `You are Lyralo's lead songwriter. Your job is to turn customer stories into emotional, original lyrics for a custom-made song.

Rules:
- Write a song with: a clear hook/chorus that repeats, 2 verses, a bridge, a final chorus.
- Use the recipient's NAME naturally (1-3 times max — never sounds forced).
- Anchor the song in 2-3 SPECIFIC details from the story (a memory, a place, an inside joke). Avoid generic platitudes.
- Match the requested musical style and mood.
- Keep it singable: 6-12 syllables per line, consistent rhyme scheme (ABAB or AABB).
- Total length: ~24-32 lines (2:30-3:00 song).
- Output a working title that fits the song.

Output JSON ONLY in this exact format:
{
  "title": "Song title here",
  "lyrics": "[Verse 1]\\nLine one\\nLine two\\n...\\n\\n[Chorus]\\n...\\n\\n[Verse 2]\\n...\\n\\n[Bridge]\\n...\\n\\n[Final Chorus]\\n..."
}
No markdown fences, no commentary. Pure JSON.`;

function buildUserPrompt(quiz) {
  const q = quiz || {};
  return `Write a custom song based on this brief:

Recipient: ${q.recipient || 'unspecified'}
Their name: ${q.name || 'unspecified'}
Occasion: ${q.occasion || 'unspecified'}
3 words to describe them: ${q.traits || 'unspecified'}
Music style / genre: ${q.genre || 'pop'}
Mood / vibe: ${q.mood || 'emotional and warm'}

Their story (raw input from the gift-giver):
"""
${q.story || '(no story provided — base the song on the traits, occasion and recipient)'}
"""

Sender (the gift-giver): ${q.senderName || 'anonymous'}

Write the song now.`;
}

export async function generateLyrics(quiz) {
  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY missing');
  }

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.85,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: buildUserPrompt(quiz) }]
  });

  const text = resp.content?.[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    // fallback: try to extract JSON between first { and last }
    const m = text.match(/\{[\s\S]*\}/);
    if (m) parsed = JSON.parse(m[0]);
    else throw new Error('Claude returned non-JSON: ' + text.slice(0, 200));
  }

  return {
    title: parsed.title || 'Untitled',
    content: parsed.lyrics || parsed.content || '',
    meta: {
      model: MODEL,
      usage: resp.usage,
      stop_reason: resp.stop_reason
    }
  };
}

// Revision: regenerate based on customer feedback
export async function regenerateLyrics(quiz, previousLyrics, revisionNotes) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY missing');

  const userPrompt = `${buildUserPrompt(quiz)}

PREVIOUS VERSION (the customer asked for changes):
"""
${previousLyrics}
"""

CUSTOMER FEEDBACK / REVISION REQUEST:
"""
${revisionNotes || '(no specific feedback — just regenerate)'}
"""

Now write an improved version that addresses the feedback. Keep what worked, change what they asked for.`;

  const resp = await client.messages.create({
    model: MODEL,
    max_tokens: 2000,
    temperature: 0.85,
    system: SYSTEM_PROMPT,
    messages: [{ role: 'user', content: userPrompt }]
  });

  const text = resp.content?.[0]?.type === 'text' ? resp.content[0].text.trim() : '';
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : { title: 'Untitled', lyrics: text };
  return {
    title: parsed.title || 'Untitled',
    content: parsed.lyrics || parsed.content || '',
    meta: { model: MODEL, usage: resp.usage, revision: true }
  };
}
