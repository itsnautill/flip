/* Flip stats endpoint.
   POST /ping  - one anonymous line per install per day
   GET  /stats - the aggregates the dashboard reads
   GET  /      - a small read-only dashboard

   Nothing here stores an IP address, a user agent, a hostname or anything else
   the client did not explicitly send. The only identifiers are the random
   install id and the UTC date. */

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

const JSON_HEADERS = { "Content-Type": "application/json; charset=utf-8", ...CORS };

const ID_RE = /^[a-z0-9]{8,64}$/;
const VERSION_RE = /^[0-9]+\.[0-9]+\.[0-9]+(-[0-9A-Za-z.-]+)?$/;

async function ensureSchema(db) {
  await db
    .prepare(
      `CREATE TABLE IF NOT EXISTS pings (
         id TEXT NOT NULL,
         day TEXT NOT NULL,
         version TEXT NOT NULL,
         lang TEXT NOT NULL,
         PRIMARY KEY (id, day)
       )`
    )
    .run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS pings_day ON pings (day)`).run();
}

function utcDay() {
  return new Date().toISOString().slice(0, 10);
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: JSON_HEADERS });
}

async function ping(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (error) {
    return json({ ok: false, error: "bad-json" }, 400);
  }

  const id = String(body?.id || "").trim();
  const version = String(body?.v || "").trim();
  const lang = String(body?.lang || "").trim();
  if (!ID_RE.test(id)) return json({ ok: false, error: "bad-id" }, 400);
  if (!VERSION_RE.test(version)) return json({ ok: false, error: "bad-version" }, 400);
  if (lang !== "en" && lang !== "vi") return json({ ok: false, error: "bad-lang" }, 400);

  await ensureSchema(env.DB);
  await env.DB.prepare(
    `INSERT OR IGNORE INTO pings (id, day, version, lang) VALUES (?, ?, ?, ?)`
  )
    .bind(id, utcDay(), version, lang)
    .run();

  return new Response(null, { status: 204, headers: CORS });
}

async function stats(env) {
  await ensureSchema(env.DB);

  const [totals, daily, versions, langs] = await Promise.all([
    env.DB.prepare(
      `SELECT
         (SELECT COUNT(DISTINCT id) FROM pings) AS installs,
         (SELECT COUNT(*) FROM pings) AS pings,
         (SELECT COUNT(DISTINCT id) FROM pings WHERE day = ?1) AS today,
         (SELECT COUNT(DISTINCT id) FROM pings WHERE day >= date(?1, '-6 days')) AS week`
    )
      .bind(utcDay())
      .first(),
    env.DB.prepare(
      `SELECT day, COUNT(DISTINCT id) AS installs
         FROM pings
        WHERE day >= date(?, '-29 days')
        GROUP BY day
        ORDER BY day`
    )
      .bind(utcDay())
      .all(),
    env.DB.prepare(
      `SELECT version, COUNT(DISTINCT id) AS installs
         FROM pings
        GROUP BY version
        ORDER BY version DESC`
    ).all(),
    env.DB.prepare(
      `SELECT lang, COUNT(DISTINCT id) AS installs FROM pings GROUP BY lang ORDER BY installs DESC`
    ).all(),
  ]);

  return json({
    updated: new Date().toISOString(),
    totals: totals || { installs: 0, pings: 0, today: 0, week: 0 },
    daily: daily.results || [],
    versions: versions.results || [],
    langs: langs.results || [],
  });
}

const PAGE = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Flip - usage</title>
<style>
  :root {
    --bg: #f7f2ea;
    --card: #fffdf9;
    --line: #e6dccd;
    --ink: #241c14;
    --muted: #7d6f5f;
    --accent: #b4622d;
  }
  @media (prefers-color-scheme: dark) {
    :root {
      --bg: #17130f;
      --card: #201a15;
      --line: #322a22;
      --ink: #f2e9dc;
      --muted: #a3947f;
    }
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 32px 20px 64px;
    background: var(--bg);
    color: var(--ink);
    font: 15px/1.55 "Segoe UI", system-ui, sans-serif;
  }
  .wrap { max-width: 880px; margin: 0 auto; }
  h1 { margin: 0 0 4px; font-size: 24px; letter-spacing: -0.01em; }
  .lede { margin: 0 0 26px; color: var(--muted); font-size: 13.5px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 12px; }
  .card {
    background: var(--card);
    border: 1px solid var(--line);
    border-radius: 14px;
    padding: 16px 18px;
  }
  .card .label { font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
  .card .value { font-size: 30px; font-weight: 600; margin-top: 6px; font-variant-numeric: tabular-nums; }
  h2 { margin: 34px 0 10px; font-size: 13px; text-transform: uppercase; letter-spacing: 0.07em; color: var(--muted); }
  .panel { background: var(--card); border: 1px solid var(--line); border-radius: 14px; padding: 8px 18px; }
  table { width: 100%; border-collapse: collapse; font-variant-numeric: tabular-nums; }
  th, td { text-align: left; padding: 8px 0; font-size: 13.5px; }
  th { color: var(--muted); font-weight: 500; font-size: 11.5px; text-transform: uppercase; letter-spacing: 0.05em; }
  tr + tr th, tr + tr td { border-top: 1px solid var(--line); }
  td.num, th.num { text-align: right; }
  .bar { position: relative; height: 8px; border-radius: 999px; background: var(--line); overflow: hidden; min-width: 90px; }
  .bar > i { position: absolute; inset: 0 auto 0 0; background: var(--accent); border-radius: 999px; }
  .row { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; }
  .empty { color: var(--muted); font-size: 13.5px; padding: 14px 0; }
  footer { margin-top: 28px; color: var(--muted); font-size: 12.5px; }
  a { color: var(--accent); }
</style>
</head>
<body>
  <div class="wrap">
    <h1>Flip usage</h1>
    <p class="lede">One anonymous line per install per day. No IP addresses, no accounts.</p>

    <div class="cards">
      <div class="card"><div class="label">Installs seen</div><div class="value" id="installs">-</div></div>
      <div class="card"><div class="label">Active today (UTC)</div><div class="value" id="today">-</div></div>
      <div class="card"><div class="label">Active this week</div><div class="value" id="week">-</div></div>
      <div class="card"><div class="label">Total pings</div><div class="value" id="pings">-</div></div>
    </div>

    <h2>Last 30 days</h2>
    <div class="panel"><table id="daily"><tbody><tr><td class="empty">Loading...</td></tr></tbody></table></div>

    <div class="row">
      <div>
        <h2>Versions</h2>
        <div class="panel"><table id="versions"><tbody><tr><td class="empty">Loading...</td></tr></tbody></table></div>
      </div>
      <div>
        <h2>Language</h2>
        <div class="panel"><table id="langs"><tbody><tr><td class="empty">Loading...</td></tr></tbody></table></div>
      </div>
    </div>

    <footer>
      <span id="updated">-</span> &middot; downloads are counted by GitHub on the
      <a href="https://github.com/itsnautill/flip/releases">releases page</a>.
    </footer>
  </div>

<script>
  const num = (value) => new Intl.NumberFormat().format(value || 0);

  function empty(target, text) {
    target.innerHTML = '<tbody><tr><td class="empty">' + text + "</td></tr></tbody>";
  }

  function dailyTable(rows) {
    const target = document.getElementById("daily");
    if (!rows.length) return empty(target, "No pings yet.");
    const top = Math.max.apply(null, rows.map((row) => row.installs)) || 1;
    target.innerHTML =
      "<tbody>" +
      rows
        .slice()
        .reverse()
        .map(function (row) {
          const width = Math.max(3, Math.round((row.installs / top) * 100));
          return (
            "<tr><td>" + row.day + "</td>" +
            '<td style="width:45%"><div class="bar"><i style="width:' + width + '%"></i></div></td>' +
            '<td class="num">' + num(row.installs) + "</td></tr>"
          );
        })
        .join("") +
      "</tbody>";
  }

  function pairTable(id, rows, key, emptyText) {
    const target = document.getElementById(id);
    if (!rows.length) return empty(target, emptyText);
    target.innerHTML =
      "<tbody>" +
      rows
        .map(function (row) {
          return "<tr><td>" + row[key] + '</td><td class="num">' + num(row.installs) + "</td></tr>";
        })
        .join("") +
      "</tbody>";
  }

  async function load() {
    try {
      const response = await fetch("/stats", { cache: "no-store" });
      if (!response.ok) throw new Error("HTTP " + response.status);
      const data = await response.json();
      document.getElementById("installs").textContent = num(data.totals.installs);
      document.getElementById("today").textContent = num(data.totals.today);
      document.getElementById("week").textContent = num(data.totals.week);
      document.getElementById("pings").textContent = num(data.totals.pings);
      document.getElementById("updated").textContent =
        "Updated " + new Date(data.updated).toLocaleString();
      dailyTable(data.daily);
      pairTable("versions", data.versions, "version", "No versions yet.");
      pairTable("langs", data.langs, "lang", "No languages yet.");
    } catch (error) {
      empty(document.getElementById("daily"), "Could not load: " + error.message);
    }
  }

  load();
  setInterval(load, 30000);
</script>
</body>
</html>`;

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: CORS });
    }

    try {
      if (url.pathname === "/ping" && request.method === "POST") {
        return await ping(request, env);
      }
      if (url.pathname === "/stats" && request.method === "GET") {
        return await stats(env);
      }
      if (url.pathname === "/" || url.pathname === "/index.html") {
        return new Response(PAGE, {
          headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" },
        });
      }
      if (url.pathname === "/health") {
        return json({ ok: true });
      }
      return json({ ok: false, error: "not-found" }, 404);
    } catch (error) {
      return json({ ok: false, error: "server" }, 500);
    }
  },
};
