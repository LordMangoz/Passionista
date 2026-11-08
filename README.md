# Passionista

By Adam Locke and Umanga Bajgai and Sally Phyu

## Wardrobe analytics

The `/analytics` page loads live aggregate wardrobe metrics from `GET /api/analytics/wardrobe`. The endpoint is available to any signed-in user and returns counts aggregated across tagged wardrobes. It does not return user IDs, image IDs, or individual clothing records.

The dashboard includes wardrobe composition, color palette, season coverage, formality mix, and common styles. Databricks credentials remain server-only.
