import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'Lyralo <hello@lyralo.com>';
const TRACK_BASE = process.env.PUBLIC_BASE_URL || 'https://lyralo.com';
const SUPPORT_EMAIL = process.env.CONTACT_EMAIL || 'hello@lyralo.com';

// =============================================================================
//  Brand color tokens (kept inline for email-client compatibility)
// =============================================================================
const C = {
  burgundy: '#7B1E3E',
  burgundyDark: '#5C1530',
  gold: '#D4A574',
  goldLight: '#E8C9A0',
  cream: '#FBF7F2',
  creamDark: '#F2EBE0',
  ink: '#1A1A1A',
  inkSoft: '#3D3D3D',
  muted: '#6B6B6B',
  line: '#E8DFD3',
  white: '#FFFFFF'
};

// =============================================================================
//  HTML helpers — table-based layout for Outlook + Gmail compatibility
// =============================================================================
function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c])
  );
}

function logoSvg() {
  return `
    <table cellpadding="0" cellspacing="0" border="0" role="presentation">
      <tr>
        <td valign="middle" style="padding-right:10px;line-height:0">
          <svg width="34" height="34" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="display:block">
            <rect x="3" y="13" width="2.5" height="6"  rx="1.25" fill="${C.burgundy}"/>
            <rect x="8" y="10" width="2.5" height="12" rx="1.25" fill="${C.burgundy}"/>
            <rect x="14.75" y="5" width="2.5" height="22" rx="1.25" fill="${C.gold}"/>
            <rect x="21.5" y="10" width="2.5" height="12" rx="1.25" fill="${C.burgundy}"/>
            <rect x="26.5" y="13" width="2.5" height="6"  rx="1.25" fill="${C.burgundy}"/>
          </svg>
        </td>
        <td valign="middle" style="font-family:Georgia,'Playfair Display',serif;font-size:26px;font-weight:600;letter-spacing:-0.5px;color:${C.burgundy};line-height:1">
          Lyralo
        </td>
      </tr>
    </table>`;
}

