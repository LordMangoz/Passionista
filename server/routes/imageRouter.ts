import { Router, Request, Response, NextFunction } from "express";
import multer from "multer";
import crypto from "node:crypto";

// ---------- Config (values read at first use to dodge the ESM lazy-env trap) ----------
/** Read a required environment variable or fail with its name. */
const env = (k: string): string => {
  const v = process.env[k];
  if (!v) throw new Error(`Missing env var ${k}`);
  return v;
};
/** Return the Databricks host without a trailing slash. */
const DB_HOST = () => env("DATABRICKS_HOST").replace(/\/$/, "");
/** Return the Databricks access token. */
const DB_TOKEN = () => env("DATABRICKS_TOKEN");
/** Return the SQL warehouse ID. */
const DB_WAREHOUSE = () => env("DATABRICKS_WAREHOUSE_ID");
/** Return the Gemini API key. */
const GEMINI_KEY = () => env("GEMINI_API_KEY");

const IMAGES_TABLE = "workspace.image_project.images";
const ITEMS_TABLE = "workspace.image_project.clothing_items";
const OUTFITS_TABLE = "workspace.image_project.outfits";
const VOLUME_IMAGES_ROOT = "/Volumes/workspace/image_project/image_files/images";

// Gemini: primary + fallback (flash models get transient 503 congestion — retry then fall back)
const GEMINI_MODELS = ["gemini-flash-latest", "gemini-flash-lite-latest"];

// ---------- Small helpers ----------
/** Error type for HTTP responses with a specific status code. */
class HttpError extends Error {
  constructor(public status: number, msg: string) {
    super(msg);
  }
}
/** Pause between retries or while polling a request. */
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Pull the Auth0 user id. Adjust if your middleware stores it elsewhere. */
function getUserId(req: Request): string {
  const sub = req.auth?.payload.sub;
  if (typeof sub !== "string") throw new HttpError(401, "Not authenticated");
  return sub;
}

// ---------- Databricks: SQL Statements API ----------

type Param = { name: string; value: string | number; type?: "STRING" | "INT" };

/** Run parameterized SQL and return its result rows. */
async function runStatement(statement: string, params: Param[] = []): Promise<(string | null)[][]> {
  // Submit the statement to the configured SQL warehouse.
  const post = async () =>
    fetch(`${DB_HOST()}/api/2.0/sql/statements`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${DB_TOKEN()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        warehouse_id: DB_WAREHOUSE(),
        statement,
        wait_timeout: "30s", // waits server-side up to 30s; we poll if it's still running
        parameters: params.map((p) => ({
          name: p.name,
          value: String(p.value),
          type: p.type ?? "STRING",
        })),
      }),
    });

  let res = await post();
  let st: any = await res.json();
  if (!res.ok) throw new Error(`Statements API ${res.status}: ${st.message ?? JSON.stringify(st)}`);

  // status is nested: status.state (NOT top-level state) — poll while PENDING/RUNNING
  let guard = 0;
  while (["PENDING", "RUNNING"].includes(st?.status?.state) && guard++ < 60) {
    await sleep(1000);
    const r = await fetch(`${DB_HOST()}/api/2.0/sql/statements/${st.statement_id}`, {
      headers: { Authorization: `Bearer ${DB_TOKEN()}` },
    });
    if (!r.ok) {
        throw new Error(`Statements API polling failed (${r.status}): ${await r.text()}`);
    }

    st = await r.json();
  }
  if (st?.status?.state !== "SUCCEEDED") {
    throw new Error(`SQL failed (${st?.status?.state}): ${st?.status?.error?.message ?? "unknown"}`);
  }
  return st?.result?.data_array ?? [];
}

let outfitsTablePromise: Promise<void> | null = null;

/** Create the outfits table on first use so existing workspaces need no manual migration. */
async function ensureOutfitsTable(): Promise<void> {
  if (!outfitsTablePromise) {
    outfitsTablePromise = runStatement(`
      CREATE TABLE IF NOT EXISTS ${OUTFITS_TABLE} (
        outfit_id STRING,
        user_id STRING,
        name STRING,
        source_image_id STRING,
        clothing_item_ids ARRAY<STRING>,
        created_at TIMESTAMP
      ) USING DELTA
    `).then(() => undefined).catch((error: unknown) => {
      outfitsTablePromise = null;
      throw error;
    });
  }
  await outfitsTablePromise;
}

// ---------- Databricks: volume file I/O (workspace Files API) ----------


