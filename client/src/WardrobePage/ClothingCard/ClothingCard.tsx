import React from "react";
import { useState } from "react";
import "./ClothingCard.css";

/**
 * Generates a card with the image, and description.
 * Clickable to open details.
 *
 * @return clickable div that links to more info about the object.
 */
export default function ClothingCard() {
  const [isBig, setIsBig] = useState(false);

  function handleChange() {
    setIsBig(!isBig);
  }

  return (
    <div
      className={`clothing-card ${isBig ? "expanded" : "small"}`}
      onClick={handleChange}
    >
      hello :D
    </div>
  );
}
