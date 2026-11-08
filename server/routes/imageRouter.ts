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
  const sub = (req as any).auth?.sub ?? (req as any).user?.sub ?? (req as any).user?.id;
  if (!sub) throw new HttpError(401, "Not authenticated");
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
INSERT INTO ${ITEMS_TABLE} (
    clothing_item_id,
    image_id,
    user_id,
    category,
    subcategory,
    primary_color,
    secondary_colors,
    pattern,
    material,
    fit,
    style_tags,
    formality,
    season,
    created_at
)
SELECT
    uuid(),
    :image_id,
    :user_id,
    it.category,
    it.subcategory,
    it.primary_color,
    it.secondary_colors,
    it.pattern,
    it.material,
    it.fit,
    it.style_tags,
    it.formality,
    it.season,
    current_timestamp()
FROM (
    SELECT explode(from_json(:items_json,
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
    )) AS it
)`;

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
      `SELECT clothing_item_id, category, subcategory, primary_color, secondary_colors,
              pattern, material, fit, style_tags, formality, season, image_id, created_at
       FROM ${ITEMS_TABLE}
       WHERE user_id = :user_id
       ORDER BY created_at DESC`,
      [{ name: "user_id", value: user_id }]
    );
    res.json(
      rows.map((r) => ({
        clothing_item_id: r[0],
        category: r[1],
        subcategory: r[2],
        primary_color: r[3],
        secondary_colors: r[4] ? JSON.parse(String(r[4])) : [],
        pattern: r[5],
        material: r[6],
        fit: r[7],
        style_tags: r[8] ? JSON.parse(String(r[8])) : [],
        formality: r[9],
        season: r[10] ? JSON.parse(String(r[10])) : [],
        image_id: r[11],
        created_at: r[12],
      }))
    );
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

// Convert route errors into JSON responses with the appropriate HTTP status.
imageRouter.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  const status = err instanceof HttpError ? err.status : 500;
  const message = err instanceof Error ? err.message : "Unexpected error";
  if (status >= 500) console.error("[images]", err);
  res.status(status).json({ error: message });
});