/** Upload image bytes to a Databricks volume path. */
async function putVolumeFile(path: string, bytes: Buffer, mime: string): Promise<void> {
    const res = await fetch(`${DB_HOST()}/api/2.0/fs/files${encodeURI(path)}`, {
        method: "PUT",
        headers: {
            Authorization: `Bearer ${DB_TOKEN()}`,
            "Content-Type": mime,
        },
        body: new Uint8Array(bytes),
    });

    if (!res.ok) throw new Error(`Files API PUT ${res.status}: ${await res.text()}`);
}
/** Download image bytes from a Databricks volume path. */
async function getVolumeFile(path: string): Promise<Buffer> {
  const res = await fetch(`${DB_HOST()}/api/2.0/fs/files${encodeURI(path)}`, {
    headers: { Authorization: `Bearer ${DB_TOKEN()}` },
  });
  if (!res.ok) throw new Error(`Files API GET ${res.status}: ${await res.text()}`);
  return Buffer.from(await res.arrayBuffer());
}

// ---------- The four statements (mirror of the notebook's Item ingest cell) ----------

const IMAGE_INSERT = `
INSERT INTO ${IMAGES_TABLE}
(image_id, user_id, file_name, file_path, mime_type, size_bytes, tags, caption, status, uploaded_at, tagged_at)
VALUES (:image_id, :user_id, :file_name, :file_path, :mime_type, :size_bytes, NULL, NULL, 'uploaded', current_timestamp(), NULL)`;

const ITEMS_INGEST = `
MERGE INTO ${ITEMS_TABLE} AS target
USING (
    SELECT
        sha2(concat(:image_id, ':', cast(pos AS STRING)), 256) AS clothing_item_id,
        it.category,
        it.subcategory,
        it.primary_color,
        it.secondary_colors,
        it.pattern,
        it.material,
        it.fit,
        it.style_tags,
        it.formality,
        it.season
    FROM posexplode(from_json(:items_json,
        'array<struct<
            category:string,
            subcategory:string,
            primary_color:string,
            secondary_colors:array<string>,
            pattern:string,
            material:string,
            fit:string,
            style_tags:array<string>,
            formality:string,
            season:array<string>
        >>'
    )) AS (pos, it)
) AS source
ON target.clothing_item_id = source.clothing_item_id
WHEN MATCHED THEN UPDATE SET
    target.category = source.category,
    target.subcategory = source.subcategory,
    target.primary_color = source.primary_color,
    target.secondary_colors = source.secondary_colors,
    target.pattern = source.pattern,
    target.material = source.material,
    target.fit = source.fit,
    target.style_tags = source.style_tags,
    target.formality = source.formality,
    target.season = source.season
WHEN NOT MATCHED THEN INSERT (
    clothing_item_id, image_id, user_id, category, subcategory, primary_color,
    secondary_colors, pattern, material, fit, style_tags, formality, season, created_at
) VALUES (
    source.clothing_item_id, :image_id, :user_id, source.category, source.subcategory,
    source.primary_color, source.secondary_colors, source.pattern, source.material,
    source.fit, source.style_tags, source.formality, source.season, current_timestamp()
)
WHEN NOT MATCHED BY SOURCE
    AND target.image_id = :image_id
    AND target.user_id = :user_id
THEN DELETE`;

const IMAGE_TAGGED = `
UPDATE ${IMAGES_TABLE}
SET status = 'tagged', caption = :caption, analysis_json = :items_json,
    tagged_at = current_timestamp()
WHERE image_id = :image_id AND user_id = :user_id`;

const IMAGE_FAILED = `
UPDATE ${IMAGES_TABLE}
SET status = 'failed'
WHERE image_id = :image_id AND user_id = :user_id`;

const IMAGE_PROCESSING = `
UPDATE ${IMAGES_TABLE}
SET status = 'processing'
WHERE image_id = :image_id AND user_id = :user_id`;

// ---------- Gemini ----------

/** Ask Gemini to identify clothing items and describe the image. */
const GEMINI_PROMPT = `You are a fashion cataloging assistant. Analyze the attached photo.
Return ONLY a JSON object (no markdown fences) shaped exactly like:
{
  "caption": "one-sentence description of the outfit or photo",
  "items": [
    {
      "category": "top|bottom|dress|outerwear|footwear|accessory",
      "subcategory": "e.g. t-shirt, jeans, sneakers",
      "primary_color": "e.g. blue",
      "secondary_colors": ["..."] or [],
      "pattern": "solid|striped|plaid|floral|graphic|other",
      "material": "e.g. cotton, denim",
      "fit": "slim|regular|relaxed|oversized",
      "style_tags": ["streetwear", "minimalist", ...],
      "formality": "very_casual|casual|smart_casual|business|formal",
      "season": ["spring", "summer", "fall", "winter"]
    }
  ]
}
List EVERY distinct clothing item visible in the photo (an image may contain several).`;

