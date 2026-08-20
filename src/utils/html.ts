import type { Request, Response } from 'express';

export function clientIp(req: Request): string | null {
  const forwarded = req.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0]!.trim();
  return (req.ip ?? req.socket.remoteAddress ?? null)?.replace(/^::ffff:/, '') ?? null;
}

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * LTI moves messages between platform and tool as browser form POSTs, never as
 * server-to-server calls - that is what carries the user's browser context
 * along. This renders the self-submitting form that performs one such hop.
 */
export function autoPostForm(
  res: Response,
  action: string,
  fields: Record<string, string | undefined>,
  label: string,
): void {
  const inputs = Object.entries(fields)
    .filter(([, value]) => value !== undefined && value !== null && value !== '')
    .map(([name, value]) => `<input type="hidden" name="${escapeHtml(name)}" value="${escapeHtml(String(value))}">`)
    .join('\n      ');

  res.type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8"><title>${escapeHtml(label)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center;
         font:14px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#f5f6f8; color:#656d78; }
  .box { text-align:center; }
  .spinner { width:26px; height:26px; margin:0 auto 12px; border-radius:50%;
             border:2.5px solid #d7dbe0; border-top-color:#2b5bd7; animation:spin .8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-color-scheme: dark) { body { background:#0f1115; color:#9aa1ac; }
    .spinner { border-color:#2a2e36; border-top-color:#7ba2ff; } }
</style></head>
<body>
  <div class="box">
    <div class="spinner"></div>
    ${escapeHtml(label)}
    <noscript><p>JavaScript is disabled - press the button to continue.</p></noscript>
    <form id="lti-form" method="POST" action="${escapeHtml(action)}">
      ${inputs}
      <noscript><button type="submit">Continue</button></noscript>
    </form>
  </div>
  <script>document.getElementById('lti-form').submit();</script>
</body></html>`);
}

export function renderErrorPage(res: Response, status: number, title: string, message: string): void {
  res.status(status).type('html').send(`<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>
  :root { color-scheme: light dark; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:15px/1.6 ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#f5f6f8; color:#16191f; }
  .card { max-width:540px; background:#fff; border:1px solid #e2e5ea; border-radius:12px; padding:26px 30px; }
  h1 { margin:0 0 10px; font-size:19px; } p { margin:0; color:#656d78; }
  @media (prefers-color-scheme: dark) { body { background:#0f1115; color:#e7e9ec; }
    .card { background:#171a1f; border-color:#2a2e36; } p { color:#9aa1ac; } }
</style></head>
<body><div class="card"><h1>${escapeHtml(title)}</h1><p>${escapeHtml(message)}</p></div></body></html>`);
}
