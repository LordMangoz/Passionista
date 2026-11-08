import { Router } from "express";
import type { WardrobeItem } from "../../client/src/WardrobePage/WardrobeItem";
import { runSql } from "../databricks";

const router = Router();


router.get("/", async (req, res) => {
  try {
    const userId = String(req.query.user_id ?? "");
    if (!userId) return res.status(400).json({ error: "user_id is required" });

    const rows = await runSql(
      `SELECT image_id, file_name, caption, tags, uploaded_at
       FROM workspace.image_project.images
       WHERE user_id = :user_id AND status = 'tagged'
       ORDER BY uploaded_at DESC`,
      { user_id: userId }
    );

    const wardrobeItems: WardrobeItem[] = rows.map(
      ([image_id, file_name, caption, tags, uploaded_at]) => ({
        image_id: image_id!,
        file_name: file_name ?? "",
        caption: caption ?? "",
        tags: typeof tags === "string" ? (JSON.parse(tags) as string[]) : [],
        uploaded_at: uploaded_at ?? "",
      })
    );

    return res.json(wardrobeItems);
  } catch (error) {
    console.error("/api/wardrobe failed:", error);
    return res.status(500).json({ error: "Failed to load wardrobe" });
  }
});


router.get("/", async (req, res) => {

});

export default router;