import { useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import ClothingCard from "../ClothingCard/ClothingCard";
import type { WardrobeItem } from "../WardrobeItem";
import PageMenu from "../../PageMenu";
import { deletePhoto, loadSavedPhotos, savePhoto } from "./wardrobeStorage";
import "./Wardrobe.css";

type PhotoPreview = { file: File; url: string };
type LocalItem = { id: string; url: string; caption: string };

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];

export default function Wardrobe({ userId }: { userId?: string }) {
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [localItems, setLocalItems] = useState<LocalItem[]>([]);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [storageError, setStorageError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<PhotoPreview | null>(null);
  const objectUrls = useRef(new Set<string>());
  const newlySavedIds = useRef(new Set<string>());
  const currentUserId = userId;

  useEffect(() => {
    let active = true;
    loadSavedPhotos()
      .then((photos) => {
        if (!active) return;
        const saved = photos
          .filter((photo) => !newlySavedIds.current.has(photo.id))
          .sort((a, b) => b.savedAt.localeCompare(a.savedAt))
          .map((photo) => {
            const url = URL.createObjectURL(photo.file);
            objectUrls.current.add(url);
            return { id: photo.id, url, caption: photo.caption };
          });
        setLocalItems((current) => [...current, ...saved]);
      })
      .catch(() => {
        if (active) setStorageError("Saved photos could not be loaded on this device.");
      });
    return () => {
      active = false;
      for (const url of objectUrls.current) URL.revokeObjectURL(url);
      objectUrls.current.clear();
    };
  }, []);

  useEffect(() => {
    if (!currentUserId) return;

    const query = new URLSearchParams({ user_id: currentUserId });
    fetch(`/api/wardrobe?${query}`)
      .then((res) => res.json())
      .then(setItems);
  }, [currentUserId]);

  function clearPreview() {
    if (previewRef.current) {
      URL.revokeObjectURL(previewRef.current.url);
      objectUrls.current.delete(previewRef.current.url);
      previewRef.current = null;
    }
    setPreview(null);
    setUploadError("");
  }

  function chooseFile(file?: File) {
    if (!file) return;
    if (isSaving) return;
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Choose a JPG or PNG image.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError("Choose an image smaller than 10 MB.");
      return;
    }

    clearPreview();
    const url = URL.createObjectURL(file);
    objectUrls.current.add(url);
    const nextPreview = { file, url };
    previewRef.current = nextPreview;
    setPreview(nextPreview);
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    chooseFile(event.target.files?.[0]);
    event.target.value = "";
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setIsDragging(false);
    chooseFile(event.dataTransfer.files[0]);
  }

  async function savePreview() {
    if (!preview) return;
    const caption = preview.file.name.replace(/\.[^.]+$/, "").replace(/[-_]+/g, " ").trim() || "New piece";
    const photo = {
      id: crypto.randomUUID(),
      file: preview.file,
      caption,
      savedAt: new Date().toISOString(),
    };
    setIsSaving(true);
    setUploadError("");
    try {
      await savePhoto(photo);
      newlySavedIds.current.add(photo.id);
      setLocalItems((current) => [
        { id: photo.id, url: preview.url, caption },
        ...current,
      ]);
      previewRef.current = null;
      setPreview(null);
      setUploadOpen(false);
      setStorageError("");
    } catch {
      setUploadError("This photo could not be saved. Please try again.");
    } finally {
      setIsSaving(false);
    }
  }

  async function removeSavedItem(id: string, url: string) {
    try {
      await deletePhoto(id);
      URL.revokeObjectURL(url);
      objectUrls.current.delete(url);
      newlySavedIds.current.delete(id);
      setLocalItems((current) => current.filter((item) => item.id !== id));
      setStorageError("");
    } catch {
      setStorageError("This photo could not be removed. Please try again.");
    }
  }

  function closeUpload() {
    if (isSaving) return;
    clearPreview();
    setUploadOpen(false);
    setIsDragging(false);
  }

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
        <div className="wardrobe-toolbar">
          <div>
            <p>YOUR COLLECTION</p>
            <h1>Your wardrobe</h1>
          </div>
          <button
            className="wardrobe-upload-toggle"
            type="button"
            aria-expanded={uploadOpen}
            aria-controls="wardrobe-upload-panel"
            disabled={isSaving}
            onClick={() => uploadOpen ? closeUpload() : setUploadOpen(true)}
          >
            {uploadOpen ? "Close upload" : "Upload a photo"}
            <span aria-hidden="true">{uploadOpen ? "×" : "↑"}</span>
          </button>
        </div>

        {uploadOpen && (
          <section className="wardrobe-upload-panel" id="wardrobe-upload-panel" aria-label="Upload clothing photo">
            <input
              ref={inputRef}
              className="wardrobe-file-input"
              type="file"
              accept="image/jpeg,image/png"
              aria-label="Choose a clothing photo"
              onChange={handleFileChange}
            />
            {preview ? (
              <div className="wardrobe-preview">
                <img src={preview.url} alt="Selected clothing item" />
                <div className="wardrobe-preview-actions">
                  <span title={preview.file.name}>{preview.file.name}</span>
                  <button type="button" onClick={() => inputRef.current?.click()} disabled={isSaving}>Replace</button>
                  <button type="button" onClick={clearPreview} disabled={isSaving}>Remove</button>
                </div>
              </div>
            ) : (
              <div
                className={isDragging ? "wardrobe-drop-zone is-dragging" : "wardrobe-drop-zone"}
                onDragEnter={(event) => { event.preventDefault(); setIsDragging(true); }}
                onDragOver={(event) => event.preventDefault()}
                onDragLeave={(event) => { event.preventDefault(); setIsDragging(false); }}
                onDrop={handleDrop}
              >
                <span className="wardrobe-upload-icon" aria-hidden="true">↑</span>
                <h2>Drop your photo here</h2>
                <p>or choose one from your device</p>
                <button type="button" onClick={() => inputRef.current?.click()}>Choose a photo</button>
                <small>JPG OR PNG · UP TO 10 MB</small>
              </div>
            )}
            {uploadError && <p className="wardrobe-upload-error" role="alert">{uploadError}</p>}
            {preview && <button className="wardrobe-add-preview" type="button" onClick={savePreview} disabled={isSaving}>{isSaving ? "Saving…" : "Save photo"} <span aria-hidden="true">→</span></button>}
            <p className="wardrobe-upload-note">Saved photos stay on this device. Account sync is coming later.</p>
          </section>
        )}

        {storageError && <p className="wardrobe-storage-error" role="alert">{storageError}</p>}
        <section className="wardrobe-grid" aria-label="Your wardrobe">
          {localItems.map((item) => (
            <div className="wardrobe-saved-item" key={item.id}>
              <ClothingCard
                imageUrl={item.url}
                description={item.caption}
                tags={["Saved on this device"]}
              />
              <button type="button" aria-label={`Remove ${item.caption} from this device`} onClick={() => void removeSavedItem(item.id, item.url)}>Remove photo</button>
            </div>
          ))}
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
      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
