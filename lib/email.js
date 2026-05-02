import { Resend } from 'resend';

const resend = process.env.RESEND_API_KEY ? new Resend(process.env.RESEND_API_KEY) : null;
const FROM = process.env.EMAIL_FROM || 'Lyralo <hello@lyralo.com>';
const TRACK_BASE = process.env.PUBLIC_BASE_URL || 'https://lyralo.com';

function html(subject, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${subject}</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Helvetica,Arial,sans-serif;background:#FBF7F2;margin:0;padding:32px 16px;color:#1A1A1A">
  <div style="max-width:560px;margin:0 auto;background:#fff;border-radius:16px;padding:32px;border:1px solid #E8DFD3">
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:24px;font-family:Georgia,serif;font-size:1.6rem;color:#7B1E3E;font-weight:600;letter-spacing:-.015em;line-height:1">
      <svg width="32" height="32" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg" style="overflow:visible;flex:none">
        <rect x="3" y="13" width="2.5" height="6" rx="1.25" fill="#7B1E3E"/>
        <rect x="8" y="10" width="2.5" height="12" rx="1.25" fill="#7B1E3E"/>
        <rect x="14.75" y="5" width="2.5" height="22" rx="1.25" fill="#D4A574"/>
        <rect x="21.5" y="10" width="2.5" height="12" rx="1.25" fill="#7B1E3E"/>
        <rect x="26.5" y="13" width="2.5" height="6" rx="1.25" fill="#7B1E3E"/>
      </svg>
      <span>Lyralo</span>
    </div>
    ${body}
    <hr style="border:none;border-top:1px solid #E8DFD3;margin:32px 0">
    <p style="color:#6B6B6B;font-size:.85rem;margin:0">Questions? Just reply to this email — we read every one.</p>
  </div>
</body></html>`;
}

export async function sendOrderReceived({ to, name, orderNo }) {
  if (!resend) return { skipped: true };
  const body = `
    <h2 style="font-family:Georgia,serif;font-size:1.5rem;margin:0 0 16px">We got it 🎵</h2>
    <p>Hi ${name || 'there'}, your custom song is in the works.</p>
    <p>Order <strong>${orderNo || ''}</strong> received. Our songwriters and producers will deliver your finished song in <strong>~6 hours</strong>. We'll email you the moment it's ready.</p>
    <p style="margin:24px 0">
      <a href="${TRACK_BASE}/track" style="display:inline-block;padding:14px 24px;background:#7B1E3E;color:#fff;text-decoration:none;border-radius:50px;font-weight:600">Track your order</a>
    </p>
  `;
  return resend.emails.send({ from: FROM, to, subject: `Your Lyralo song is being created 🎵`, html: html('Order received', body) });
}

export async function sendSongDelivered({ to, name, orderNo, trackUrl, songUrls = [] }) {
  if (!resend) return { skipped: true };
  const players = songUrls.map((u, i) => `
    <div style="background:#FBF7F2;border-radius:12px;padding:16px;margin:12px 0;border:1px solid #E8DFD3">
      <div style="font-weight:600;margin-bottom:8px">Version ${i + 1}</div>
      <audio controls src="${u}" style="width:100%"></audio>
      <p style="margin:10px 0 0"><a href="${u}" download style="color:#7B1E3E">⬇ Download MP3</a></p>
    </div>
  `).join('');

  const body = `
    <h2 style="font-family:Georgia,serif;font-size:1.5rem;margin:0 0 16px">Your song is ready 💝</h2>
    <p>Hi ${name || 'there'}, here's the song we created for you (order ${orderNo || ''}).</p>
    ${players}
    <p style="margin:24px 0">
      <a href="${trackUrl || TRACK_BASE + '/track'}" style="display:inline-block;padding:14px 24px;background:#7B1E3E;color:#fff;text-decoration:none;border-radius:50px;font-weight:600">View in your library</a>
    </p>
    <p style="color:#6B6B6B">Want a tweak? Reply to this email or request a free revision from your library.</p>
  `;
  return resend.emails.send({ from: FROM, to, subject: `🎵 Your Lyralo song is ready`, html: html('Song delivered', body) });
}

export async function sendRevisionUpdate({ to, name, status, note }) {
  if (!resend) return { skipped: true };
  const subject = status === 'approved'
    ? `We're working on your revision 🎶`
    : status === 'rejected'
    ? `About your revision request`
    : `Revision update`;
  const body = `
    <h2 style="font-family:Georgia,serif;font-size:1.5rem;margin:0 0 16px">${subject}</h2>
    <p>Hi ${name || 'there'}, ${status === 'approved'
      ? 'we received your feedback and our team is reworking your song. New version will arrive in ~6 hours.'
      : status === 'rejected'
      ? 'we reviewed your revision request and a member of our team will reach out shortly to discuss next steps.'
      : 'there\'s an update on your revision.'}
    </p>
    ${note ? `<p style="background:#FBF7F2;padding:14px 18px;border-left:3px solid #D4A574;border-radius:8px"><strong>Note:</strong> ${note}</p>` : ''}
  `;
  return resend.emails.send({ from: FROM, to, subject, html: html(subject, body) });
}
