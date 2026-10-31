// SlapScore en Cloudflare Workers.
// La web son archivos estáticos (los sirve Cloudflare sin pasar por aquí). Este Worker solo:
//  1) responde a las rutas que no son un archivo (404), y
//  2) cada 30 minutos pide a GitHub que lance el robot (más fiable que el reloj de GitHub Actions).
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env) {
    if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return;
    const r = await fetch(`https://api.github.com/repos/${env.GH_REPO}/actions/workflows/crawl.yml/dispatches`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json',
        'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'slapscore-cron',
      },
      body: JSON.stringify({ ref: 'main', inputs: { minutes: '8' } }),
    });
    if (!r.ok) console.log(`GitHub respondió ${r.status}: ${(await r.text()).slice(0, 300)}`);
  },
};