function shell({ title, preview, body, footerExtra = '' }) {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta http-equiv="x-ua-compatible" content="ie=edge">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta name="x-apple-disable-message-reformatting">
  <meta name="color-scheme" content="light only">
  <meta name="supported-color-schemes" content="light only">
  <title>${escape(title)}</title>
  <style>
    @media only screen and (max-width: 620px) {
      .container { width: 100% !important; padding: 0 !important; }
      .card { padding: 24px 22px !important; border-radius: 0 !important; border-left:0!important; border-right:0!important }
      h1 { font-size: 22px !important; line-height: 1.25 !important }
      h2 { font-size: 18px !important }
      .btn-cta { padding: 14px 20px !important; font-size: 15px !important }
    }
  </style>
</head>
<body style="margin:0;padding:0;background:${C.cream};font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;color:${C.ink}">
  <!-- Preview text (hidden) -->
  <div style="display:none;max-height:0;overflow:hidden;mso-hide:all;font-size:1px;line-height:1px;color:${C.cream}">${escape(preview)}</div>

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" bgcolor="${C.cream}">
    <tr>
      <td align="center" style="padding:32px 16px">
        <table role="presentation" class="container" width="600" cellpadding="0" cellspacing="0" border="0" style="max-width:600px">

          <!-- Logo -->
          <tr>
            <td align="left" style="padding:0 8px 24px">
              ${logoSvg()}
            </td>
          </tr>

          <!-- Card -->
          <tr>
            <td class="card" style="background:${C.white};border:1px solid ${C.line};border-radius:18px;padding:36px 36px 28px;box-shadow:0 2px 4px rgba(123,30,62,0.04)">
              ${body}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td align="center" style="padding:24px 12px 8px;color:${C.muted};font-size:13px;line-height:1.6">
              <p style="margin:0 0 8px">
                Questions? Just reply — we read every email.<br>
                <a href="mailto:${SUPPORT_EMAIL}" style="color:${C.burgundy};text-decoration:none">${SUPPORT_EMAIL}</a>
              </p>
              ${footerExtra}
              <p style="margin:14px 0 0;font-size:12px;color:${C.muted}">
                © ${new Date().getFullYear()} Lyralo &middot; Custom songs that move people
              </p>
            </td>
          </tr>

        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

function btn(href, label, color = C.burgundy) {
  return `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 auto">
      <tr>
        <td align="center" bgcolor="${color}" style="border-radius:50px;mso-padding-alt:16px 32px">
          <a class="btn-cta" href="${href}" target="_blank"
             style="display:inline-block;padding:16px 32px;color:#fff;background:${color};border-radius:50px;font-weight:600;font-size:16px;text-decoration:none;line-height:1">
            ${escape(label)}
          </a>
        </td>
      </tr>
    </table>`;
}

// =============================================================================
//  Email 1 — Order Received  (sent immediately after Shopify webhook)
// =============================================================================
export async function sendOrderReceived({ to, name, orderNo, recipient, occasion, bundle }) {
  if (!resend) return { skipped: true };

  const senderName = name || 'there';
  const forWhom = recipient ? `for <strong>${escape(recipient)}</strong>` : '';
  const ofOccasion = occasion ? ` (${escape(occasion)})` : '';
  const isComplete = bundle === 'complete';
  const subject = `🎵 Your custom song is being crafted${orderNo ? ` — order ${orderNo}` : ''}`;
  const preview = `We got your order. Your song will be ready in ~6 hours.`;

  const body = `
    <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:28px;font-weight:600;color:${C.ink};line-height:1.2;letter-spacing:-0.3px">
      We got it. 🎵
    </h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
      Hi ${escape(senderName)}, your custom song ${forWhom}${ofOccasion} is officially in the works.
    </p>

    <!-- Timeline -->
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:0 0 24px;background:${C.cream};border-radius:14px;padding:6px">
      <tr>
        <td style="padding:18px 20px">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0">
            <tr>
              <td valign="top" style="font-size:24px;width:36px;padding-bottom:14px">✍️</td>
              <td style="padding-bottom:14px">
                <strong style="display:block;color:${C.ink};font-size:15px;line-height:1.4">Lyrics writing</strong>
                <span style="color:${C.muted};font-size:13px">~30 minutes — our songwriters turn your story into custom lyrics.</span>
              </td>
            </tr>
            <tr>
              <td valign="top" style="font-size:24px;width:36px;padding-bottom:14px">🎙️</td>
              <td style="padding-bottom:14px">
                <strong style="display:block;color:${C.ink};font-size:15px;line-height:1.4">Studio production</strong>
                <span style="color:${C.muted};font-size:13px">~4 hours — real vocals, professional instrumentation, mastered.</span>
              </td>
            </tr>
            <tr>
              <td valign="top" style="font-size:24px;width:36px">💝</td>
              <td>
                <strong style="display:block;color:${C.ink};font-size:15px;line-height:1.4">Delivery to you</strong>
                <span style="color:${C.muted};font-size:13px">Total ~6 hours. We'll email the moment it's ready.</span>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    ${isComplete ? `
    <div style="background:rgba(212,165,116,0.12);border-left:3px solid ${C.gold};padding:14px 18px;border-radius:10px;margin:0 0 24px">
      <strong style="color:${C.burgundy}">🎁 Your Complete Gift includes:</strong>
      <ul style="margin:8px 0 0;padding-left:20px;color:${C.inkSoft};font-size:14px;line-height:1.7">
        <li>2 versions of the song (different styles)</li>
        <li>MP3 + WAV studio-quality files</li>
        <li>Printable lyric card</li>
        <li>Unlimited free revisions</li>
      </ul>
    </div>` : ''}

    ${btn(`${TRACK_BASE}/track?email=${encodeURIComponent(to)}`, 'Track your order')}

    <p style="margin:24px 0 0;color:${C.muted};font-size:13px;line-height:1.6;text-align:center">
      Order reference: <strong style="color:${C.ink}">${escape(orderNo || '')}</strong><br>
      You'll receive your song at <strong style="color:${C.ink}">${escape(to)}</strong>
    </p>
  `;

  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html: shell({ title: 'Order received', preview, body })
  });
}