const STRING_FIELDS = ["category", "subcategory", "primary_color", "pattern", "material", "fit", "formality"] as const;
const ARRAY_FIELDS = ["secondary_colors", "style_tags", "season"] as const;
const FORMALITY_VALUES = ["very_casual", "casual", "smart_casual", "business", "formal"];

/** Send an image to Gemini and parse its clothing analysis, retrying on transient errors. */
async function analyzeWithGemini(
  base64: string,
  mime: string
): Promise<{ caption: string; items: Record<string, unknown>[]; raw: string }> {
  let lastErr: unknown;
  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: GEMINI_PROMPT },
                    { inline_data: { mime_type: mime, data: base64 } },
                  ],
                },
              ],
              generationConfig: { responseMimeType: "application/json", temperature: 0.2 },
            }),
            signal: AbortSignal.timeout(30_000),
          }
        );
        // Google flash models throw transient 503s under congestion — back off and retry
        if (res.status === 503 || res.status === 429) {
          await sleep(1200 * attempt);
          continue;
        }
        if (!res.ok) throw new Error(`Gemini ${model} HTTP ${res.status}: ${await res.text()}`);

        const data: any = await res.json();
        const raw: string = (data.candidates?.[0]?.content?.parts ?? [])
          .map((p: any) => p.text ?? "")
          .join("");
        const parsed = JSON.parse(raw);
        if (!parsed?.caption || !Array.isArray(parsed?.items) || parsed.items.length === 0) {
          throw new Error("Gemini response missing caption or items");
        }
        return { caption: String(parsed.caption), items: parsed.items, raw };
      } catch (e) {
        lastErr = e;
      }
    }
  }
  throw lastErr instanceof Error ? lastErr : new Error("Gemini failed after all retries/fallbacks");
}

/** Validate + normalize Gemini items into exactly the columns ITEMS_INGEST expects. */
function validateItems(items: any[]): string {
  const clean = items.map((it) => {
    const row: Record<string, unknown> = {};
    for (const f of STRING_FIELDS) {
      const v = it?.[f];
      row[f] = typeof v === "string" && v.trim() ? v.trim() : "unknown";
    }
    row.formality = FORMALITY_VALUES.includes(row.formality as string) ? row.formality : "casual";
    for (const f of ARRAY_FIELDS) {
      const v = it?.[f];
      row[f] = Array.isArray(v) ? v.map((x) => String(x)) : [];
    }
    return row;
  });
  if (clean.length === 0) throw new Error("No valid clothing items to store");
  return JSON.stringify(clean);
}

// ---------- Background tagging pipeline ----------

/** Analyze an uploaded image, save its clothing items, and update its processing status. */
async function tagImageInBackground(
  user_id: string,
  image_id: string,
  base64: string,
  mime: string
): Promise<void> {
  try {

    await runStatement(IMAGE_PROCESSING, [
    { name: "image_id", value: image_id },
    { name: "user_id", value: user_id },
    ]);
    
    const { caption, items, raw } = await analyzeWithGemini(base64, mime);
    const itemsJson = validateItems(items);

    await runStatement(ITEMS_INGEST, [
      { name: "image_id", value: image_id },
      { name: "user_id", value: user_id },
      { name: "items_json", value: itemsJson },
    ]);

    await runStatement(IMAGE_TAGGED, [
    { name: "image_id", value: image_id },
    { name: "user_id", value: user_id },
    { name: "caption", value: caption },
    { name: "items_json", value: raw },
    ]);

    console.log(`[tag] image ${image_id} -> tagged (${items.length} item(s))`);
  } catch (e) {
    console.error(`[tag] image ${image_id} failed:`, e);
    try {
    await runStatement(IMAGE_FAILED, [
        { name: "image_id", value: image_id },
        { name: "user_id", value: user_id },
    ]);
    } catch (markErr) {
      console.error(`[tag] could not mark ${image_id} failed:`, markErr);
    }
  }
}

// ---------- Routes ----------

// actual upload handling to server.
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
  // Reject files that are not supported image types.
  fileFilter: (_req, file, callback) => {
    const allowedTypes = ["image/jpeg", "image/png", "image/webp"];

    if (!allowedTypes.includes(file.mimetype)) {
      callback(new HttpError(400, "Unsupported image type"));
      return;
    }

    callback(null, true);
  },
});

