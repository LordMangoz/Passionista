import { Router } from "express";
import {WardrobeItem} from "../../client/src/WardrobePage/WardrobeItem"
const router = Router();


//hard coding currentUserId as 10 for now
//return the images for the user.
router.get("/", async (req, res) => {
    try {
    const userId = req.query.user_id;
    console.log(userId);

  // TODO: Retrieve wardrobe items from database.
  const wardrobeItems: WardrobeItem[] = [
    {
      image_id: 1,
      file_name: "GoodShrekImage.png",
      caption: "Black hoodie",
      tags: ["black", "hoodie"],
      uploaded_at: "2026-11-07T15:30:00Z",
    },
    {
      image_id: 2,
      file_name: "GoodShrekImage.png",
      caption: "Blue jeans",
      tags: ["blue", "jeans"],
      uploaded_at: "2026-11-07T16:00:00Z",
    },
  ];

    return res.json(wardrobeItems);

    } catch(error)
    {
        return res.status(500).json({error: "ooopsies something went wrong in route: /api/wardrobe?user_id=${currentUserId}"})
    }
});

export default router;