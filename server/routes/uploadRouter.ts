import { Router } from "express";
import multer from "multer";
import crypto from "crypto";
import { runSql, putFileBytes } from "../databricks";

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});


router.post("/", upload.single("image"), async (req, res) => {
  try {
    const userId = req.body.user_id;
    if (!userId) return res.status(400).json({ error: "user_id is required" });
    if (!req.file) return res.status(400).json({ error: "image file is required" });
    if (!["image/jpeg", "image/png"].includes(req.file.mimetype))
      return res.status(400).json({ error: "Only JPEG and PNG are supported" });

    const imageId = crypto.randomUUID();
    const safeName = req.file.originalname.replace(/\s+/g, "_");
    const volumePath = `/Volumes/workspace/image_project/image_files/images/${userId}/${imageId}_${safeName}`;

    await putFileBytes(volumePath, req.file.buffer);

    await runSql(
      `INSERT INTO workspace.image_project.images
       (image_id, user_id, file_name, file_path, mime_type, size_bytes,
        tags, caption, status, uploaded_at, tagged_at)
       VALUES (:image_id, :user_id, :file_name, :file_path, :mime_type, :size_bytes,
               NULL, NULL, 'uploaded', current_timestamp(), NULL)`,
      {
        image_id: imageId,
        user_id: userId,
        file_name: req.file.originalname,
        file_path: volumePath,
        mime_type: req.file.mimetype,
        size_bytes: String(req.file.size),
      }
    );

    return res.json({ image_id: imageId, status: "uploaded" });
  } catch (error) {
    console.error("/api/upload failed:", error);
    return res.status(500).json({ error: "Upload failed" });
  }
});

export default router;