// The page people see when they open the addon's address in a browser: what this is, how to add it, where the
// project lives. Self-contained; one tiny script fills in this address (the page does not know it when rendered).

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export const PROJECT_URL = 'https://github.com/israeltv2/israel-tv';

export function renderLandingHtml(name: string, description: string): string {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(name)}</title><style>
body{font:16px/1.5 system-ui,sans-serif;margin:0 auto;padding:24px 16px;max-width:40rem;background:#fff;color:#111}
@media (prefers-color-scheme:dark){body{background:#111;color:#eee}a{color:#8bf}}
code{word-break:break-all;background:#8882;padding:2px 4px;border-radius:4px}
.btn{display:inline-block;padding:8px 14px;border-radius:6px;background:#2a5bd7;color:#fff;text-decoration:none;font-weight:600}
</style></head><body>
<h1>${esc(name)}</h1>
<p>${esc(description)}</p>
<p>It is an addon for Stremio and Nuvio. To add it, copy this link and paste it into the app's addon search box:</p>
<p><code id="link">manifest.json</code></p>
<p><a class="btn" id="open" href="manifest.json">Open in Stremio</a></p>
<p>Step-by-step help, the home helper for Keshet 12, and the source code: <a href="${PROJECT_URL}">${PROJECT_URL}</a></p>
<p><a href="status">Current status</a></p>
<script>
var u = location.origin + '/manifest.json';
document.getElementById('link').textContent = u;
document.getElementById('open').href = 'stremio://' + location.host + '/manifest.json';
</script>
</body></html>
`;
}