export const imageRouter = Router();

/** POST /api/images — multipart field "image". Stores + registers; tags in background. */
imageRouter.post("/images", upload.single("image"), async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    if (!req.file) throw new HttpError(400, "multipart field 'image' is required");

    const image_id = crypto.randomUUID();
    const safe_name = req.file.originalname
  .split(/[\\/]/)
  .pop()!
  .replace(/[^a-zA-Z0-9._-]/g, "_");
    const file_path = `${VOLUME_IMAGES_ROOT}/${user_id}/${image_id}_${safe_name}`;

    // 1. Bytes -> volume
    await putVolumeFile(file_path, req.file.buffer, req.file.mimetype);

    // 2. Metadata row (status='uploaded')
    await runStatement(IMAGE_INSERT, [
      { name: "image_id", value: image_id },
      { name: "user_id", value: user_id },
      { name: "file_name", value: req.file.originalname },
      { name: "file_path", value: file_path },
      { name: "mime_type", value: req.file.mimetype },
      { name: "size_bytes", value: req.file.size, type: "INT" },
    ]);

    // 3. Kick off background Gemini tagging — response returns immediately
    void tagImageInBackground(user_id, image_id, req.file.buffer.toString("base64"), req.file.mimetype);

    res.status(202).json({ image_id, status: "uploaded" });
  } catch (e) {
    next(e);
  }
});


// answer questions for sytlist in a easy way.
async function answerStylistQuestion(
  base64: string,
  mime: string,
  prompt: string,
  structured = false
): Promise<string> {
  let lastErr: unknown;

  for (const model of GEMINI_MODELS) {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const res = await fetch(
          `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${GEMINI_KEY()}`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              contents: [
                {
                  parts: [
                    { text: prompt },
                    { inline_data: { mime_type: mime, data: base64 } }
                  ]
                }
              ],
              generationConfig: structured
                ? { responseMimeType: "application/json", temperature: 0.4 }
                : { temperature: 0.4 }
            }),
            signal: AbortSignal.timeout(30_000)
          }
        );

        if (res.status === 503 || res.status === 429) {
          await sleep(1200 * attempt);
          continue;
        }

        if (!res.ok) {
          throw new Error(`Gemini ${model} HTTP ${res.status}: ${await res.text()}`);
        }

        const data: any = await res.json();

        const answer = (data.candidates?.[0]?.content?.parts ?? [])
          .map((p: any) => p.text ?? "")
          .join("");

        if (!answer.trim()) {
          throw new Error("Gemini returned an empty answer");
        }

        return answer;
      } catch (e) {
        lastErr = e;
      }
    }
  }

  throw lastErr instanceof Error
    ? lastErr
    : new Error("Gemini failed after all retries/fallbacks");
}


