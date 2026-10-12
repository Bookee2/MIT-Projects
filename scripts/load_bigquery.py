"""Load the CRE dataset into BigQuery and (re)create the reporting views.

This is the quarterly refresh job. In production the inputs would come from
the research team's market extracts and the lease administration system; in
this demo they are the synthetic files in docs/data/.

Tables (dataset `cre` by default):
    markets            market id and display name
    market_quarterly   one row per quarter x market x property type
    portfolio          the occupier's leases
    refresh_log        one row per run
Views:
    v_market_kpis      latest-quarter KPIs per market and type (T4Q sums, YoY changes, spread)
    v_lease_risk       leases with months remaining and mark-to-market

Usage:
    python3 scripts/load_bigquery.py [--project PROJECT] [--dataset cre] [--location US]
Uses Application Default Credentials.
"""

import argparse
import csv
import json
from datetime import datetime, timezone
from pathlib import Path

from google.cloud import bigquery

DATA = Path(__file__).resolve().parent.parent / "docs" / "data"

MARKET_QUARTERLY_SCHEMA = [
    bigquery.SchemaField("quarter", "STRING", "REQUIRED"),
    bigquery.SchemaField("market", "STRING", "REQUIRED"),
    bigquery.SchemaField("property_type", "STRING", "REQUIRED"),
    bigquery.SchemaField("inventory_sf", "INT64"),
    bigquery.SchemaField("vacancy_pct", "FLOAT64"),
    bigquery.SchemaField("net_absorption_sf", "INT64"),
    bigquery.SchemaField("deliveries_sf", "INT64"),
    bigquery.SchemaField("under_construction_sf", "INT64"),
    bigquery.SchemaField("asking_rent_psf", "FLOAT64"),
    bigquery.SchemaField("cap_rate_pct", "FLOAT64"),
    bigquery.SchemaField("sales_volume_usd", "FLOAT64"),
    bigquery.SchemaField("treasury_10y_pct", "FLOAT64"),
]
PORTFOLIO_SCHEMA = [
    bigquery.SchemaField("lease_id", "STRING", "REQUIRED"),
    bigquery.SchemaField("market", "STRING"),
    bigquery.SchemaField("property_type", "STRING"),
    bigquery.SchemaField("rentable_sf", "INT64"),
    bigquery.SchemaField("expiration", "DATE"),
    bigquery.SchemaField("in_place_rent_psf", "FLOAT64"),
    bigquery.SchemaField("market_rent_psf", "FLOAT64"),
]
MARKETS_SCHEMA = [
    bigquery.SchemaField("id", "STRING", "REQUIRED"),
    bigquery.SchemaField("name", "STRING"),
    bigquery.SchemaField("sort_order", "INT64"),
]
LOG_SCHEMA = [
    bigquery.SchemaField("run_at", "TIMESTAMP"),
    bigquery.SchemaField("latest_quarter", "STRING"),
    bigquery.SchemaField("market_rows", "INT64"),
    bigquery.SchemaField("leases", "INT64"),
]

