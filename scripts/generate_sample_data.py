"""Generate the illustrative CRE sample dataset used by the dashboard.

Every number this script writes is synthetic. The market shapes (office
vacancy rising after 2020, the 2021-22 industrial squeeze, cap rates
repricing with Treasury yields) are modeled to look plausible, but none of
the values are real market statistics.

The series are internally consistent: inventory grows by deliveries, net
absorption is the change in occupied space, and under construction is the
next six quarters of deliveries. That lets the dashboard compute KPIs the
same way a production pipeline would.

Usage:
    python3 scripts/generate_sample_data.py
Writes docs/data/cre_sample.json, docs/data/cre_market_quarterly.csv and
docs/data/portfolio_sample.csv.
"""

import csv
import json
import math
import random
from datetime import date
from pathlib import Path

SEED = 20261015
OUT_DIR = Path(__file__).resolve().parent.parent / "docs" / "data"

QUARTERS = [f"{y}Q{q}" for y in range(2018, 2027) for q in range(1, 5)][:34]  # 2018Q1-2026Q2
AS_OF = date(2026, 6, 30)

# Illustrative 10-year Treasury quarterly averages (%).
TREASURY_10Y = [
    2.76, 2.92, 2.93, 3.04, 2.65, 2.33, 1.80, 1.80, 1.38, 0.69, 0.65, 0.86,
    1.32, 1.59, 1.32, 1.53, 1.95, 2.93, 3.11, 3.83, 3.65, 3.60, 4.15, 4.44,
    4.16, 4.44, 3.95, 4.28, 4.45, 4.36, 4.25, 4.10, 4.15, 4.20,
]

MARKETS = [
    ("NYC", "New York"), ("LAX", "Los Angeles"), ("CHI", "Chicago"),
    ("DFW", "Dallas-Fort Worth"), ("ATL", "Atlanta"), ("PHX", "Phoenix"),
    ("SEA", "Seattle"), ("BOS", "Boston"), ("MIA", "Miami"), ("DEN", "Denver"),
]
TYPES = ["Office", "Industrial", "Retail"]

# National keyframes per property type: (quarter, value). Linear in between.
PROFILE = {
    "Office": {
        "vacancy": [("2018Q1", 12.6), ("2019Q4", 12.3), ("2020Q4", 14.9), ("2021Q4", 16.8),
                    ("2023Q2", 18.7), ("2025Q1", 20.4), ("2026Q2", 19.9)],
        "rent": [("2018Q1", 37.5), ("2020Q1", 39.0), ("2021Q2", 38.6), ("2023Q4", 39.4), ("2026Q2", 39.8)],
        "cap": [("2018Q1", 6.7), ("2021Q4", 6.4), ("2023Q4", 7.9), ("2025Q2", 8.6), ("2026Q2", 8.5)],
        "delivery_rate": [("2018Q1", 0.35), ("2020Q1", 0.42), ("2022Q1", 0.30), ("2024Q1", 0.14), ("2026Q2", 0.05)],
        "turnover": [("2018Q1", 1.1), ("2020Q2", 0.35), ("2021Q4", 1.3), ("2023Q2", 0.40), ("2025Q2", 0.55), ("2026Q2", 0.70)],
    },
    "Industrial": {
        "vacancy": [("2018Q1", 5.0), ("2019Q4", 5.1), ("2020Q3", 5.4), ("2022Q2", 3.2),
                    ("2023Q2", 4.4), ("2024Q2", 6.0), ("2025Q4", 7.2), ("2026Q2", 7.0)],
        "rent": [("2018Q1", 7.9), ("2020Q1", 8.6), ("2021Q2", 9.1), ("2023Q2", 11.0), ("2024Q4", 11.3), ("2026Q2", 11.2)],
        "cap": [("2018Q1", 5.6), ("2022Q1", 4.5), ("2023Q4", 5.9), ("2025Q2", 6.3), ("2026Q2", 6.2)],
        "delivery_rate": [("2018Q1", 0.60), ("2021Q1", 0.80), ("2023Q1", 1.20), ("2024Q2", 0.80), ("2025Q2", 0.42), ("2026Q2", 0.38)],
        "turnover": [("2018Q1", 1.3), ("2020Q2", 0.50), ("2021Q4", 2.2), ("2023Q2", 0.85), ("2025Q2", 1.15), ("2026Q2", 1.25)],
    },
    "Retail": {
        "vacancy": [("2018Q1", 5.0), ("2019Q4", 5.2), ("2020Q4", 6.3), ("2022Q2", 4.9),
                    ("2024Q2", 4.1), ("2026Q2", 4.4)],
        "rent": [("2018Q1", 21.0), ("2020Q1", 21.6), ("2021Q1", 20.9), ("2023Q4", 23.2), ("2026Q2", 24.6)],
        "cap": [("2018Q1", 6.6), ("2022Q1", 6.2), ("2023Q4", 6.9), ("2026Q2", 7.1)],
        "delivery_rate": [("2018Q1", 0.16), ("2020Q2", 0.12), ("2023Q1", 0.08), ("2026Q2", 0.07)],
        "turnover": [("2018Q1", 1.2), ("2020Q2", 0.40), ("2021Q4", 1.6), ("2023Q2", 0.80), ("2026Q2", 1.05)],
    },
}

