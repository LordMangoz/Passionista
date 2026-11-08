import { useAuth0 } from "@auth0/auth0-react";
import { useCallback, useEffect, useRef, useState } from "react";
import type { ChangeEvent, DragEvent } from "react";
import ClothingCard from "../ClothingCard/ClothingCard";
import type { WardrobeItem } from "../WardrobeItem";
import PageMenu from "../../PageMenu";
import "./Wardrobe.css";

type PhotoPreview = { file: File; url: string };
type UploadedImage = { image_id: string; status: string };
type TagAction = "add" | "remove";
type SavedOutfit = {
  outfit_id: string;
  name: string;
  source_image_id: string | null;
  clothing_item_ids: string[];
  created_at: string;
};

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

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((entry: unknown) => typeof entry === "string");
}

function outfitDisplayOrder(item: WardrobeItem): number {
  const subcategory = item.subcategory.toLowerCase();
  if (subcategory.includes("sock")) return 3;
  if (/\b(shoe|sneaker|boot|sandal)\b/.test(subcategory)) return 4;
  if (item.category === "top" || item.category === "dress") return 0;
  if (item.category === "outerwear") return 1;
  if (item.category === "bottom") return 2;
  if (item.category === "footwear") return 4;
  if (item.category === "accessory") return 5;
  return 6;
}