// =============================================================================
//  Email 2 — Song Delivered  (sent when admin clicks "Approve & Deliver")
// =============================================================================
export async function sendSongDelivered({ to, name, orderNo, trackUrl, songUrls = [], recipient, occasion, lyricsTitle, lyricsContent }) {
  if (!resend) return { skipped: true };

  const senderName = name || 'there';
  const forWhom = recipient ? ` for ${escape(recipient)}` : '';
  const ofOccasion = occasion ? ` — ${escape(occasion)}` : '';
  const subject = `💝 Your custom song is ready${orderNo ? ` (${orderNo})` : ''}`;
  const preview = `Listen to your custom song now. ${songUrls.length > 1 ? `${songUrls.length} versions inside.` : 'Crafted just for them.'}`;

  // Audio player blocks — multiple versions for Complete Gift, single for Single Song
  const players = songUrls.length === 0 ? '' : songUrls.map((u, i) => `
    <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="margin:14px 0;background:${C.cream};border-radius:14px;border:1px solid ${C.line}">
      <tr>
        <td style="padding:18px 20px">
          ${songUrls.length > 1 ? `
          <div style="font-family:Georgia,'Playfair Display',serif;font-size:13px;font-weight:600;color:${C.gold};letter-spacing:1px;text-transform:uppercase;margin-bottom:6px">
            Version ${i + 1}
          </div>` : ''}
          <div style="font-family:Georgia,'Playfair Display',serif;font-size:18px;font-weight:600;color:${C.ink};margin-bottom:14px">
            ${escape(lyricsTitle || 'Your custom song')}
          </div>

          <!-- HTML5 audio player (Apple Mail, modern Gmail) -->
          <audio controls preload="none" src="${u}" style="width:100%;height:42px;border-radius:8px"></audio>

          <!-- Download CTAs (always visible — fallback for email clients without audio support) -->
          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:14px 0 0">
            <tr>
              <td align="center" bgcolor="${C.burgundy}" style="border-radius:50px;mso-padding-alt:11px 22px">
                <a href="${u}" target="_blank"
                   style="display:inline-block;padding:11px 22px;color:#fff;background:${C.burgundy};border-radius:50px;font-weight:600;font-size:14px;text-decoration:none;line-height:1">
                  ▶ Listen
                </a>
              </td>
              <td style="padding-left:8px">
                <a href="${u}" download target="_blank" style="display:inline-block;padding:11px 22px;color:${C.burgundy};border:2px solid ${C.burgundy};border-radius:50px;font-weight:600;font-size:14px;text-decoration:none;line-height:1">
                  ⬇ MP3
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  `).join('');

  // Lyrics preview (first 8 lines if provided)
  const lyricsPreview = lyricsContent ? `
    <div style="margin:24px 0 0;padding:24px;background:${C.creamDark};border-radius:14px;border-left:3px solid ${C.gold}">
      <div style="font-family:Georgia,'Playfair Display',serif;font-size:13px;font-weight:600;color:${C.gold};letter-spacing:1px;text-transform:uppercase;margin-bottom:10px">
        From the song
      </div>
      <pre style="font-family:Georgia,'Playfair Display',serif;font-style:italic;font-size:15px;line-height:1.7;color:${C.ink};white-space:pre-wrap;word-wrap:break-word;margin:0">${escape(lyricsContent.split('\n').slice(0, 12).join('\n'))}${lyricsContent.split('\n').length > 12 ? '\n...' : ''}</pre>
    </div>
  ` : '';

  const body = `
    <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:30px;font-weight:600;color:${C.ink};line-height:1.2;letter-spacing:-0.4px">
      Your song is ready. 💝
    </h1>
    <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
      Hi ${escape(senderName)}, the custom song${forWhom}${ofOccasion} you ordered is finished and waiting for the first listen.
    </p>

    ${players}

    ${lyricsPreview}

    <div style="margin:32px 0 8px;text-align:center">
      ${btn(trackUrl || `${TRACK_BASE}/track?email=${encodeURIComponent(to)}`, '🎵 View in your library')}
    </div>

    <p style="margin:24px 0 0;color:${C.muted};font-size:14px;line-height:1.7;text-align:center">
      <strong style="color:${C.ink}">How to share it</strong><br>
      Forward this email, or open the link above and tap "Share".<br>
      The song is yours forever — use it for the surprise, the wedding, the video, anywhere.
    </p>

    <hr style="border:none;border-top:1px solid ${C.line};margin:28px 0">

    <p style="margin:0;color:${C.muted};font-size:13px;line-height:1.7;text-align:center">
      Want a tweak? Reply to this email or<br>
      <a href="${trackUrl || TRACK_BASE + '/track'}" style="color:${C.burgundy};font-weight:600;text-decoration:none">request a free revision →</a>
    </p>
  `;

  return resend.emails.send({
    from: FROM,
    to,
    subject,
    html: shell({ title: 'Song delivered', preview, body })
  });
}

