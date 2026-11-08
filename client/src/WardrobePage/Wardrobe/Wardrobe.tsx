import React, { useEffect } from "react";
import { useState } from "react";
import ClothingCard from "../ClothingCard/ClothingCard";
import type { WardrobeItem } from "../WardrobeItem";
/**
 * The Actual Wardrobe Page, generates
 * each item under the user's wardrobe on the database.
 */

const currentUserId:number = 10; 
export default function Wardrobe() {
  // for each card in the user's "wardrobe" (databricks database)
  // generate a wardrobe card.

  // we define a type to store each card.
  const [items, setItems] = useState<WardrobeItem[]>([]);

  // we define hthe effect of getting the database response
  // upon loading this componenet.
  useEffect(() => {
    fetch(`/api/wardrobe?user_id=${currentUserId}`)
      .then((res) => res.json())
      .then(setItems);
  }, []);


  return (
    <div className="wardrobe-grid">
    {items.map((item) => (
      <ClothingCard
        key={item.image_id}
        imageUrl={`/api/image/${item.image_id}`}
        description={item.caption}
        tags={item.tags}
      />
    ))}
    </div>
  );
}