export default function Wardrobe() {
  const {
    getAccessTokenSilently,
    isAuthenticated,
    isLoading: isAuthLoading,
    loginWithRedirect,
    user,
  } = useAuth0();
  const [items, setItems] = useState<WardrobeItem[]>([]);
  const [outfits, setOutfits] = useState<SavedOutfit[]>([]);
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null);
  const [imageUrls, setImageUrls] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [loadError, setLoadError] = useState("");
  const [loadErrorForUser, setLoadErrorForUser] = useState<string | null>(null);
  const [uploadOpen, setUploadOpen] = useState(false);
  const [preview, setPreview] = useState<PhotoPreview | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const [uploadMessage, setUploadMessage] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [collectionView, setCollectionView] = useState<"wardrobe" | "outfits">("wardrobe");
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [outfitName, setOutfitName] = useState("");
  const [isSavingOutfit, setIsSavingOutfit] = useState(false);
  const [outfitError, setOutfitError] = useState("");
  const [outfitMessage, setOutfitMessage] = useState("");
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<string[]>([]);
  const [isDeleteSelectMode, setIsDeleteSelectMode] = useState(false);
  const [isDeletingItems, setIsDeletingItems] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<PhotoPreview | null>(null);
  const objectUrls = useRef(new Set<string>());

  const revokeUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  const loadWardrobe = useCallback(async (accessToken: string) => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [response, outfitsResponse] = await Promise.all([
      fetch("/api/wardrobe", { headers }),
      fetch("/api/outfits", { headers }),
    ]);
    if (!response.ok) throw new Error(await getApiError(response, "Could not load wardrobe"));
    if (!outfitsResponse.ok) throw new Error(await getApiError(outfitsResponse, "Could not load saved outfits"));
    const wardrobeItems = await response.json() as WardrobeItem[];
    const savedOutfits = await outfitsResponse.json() as SavedOutfit[];
    const uniqueImageIds = [...new Set([
      ...wardrobeItems.map((item) => item.image_id),
      ...savedOutfits.map((outfit) => outfit.source_image_id).filter(
        (imageId): imageId is string => Boolean(imageId),
      ),
    ])];

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
      outfits: savedOutfits,
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
    setOutfits(wardrobe.outfits);
    setLoadedForUser(user?.sub ?? null);
  }, [loadWardrobe, revokeUrl, user?.sub]);

  const updateTag = useCallback(async (itemId: string, tag: string, action: TagAction) => {
    if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
    const accessToken = await getAccessTokenSilently({
      authorizationParams: { audience: auth0Audience },
    });
    if (!accessToken) throw new Error("Auth0 did not return an access token.");

    const response = await fetch(`/api/wardrobe/${encodeURIComponent(itemId)}/tags`, {
      method: "PATCH",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ action, tag }),
    });
    if (!response.ok) throw new Error(await getApiError(response, "Could not update tag"));

    const data: unknown = await response.json();
    if (!data || typeof data !== "object" || !("style_tags" in data)) {
      throw new Error("The server returned an invalid tag list.");
    }
    const styleTags = data.style_tags;
    if (!isStringArray(styleTags)) throw new Error("The server returned an invalid tag list.");

    setItems((current) => current.map((item) =>
      item.clothing_item_id === itemId
        ? { ...item, style_tags: styleTags }
        : item
    ));
  }, [getAccessTokenSilently]);

  async function deleteItems(itemIds: string[]) {
    if (!auth0Audience || itemIds.length === 0) {
      if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
      return;
    }

    setIsDeletingItems(true);
    setDeleteError("");
    try {
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");

      const response = await fetch("/api/wardrobe", {
        method: "DELETE",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ item_ids: itemIds }),
      });
      if (!response.ok) throw new Error(await getApiError(response, "Could not delete clothing item"));

      const result: unknown = await response.json();
      if (
        !result ||
        typeof result !== "object" ||
        !("deleted_item_ids" in result) ||
        !Array.isArray(result.deleted_item_ids) ||
        !result.deleted_item_ids.every((id: unknown) => typeof id === "string")
      ) {
        throw new Error("The server returned an invalid delete response.");
      }

      const deletedIds = result.deleted_item_ids as string[];
      const deletedIdSet = new Set(deletedIds);
      const deletedImageIds = new Set(
        items
          .filter((item) => deletedIdSet.has(item.clothing_item_id))
          .map((item) => item.image_id),
      );
      const remainingItems = items.filter((item) => !deletedIdSet.has(item.clothing_item_id));
      const remainingOutfits = outfits
        .map((outfit) => ({
          ...outfit,
          clothing_item_ids: outfit.clothing_item_ids.filter((id) => !deletedIdSet.has(id)),
        }))
        .filter((outfit) => outfit.source_image_id || outfit.clothing_item_ids.length > 0);
      const referencedImages = new Set([
        ...remainingItems.map((item) => item.image_id),
        ...remainingOutfits
          .map((outfit) => outfit.source_image_id)
          .filter((imageId): imageId is string => Boolean(imageId)),
      ]);

      setItems(remainingItems);
      setOutfits(remainingOutfits);
      setSelectedItemIds((current) => current.filter((id) => !deletedIdSet.has(id)));
      setDeleteSelectedIds((current) => current.filter((id) => !deletedIdSet.has(id)));
      setImageUrls((current) => {
        const next = { ...current };
        for (const imageId of deletedImageIds) {
          if (!referencedImages.has(imageId) && next[imageId]) {
            revokeUrl(next[imageId]);
            delete next[imageId];
          }
        }
        return next;
      });
      if (deleteSelectedIds.every((id) => deletedIdSet.has(id))) {
        setIsDeleteSelectMode(false);
      }
    } finally {
      setIsDeletingItems(false);
    }
  }

  function toggleDeleteSelection(itemId: string) {
    if (deleteSelectedIds.includes(itemId)) {
      setDeleteSelectedIds((current) => current.filter((id) => id !== itemId));
    } else if (deleteSelectedIds.length >= 100) {
      setDeleteError("Select up to 100 items to delete at once.");
      return;
    } else {
      setDeleteSelectedIds((current) => [...current, itemId]);
    }
    setDeleteError("");
  }

  function startDeleteSelection(itemId: string) {
    if (deleteSelectedIds.length >= 100 && !deleteSelectedIds.includes(itemId)) {
      setDeleteError("Select up to 100 items to delete at once.");
      setIsDeleteSelectMode(true);
      return;
    }
    setIsDeleteSelectMode(true);
    setDeleteSelectedIds((current) => current.includes(itemId)
      ? current
      : [...current, itemId]);
    setDeleteError("");
  }

  async function deleteSelectedItems() {
    if (!deleteSelectedIds.length || isDeletingItems) return;
    if (!window.confirm(`Delete ${deleteSelectedIds.length} selected wardrobe item${deleteSelectedIds.length === 1 ? "" : "s"}?`)) {
      return;
    }
    try {
      await deleteItems(deleteSelectedIds);
      setIsDeleteSelectMode(false);
      setDeleteSelectedIds([]);
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Could not delete selected items.");
    }
  }

  useEffect(() => {
    if (isAuthLoading || !isAuthenticated) return;

    let active = true;
    const userId = user?.sub ?? null;
    const urls = objectUrls.current;

    void getAccessTokenSilently({
      authorizationParams: { audience: auth0Audience },
    })
      .then((accessToken) => {
        if (!accessToken) throw new Error("Auth0 did not return an access token.");
        if (active) {
          setIsLoading(true);
          setLoadError("");
          setLoadErrorForUser(null);
          setDeleteSelectedIds([]);
          setIsDeleteSelectMode(false);
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
        setOutfits(wardrobe.outfits);
        setLoadedForUser(userId);
      })
      .catch((error: unknown) => {
        if (active) {
          setLoadError(error instanceof Error ? error.message : "Could not load wardrobe.");
          setLoadErrorForUser(userId);
        }
      })
      .finally(() => {
        if (active) setIsLoading(false);
      });

    return () => {
      active = false;
      for (const url of urls) revokeUrl(url);
    };
  }, [getAccessTokenSilently, isAuthLoading, isAuthenticated, loadWardrobe, revokeUrl, user?.sub]);

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
      setUploadMessage("");
      setUploadError(error instanceof Error ? error.message : "Could not upload photo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveOutfit(itemIds: string[], sourceImageId?: string) {
    if (!isAuthenticated || isSavingOutfit) return;
    setIsSavingOutfit(true);
    setOutfitError("");
    setOutfitMessage("");
    try {
      if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");

      const response = await fetch("/api/outfits", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: outfitName.trim() || "My outfit",
          clothing_item_ids: itemIds,
          ...(sourceImageId ? { source_image_id: sourceImageId } : {}),
        }),
      });
      if (!response.ok) throw new Error(await getApiError(response, "Could not save outfit"));

      await refreshWardrobe(accessToken);
      setSelectedItemIds([]);
      setOutfitName("");
      setOutfitMessage("Outfit saved.");
    } catch (error) {
      setOutfitError(error instanceof Error ? error.message : "Could not save outfit.");
    } finally {
      setIsSavingOutfit(false);
    }
  }

  function closeUpload() {
    if (isSaving) return;
    clearPreview();
    setUploadOpen(false);
    setIsDragging(false);
  }

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const filteredItems = categoryFilter === "all"
    ? items
    : items.filter((item) => item.category === categoryFilter);
  const currentUserId = user?.sub ?? null;
  const currentUserLoaded = currentUserId !== null && loadedForUser === currentUserId;
  const currentUserHasLoadError = currentUserId !== null && loadErrorForUser === currentUserId;

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
            <h1>{collectionView === "outfits" ? "Your outfits" : "Your wardrobe"}</h1>
          </div>
          <div className="wardrobe-toolbar-actions">
            {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && items.length > 0 && (
              <label className="wardrobe-filter">
                <span>Filter by category</span>
                <select
                  value={categoryFilter}
                  onChange={(event) => setCategoryFilter(event.target.value)}
                >
                  <option value="all">All categories</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isAuthenticated && currentUserLoaded && (
              <button
                className={`wardrobe-view-toggle${collectionView === "outfits" ? " is-active" : ""}`}
                type="button"
                aria-pressed={collectionView === "outfits"}
                onClick={() => {
                  setCollectionView((current) => current === "wardrobe" ? "outfits" : "wardrobe");
                  setOutfitError("");
                  setOutfitMessage("");
                }}
              >
                {collectionView === "outfits" ? "Wardrobe" : "Outfits"}
              </button>
            )}
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

        {isAuthenticated && currentUserHasLoadError && loadError && <p className="wardrobe-storage-error" role="alert">{loadError}</p>}
        {isAuthenticated && (isLoading || (!currentUserLoaded && !currentUserHasLoadError)) && <p role="status">Loading your Databricks wardrobe…</p>}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && !isLoading && !loadError && items.length === 0 && (
          <p>Your Databricks wardrobe is empty. Upload a photo to add your first item.</p>
        )}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && !isLoading && !loadError && items.length > 0 && filteredItems.length === 0 && (
          <p>No wardrobe items match this category.</p>
        )}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && items.length > 0 && !isDeleteSelectMode && (
          <p className="wardrobe-long-press-hint">Press and hold a clothing card to select multiple items for deletion.</p>
        )}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && selectedItemIds.length > 0 && (
          <form
            className="outfit-selection-bar"
            onSubmit={(event) => {
              event.preventDefault();
              void saveOutfit(selectedItemIds);
            }}
          >
            <span>{selectedItemIds.length} item{selectedItemIds.length === 1 ? "" : "s"} selected</span>
            <input
              aria-label="Outfit name"
              maxLength={80}
              placeholder="Outfit name (optional)"
              value={outfitName}
              onChange={(event) => setOutfitName(event.target.value)}
              disabled={isSavingOutfit}
            />
            <button type="submit" disabled={isSavingOutfit}>
              {isSavingOutfit ? "Saving…" : "Save selected outfit"}
            </button>
          </form>
        )}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && isDeleteSelectMode && (
          <div className="outfit-selection-bar delete-selection-bar">
            <span>{deleteSelectedIds.length} item{deleteSelectedIds.length === 1 ? "" : "s"} selected for deletion</span>
            <button
              type="button"
              onClick={() => void deleteSelectedItems()}
              disabled={isDeletingItems || deleteSelectedIds.length === 0}
            >
              {isDeletingItems ? "Deleting…" : "Delete selected"}
            </button>
            <button
              className="cancel-delete-selection"
              type="button"
              onClick={() => {
                setIsDeleteSelectMode(false);
                setDeleteSelectedIds([]);
                setDeleteError("");
              }}
              disabled={isDeletingItems}
            >
              Cancel
            </button>
          </div>
        )}
        {outfitError && <p className="wardrobe-storage-error" role="alert">{outfitError}</p>}
        {deleteError && <p className="wardrobe-storage-error" role="alert">{deleteError}</p>}
        {outfitMessage && <p className="outfit-success" role="status">{outfitMessage}</p>}
        {isAuthenticated && currentUserLoaded && collectionView === "wardrobe" && (
          <section className="wardrobe-grid" aria-label="Your wardrobe">
          {filteredItems.map((item) => {
            const title = [item.subcategory || item.category, item.primary_color]
              .filter(Boolean)
              .join(" · ");
            return (
              <ClothingCard
                key={item.clothing_item_id}
                imageUrl={imageUrls[item.image_id] ?? ""}
                description={title || "Clothing item"}
                tags={item.style_tags}
                details={[
                  item.pattern,
                  item.material,
                  ...item.secondary_colors,
                ].filter(Boolean)}
                isSelected={selectedItemIds.includes(item.clothing_item_id)}
                isDeleteSelectMode={isDeleteSelectMode}
                isDeleteSelected={deleteSelectedIds.includes(item.clothing_item_id)}
                onDeleteSelectToggle={() => toggleDeleteSelection(item.clothing_item_id)}
                onLongPress={() => startDeleteSelection(item.clothing_item_id)}
                onDelete={() => deleteItems([item.clothing_item_id])}
                onSelectionToggle={() => {
                  setSelectedItemIds((current) => current.includes(item.clothing_item_id)
                    ? current.filter((id) => id !== item.clothing_item_id)
                    : [...current, item.clothing_item_id]);
                  setOutfitError("");
                  setOutfitMessage("");
                }}
                onTagChange={(tag, action) =>
                  updateTag(item.clothing_item_id, tag, action)
                }
              />
            );
          })}
          </section>
        )}
        {isAuthenticated && currentUserLoaded && collectionView === "outfits" && (
          outfits.length ? (
            <section className="saved-outfit-grid" aria-label="Your saved outfits">
              {outfits.map((outfit) => {
                const outfitItems = outfit.clothing_item_ids
                  .map((id) => items.find((item) => item.clothing_item_id === id))
                  .filter((item): item is WardrobeItem => Boolean(item))
                  .sort((a, b) => outfitDisplayOrder(a) - outfitDisplayOrder(b));
                return (
                  <article className="saved-outfit-card" key={outfit.outfit_id}>
                    <h2>{outfit.name}</h2>
                    <p>{outfit.created_at ? new Date(outfit.created_at).toLocaleDateString() : ""}</p>
                    <div className="saved-outfit-images">
                      {outfit.source_image_id && imageUrls[outfit.source_image_id] && (
                        <figure>
                          <img src={imageUrls[outfit.source_image_id]} alt="Outfit starting piece" />
                          <figcaption>Starting piece</figcaption>
                        </figure>
                      )}
                      {outfitItems.map((item) => (
                        <figure key={item.clothing_item_id}>
                          <img src={imageUrls[item.image_id] ?? ""} alt={item.subcategory || item.category} />
                          <figcaption>{item.subcategory || item.category}</figcaption>
                        </figure>
                      ))}
                    </div>
                  </article>
                );
              })}
            </section>
          ) : (
            <p>You haven’t saved any outfits yet. Select wardrobe items or save a stylist recommendation.</p>
          )
        )}
      </main>
      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
