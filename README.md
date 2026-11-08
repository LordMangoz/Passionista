# Passionista

By Adam Locke and Umanga Bajgai and Sally Phyu

## Wardrobe analytics

The `/analytics` page loads live aggregate wardrobe metrics from `GET /api/analytics/wardrobe`. The endpoint is available to any signed-in user and returns counts aggregated across tagged wardrobes. It does not return user IDs, image IDs, or individual clothing records.

The dashboard includes wardrobe composition, color palette, season coverage, formality mix, and common styles. Databricks credentials remain server-only.

### Seed demo analytics data

The one-time demo seed creates 60 tagged sample wardrobe entries across six clearly synthetic users, with varied categories, colors, seasons, formality levels, and style tags. These records affect the shared, all-user analytics and are not tied to real accounts. Run the command from `server/`; it uses the Databricks values in the root `.env`.

```powershell
# Preview without writing anything
npm run seed:analytics

# Explicitly seed the configured workspace
$env:SEED_ANALYTICS_CONFIRM="YES"
npm run seed:analytics -- --apply

# Remove only this version of the demo seed later
npm run seed:analytics -- --remove
Remove-Item Env:SEED_ANALYTICS_CONFIRM
```

The script is idempotent and writes illustrative SVG thumbnails to the Databricks volume so seeded items can render in the wardrobe. Confirm that the configured workspace is for development/demo before applying. The same confirmation variable is required for removal.