// answer for specfic question.
// POST /api/images/:id/ask — ask Gemini a question about an uploaded image.
imageRouter.post("/images/:id/ask", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const image_id = req.params.id;
    if (typeof image_id !== "string") throw new HttpError(400, "Invalid image ID");
    const questionID = req.body.questionID;

    // Select the appropriate prompt.
    const prompts: Record<string, string> = {
      identify: "Identify the clothing items in this image. Describe their appearance, colors, materials, and style.",

      "my-style": "Evaluate whether the clothing in this image fits the user's personal style. Use their existing wardrobe as context. Explain why it does or does not fit.",

      "wardrobe-match": "Choose the best matching items from the user's wardrobe for an outfit with the clothing in this image. Explain briefly why the combination works.",

      "outfit-ideas": "Suggest several outfits incorporating the clothing shown in this image. Explain how to style the item, including suitable colors, clothing, and accessories."
    };

    const prompt = prompts[questionID];

    if (!prompt) {
      throw new HttpError(400, "Invalid question ID");
    }

    // Retrieve the image, ensuring it belongs to the authenticated user.
    const imageRows = await runStatement(
      `SELECT file_path, mime_type
       FROM ${IMAGES_TABLE}
       WHERE image_id = :image_id AND user_id = :user_id`,
      [
        { name: "image_id", value: image_id },
        { name: "user_id", value: user_id }
      ]
    );

    if (!imageRows.length) {
      throw new HttpError(404, "Image not found");
    }

    // Download image bytes from Databricks.
    const bytes = await getVolumeFile(String(imageRows[0][0]));
    const mime = String(imageRows[0][1]);
    const base64 = bytes.toString("base64");

    // Retrieve wardrobe context for questions that need personal style information.
    let wardrobeContext = "";
    let wardrobeItems: {
      clothing_item_id: string;
      image_id: string;
      category: string;
      subcategory: string;
      primary_color: string;
      style_tags: string;
    }[] = [];

    if (questionID === "wardrobe-match") {
      const wardrobeRows = await runStatement(
        `SELECT item.clothing_item_id, item.image_id, item.category, item.subcategory,
                item.primary_color, item.style_tags
         FROM ${ITEMS_TABLE} AS item
         INNER JOIN ${IMAGES_TABLE} AS source
           ON item.image_id = source.image_id AND item.user_id = source.user_id
         WHERE item.user_id = :user_id
           AND item.image_id <> :image_id
           AND source.status = 'tagged'
         ORDER BY item.created_at DESC
         LIMIT 100`,
        [
          { name: "user_id", value: user_id },
          { name: "image_id", value: image_id },
        ]
      );

      wardrobeItems = wardrobeRows.map((row) => ({
        clothing_item_id: String(row[0]),
        image_id: String(row[1]),
        category: String(row[2] ?? ""),
        subcategory: String(row[3] ?? ""),
        primary_color: String(row[4] ?? ""),
        style_tags: String(row[5] ?? ""),
      }));

      if (wardrobeItems.length === 0) {
        res.json({
          answer: "Your wardrobe does not have any other tagged items to compare yet.",
          matches: [],
        });
        return;
      }

      wardrobeContext = `
        Select matches only from this user's wardrobe catalog. Never invent an item or ID.
        Choose up to 6 pieces that make a cohesive outfit with the uploaded item.
        Return pieces in visual top-to-bottom order: tops or dresses, outerwear, bottoms,
        socks, shoes, then other accessories. In particular, put socks before shoes.
        Wardrobe catalog:
        ${JSON.stringify(wardrobeItems)}

        Return only JSON in this exact shape:
        {"answer":"brief outfit advice","matches":[{"clothing_item_id":"exact catalog ID","reason":"brief reason"}]}
        Use an empty matches array when no catalog pieces work.
      `;
    } else if (questionID === "my-style" || questionID === "outfit-ideas") {
      const wardrobeRows = await runStatement(
        `SELECT category, subcategory, primary_color, style_tags, formality, season
         FROM ${ITEMS_TABLE}
         WHERE user_id = :user_id
         ORDER BY created_at DESC`,
        [{ name: "user_id", value: user_id }]
      );

      const wardrobe = wardrobeRows.map((r) => ({
        category: r[0],
        subcategory: r[1],
        primary_color: r[2],
        style_tags: r[3],
        formality: r[4],
        season: r[5]
      }));

      wardrobeContext = `
        The user's existing wardrobe:
        ${JSON.stringify(wardrobe)}

        Use this information as context. Do not invent clothing items
        that are not present in the wardrobe.
      `;
    }

    // Ask Gemini about the image.
    const answer = await answerStylistQuestion(
      base64,
      mime,
      `${prompt}\n\n${wardrobeContext}`,
      questionID === "wardrobe-match"
    );

    if (questionID === "wardrobe-match") {
      let recommendation: unknown;
      try {
        recommendation = JSON.parse(answer);
      } catch {
        throw new HttpError(502, "The stylist returned an invalid outfit recommendation. Please try again.");
      }

      if (
        !recommendation ||
        typeof recommendation !== "object" ||
        !("answer" in recommendation) ||
        typeof recommendation.answer !== "string" ||
        !("matches" in recommendation) ||
        !Array.isArray(recommendation.matches)
      ) {
        throw new HttpError(502, "The stylist returned an invalid outfit recommendation. Please try again.");
      }

      const wardrobeById = new Map(wardrobeItems.map((item) => [item.clothing_item_id, item]));
      const seen = new Set<string>();
      const matches = recommendation.matches.flatMap((entry) => {
        if (
          !entry ||
          typeof entry !== "object" ||
          !("clothing_item_id" in entry) ||
          typeof entry.clothing_item_id !== "string" ||
          seen.has(entry.clothing_item_id)
        ) return [];

        const item = wardrobeById.get(entry.clothing_item_id);
        if (!item) return [];
        seen.add(item.clothing_item_id);
        const name = [item.subcategory || item.category, item.primary_color]
          .filter(Boolean)
          .join(" · ");

        return [{
          ...item,
          name: name || "Wardrobe item",
          reason: "reason" in entry && typeof entry.reason === "string" ? entry.reason : "",
        }];
      }).slice(0, 6);

      res.json({ answer: recommendation.answer, matches });
      return;
    }

    res.json({ answer });
  } catch (error) {
    next(error);
  }
});

