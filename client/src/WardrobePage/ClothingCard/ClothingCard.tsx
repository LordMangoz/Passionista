import { useState } from "react";
import "./ClothingCard.css";

/**
 * Wardrobe will pass in the item prop,
 * this defines the inputs of that prop.
 */
interface ClothingCardProps {
  imageUrl: string;
  description: string;
  tags: string[];
}

/**
 * Generates a card with the image, and description.
 * Clickable to open details.
 *
 * @return clickable div that links to more info about the object.
 */
export default function ClothingCard( {
  imageUrl,
  description,
  tags
}: ClothingCardProps) 
{
  const [isBig, setIsBig] = useState(false);

  function handleChange() {
    setIsBig(!isBig);
  }

  return (
    <div
      className={`clothing-card ${isBig ? "expanded" : "small"}`}
      onClick={handleChange}
    >
      <img src={`${imageUrl}`}> hello :D</img>
      <a>{description}</a>
      <p> 
      {
        tags.map((tag) => (
          <span className="tag">${tag}</span> 
        ))
      }
    </p>
      omg clothing card no way??
    </div>
  );
}