// =============================================================================
//  Email 3 — Revision Update  (approved / rejected / applied)
// =============================================================================
export async function sendRevisionUpdate({ to, name, status, note }) {
  if (!resend) return { skipped: true };

  const senderName = name || 'there';
  const config = {
    approved: {
      subject: `🎶 We're reworking your song`,
      preview: `Your revision was approved. New version coming in ~6 hours.`,
      heading: `Your revision is approved.`,
      emoji: '🎶',
      body: 'We received your feedback and our team is reworking your song. The new version will arrive in your inbox in <strong>~6 hours</strong>.'
    },
    rejected: {
      subject: `About your revision request`,
      preview: `We've reviewed your revision request — let's talk.`,
      heading: `About your revision request.`,
      emoji: '💬',
      body: `We reviewed your revision request and want to discuss the next steps with you. A team member will reach out shortly. In the meantime, feel free to reply to this email with any details that would help.`
    },
    applied: {
      subject: `🎵 Your revised song is ready`,
      preview: `The revised version of your custom song is now available.`,
      heading: `The revision is done.`,
      emoji: '🎵',
      body: `Your revised song is now available in your library. Listen, download, and share away.`
    }
  }[status] || {
    subject: 'Revision update',
    preview: 'There is an update on your revision.',
    heading: 'Revision update.',
    emoji: '✉️',
    body: `There's an update on your revision request.`
  };

  const body = `
    <div style="font-size:36px;line-height:1;margin:0 0 12px">${config.emoji}</div>
    <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:26px;font-weight:600;color:${C.ink};line-height:1.25;letter-spacing:-0.3px">
      ${escape(config.heading)}
    </h1>
    <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
      Hi ${escape(senderName)}, ${config.body}
    </p>

    ${note ? `
    <div style="margin:0 0 24px;background:rgba(212,165,116,0.12);border-left:3px solid ${C.gold};padding:16px 20px;border-radius:10px">
      <strong style="color:${C.burgundy};font-size:13px;text-transform:uppercase;letter-spacing:0.5px">Note from the team</strong>
      <p style="margin:6px 0 0;color:${C.ink};font-size:15px;line-height:1.6">${escape(note)}</p>
    </div>` : ''}

    ${status === 'approved' || status === 'applied' ? btn(`${TRACK_BASE}/track?email=${encodeURIComponent(to)}`, 'View in your library') : ''}
  `;

  return resend.emails.send({
    from: FROM,
    to,
    subject: config.subject,
    html: shell({ title: config.subject, preview: config.preview, body })
  });
}