/** GET /api/images — this user's uploads, newest first. */
imageRouter.get("/images", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const rows = await runStatement(
      `SELECT image_id, file_name, file_path, mime_type, size_bytes, caption, status, uploaded_at, tagged_at
       FROM ${IMAGES_TABLE}
       WHERE user_id = :user_id
       ORDER BY uploaded_at DESC`,
      [{ name: "user_id", value: user_id }]
    );
    res.json(
      rows.map((r) => ({
        image_id: r[0],
        file_name: r[1],
        file_path: r[2],
        mime_type: r[3],
        size_bytes: Number(r[4] ?? 0),
        caption: r[5],
        status: r[6],
        uploaded_at: r[7],
        tagged_at: r[8],
      }))
    );
  } catch (e) {
    next(e);
  }
});

/** GET /api/images/:id/file — stream the stored bytes back (for your React gallery). */
imageRouter.get("/images/:id/file", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const image_id = req.params.id;
    if (typeof image_id !== "string") throw new HttpError(400, "Invalid image ID");

    const rows = await runStatement(
      `SELECT file_path, mime_type FROM ${IMAGES_TABLE}
       WHERE image_id = :image_id AND user_id = :user_id`,
      [
        { name: "image_id", value: image_id },
        { name: "user_id", value: user_id },
      ]
    );
    if (!rows.length) throw new HttpError(404, "Image not found");

    const bytes = await getVolumeFile(String(rows[0][0]));

    res.setHeader("Content-Type", String(rows[0][1] ?? "image/jpeg"));
    res.send(bytes);
  } catch (e) {
    next(e);
  }
});

/** GET /api/wardrobe — this user's typed clothing items. */
imageRouter.get("/wardrobe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const rows = await runStatement(
      `SELECT item.clothing_item_id, item.image_id, item.category, item.subcategory,
              item.primary_color, item.secondary_colors, item.pattern, item.material,
              item.fit, item.style_tags, item.formality, item.season, item.created_at
       FROM ${ITEMS_TABLE} AS item
       INNER JOIN ${IMAGES_TABLE} AS source
         ON item.image_id = source.image_id AND item.user_id = source.user_id
       WHERE item.user_id = :user_id AND source.status = 'tagged'
       ORDER BY item.created_at DESC`,
      [{ name: "user_id", value: user_id }]
    );
    res.json(
      rows.map((r) => ({
        clothing_item_id: r[0],
        image_id: r[1],
        category: r[2] ?? "",
        subcategory: r[3] ?? "",
        primary_color: r[4] ?? "",
        secondary_colors: r[5] ? JSON.parse(String(r[5])) : [],
        pattern: r[6] ?? "",
        material: r[7] ?? "",
        fit: r[8] ?? "",
        style_tags: r[9] ? JSON.parse(String(r[9])) : [],
        formality: r[10] ?? "",
        season: r[11] ? JSON.parse(String(r[11])) : [],
        created_at: r[12] ?? "",
      }))
    );
  } catch (e) {
    next(e);
  }
});

/** DELETE /api/wardrobe — delete selected clothing rows and clean saved outfit references. */
imageRouter.delete("/wardrobe", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const body = req.body as { item_ids?: unknown };
    if (
      !Array.isArray(body?.item_ids) ||
      body.item_ids.length === 0 ||
      body.item_ids.length > 100 ||
      !body.item_ids.every((id) => typeof id === "string" && id.length > 0 && id.length <= 128)
    ) {
      throw new HttpError(400, "Provide between 1 and 100 valid clothing item IDs");
    }

    const itemIds = [...new Set(body.item_ids as string[])];
    if (itemIds.length !== body.item_ids.length) {
      throw new HttpError(400, "Clothing item IDs must be unique");
    }

    const itemIdsJson = JSON.stringify(itemIds);
    const ownedItems = await runStatement(
      `SELECT COUNT(DISTINCT clothing_item_id)
       FROM ${ITEMS_TABLE}
       WHERE user_id = :user_id
         AND array_contains(from_json(:item_ids_json, 'array<string>'), clothing_item_id)`,
      [
        { name: "user_id", value: user_id },
        { name: "item_ids_json", value: itemIdsJson },
      ]
    );
    if (Number(ownedItems[0]?.[0] ?? 0) !== itemIds.length) {
      throw new HttpError(404, "One or more clothing items were not found");
    }

    await runStatement(
      `DELETE FROM ${ITEMS_TABLE}
       WHERE user_id = :user_id
         AND array_contains(from_json(:item_ids_json, 'array<string>'), clothing_item_id)`,
      [
        { name: "user_id", value: user_id },
        { name: "item_ids_json", value: itemIdsJson },
      ]
    );

    await ensureOutfitsTable();
    await runStatement(
      `UPDATE ${OUTFITS_TABLE}
       SET clothing_item_ids = array_except(
         COALESCE(clothing_item_ids, CAST(ARRAY() AS ARRAY<STRING>)),
         from_json(:item_ids_json, 'array<string>')
       )
       WHERE user_id = :user_id
         AND array_size(clothing_item_ids) > 0
         AND array_size(array_intersect(
           clothing_item_ids,
           from_json(:item_ids_json, 'array<string>')
         )) > 0`,
      [
        { name: "user_id", value: user_id },
        { name: "item_ids_json", value: itemIdsJson },
      ]
    );
    await runStatement(
      `DELETE FROM ${OUTFITS_TABLE}
       WHERE user_id = :user_id
         AND source_image_id IS NULL
         AND array_size(COALESCE(clothing_item_ids, CAST(ARRAY() AS ARRAY<STRING>))) = 0`,
      [{ name: "user_id", value: user_id }]
    );

    res.json({ deleted_item_ids: itemIds });
  } catch (e) {
    next(e);
  }
});