# Base inventory (million sf) per market and type.
INVENTORY_MSF = {
    "Office":     {"NYC": 460, "LAX": 210, "CHI": 240, "DFW": 220, "ATL": 150, "PHX": 100, "SEA": 110, "BOS": 180, "MIA": 62, "DEN": 110},
    "Industrial": {"NYC": 850, "LAX": 1800, "CHI": 1300, "DFW": 1100, "ATL": 800, "PHX": 450, "SEA": 350, "BOS": 300, "MIA": 250, "DEN": 280},
    "Retail":     {"NYC": 600, "LAX": 450, "CHI": 550, "DFW": 450, "ATL": 350, "PHX": 230, "SEA": 200, "BOS": 250, "MIA": 250, "DEN": 170},
}

RENT_MULT = {
    "Office":     {"NYC": 1.95, "LAX": 1.20, "CHI": 1.00, "DFW": 0.86, "ATL": 0.82, "PHX": 0.78, "SEA": 1.15, "BOS": 1.35, "MIA": 1.30, "DEN": 0.84},
    "Industrial": {"NYC": 1.70, "LAX": 1.60, "CHI": 0.75, "DFW": 0.70, "ATL": 0.70, "PHX": 0.85, "SEA": 1.25, "BOS": 1.30, "MIA": 1.40, "DEN": 0.95},
    "Retail":     {"NYC": 2.10, "LAX": 1.40, "CHI": 0.95, "DFW": 0.85, "ATL": 0.85, "PHX": 0.80, "SEA": 1.10, "BOS": 1.20, "MIA": 1.50, "DEN": 0.90},
}

# Vacancy offset from the national path (percentage points): (start, end).
VAC_OFFSET = {
    "Office":     {"NYC": (-1.5, -2.5), "LAX": (2.0, 3.0), "CHI": (3.0, 4.0), "DFW": (4.0, 4.5), "ATL": (2.5, 3.5),
                   "PHX": (3.0, 2.0), "SEA": (0.5, 4.0), "BOS": (-1.0, 0.5), "MIA": (-2.0, -6.0), "DEN": (4.0, 5.0)},
    "Industrial": {"NYC": (-0.5, -0.5), "LAX": (-1.5, 1.0), "CHI": (0.5, -0.5), "DFW": (1.0, 2.5), "ATL": (0.5, 1.5),
                   "PHX": (1.0, 4.0), "SEA": (-0.5, 0.0), "BOS": (0.5, 0.5), "MIA": (-1.5, -1.5), "DEN": (1.5, 1.5)},
    "Retail":     {"NYC": (1.0, 1.5), "LAX": (0.5, 1.0), "CHI": (1.5, 1.0), "DFW": (0.5, -0.5), "ATL": (0.5, 0.0),
                   "PHX": (1.0, -0.5), "SEA": (0.0, 0.5), "BOS": (-0.5, -0.5), "MIA": (-0.5, -1.5), "DEN": (0.5, 0.0)},
}

# Rent growth tilt per market over the full window (fraction), e.g. 0.08 = +8% vs national.
RENT_TILT = {"NYC": 0.0, "LAX": -0.04, "CHI": -0.06, "DFW": 0.05, "ATL": 0.04, "PHX": 0.06,
             "SEA": -0.03, "BOS": 0.0, "MIA": 0.12, "DEN": -0.02}
CAP_OFFSET = {"NYC": -0.3, "LAX": -0.4, "CHI": 0.6, "DFW": 0.1, "ATL": 0.2, "PHX": 0.2,
              "SEA": -0.2, "BOS": -0.2, "MIA": -0.3, "DEN": 0.1}
