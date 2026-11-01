// SlapScore en Cloudflare Workers.
// La web son archivos estáticos (los sirve Cloudflare sin pasar por aquí). Este Worker solo:
//  1) responde a las rutas que no son un archivo (404), y
//  2) cada 30 minutos comprueba que el robot sigue en marcha: las pasadas van encadenadas
//     (cada una deja en cola la siguiente) y, si la cadena se ha cortado, la vuelve a lanzar.
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
  async scheduled(event, env) {
    if (!env.GH_DISPATCH_TOKEN || !env.GH_REPO) return;
    const api = `https://api.github.com/repos/${env.GH_REPO}/actions/workflows/crawl.yml`;
    const headers = {
      authorization: `Bearer ${env.GH_DISPATCH_TOKEN}`, accept: 'application/vnd.github+json',
      'x-github-api-version': '2022-11-28', 'content-type': 'application/json', 'user-agent': 'slapscore-cron',
    };
    // ¿Hay alguna pasada en marcha, en cola o de hace menos de 15 minutos? Entonces la cadena funciona.
    const r = await fetch(`${api}/runs?per_page=5`, { headers });
    if (r.ok) {
      const runs = (await r.json()).workflow_runs || [];
      const alive = runs.some((x) => x.status !== 'completed' || Date.now() - Date.parse(x.updated_at) < 15 * 60_000);
      if (alive) return;
    }
    const d = await fetch(`${api}/dispatches`, { method: 'POST', headers, body: JSON.stringify({ ref: 'main', inputs: { minutes: '3', chain: '1' } }) });
    if (!d.ok) console.log(`GitHub respondió ${d.status}: ${(await d.text()).slice(0, 300)}`);
  },
};
