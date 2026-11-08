import { useRef, useState } from "react";
import type { FormEvent, PointerEvent } from "react";
import "./ClothingCard.css";

type TagAction = "add" | "remove";

interface ClothingCardProps {
  imageUrl: string;
  description: string;
  tags: string[];
  details?: string[];
  onTagChange: (tag: string, action: TagAction) => Promise<void>;
  isSelected: boolean;
  onSelectionToggle: () => void;
  isDeleteSelectMode: boolean;
  isDeleteSelected: boolean;
  onDeleteSelectToggle: () => void;
  onLongPress: () => void;
  onDelete: () => Promise<void>;
}

export default function ClothingCard({
  imageUrl,
  description,
  tags,
  details = [],
  onTagChange,
  isSelected,
  onSelectionToggle,
  isDeleteSelectMode,
  isDeleteSelected,
  onDeleteSelectToggle,
  onLongPress,
  onDelete,
}: ClothingCardProps) {
  const [isAddingTag, setIsAddingTag] = useState(false);
  const [newTag, setNewTag] = useState("");
  const [isSavingTag, setIsSavingTag] = useState(false);
  const [tagError, setTagError] = useState("");
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);

  function clearLongPressTimer() {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  }

  function handlePointerDown(event: PointerEvent<HTMLElement>) {
    if (
      isDeleteSelectMode ||
      event.button !== 0 ||
      (event.target instanceof Element && event.target.closest("button, input, form"))
    ) return;

    longPressTriggered.current = false;
    longPressTimer.current = setTimeout(() => {
      longPressTriggered.current = true;
      onLongPress();
    }, 550);
  }

  async function deleteItem() {
    if (!window.confirm(`Delete ${description} from your wardrobe?`)) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      await onDelete();
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete clothing item.");
    } finally {
      setIsDeleting(false);
    }
  }

  async function changeTag(tag: string, action: TagAction) {
    setIsSavingTag(true);
    setTagError("");
    try {
      await onTagChange(tag, action);
      if (action === "add") {
        setNewTag("");
        setIsAddingTag(false);
      }
    } catch (error) {
      setTagError(error instanceof Error ? error.message : "Could not update tag.");
    } finally {
      setIsSavingTag(false);
    }
  }

  function submitNewTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const tag = newTag.trim();
    if (!tag) {
      setTagError("Enter a tag first.");
      return;
    }
    if (tags.some((current) => current.toLowerCase() === tag.toLowerCase())) {
      setTagError("That tag is already on this item.");
      return;
    }
    void changeTag(tag, "add");
  }

  return (
    <article
      className={`clothing-card${isDeleteSelected ? " is-delete-selected" : ""}${isDeleteSelectMode ? " is-delete-select-mode" : ""}`}
      onPointerDown={handlePointerDown}
      onPointerUp={clearLongPressTimer}
      onPointerLeave={clearLongPressTimer}
      onPointerCancel={clearLongPressTimer}
      onClick={(event) => {
        if (longPressTriggered.current) {
          longPressTriggered.current = false;
          event.preventDefault();
          return;
        }
        if (
          isDeleteSelectMode &&
          !(event.target instanceof Element && event.target.closest("button, input, form"))
        ) onDeleteSelectToggle();
      }}
    >
      <img src={imageUrl} alt={description} />
      {isDeleteSelectMode ? (
        <button
          className="clothing-card-delete-check"
          type="button"
          aria-label={`${isDeleteSelected ? "Deselect" : "Select"} ${description} for deletion`}
          aria-pressed={isDeleteSelected}
          onClick={onDeleteSelectToggle}
        >
          {isDeleteSelected ? "✓" : ""}
        </button>
      ) : (
        <button
          className="clothing-card-delete"
          type="button"
          aria-label={`Delete ${description}`}
          title="Delete clothing item"
          disabled={isDeleting}
          onClick={() => void deleteItem()}
        >
          {isDeleting ? "…" : "×"}
        </button>
      )}
      <div className="clothing-card-details">
        <button
          className={`clothing-card-select${isSelected ? " is-selected" : ""}`}
          type="button"
          aria-pressed={isSelected}
          onClick={onSelectionToggle}
        >
          {isSelected ? "Selected for outfit" : "Select for outfit"}
        </button>
        <h2>{description}</h2>
        {details.length > 0 && (
          <p className="clothing-card-meta">{details.join(" · ")}</p>
        )}
        <div className="clothing-card-tag-row">
          <div className="clothing-card-tags" aria-label="Style tags">
            {tags.map((tag, index) => (
              <button
                key={`${tag}-${index}`}
                className="tag tag-delete"
                type="button"
                aria-label={`Delete ${tag} tag`}
                title={`Delete ${tag}`}
                disabled={isSavingTag}
                onClick={() => void changeTag(tag, "remove")}
              >
                {tag} <span aria-hidden="true">×</span>
              </button>
            ))}
          </div>
          <button
            className="tag-add-button"
            type="button"
            aria-label={`Add tag to ${description}`}
            aria-expanded={isAddingTag}
            title="Add tag"
            disabled={isSavingTag}
            onClick={() => {
              setTagError("");
              setIsAddingTag((current) => !current);
            }}
          >
            +
          </button>
        </div>
        {isAddingTag && (
          <form className="tag-add-form" onSubmit={submitNewTag}>
            <input
              aria-label="New tag"
              maxLength={40}
              value={newTag}
              onChange={(event) => setNewTag(event.target.value)}
              placeholder="Add a style tag"
              disabled={isSavingTag}
            />
            <button type="submit" disabled={isSavingTag || !newTag.trim()}>
              {isSavingTag ? "Saving…" : "Add"}
            </button>
          </form>
        )}
        {tagError && <p className="tag-error" role="alert">{tagError}</p>}
        {deleteError && <p className="tag-error" role="alert">{deleteError}</p>}
      </div>
    </article>
  );
}
