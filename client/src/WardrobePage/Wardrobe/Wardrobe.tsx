import { useAuth0 } from "@auth0/auth0-react";
import { useEffect, useState } from "react";
import ClothingCard from "../ClothingCard/ClothingCard";
import type { WardrobeItem } from "../WardrobeItem";
import "./Wardrobe.css";
import PageMenu from "../../PageMenu";
/**
 * The Actual Wardrobe Page, generates
 * each item under the user's wardrobe on the database.
 */

export default function Wardrobe() {
  // for each card in the user's "wardrobe" (databricks database)
  // generate a wardrobe card.

  // we define a type to store each card.
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const { user } = useAuth0();
  const currentUserId = user?.sub;

  // we define hthe effect of getting the database response
  // upon loading this componenet.
  useEffect(() => {
    if (!currentUserId) return;

    const query = new URLSearchParams({ user_id: currentUserId });
    fetch(`/api/wardrobe?${query}`)
      .then((res) => res.json())
      .then(setItems);
  }, [currentUserId]);


  return (
    <div className="wardrobe-page">
      <header className="stylist-header">
          <a className="stylist-wordmark" href="/">
          passionista<span>.</span>
          </a>
          <span className="stylist-header-title">THE STYLIST STUDIO</span>
          <PageMenu current="wardrobe" />
      </header>
      <main className="wardrobe-content">
        <section className="wardrobe-grid" aria-label="Your wardrobe">
          {items.map((item) => (
            <ClothingCard
              key={item.image_id}
              imageUrl={`/api/image/${item.image_id}`}
              description={item.caption}
              tags={item.tags}
            />
          ))}
        </section>
        {currentUserId && <p className="wardrobe-user-id">User ID: {currentUserId}</p>}
      </main>
    </div>
  );
}
