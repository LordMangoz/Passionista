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
 * Generates a clothing card whose details appear on hover or keyboard focus.
 */
export default function ClothingCard({
  imageUrl,
  description,
  tags,
}: ClothingCardProps) {
  return (
    <article className="clothing-card" tabIndex={0}>
      <img src={imageUrl} alt={description} />
      <div className="clothing-card-details">
        <h2>{description}</h2>
        <div className="clothing-card-tags" aria-label="Tags">
          {tags.map((tag) => (
            <span key={tag} className="tag">
              {tag}
            </span>
          ))}
        </div>
      </div>
    </article>
  );
}