/** PATCH /api/wardrobe/:itemId/tags — add or remove a style tag on an owned item. */
imageRouter.patch("/wardrobe/:itemId/tags", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const item_id = req.params.itemId;
    if (typeof item_id !== "string") throw new HttpError(400, "Invalid clothing item ID");

    const { action, tag: rawTag } = req.body as { action?: unknown; tag?: unknown };
    if (action !== "add" && action !== "remove") {
      throw new HttpError(400, "Tag action must be 'add' or 'remove'");
    }
    if (typeof rawTag !== "string") throw new HttpError(400, "A tag is required");

    const tag = rawTag.trim();
    if (!tag || tag.length > 40) {
      throw new HttpError(400, "Tags must be between 1 and 40 characters");
    }

    const tagUpdate = action === "add"
      ? `array_union(COALESCE(style_tags, CAST(ARRAY() AS ARRAY<STRING>)), ARRAY(:tag))`
      : `array_except(COALESCE(style_tags, CAST(ARRAY() AS ARRAY<STRING>)), ARRAY(:tag))`;

    await runStatement(
      `UPDATE ${ITEMS_TABLE}
       SET style_tags = ${tagUpdate}
       WHERE clothing_item_id = :item_id AND user_id = :user_id`,
      [
        { name: "tag", value: tag },
        { name: "item_id", value: item_id },
        { name: "user_id", value: user_id },
      ]
    );

    const rows = await runStatement(
      `SELECT style_tags FROM ${ITEMS_TABLE}
       WHERE clothing_item_id = :item_id AND user_id = :user_id`,
      [
        { name: "item_id", value: item_id },
        { name: "user_id", value: user_id },
      ]
    );
    if (!rows.length) throw new HttpError(404, "Clothing item not found");

    res.json({
      style_tags: rows[0][0] ? JSON.parse(String(rows[0][0])) as string[] : [],
    });
  } catch (e) {
    next(e);
  }
});

/** POST /api/images/:id/retry — re-run background tagging for a failed image. */
imageRouter.post("/images/:id/retry", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const image_id = req.params.id;
    if (typeof image_id !== "string") throw new HttpError(400, "Invalid image ID");

    const rows = await runStatement(
      `SELECT file_path, mime_type, status FROM ${IMAGES_TABLE}
       WHERE image_id = :image_id AND user_id = :user_id`,
      [
        { name: "image_id", value: image_id },
        { name: "user_id", value: user_id },
      ]
    );
    if (!rows.length) throw new HttpError(404, "Image not found");
    if (rows[0][2] !== "failed") {
        throw new HttpError(409, "Only failed images can be retried");
    }
    const bytes = await getVolumeFile(String(rows[0][0]));
    void tagImageInBackground(user_id, image_id, bytes.toString("base64"), String(rows[0][1]));

    res.status(202).json({ image_id, status: "retrying" });
  } catch (e) {
    next(e);
  }
});