DELIVERY_MULT = {"Industrial": {"PHX": 2.4, "DFW": 1.6, "ATL": 1.4, "LAX": 0.5, "NYC": 0.6, "BOS": 0.6},
                 "Office": {"MIA": 1.4, "NYC": 0.8}}

# One-off shocks (percentage points added to vacancy from that quarter on),
# so the anomaly detector has something real to find.
SHOCKS = {("PHX", "Industrial"): [("2026Q2", 1.5)], ("MIA", "Office"): [("2026Q1", -1.3)],
          ("SEA", "Office"): [("2024Q3", 0.9)]}


def qi(label):
    return QUARTERS.index(label)


def interp(keyframes, n=len(QUARTERS)):
    pts = [(qi(q), v) for q, v in keyframes]
    out = []
    for i in range(n):
        if i <= pts[0][0]:
            out.append(pts[0][1])
            continue
        if i >= pts[-1][0]:
            out.append(pts[-1][1])
            continue
        for (x0, y0), (x1, y1) in zip(pts, pts[1:]):
            if x0 <= i <= x1:
                out.append(y0 + (y1 - y0) * (i - x0) / (x1 - x0))
                break
    return out


def ar1(rng, n, sigma, phi=0.6):
    x, out = 0.0, []
    for _ in range(n):
        x = phi * x + rng.gauss(0, sigma)
        out.append(x)
    return out


def build_series(rng, mkt, ptype):
    n = len(QUARTERS)
    prof = PROFILE[ptype]
    vac_nat = interp(prof["vacancy"])
    rent_nat = interp(prof["rent"])
    cap_nat = interp(prof["cap"])
    deliv_rate = interp(prof["delivery_rate"])
    turnover = interp(prof["turnover"])

    o0, o1 = VAC_OFFSET[ptype][mkt]
    vac_noise = ar1(rng, n, 0.18 if ptype == "Office" else 0.12)
    shocks = SHOCKS.get((mkt, ptype), [])
    vacancy = []
    for i in range(n):
        v = vac_nat[i] + o0 + (o1 - o0) * i / (n - 1) + vac_noise[i]
        v += sum(size for q, size in shocks if i >= qi(q))
        vacancy.append(max(1.5, v))

    rent_noise = ar1(rng, n, 0.006, phi=0.8)
    rent = [rent_nat[i] * RENT_MULT[ptype][mkt] * (1 + RENT_TILT[mkt] * i / (n - 1) + rent_noise[i]) for i in range(n)]
    cap_noise = ar1(rng, n, 0.05, phi=0.7)
    cap = [cap_nat[i] + CAP_OFFSET[mkt] + cap_noise[i] for i in range(n)]

    dmult = DELIVERY_MULT.get(ptype, {}).get(mkt, 1.0)
    inv0 = INVENTORY_MSF[ptype][mkt] * 1e6
    inventory, deliveries = [], []
    inv = inv0
    for i in range(n):
        d = inv * deliv_rate[i] / 100 * dmult * math.exp(rng.gauss(0, 0.18))
        inv += d
        deliveries.append(d)
        inventory.append(inv)

    # Under construction = deliveries scheduled over the next six quarters.
    # Beyond the window, extend with the latest delivery rate.
    tail_rate = deliveries[-1]
    future = deliveries + [tail_rate * (0.97 ** k) for k in range(1, 7)]
    under_construction = [sum(future[i + 1:i + 7]) for i in range(n)]

    absorption = []
    prev_occ = inv0 * (1 - vacancy[0] / 100) - deliveries[0] * 0.6
    for i in range(n):
        occ = inventory[i] * (1 - vacancy[i] / 100)
        absorption.append(occ - prev_occ)
        prev_occ = occ

    sales = []
    for i in range(n):
        noi = rent[i] * inventory[i] * (1 - vacancy[i] / 100) * 0.62
        value = noi / (cap[i] / 100)
        sales.append(value * turnover[i] / 100 * math.exp(rng.gauss(0, 0.15)))

    return {
        "inventory_sf": [round(x) for x in inventory],
        "vacancy_pct": [round(x, 2) for x in vacancy],
        "net_absorption_sf": [round(x) for x in absorption],
        "deliveries_sf": [round(x) for x in deliveries],
        "under_construction_sf": [round(x) for x in under_construction],
        "asking_rent_psf": [round(x, 2) for x in rent],
        "cap_rate_pct": [round(x, 2) for x in cap],
        "sales_volume_usd": [round(x, -4) for x in sales],
    }


