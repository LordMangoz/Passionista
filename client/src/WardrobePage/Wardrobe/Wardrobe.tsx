import { useAuth0 } from "@auth0/auth0-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import ClothingCard from "../ClothingCard/ClothingCard";
import type { WardrobeItem } from "../WardrobeItem";
import PageMenu from "../../PageMenu";
import "./Wardrobe.css";

type PhotoPreview = { file: File; url: string };
type UploadedImage = { image_id: string; status: string };

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;

async function getApiError(response: Response, fallback: string): Promise<string> {
  if (response.headers.get("content-type")?.includes("application/json")) {
    const data: unknown = await response.json();
    if (data && typeof data === "object" && "error" in data && typeof data.error === "string") {
      return data.error;
    }
  }
  return `${fallback} (HTTP ${response.status})`;
}

export default function Wardrobe() {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuthLoading,
    loginWithRedirect,
  } = useAuth0();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<PhotoPreview | null>(null);
  const objectUrls = useRef(new Set<string>());

  const revokeUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  const loadWardrobe = useCallback(async (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const response = await fetch("/api/wardrobe", { headers });
    if (!response.ok) throw new Error(await getApiError(response, "Could not load wardrobe"));
    const wardrobeItems = await response.json() as WardrobeItem[];
    const uniqueImageIds = [...new Set(wardrobeItems.map((item) => item.image_id))];

    const loadedPhotos = await Promise.all(uniqueImageIds.map(async (imageId) => {
      const imageResponse = await fetch(`/api/images/${encodeURIComponent(imageId)}/file`, { headers });
      if (!imageResponse.ok) {
        throw new Error(await getApiError(imageResponse, "Could not load a wardrobe photo"));
      }
      const url = URL.createObjectURL(await imageResponse.blob());
      objectUrls.current.add(url);
      return [imageId, url] as const;
    }));

    return {
      items: wardrobeItems,
      imageUrls: Object.fromEntries(loadedPhotos),
    };
  }, []);

  const refreshWardrobe = useCallback(async (accessToken: string) => {
    const wardrobe = await loadWardrobe(accessToken);
    setImageUrls((current) => {
      Object.values(current).forEach(revokeUrl);
      return wardrobe.imageUrls;
    });
    setItems(wardrobe.items);
  }, [loadWardrobe, revokeUrl]);

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;

    let active = true;

    void getAccessTokenSilently({
      authorizationParams: { audience: auth0Audience },
    })
      .then((accessToken) => {
        if (!accessToken) throw new Error("Auth0 did not return an access token.");
        if (active) {
          setIsLoading(true);
          setLoadError("");
        }
        return accessToken;
      })
      .then(loadWardrobe)
      .then((wardrobe) => {
        if (!active) {
          Object.values(wardrobe.imageUrls).forEach(revokeUrl);
          return;
        }
        setImageUrls((current) => {
          Object.values(current).forEach(revokeUrl);
          return wardrobe.imageUrls;
        });
        setItems(wardrobe.items);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Could not load wardrobe.");
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
    };
  }, [getAccessTokenSilently, isAuthLoading, isAuthenticated, loadWardrobe, revokeUrl]);

  useEffect(() => () => {
    for (const url of objectUrls.current) URL.revokeObjectURL(url);
    objectUrls.current.clear();
  }, []);

  function clearPreview() {
    if (previewRef.current) {
      revokeUrl(previewRef.current.url);
      previewRef.current = null;
    }
    setPreview(null);
    setUploadError("");
  }

  function chooseFile(file?: File) {
    if (!file || isSaving) return;
    setUploadError("");
    setUploadMessage("");
    if (!ACCEPTED_IMAGE_TYPES.includes(file.type)) {
      setUploadError("Choose a JPG or PNG image.");
      return;
    }
    if (file.size > MAX_IMAGE_SIZE) {
      setUploadError("Choose an image smaller than 10 MB.");
      return;
    }

    clearPreview();
    const nextPreview = { file, url: URL.createObjectURL(file) };
    objectUrls.current.add(nextPreview.url);
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

  async function waitForTagging(imageId: string, accessToken: string): Promise<void> {
    for (let attempt = 0; attempt < 30; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 2000));
      const response = await fetch("/api/images", {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(await getApiError(response, "Could not check upload status"));
      const images = await response.json() as UploadedImage[];
      const image = images.find((entry) => entry.image_id === imageId);
      if (image?.status === "tagged") return;
      if (image?.status === "failed") {
        throw new Error("The photo uploaded, but AI tagging failed. Check the server logs and try again.");
      }
    }
    throw new Error("The photo is still being tagged. Refresh your wardrobe in a moment.");
  }

  async function savePreview() {
    if (!preview || !isAuthenticated || isSaving) return;
    setIsSaving(true);
    setUploadError("");
    setUploadMessage("");

    try {
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");
      const body = new FormData();
      body.append("image", preview.file);

      const response = await fetch("/api/images", {
        method: "POST",
        headers: { Authorization: `Bearer ${accessToken}` },
        body,
      });
      if (!response.ok) throw new Error(await getApiError(response, "Could not upload photo"));

      const uploaded = await response.json() as { image_id?: string };
      if (!uploaded.image_id) throw new Error("The server did not return an image ID.");

      setUploadMessage("Photo uploaded. AI is identifying the clothing…");
      await waitForTagging(uploaded.image_id, accessToken);
      await refreshWardrobe(accessToken);
      clearPreview();
      setUploadOpen(false);
      setUploadMessage("Added to your Databricks wardrobe.");
    } catch (error) {
      setUploadError(error instanceof Error ? error.message : "Could not upload photo.");
    } finally {
      setIsSaving(false);
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
        <a className="stylist-wordmark" href="/">passionista<span>.</span></a>
        <span className="stylist-header-title">THE STYLIST STUDIO</span>
        <PageMenu current="wardrobe" />
      </header>
      <main className="wardrobe-content">
        <div className="wardrobe-toolbar">
          <div>
            <p>YOUR COLLECTION</p>
            <h1>Your wardrobe</h1>
          </div>
          {isAuthenticated && (
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
          )}
        </div>

        {isAuthLoading ? (
          <p role="status">Checking your sign-in…</p>
        ) : !isAuthenticated ? (
          <section className="wardrobe-upload-panel" aria-label="Sign in">
            <p>Sign in to view and manage your wardrobe.</p>
            <button
              className="wardrobe-upload-toggle"
              type="button"
              onClick={() => void loginWithRedirect({ appState: { returnTo: "/wardrobe" } })}
            >
              Sign in <span aria-hidden="true">→</span>
            </button>
          </section>
        ) : null}

        {isAuthenticated && uploadOpen && (
          <section className="wardrobe-upload-panel" id="wardrobe-upload-panel" aria-label="Upload clothing photo">
            <input
              ref={inputRef}
              className="wardrobe-file-input"
              type="file"
              accept="image/jpeg,image/png"
              aria-label="Choose a clothing photo"
              onChange={handleFileChange}
              disabled={isSaving}
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
                <button type="button" onClick={() => inputRef.current?.click()} disabled={isSaving}>Choose a photo</button>
                <small>JPG OR PNG · UP TO 10 MB</small>
              </div>
            )}
            {uploadError && <p className="wardrobe-upload-error" role="alert">{uploadError}</p>}
            {uploadMessage && <p className="wardrobe-upload-note" role="status">{uploadMessage}</p>}
            {preview && (
              <button className="wardrobe-add-preview" type="button" onClick={() => void savePreview()} disabled={isSaving}>
                {isSaving ? "Uploading…" : "Add to wardrobe"} <span aria-hidden="true">→</span>
              </button>
            )}
            <p className="wardrobe-upload-note">Photos are tagged automatically and appear when ready.</p>
          </section>
        )}

        {isAuthenticated && loadError && <p className="wardrobe-storage-error" role="alert">{loadError}</p>}
        {isAuthenticated && isLoading && <p role="status">Loading your Databricks wardrobe…</p>}
        {isAuthenticated && !isLoading && !loadError && items.length === 0 && (
          <p>Your Databricks wardrobe is empty. Upload a photo to add your first item.</p>
        )}
        <section className="wardrobe-grid" aria-label="Your wardrobe">
          {isAuthenticated && items.map((item) => {
            const title = [item.subcategory || item.category, item.primary_color]
              .filter(Boolean)
              .join(" · ");
            const tags = [...new Set([
              ...item.style_tags,
              ...item.secondary_colors,
              item.pattern,
              item.material,
            ].filter(Boolean))];
            return (
              <ClothingCard
                key={item.clothing_item_id}
                imageUrl={imageUrls[item.image_id] ?? ""}
                description={title || "Clothing item"}
                tags={tags}
              />
            );
          })}
        </section>
      </main>
      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