/** GET /api/outfits — list this user's saved outfits. */
imageRouter.get("/outfits", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    await ensureOutfitsTable();
    const rows = await runStatement(
      `SELECT outfit_id, name, source_image_id, to_json(clothing_item_ids), created_at
       FROM ${OUTFITS_TABLE}
       WHERE user_id = :user_id
       ORDER BY created_at DESC`,
      [{ name: "user_id", value: user_id }]
    );

    res.json(rows.map((row) => {
      const itemIds = row[3] ? JSON.parse(String(row[3])) as unknown : [];
      if (!Array.isArray(itemIds) || !itemIds.every((id) => typeof id === "string")) {
        throw new Error("Databricks returned an invalid outfit item list.");
      }
      return {
        outfit_id: String(row[0]),
        name: String(row[1] ?? "Saved outfit"),
        source_image_id: row[2] ? String(row[2]) : null,
        clothing_item_ids: itemIds,
        created_at: String(row[4] ?? ""),
      };
    }));
  } catch (e) {
    next(e);
  }
});

/** POST /api/outfits — save an outfit made from this user's clothing items and/or source image. */
imageRouter.post("/outfits", async (req: Request, res: Response, next: NextFunction) => {
  try {
    const user_id = getUserId(req);
    const body = req.body as {
      name?: unknown;
      source_image_id?: unknown;
      clothing_item_ids?: unknown;
    };
    if (body?.name !== undefined && typeof body.name !== "string") {
      throw new HttpError(400, "Outfit name must be text");
    }
    if (body?.source_image_id !== undefined && typeof body.source_image_id !== "string") {
      throw new HttpError(400, "Invalid source image ID");
    }
    const itemIds = Array.isArray(body?.clothing_item_ids)
      ? [...new Set(body.clothing_item_ids.filter(
          (id): id is string => typeof id === "string" && id.length > 0 && id.length <= 128
        ))]
      : [];
    if (
      !Array.isArray(body?.clothing_item_ids) ||
      itemIds.length !== body.clothing_item_ids.length ||
      itemIds.length > 20
    ) {
      throw new HttpError(400, "Choose up to 20 valid wardrobe items");
    }

    const source_image_id = typeof body.source_image_id === "string"
      ? body.source_image_id.trim()
      : "";
    if (source_image_id.length > 128) {
      throw new HttpError(400, "Invalid source image ID");
    }
    if (itemIds.length === 0 && !source_image_id) {
      throw new HttpError(400, "An outfit must include at least one item or image");
    }

    const name = typeof body.name === "string" ? body.name.trim() : "";
    if (name.length > 80) throw new HttpError(400, "Outfit names must be 80 characters or fewer");
    const outfit_name = name || "My outfit";

    await ensureOutfitsTable();

    if (itemIds.length > 0) {
      const ownedItems = await runStatement(
        `SELECT COUNT(DISTINCT clothing_item_id)
         FROM ${ITEMS_TABLE}
         WHERE user_id = :user_id
           AND array_contains(from_json(:item_ids_json, 'array<string>'), clothing_item_id)`,
        [
          { name: "user_id", value: user_id },
          { name: "item_ids_json", value: JSON.stringify(itemIds) },
        ]
      );
      if (Number(ownedItems[0]?.[0] ?? 0) !== itemIds.length) {
        throw new HttpError(400, "One or more selected items are not in your wardrobe");
      }
    }

    if (source_image_id) {
      const ownedImage = await runStatement(
        `SELECT image_id FROM ${IMAGES_TABLE}
         WHERE image_id = :image_id AND user_id = :user_id`,
        [
          { name: "image_id", value: source_image_id },
          { name: "user_id", value: user_id },
        ]
      );
      if (!ownedImage.length) throw new HttpError(400, "The outfit image is not in your uploads");
    }

    const outfit_id = crypto.randomUUID();
    await runStatement(
      `INSERT INTO ${OUTFITS_TABLE}
         (outfit_id, user_id, name, source_image_id, clothing_item_ids, created_at)
       VALUES (
         :outfit_id, :user_id, :name, NULLIF(:source_image_id, ''),
         from_json(:item_ids_json, 'array<string>'), current_timestamp()
       )`,
      [
        { name: "outfit_id", value: outfit_id },
        { name: "user_id", value: user_id },
        { name: "name", value: outfit_name },
        { name: "source_image_id", value: source_image_id },
        { name: "item_ids_json", value: JSON.stringify(itemIds) },
      ]
    );

    res.status(201).json({
      outfit_id,
      name: outfit_name,
      source_image_id: source_image_id || null,
      clothing_item_ids: itemIds,
    });
  } catch (e) {
    next(e);
  }
});

// Convert route errors into JSON responses with the appropriate HTTP status.
imageRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unexpected error";
  if (status >= 500) console.error("[images]", err);
  res.status(status).json({ error: message });
});
