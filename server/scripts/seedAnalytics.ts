import { config } from "dotenv";
import { runSql, putFileBytes } from "../databricks";

config({ path: "../.env" });

const SEED_VERSION = "passionista-analytics-demo-v1";
const USER_COUNT = 6;
const ITEMS_PER_USER = 10;
const VOLUME_ROOT = "/Volumes/workspace/image_project/image_files/images";
const SEED_VOLUME_ROOT = `${VOLUME_ROOT}/${SEED_VERSION}`;
const IMAGE_TABLE = "workspace.image_project.images";
const ITEMS_TABLE = "workspace.image_project.clothing_items";

type SampleItem = {
  slug: string;
  category: string;
  subcategory: string;
  primaryColor: string;
  colorHex: string;
  secondaryColors: string[];
  pattern: string;
  material: string;
  fit: string;
  styleTags: string[];
  formality: string;
  seasons: string[];
};

const samples: SampleItem[] = [
  { slug: "black-graphic-tee", category: "top", subcategory: "graphic t-shirt", primaryColor: "black", colorHex: "#303039", secondaryColors: ["white"], pattern: "graphic", material: "cotton", fit: "oversized", styleTags: ["streetwear", "grunge"], formality: "very_casual", seasons: ["summer", "spring"] },
  { slug: "cream-linen-blouse", category: "top", subcategory: "linen blouse", primaryColor: "cream", colorHex: "#e8d9bc", secondaryColors: [], pattern: "solid", material: "linen", fit: "relaxed", styleTags: ["minimalist", "bohemian"], formality: "smart_casual", seasons: ["spring", "summer"] },
  { slug: "blue-straight-jeans", category: "bottom", subcategory: "straight-leg jeans", primaryColor: "blue", colorHex: "#49688c", secondaryColors: [], pattern: "solid", material: "denim", fit: "regular", styleTags: ["casual", "streetwear"], formality: "casual", seasons: ["spring", "fall"] },
  { slug: "floral-midi-dress", category: "dress", subcategory: "floral midi dress", primaryColor: "sage green", colorHex: "#71816b", secondaryColors: ["cream", "pink"], pattern: "floral", material: "cotton", fit: "relaxed", styleTags: ["bohemian", "romantic"], formality: "casual", seasons: ["spring", "summer"] },
  { slug: "navy-tailored-blazer", category: "outerwear", subcategory: "tailored blazer", primaryColor: "navy", colorHex: "#34435c", secondaryColors: [], pattern: "solid", material: "wool blend", fit: "regular", styleTags: ["old money", "business casual"], formality: "business", seasons: ["fall", "spring"] },
  { slug: "white-low-sneakers", category: "footwear", subcategory: "low-top sneakers", primaryColor: "white", colorHex: "#e7e2d9", secondaryColors: ["gray"], pattern: "color-block", material: "leather", fit: "regular", styleTags: ["minimalist", "sporty"], formality: "casual", seasons: ["spring", "summer", "fall"] },
  { slug: "brown-leather-tote", category: "accessory", subcategory: "leather tote", primaryColor: "brown", colorHex: "#946b4c", secondaryColors: [], pattern: "solid", material: "leather", fit: "structured", styleTags: ["quiet luxury", "minimalist"], formality: "smart_casual", seasons: ["spring", "summer", "fall", "winter"] },
  { slug: "gray-hoodie", category: "top", subcategory: "hoodie", primaryColor: "gray", colorHex: "#92918f", secondaryColors: [], pattern: "solid", material: "fleece", fit: "oversized", styleTags: ["streetwear", "athleisure"], formality: "very_casual", seasons: ["fall", "winter"] },
  { slug: "pink-pleated-skirt", category: "bottom", subcategory: "pleated skirt", primaryColor: "pink", colorHex: "#d99ca7", secondaryColors: [], pattern: "solid", material: "polyester", fit: "regular", styleTags: ["coquette", "preppy"], formality: "smart_casual", seasons: ["spring", "summer"] },
  { slug: "camel-wool-coat", category: "outerwear", subcategory: "wool coat", primaryColor: "camel", colorHex: "#b28a62", secondaryColors: [], pattern: "solid", material: "wool", fit: "regular", styleTags: ["old money", "minimalist"], formality: "business", seasons: ["fall", "winter"] },
  { slug: "black-combat-boots", category: "footwear", subcategory: "combat boots", primaryColor: "black", colorHex: "#29282c", secondaryColors: [], pattern: "solid", material: "leather", fit: "regular", styleTags: ["grunge", "edgy"], formality: "casual", seasons: ["fall", "winter"] },
  { slug: "rust-knit-scarf", category: "accessory", subcategory: "knit scarf", primaryColor: "rust", colorHex: "#ad6246", secondaryColors: [], pattern: "knit", material: "wool", fit: "relaxed", styleTags: ["bohemian", "cozy"], formality: "casual", seasons: ["fall", "winter"] },
  { slug: "striped-polo", category: "top", subcategory: "striped polo", primaryColor: "navy", colorHex: "#44546b", secondaryColors: ["white"], pattern: "striped", material: "cotton", fit: "regular", styleTags: ["preppy", "smart casual"], formality: "smart_casual", seasons: ["spring", "summer"] },
  { slug: "olive-chinos", category: "bottom", subcategory: "chino trousers", primaryColor: "olive", colorHex: "#727355", secondaryColors: [], pattern: "solid", material: "cotton twill", fit: "regular", styleTags: ["preppy", "old money"], formality: "business", seasons: ["spring", "fall"] },
  { slug: "blue-denim-jacket", category: "outerwear", subcategory: "denim jacket", primaryColor: "blue", colorHex: "#56718b", secondaryColors: [], pattern: "solid", material: "denim", fit: "relaxed", styleTags: ["casual", "streetwear"], formality: "casual", seasons: ["spring", "fall"] },
  { slug: "black-slip-dress", category: "dress", subcategory: "slip dress", primaryColor: "black", colorHex: "#34313a", secondaryColors: [], pattern: "solid", material: "satin", fit: "slim", styleTags: ["minimalist", "evening"], formality: "formal", seasons: ["summer", "fall"] },
  { slug: "tan-loafers", category: "footwear", subcategory: "leather loafers", primaryColor: "tan", colorHex: "#b18a62", secondaryColors: [], pattern: "solid", material: "leather", fit: "regular", styleTags: ["old money", "preppy"], formality: "business", seasons: ["spring", "summer", "fall"] },
  { slug: "silver-hoop-earrings", category: "accessory", subcategory: "hoop earrings", primaryColor: "silver", colorHex: "#a9aeb4", secondaryColors: [], pattern: "solid", material: "metal", fit: "regular", styleTags: ["minimalist", "everyday"], formality: "smart_casual", seasons: ["spring", "summer", "fall", "winter"] },
  { slug: "lavender-cardigan", category: "top", subcategory: "knit cardigan", primaryColor: "lavender", colorHex: "#a59ab9", secondaryColors: [], pattern: "solid", material: "knit", fit: "relaxed", styleTags: ["coquette", "romantic"], formality: "casual", seasons: ["spring", "fall"] },
  { slug: "white-linen-shorts", category: "bottom", subcategory: "linen shorts", primaryColor: "white", colorHex: "#e8e1d5", secondaryColors: [], pattern: "solid", material: "linen", fit: "relaxed", styleTags: ["bohemian", "resort"], formality: "casual", seasons: ["summer"] },
];

