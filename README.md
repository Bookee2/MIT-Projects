# CRE Market Pulse

An AI-assisted commercial real estate (CRE) analytics demo: market KPIs, a vacancy forecast, anomaly detection, a lease-rollover risk view for an occupier portfolio, and an "ask the data" assistant that can optionally use Gemini.

All data is **synthetic sample data** from `scripts/generate_sample_data.py`. None of it is real market data.

## What's in it

| Area | What it shows |
| --- | --- |
| KPI tiles | Vacancy, net absorption (trailing 4 quarters), asking rent, cap rate and spread to the 10-year Treasury, construction pipeline, sales volume |
| Executive summary | A narrative built from the computed KPIs, with recommendations for occupiers and investors. Can be rewritten by Gemini. |
| Ask the data | Plain-English questions (rankings, comparisons, forecasts, anomalies, leases). The answer also refilters the dashboard. |
| Vacancy forecast | Damped Holt trend model with an 80% interval |
| Demand vs. supply | Net absorption against deliveries |
| Market scorecard | Sortable table of 10 markets with signals: Unusual move (z-score), Oversupply risk, Softening or Tightening |
| Portfolio | WALT, share of space expiring within 24 months, mark-to-market renewal cost, and priority actions |
| Methodology | KPI definitions, a reference Google Cloud pipeline, and an example BigQuery SQL view |

## Project layout

```
docs/                     GitHub Pages site (static, no build step)
  index.html
  assets/config.js        passcode hash, footer name, default Gemini model
  assets/analytics.js     KPI math, forecast, anomalies, portfolio scoring
  assets/assistant.js     intent parser + optional Gemini call
  assets/charts.js        dependency-free SVG charts
  assets/app.js           page wiring
  data/                   generated JSON and CSV
scripts/generate_sample_data.py
```

## Run locally

```bash
python3 scripts/generate_sample_data.py   # optional: regenerate the data
python3 -m http.server 8000 -d docs       # then open http://localhost:8000
```

## Publish with GitHub Pages

The live site is served from the `gh-pages` branch at `https://bookee2.github.io/MIT-Projects/Colliersdemo/`. The site root redirects there.

After changing anything in `docs/`, commit it, then run:

```bash
scripts/publish_pages.sh
```

The script copies `docs/` into `gh-pages` under `/Colliersdemo/` and pushes. GitHub redeploys within about a minute.

## Privacy

- On free and Pro GitHub plans, a Pages site is public to anyone who has the URL. Truly private Pages sites require GitHub Enterprise Cloud.
- The page tells search engines not to index it (`noindex`).
- The passcode screen is client-side only. It keeps casual visitors out, but it is not security. The default passcode is `pulse2026`. To change it, run `printf 'new-passcode' | sha256sum` and paste the hash into `docs/assets/config.js`. Set it to `""` to remove the screen.

## Gemini (optional)

Click **Connect Gemini** and paste an API key from Google AI Studio. The key is stored only in that browser's localStorage and sent only to `generativelanguage.googleapis.com`. Gemini receives a compact JSON copy of the current KPIs and is told to answer only from it. Without a key, or if a call fails, the built-in insight engine answers instead.

## Google Cloud deployment

The hosted version runs on Google Cloud project `colliers-demo-kb`:
https://colliers-demo-165316578606.us-central1.run.app (same passcode).

| Piece | Service | What it does |
| --- | --- | --- |
| `cre` dataset | BigQuery | Tables `markets`, `market_quarterly`, `portfolio`, `refresh_log`; views `v_market_kpis` and `v_lease_risk` |
| `colliers-demo` | Cloud Run service | `server/main.py`: serves `docs/`, builds `data/cre_sample.json` from BigQuery (falls back to the static file), and answers `/api/gemini` with Gemini on Vertex AI |
| `cre-refresh` | Cloud Run job | `scripts/load_bigquery.py`: reloads the tables and recreates the views |
| `cre-quarterly-refresh` | Cloud Scheduler | Runs the job at 6am ET on Jan 2, Apr 2, Jul 2 and Oct 2 |
| `cre-app` | Service account | BigQuery data editor and job user, Vertex AI user, Cloud Run invoker |

On the hosted site, "Ask the data" and "Rewrite with Gemini" use the server, so viewers need no API key. The Gemini endpoint does not require the passcode (`GEMINI_REQUIRE_PASSCODE=false`); it is limited to 20 calls a minute and 300 a day. On GitHub Pages the browser-key option still works.

Redeploy after changes:

```bash
gcloud run deploy colliers-demo --source . --region us-central1 --project colliers-demo-kb
```

Take everything down (stops all charges):

```bash
gcloud projects delete colliers-demo-kb
```