VIEWS = {
    "v_market_kpis": """
WITH q AS (
  SELECT *,
    SUM(net_absorption_sf) OVER w4 AS net_absorption_t4q_sf,
    SUM(deliveries_sf) OVER w4 AS deliveries_t4q_sf,
    SUM(sales_volume_usd) OVER w4 AS sales_volume_t4q_usd,
    vacancy_pct - LAG(vacancy_pct, 4) OVER w AS vacancy_yoy_pp,
    SAFE_DIVIDE(asking_rent_psf, LAG(asking_rent_psf, 4) OVER w) * 100 - 100 AS rent_yoy_pct,
    ROW_NUMBER() OVER (PARTITION BY market, property_type ORDER BY quarter DESC) AS rn
  FROM `{ds}.market_quarterly`
  WINDOW w AS (PARTITION BY market, property_type ORDER BY quarter),
         w4 AS (PARTITION BY market, property_type ORDER BY quarter ROWS BETWEEN 3 PRECEDING AND CURRENT ROW)
)
SELECT q.quarter, q.market, m.name AS market_name, q.property_type,
  q.vacancy_pct, q.vacancy_yoy_pp, q.net_absorption_t4q_sf, q.deliveries_t4q_sf,
  q.asking_rent_psf, q.rent_yoy_pct, q.cap_rate_pct,
  ROUND((q.cap_rate_pct - q.treasury_10y_pct) * 100) AS spread_to_10y_bps,
  q.under_construction_sf, SAFE_DIVIDE(q.under_construction_sf, q.inventory_sf) * 100 AS under_construction_pct_inventory,
  q.sales_volume_t4q_usd
FROM q JOIN `{ds}.markets` m ON m.id = q.market
WHERE q.rn = 1
""",
    "v_lease_risk": """
SELECT p.*, m.name AS market_name,
  DATE_DIFF(p.expiration, CURRENT_DATE(), DAY) / 30.4375 AS months_remaining,
  SAFE_DIVIDE(p.market_rent_psf - p.in_place_rent_psf, p.in_place_rent_psf) * 100 AS mark_to_market_pct,
  (p.market_rent_psf - p.in_place_rent_psf) * p.rentable_sf AS mark_to_market_annual_usd
FROM `{ds}.portfolio` p JOIN `{ds}.markets` m ON m.id = p.market
""",
}


def read_csv(path, ints=(), floats=()):
    with open(path, newline="") as f:
        rows = list(csv.DictReader(f))
    for r in rows:
        for k in ints:
            r[k] = int(float(r[k]))
        for k in floats:
            r[k] = float(r[k])
    return rows


def load(client, table, rows, schema):
    job = client.load_table_from_json(rows, table, job_config=bigquery.LoadJobConfig(
        schema=schema, write_disposition="WRITE_TRUNCATE"))
    job.result()
    return len(rows)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--project")
    ap.add_argument("--dataset", default="cre")
    ap.add_argument("--location", default="US")
    a = ap.parse_args()

    client = bigquery.Client(project=a.project)
    ds = f"{client.project}.{a.dataset}"
    dataset = bigquery.Dataset(ds)
    dataset.location = a.location
    dataset.description = "CRE Market Pulse demo. Synthetic sample data, not real market statistics."
    client.create_dataset(dataset, exists_ok=True)

    markets = [{"id": m["id"], "name": m["name"], "sort_order": i}
               for i, m in enumerate(json.loads((DATA / "cre_sample.json").read_text())["markets"])]
    mq = read_csv(DATA / "cre_market_quarterly.csv",
                  ints=("inventory_sf", "net_absorption_sf", "deliveries_sf", "under_construction_sf"),
                  floats=("vacancy_pct", "asking_rent_psf", "cap_rate_pct", "sales_volume_usd", "treasury_10y_pct"))
    pf = read_csv(DATA / "portfolio_sample.csv", ints=("rentable_sf",),
                  floats=("in_place_rent_psf", "market_rent_psf"))

    load(client, f"{ds}.markets", markets, MARKETS_SCHEMA)
    n_mq = load(client, f"{ds}.market_quarterly", mq, MARKET_QUARTERLY_SCHEMA)
    n_pf = load(client, f"{ds}.portfolio", pf, PORTFOLIO_SCHEMA)

    for name, sql in VIEWS.items():
        view = bigquery.Table(f"{ds}.{name}")
        view.view_query = sql.format(ds=ds)
        client.delete_table(view, not_found_ok=True)
        client.create_table(view)

    latest = max(r["quarter"] for r in mq)
    # A load job rather than a streaming insert, so a brand-new table is writable at once.
    client.load_table_from_json([{
        "run_at": datetime.now(timezone.utc).isoformat(), "latest_quarter": latest,
        "market_rows": n_mq, "leases": n_pf}], f"{ds}.refresh_log", job_config=bigquery.LoadJobConfig(
        schema=LOG_SCHEMA, write_disposition="WRITE_APPEND")).result()
    print(f"Loaded {n_mq} market rows and {n_pf} leases into {ds} (latest quarter {latest})")


if __name__ == "__main__":
    main()