def build_portfolio(rng, series):
    """A fictional occupier's 26 leases, with in-place rents vs today's market."""
    plan = [("NYC", "Office"), ("NYC", "Office"), ("LAX", "Office"), ("CHI", "Office"), ("DFW", "Office"),
            ("ATL", "Office"), ("SEA", "Office"), ("BOS", "Office"), ("MIA", "Office"), ("DEN", "Office"),
            ("LAX", "Industrial"), ("LAX", "Industrial"), ("CHI", "Industrial"), ("DFW", "Industrial"),
            ("DFW", "Industrial"), ("ATL", "Industrial"), ("PHX", "Industrial"), ("PHX", "Industrial"),
            ("NYC", "Industrial"), ("DEN", "Industrial"), ("NYC", "Retail"), ("LAX", "Retail"),
            ("CHI", "Retail"), ("MIA", "Retail"), ("BOS", "Retail"), ("PHX", "Retail")]
    size = {"Office": (25_000, 180_000), "Industrial": (120_000, 650_000), "Retail": (8_000, 45_000)}
    leases = []
    for n, (mkt, ptype) in enumerate(plan, start=1):
        lo, hi = size[ptype]
        sf = round(rng.uniform(lo, hi), -3)
        months_left = rng.choice([3, 5, 8, 11, 14, 17, 20, 23, 28, 33, 40, 46, 55, 64, 75, 88])
        y, m = AS_OF.year, AS_OF.month + months_left
        y += (m - 1) // 12
        m = (m - 1) % 12 + 1
        expiry = date(y, m, 28)
        market_rent = series[f"{mkt}|{ptype}"]["asking_rent_psf"][-1]
        # Older leases (signed further back) tend to sit further below market.
        drift = -0.18 if ptype == "Industrial" else (0.04 if ptype == "Office" else -0.06)
        in_place = market_rent * (1 + drift * (1 - months_left / 90) + rng.gauss(0, 0.06))
        leases.append({
            "lease_id": f"L-{n:03d}",
            "market": mkt,
            "property_type": ptype,
            "rentable_sf": int(sf),
            "expiration": expiry.isoformat(),
            "in_place_rent_psf": round(in_place, 2),
            "market_rent_psf": market_rent,
        })
    return leases


def main():
    rng = random.Random(SEED)
    series = {}
    for ptype in TYPES:
        for mkt, _ in MARKETS:
            series[f"{mkt}|{ptype}"] = build_series(rng, mkt, ptype)
    portfolio = build_portfolio(rng, series)

    OUT_DIR.mkdir(parents=True, exist_ok=True)
    payload = {
        "meta": {
            "title": "Illustrative CRE market sample",
            "disclaimer": "Synthetic sample data generated for a portfolio demo. Not real market statistics.",
            "as_of": AS_OF.isoformat(),
            "seed": SEED,
            "units": {
                "inventory_sf": "rentable square feet", "vacancy_pct": "% of inventory",
                "net_absorption_sf": "sf per quarter", "deliveries_sf": "sf per quarter",
                "under_construction_sf": "sf at quarter end", "asking_rent_psf": "USD per sf per year",
                "cap_rate_pct": "%", "sales_volume_usd": "USD per quarter",
            },
        },
        "quarters": QUARTERS,
        "treasury_10y_pct": TREASURY_10Y,
        "markets": [{"id": m, "name": name} for m, name in MARKETS],
        "property_types": TYPES,
        "series": series,
        "portfolio": portfolio,
    }
    (OUT_DIR / "cre_sample.json").write_text(json.dumps(payload, separators=(",", ":")))

    with open(OUT_DIR / "cre_market_quarterly.csv", "w", newline="") as f:
        w = csv.writer(f)
        fields = list(next(iter(series.values())).keys())
        w.writerow(["quarter", "market", "property_type", *fields, "treasury_10y_pct"])
        for key, s in series.items():
            mkt, ptype = key.split("|")
            for i, q in enumerate(QUARTERS):
                w.writerow([q, mkt, ptype, *(s[k][i] for k in fields), TREASURY_10Y[i]])

    with open(OUT_DIR / "portfolio_sample.csv", "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=list(portfolio[0].keys()))
        w.writeheader()
        w.writerows(portfolio)

    print(f"Wrote {len(series)} market series x {len(QUARTERS)} quarters and {len(portfolio)} leases to {OUT_DIR}")


if __name__ == "__main__":
    main()
