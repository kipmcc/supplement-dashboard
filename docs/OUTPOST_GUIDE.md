# 🚀 Outpost Command Center — Guide

*Unified content lifecycle management. One tab, four views.*

*Last updated: 2026-02-16*

## Overview

The Outpost tab replaces the former separate "Signal Path" and "Content" tabs. It provides a single command center for the entire content lifecycle: review → approve → schedule → measure → optimize.

## Sub-Views

### 📋 Queue
Content approval workflow. Shows all items from `content_queue` with status filters (Pending, Draft, Approved, Scheduled, Published, Rejected). Features:
- Platform icons and content previews
- One-click approve/reject
- Bulk action bar (select multiple → approve/reject all)
- Schedule button on approved items (opens optimal time picker)

### 📅 Calendar
Week-view scheduling grid (Mon–Sun, 6 AM–10 PM). Features:
- Platform-colored post cards in time slots
- Green-tinted optimal time slots per platform (LinkedIn Tue-Thu 8-10AM, etc.)
- Red gap alerts when a platform has no posts for the week
- Today indicator (red line at current time)
- Week navigation (← Previous | This Week | Next →)

### 📊 Performance
Signal Path attribution data (migrated from old Signal Path tab). Features:
- Attribution funnel: Sessions → Reads → Views → Clicks
- Channel summary cards with conversion rates
- Top articles by conversion rate
- Daily article reads trend chart
- Date range selector: 7d / 30d / 90d

### 💡 Insights
Auto-generated recommendations based on performance and content data:
- 🟢 Green = opportunity ("Top article converts well — create more")
- 🟡 Amber = attention needed ("Only 2 posts scheduled")
- 🔴 Red = problem ("No future posts scheduled")
- 🔵 Blue = informational ("Tuesday 9 AM is best slot")
- Channel health bars showing relative traffic
- Content velocity: posts/week trend

## Data Sources
- `content_queue` — posts, statuses, scheduled times
- `signal_path_events` — GA4 event data
- `signal_path_channel_summary` (view)
- `signal_path_article_scorecard` (view)
- `signal_path_attribution` (view)

## Navigation
Click **🚀 Outpost** in the main nav, then use the pill sub-nav to switch between Queue, Calendar, Performance, and Insights.
