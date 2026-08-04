import { Router } from 'express';

import * as qr from '../../services/qrService.js';
import { asyncRoute, validate } from '../middleware/core.js';
import { feedbackLimiter, scanLimiter } from '../middleware/rateLimit.js';
import { publicIdSchema, submitRatingSchema } from '../schemas.js';

export const publicRoutes = Router();

/**
 * The QR / NFC gate — entirely uncredentialed.
 *
 * The tenant is always derived server-side from the stand's public id. Nothing
 * here accepts an account id from the client, and the account id is never
 * returned: doing either would let anyone who scans a code harvest the tenant
 * and write unlimited fabricated feedback into that business.
 */

publicRoutes.get(
  '/q/:publicId',
  scanLimiter,
  validate(publicIdSchema, 'params'),
  asyncRoute(async (req, res) => {
    const gate = await qr.resolveScan({
      publicId: req.params.publicId,
      ip: req.ip,
      userAgent: req.get('user-agent'),
    });

    // Kill switch: without the paid gating feature the customer goes straight
    // to Google. Their experience never breaks because the business did not pay.
    if (!gate.gateEnabled) return res.redirect(302, gate.reviewUrl);

    // A browser navigating directly gets the hosted page; the SPA and native
    // clients ask for JSON.
    if (req.accepts(['html', 'json']) === 'html') {
      return res.type('html').send(renderGatePage(gate, req.params.publicId));
    }

    return res.json({
      businessName: gate.businessName,
      reviewThreshold: gate.reviewThreshold,
      standPublicId: req.params.publicId,
    });
  }),
);

publicRoutes.post(
  '/q/:publicId/rating',
  feedbackLimiter,
  validate(publicIdSchema, 'params'),
  validate(submitRatingSchema),
  asyncRoute(async (req, res) => {
    const result = await qr.submitRating({ publicId: req.params.publicId, ...req.body });

    res.json(
      result.action === 'redirect'
        ? { action: 'redirect', reviewUrl: result.reviewUrl }
        : { action: 'captured', message: 'Thank you — your feedback has been sent to the owner.' },
    );
  }),
);

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (character) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character],
  );
}

/**
 * Minimal server-rendered gate.
 *
 * Self-contained so a printed QR code works before any frontend is deployed —
 * a code on a physical table tent cannot be recalled if the SPA is late. Every
 * interpolated value is escaped, and both dynamic values are passed through
 * JSON.stringify or Number rather than concatenated into the script.
 */
function renderGatePage(gate, publicId) {
  const business = escapeHtml(gate.businessName);

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="robots" content="noindex">
<title>How did we do? — ${business}</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin:0; min-height:100vh; display:grid; place-items:center; padding:24px;
         font:16px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif;
         background:#f6f7f9; color:#111827; }
  @media (prefers-color-scheme: dark) {
    body { background:#0b0f19; color:#e5e7eb; }
    .card { background:#151b28 !important; }
    textarea { border-color:#374151 !important; }
  }
  .card { background:#fff; border-radius:16px; padding:32px 24px; max-width:420px; width:100%;
          box-shadow:0 10px 40px rgba(0,0,0,.08); text-align:center; }
  h1 { font-size:1.35rem; margin:0 0 8px; }
  p.sub { margin:0 0 24px; opacity:.75; }
  .stars { display:flex; justify-content:center; gap:8px; }
  .stars button { font-size:2.2rem; background:none; border:0; cursor:pointer; padding:4px;
                  line-height:1; filter:grayscale(1); opacity:.45; transition:.15s; }
  .stars button:hover, .stars button:focus-visible { transform:scale(1.15); filter:none; opacity:1; }
  textarea { width:100%; min-height:110px; padding:12px; border-radius:10px;
             border:1px solid #d1d5db; font:inherit; margin-bottom:12px;
             background:transparent; color:inherit; }
  button.primary { width:100%; padding:14px; border:0; border-radius:10px; background:#2563eb;
                   color:#fff; font-weight:600; font-size:1rem; cursor:pointer; }
  .hidden { display:none; }
</style>
</head>
<body>
  <main class="card">
    <h1>How did we do?</h1>
    <p class="sub">${business}</p>

    <div class="stars" id="stars" role="group" aria-label="Rate from 1 to 5 stars">
      ${[1, 2, 3, 4, 5]
        .map(
          (n) =>
            `<button type="button" data-rating="${n}" aria-label="${n} star${n > 1 ? 's' : ''}">★</button>`,
        )
        .join('')}
    </div>

    <form id="feedback" class="hidden">
      <p>Sorry to hear that. What went wrong?</p>
      <textarea id="text" required maxlength="2000" placeholder="Tell us what happened…"></textarea>
      <button class="primary" type="submit">Send to the owner</button>
    </form>

    <p id="done" class="hidden">Thank you — your feedback has been sent to the owner.</p>
  </main>

<script>
(function () {
  var publicId = ${JSON.stringify(publicId)};
  var chosen = 0;

  function post(payload) {
    return fetch('/q/' + encodeURIComponent(publicId) + '/rating', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    }).then(function (r) { return r.json(); }).catch(function () { return null; });
  }

  document.getElementById('stars').addEventListener('click', function (event) {
    var button = event.target.closest('button[data-rating]');
    if (!button) return;
    chosen = Number(button.dataset.rating);

    post({ rating: chosen }).then(function (data) {
      if (data && data.action === 'redirect') { window.location.href = data.reviewUrl; return; }
      document.getElementById('stars').classList.add('hidden');
      document.getElementById('feedback').classList.remove('hidden');
      document.getElementById('text').focus();
    });
  });

  document.getElementById('feedback').addEventListener('submit', function (event) {
    event.preventDefault();
    var text = document.getElementById('text').value.trim();
    if (!text) return;

    post({ rating: chosen, feedbackText: text }).then(function () {
      document.getElementById('feedback').classList.add('hidden');
      document.getElementById('done').classList.remove('hidden');
    });
  });
})();
</script>
</body>
</html>`;
}
