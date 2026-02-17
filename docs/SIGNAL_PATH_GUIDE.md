# Signal Path

> **Note:** Signal Path is now located inside the **🚀 Outpost** tab under the **📊 Performance** sub-view. The standalone Signal Path tab has been removed.

# Signal Path (Legacy Reference) Tab Guide — For AI Agents

*How to read and operate the Signal Path (attribution) tab.*

*Last updated: 2026-02-16*

---

## Purpose

The Signal Path tab shows **content attribution analytics** — tracking how visitors flow from traffic sources through articles to product views and outbound clicks.

---

## Sections

### 1. Attribution Funnel
- Aggregated totals across all channels/dates: **Sessions → Article Reads → Product Views → Outbound Clicks**
- Each step shows count, percentage bar relative to sessions, and conversion rate from previous step
- Data source: `signal_path_attribution` view

### 2. Channel Summary
- One card per traffic source (source/medium combination)
- Shows sessions, reads, product views, outbound clicks, overall conversion rate
- Data source: `signal_path_channel_summary` view

### 3. Top Articles by Conversion
- Ranked list of up to 15 articles by outbound clicks
- Shows reads, product views, clicks, read→view rate, view→click rate
- Data source: `signal_path_article_scorecard` view

### 4. Daily Article Reads (Trend)
- Bar chart of daily article reads over time
- Aggregated from `signal_path_attribution` view (`sessions_with_reads` by `event_date`)

---

## Supabase Views

| View | Purpose |
|------|---------|
| `signal_path_channel_summary` | Per-channel aggregate metrics |
| `signal_path_article_scorecard` | Per-article conversion metrics |
| `signal_path_attribution` | Per-date, per-channel funnel steps |
| `signal_path_channel_articles` | Channel → article read performance |
| `signal_path_article_products` | Article → product view funnel |

Source table: `signal_path_events`

---

## Empty State

All sections gracefully show "No data yet" when views return empty results. Data populates as Signal Path tracking events are recorded.

---

## Code Location

- HTML: `index.html` — `content-signalpath` div
- JS: `dashboard.js` — `loadSignalPath()`, `loadSPFunnel()`, `loadSPChannels()`, `loadSPArticles()`, `loadSPTrend()`