const sqlString = (value: string): string => `'${value.replace(/'/g, "''")}'`;
const sqlArray = (values: string[]): string =>
  values.length ? `ARRAY(${values.map(sqlString).join(", ")})` : "CAST(ARRAY() AS ARRAY<STRING>)";
const userId = (userIndex: number): string =>
  `${SEED_VERSION}-user-${String(userIndex + 1).padStart(2, "0")}`;
const imageId = (userIndex: number, itemIndex: number): string =>
  `${SEED_VERSION}-image-${String(userIndex + 1).padStart(2, "0")}-${String(itemIndex + 1).padStart(2, "0")}`;
const itemId = (userIndex: number, itemIndex: number): string =>
  `${SEED_VERSION}-item-${String(userIndex + 1).padStart(2, "0")}-${String(itemIndex + 1).padStart(2, "0")}`;
const samplePath = (sample: SampleItem): string =>
  `${SEED_VOLUME_ROOT}/${sample.slug}.svg`;

function svgForSample(sample: SampleItem): Buffer {
  const label = sample.subcategory.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;",
  })[character]!);
  const shapes: Record<string, string> = {
    top: `<path d="M92 104 135 78h50l43 26-21 45-22-12v125h-50V137l-22 12z" fill="${sample.colorHex}"/>`,
    bottom: `<path d="M112 82h76l-7 87-10 89h-43l-5-81-6 81H74l-2-89-5-87z" fill="${sample.colorHex}"/>`,
    dress: `<path d="M132 78h56l16 48-15 26 35 108H96l35-108-15-26z" fill="${sample.colorHex}"/>`,
    outerwear: `<path d="m99 101 36-23h50l36 23-19 48-19-13v124h-52V136l-19 13z" fill="${sample.colorHex}"/><path d="m135 79 25 36 25-36" fill="none" stroke="#f8f4ee" stroke-width="5"/>`,
    footwear: `<path d="M77 164h64v55q0 14-18 17l-62 1q-15-1-12-13l18-20zM177 164h64v55q0 14-18 17l-62 1q-15-1-12-13l18-20z" fill="${sample.colorHex}"/><path d="M50 222h89m-9 0h91" stroke="#fff" stroke-width="7"/>`,
    accessory: `<path d="M104 121h112l15 119H89z" fill="${sample.colorHex}"/><path d="M129 124v-17q0-34 31-34t31 34v17" fill="none" stroke="${sample.colorHex}" stroke-width="12"/>`,
  };
  const shape = shapes[sample.category] ?? shapes.accessory;
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="320" height="360" viewBox="0 0 320 360"><rect width="320" height="360" rx="20" fill="#f3eee8"/><circle cx="258" cy="58" r="32" fill="#e9ddd3"/><g transform="translate(0 10)">${shape}</g><text x="160" y="306" text-anchor="middle" fill="#453e3d" font-family="Arial,sans-serif" font-size="16">${label}</text><text x="160" y="330" text-anchor="middle" fill="#837876" font-family="Arial,sans-serif" font-size="12">${sample.primaryColor}</text></svg>`,
    "utf8",
  );
}

function buildImageValues(): string {
  const values: string[] = [];
  for (let userIndex = 0; userIndex < USER_COUNT; userIndex++) {
    for (let itemIndex = 0; itemIndex < ITEMS_PER_USER; itemIndex++) {
      const sample = samples[(userIndex * 3 + itemIndex * 2) % samples.length];
      const id = imageId(userIndex, itemIndex);
      const name = `${sample.slug}.svg`;
      const path = samplePath(sample);
      const caption = `Demo sample: ${sample.primaryColor} ${sample.subcategory}.`;
      const tags = JSON.stringify(sample.styleTags);
      values.push(
        `(${sqlString(id)}, ${sqlString(userId(userIndex))}, ${sqlString(name)}, ${sqlString(path)}, 'image/svg+xml', 0, ${sqlString(tags)}, ${sqlString(caption)}, 'tagged', current_timestamp(), current_timestamp())`,
      );
    }
  }
  return values.join(",\n");
}

function buildItemValues(): string {
  const values: string[] = [];
  for (let userIndex = 0; userIndex < USER_COUNT; userIndex++) {
    for (let itemIndex = 0; itemIndex < ITEMS_PER_USER; itemIndex++) {
      const sample = samples[(userIndex * 3 + itemIndex * 2) % samples.length];
      values.push(
        `(${sqlString(itemId(userIndex, itemIndex))}, ${sqlString(imageId(userIndex, itemIndex))}, ${sqlString(userId(userIndex))}, ${sqlString(sample.category)}, ${sqlString(sample.subcategory)}, ${sqlString(sample.primaryColor)}, ${sqlArray(sample.secondaryColors)}, ${sqlString(sample.pattern)}, ${sqlString(sample.material)}, ${sqlString(sample.fit)}, ${sqlArray(sample.styleTags)}, ${sqlString(sample.formality)}, ${sqlArray(sample.seasons)}, current_timestamp())`,
      );
    }
  }
  return values.join(",\n");
}

async function seed(): Promise<void> {
  const usedSamples = new Map(samples.map((sample) => [sample.slug, sample]));
  for (const sample of usedSamples.values()) {
    await putFileBytes(samplePath(sample), svgForSample(sample));
  }

  await runSql(
    `MERGE INTO ${IMAGE_TABLE} AS target
     USING (VALUES ${buildImageValues()}) AS source
       (image_id, user_id, file_name, file_path, mime_type, size_bytes, tags, caption, status, uploaded_at, tagged_at)
     ON target.image_id = source.image_id AND target.user_id = source.user_id
     WHEN MATCHED THEN UPDATE SET
       file_name = source.file_name, file_path = source.file_path,
       mime_type = source.mime_type, size_bytes = source.size_bytes,
       tags = source.tags, caption = source.caption, status = source.status,
       tagged_at = current_timestamp()
     WHEN NOT MATCHED THEN INSERT
       (image_id, user_id, file_name, file_path, mime_type, size_bytes, tags, caption, status, uploaded_at, tagged_at)
       VALUES (source.image_id, source.user_id, source.file_name, source.file_path,
               source.mime_type, source.size_bytes, source.tags, source.caption,
               source.status, current_timestamp(), current_timestamp())`,
    {},
  );

  await runSql(
    `MERGE INTO ${ITEMS_TABLE} AS target
     USING (VALUES ${buildItemValues()}) AS source
       (clothing_item_id, image_id, user_id, category, subcategory, primary_color, secondary_colors, pattern, material, fit, style_tags, formality, season, created_at)
     ON target.clothing_item_id = source.clothing_item_id
     WHEN MATCHED THEN UPDATE SET
       image_id = source.image_id, user_id = source.user_id,
       category = source.category, subcategory = source.subcategory,
       primary_color = source.primary_color, secondary_colors = source.secondary_colors,
       pattern = source.pattern, material = source.material, fit = source.fit,
       style_tags = source.style_tags, formality = source.formality, season = source.season
     WHEN NOT MATCHED THEN INSERT
       (clothing_item_id, image_id, user_id, category, subcategory, primary_color, secondary_colors, pattern, material, fit, style_tags, formality, season, created_at)
       VALUES (source.clothing_item_id, source.image_id, source.user_id, source.category,
               source.subcategory, source.primary_color, source.secondary_colors,
               source.pattern, source.material, source.fit, source.style_tags,
               source.formality, source.season, current_timestamp())`,
    {},
  );
}

async function removeSeed(): Promise<void> {
  const userIds = Array.from({ length: USER_COUNT }, (_, index) => sqlString(userId(index))).join(", ");
  await runSql(`DELETE FROM ${ITEMS_TABLE} WHERE user_id IN (${userIds})`, {});
  await runSql(`DELETE FROM ${IMAGE_TABLE} WHERE user_id IN (${userIds})`, {});
  for (const sample of samples) {
    await runSql(
      `DELETE FROM ${IMAGE_TABLE} WHERE file_path = ${sqlString(samplePath(sample))}`,
      {},
    );
    const encodedPath = samplePath(sample).split("/").map(encodeURIComponent).join("/");
    const host = process.env.DATABRICKS_HOST?.replace(/\/+$/, "");
    const token = process.env.DATABRICKS_TOKEN;
    if (!host || !token) throw new Error("Missing DATABRICKS_HOST or DATABRICKS_TOKEN");
    const response = await fetch(`${host}/api/2.0/fs/files${encodedPath}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!response.ok && response.status !== 404) {
      throw new Error(`Could not remove sample image ${sample.slug}: HTTP ${response.status} ${await response.text()}`);
    }
  }
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const doRemove = args.has("--remove");
  const doApply = args.has("--apply");
  if (doRemove && doApply) throw new Error("Choose either --apply or --remove, not both.");
  if (!doApply && !doRemove) {
    console.log(`Dry run: this will create ${USER_COUNT * ITEMS_PER_USER} tagged items across ${USER_COUNT} synthetic demo users.`);
    console.log("Run with --apply to write demo data, or --remove to remove only this seed version.");
    return;
  }
  if (process.env.SEED_ANALYTICS_CONFIRM !== "YES") {
    throw new Error("Set SEED_ANALYTICS_CONFIRM=YES to confirm you intend to change the configured Databricks workspace.");
  }

  if (doRemove) {
    await removeSeed();
    console.log(`Removed demo seed ${SEED_VERSION}.`);
    return;
  }
  await seed();
  console.log(`Seeded ${USER_COUNT * ITEMS_PER_USER} tagged demo items across ${USER_COUNT} synthetic users.`);
  console.log(`Seed version: ${SEED_VERSION}. Remove it later with --remove.`);
}

main().catch((error: unknown) => {
  console.error("Analytics seed failed:", error);
  process.exitCode = 1;
});