// =============================================================================
//  Email 4 — Lead Recovery  (quiz abandonné avant checkout)
//  attempt: 1 = +1h "you were close", 2 = +24h social proof, 3 = +48h urgency
// =============================================================================
export async function sendLeadRecovery({ to, quiz = {}, attempt = 1 }) {
  if (!resend) return { skipped: true };

  const recipient = quiz.recipient || 'someone special';
  const occasion  = quiz.occasion  || '';
  const genre     = quiz.genre     || '';
  const shopUrl   = process.env.SHOPIFY_STORE_URL || 'https://lyralo.com';

  const brief = `
    <div style="margin:0 0 28px;background:rgba(123,30,62,0.05);border-radius:14px;padding:20px 24px">
      <p style="margin:0 0 4px;font-size:13px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${C.muted}">Your brief</p>
      <p style="margin:0;font-size:15px;line-height:1.6;color:${C.ink}">
        🎁 For: <strong>${escape(recipient)}</strong>${occasion ? `  ·  🎉 ${escape(occasion)}` : ''}${genre ? `  ·  🎵 ${escape(genre)}` : ''}
      </p>
    </div>`;

  const trust = `
    <div style="background:${C.creamDark};border-radius:12px;padding:14px 20px;margin:24px 0 0">
      <p style="margin:0;font-size:13px;line-height:1.6;color:${C.inkSoft};text-align:center">
        ⚡ Delivered in <strong>6 hours</strong> &nbsp;·&nbsp; 🔒 Secure &nbsp;·&nbsp; ↩️ 30-day refund
      </p>
    </div>`;

  const configs = {
    1: {
      subject: `Your custom song is still waiting 🎵`,
      preview: `You were so close! Your brief for ${recipient} is saved — finish in 30 seconds.`,
      body: `
        <div style="font-size:36px;line-height:1;margin:0 0 12px">🎵</div>
        <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:26px;font-weight:600;color:${C.ink};line-height:1.25">
          You were so close.
        </h1>
        <p style="margin:0 0 24px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
          Your brief for <strong>${escape(recipient)}</strong>${occasion ? ` (${escape(occasion)})` : ''} is saved. One click and your song is on its way — delivered in <strong>6 hours</strong>.
        </p>
        ${brief}
        <div style="text-align:center">${btn(shopUrl, '🎶 Complete my order →')}</div>
        ${trust}`
    },
    2: {
      subject: `5,000+ songs created — yours is next 🎶`,
      preview: `Real people, real tears. See why Lyralo songs make the most unforgettable gifts.`,
      body: `
        <div style="font-size:36px;line-height:1;margin:0 0 12px">🥹</div>
        <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:26px;font-weight:600;color:${C.ink};line-height:1.25">
          "She cried the whole way through."
        </h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
          That's what one of our customers told us after gifting a Lyralo song for their wife's birthday. Over 5,000 songs created — each one a memory that lasts forever.
        </p>
        <div style="margin:0 0 24px;background:#fff;border:1px solid ${C.line};border-radius:14px;padding:20px 24px">
          <p style="margin:0 0 6px;font-size:15px;line-height:1.6;color:${C.ink}">
            ⭐⭐⭐⭐⭐ <strong>"The most thoughtful gift I've ever given."</strong>
          </p>
          <p style="margin:0;font-size:13px;color:${C.muted}">— Sarah M., anniversary gift</p>
        </div>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${C.inkSoft}">
          Your brief for <strong>${escape(recipient)}</strong> is still saved. Pick up where you left off:
        </p>
        ${brief}
        <div style="text-align:center">${btn(shopUrl, '🎶 Create my song →')}</div>
        ${trust}`
    },
    3: {
      subject: `Last reminder — your brief expires soon ⏳`,
      preview: `This is our last email. Your brief for ${recipient} is still saved — but not forever.`,
      body: `
        <div style="font-size:36px;line-height:1;margin:0 0 12px">⏳</div>
        <h1 style="margin:0 0 8px;font-family:Georgia,'Playfair Display',serif;font-size:26px;font-weight:600;color:${C.ink};line-height:1.25">
          Last reminder.
        </h1>
        <p style="margin:0 0 20px;font-size:16px;line-height:1.6;color:${C.inkSoft}">
          This is the last email we'll send. Your brief for <strong>${escape(recipient)}</strong>${occasion ? ` (${escape(occasion)})` : ''} is saved — but we'll delete it soon.
        </p>
        <p style="margin:0 0 24px;font-size:15px;line-height:1.6;color:${C.inkSoft}">
          If this song matters to you, now's the time. It takes 30 seconds and arrives in <strong>6 hours</strong>.
        </p>
        ${brief}
        <div style="text-align:center">${btn(shopUrl, '🎶 Finish my order — last chance →')}</div>
        ${trust}
        <p style="margin:20px 0 0;font-size:12px;color:${C.muted};text-align:center">
          You won't receive any more emails about this. No hard feelings.
        </p>`
    }
  };

  const config = configs[attempt] || configs[1];

  return resend.emails.send({
    from: FROM,
    to,
    subject: config.subject,
    html: shell({ title: 'Your song is waiting', preview: config.preview, body: config.body })
  });
}
