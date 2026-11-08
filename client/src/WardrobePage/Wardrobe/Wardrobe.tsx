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
  notes?: string;
  is_local?: boolean;
};

const MAX_IMAGE_SIZE = 10 * 1024 * 1024;
const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/png"];
const auth0Audience = import.meta.env.VITE_AUTH0_AUDIENCE;
const currentPath = window.location.pathname.replace(/\/$/, "");
const isOutfitCreatorPage = currentPath === "/outfit-creation";
const isOutfitDetailPage = currentPath === "/outfit";
const isOutfitListPage = currentPath === "/outfits";

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

function localOutfitsKey(userId: string): string {
  return `passionista:outfits:${encodeURIComponent(userId)}`;
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
  const [categoryFilter] = useState(
    () => new URLSearchParams(window.location.search).get("category") ?? "all",
  );
  const [collectionView, setCollectionView] = useState<"wardrobe" | "outfits">(
    isOutfitCreatorPage || isOutfitDetailPage || isOutfitListPage ? "outfits" : "wardrobe",
  );
  const [selectedItemIds, setSelectedItemIds] = useState<string[]>([]);
  const [outfitName, setOutfitName] = useState("");
  const [outfitError, setOutfitError] = useState("");
  const [outfitMessage, setOutfitMessage] = useState("");
  const [editingOutfitId, setEditingOutfitId] = useState<string | null>(
    () => new URLSearchParams(window.location.search).get("id"),
  );
  const [isSavingEditedOutfit, setIsSavingEditedOutfit] = useState(false);
  const [outfitEditError, setOutfitEditError] = useState("");
  const [isSavingNotes, setIsSavingNotes] = useState(false);
  const [notesMessage, setNotesMessage] = useState("");
  const [deleteSelectedIds, setDeleteSelectedIds] = useState<string[]>([]);
  const [isDeleteSelectMode, setIsDeleteSelectMode] = useState(false);
  const [isDeletingItems, setIsDeletingItems] = useState(false);
  const [deleteError, setDeleteError] = useState("");
  const [deleteMessage, setDeleteMessage] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);
  const previewRef = useRef<PhotoPreview | null>(null);
  const objectUrls = useRef(new Set<string>());

  useEffect(() => {
    document.title = isOutfitCreatorPage
      ? "Outfit Creation | Passionista"
      : isOutfitDetailPage
        ? "Outfit Details | Passionista"
        : isOutfitListPage
          ? "Your Outfits | Passionista"
          : "Wardrobe | Passionista";
  }, []);

  const revokeUrl = useCallback((url: string) => {
    URL.revokeObjectURL(url);
    objectUrls.current.delete(url);
  }, []);

  const loadWardrobe = useCallback(async (accessToken: string, userId: string | null) => {
    const headers = { Authorization: `Bearer ${accessToken}` };
    const [response, outfitsResponse] = await Promise.all([
      fetch("/api/wardrobe", { headers }),
      fetch("/api/outfits", { headers }),
    ]);
    if (!response.ok) throw new Error(await getApiError(response, "Could not load wardrobe"));
    if (!outfitsResponse.ok) throw new Error(await getApiError(outfitsResponse, "Could not load saved outfits"));
    const wardrobeItems = await response.json() as WardrobeItem[];
    const savedOutfits = await outfitsResponse.json() as SavedOutfit[];
    let localOutfits: SavedOutfit[] = [];
    if (userId) {
      try {
        const stored = sessionStorage.getItem(localOutfitsKey(userId));
        if (stored) {
          const parsed: unknown = JSON.parse(stored);
          if (Array.isArray(parsed)) {
            localOutfits = parsed.filter((outfit): outfit is SavedOutfit =>
              Boolean(outfit) &&
              typeof outfit === "object" &&
              "outfit_id" in outfit &&
              typeof outfit.outfit_id === "string" &&
              "name" in outfit &&
              typeof outfit.name === "string" &&
              "clothing_item_ids" in outfit &&
              Array.isArray(outfit.clothing_item_ids) &&
              outfit.clothing_item_ids.every((id: unknown) => typeof id === "string") &&
              "is_local" in outfit &&
              outfit.is_local === true,
            );
          }
        }
      } catch (error) {
        console.error("Could not restore session-only outfit drafts:", error);
      }
    }
    const allOutfits = [...savedOutfits, ...localOutfits];
    const uniqueImageIds = [...new Set([
      ...wardrobeItems.map((item) => item.image_id),
      ...allOutfits.map((outfit) => outfit.source_image_id).filter(
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
      outfits: allOutfits,
      imageUrls: Object.fromEntries(loadedPhotos),
    };
  }, []);

  const refreshWardrobe = useCallback(async (accessToken: string) => {
    const wardrobe = await loadWardrobe(accessToken, user?.sub ?? null);
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

    const requestedIds = new Set(itemIds);
    const previousItems = items;
    const previousOutfits = outfits;
    const previousImageUrls = imageUrls;
    const previousSelectedItemIds = selectedItemIds;
    const previousDeleteSelectedIds = deleteSelectedIds;
    const removedItems = items.filter((item) => requestedIds.has(item.clothing_item_id));
    const nextItems = items.filter((item) => !requestedIds.has(item.clothing_item_id));
    const nextOutfits = outfits
      .map((outfit) => ({
        ...outfit,
        clothing_item_ids: outfit.clothing_item_ids.filter((id) => !requestedIds.has(id)),
      }))
      .filter((outfit) => outfit.source_image_id || outfit.clothing_item_ids.length > 0);
    const remainingImageIds = new Set([
      ...nextItems.map((item) => item.image_id),
      ...nextOutfits
        .map((outfit) => outfit.source_image_id)
        .filter((imageId): imageId is string => Boolean(imageId)),
    ]);
    const orphanImageIds = new Set(
      removedItems
        .map((item) => item.image_id)
        .filter((imageId) => !remainingImageIds.has(imageId)),
    );

    // Hide the selected cards and unused source images before waiting on network or SQL.
    setItems(nextItems);
    setOutfits(nextOutfits);
    setSelectedItemIds((current) => current.filter((id) => !requestedIds.has(id)));
    setDeleteSelectedIds((current) => current.filter((id) => !requestedIds.has(id)));
    setImageUrls((current) => {
      const next = { ...current };
      for (const imageId of orphanImageIds) delete next[imageId];
      return next;
    });

    setIsDeletingItems(true);
    setDeleteError("");
    setDeleteMessage("");
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
      if (deletedIds.length !== requestedIds.size || deletedIds.some((id) => !requestedIds.has(id))) {
        throw new Error("The server did not confirm deleting all selected items.");
      }

      for (const imageId of orphanImageIds) {
        const url = previousImageUrls[imageId];
        if (url) revokeUrl(url);
      }
      if ([...requestedIds].every((id) => deletedIdSet.has(id))) {
        setIsDeleteSelectMode(false);
      }
      setDeleteMessage(
        "warning" in result && typeof result.warning === "string" ? result.warning : "",
      );
    } catch (error) {
      setItems(previousItems);
      setOutfits(previousOutfits);
      setSelectedItemIds(previousSelectedItemIds);
      setDeleteSelectedIds(previousDeleteSelectedIds);
      setImageUrls(previousImageUrls);
      setDeleteError(error instanceof Error ? error.message : "Could not delete clothing item.");
      setDeleteMessage("");
      throw error;
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
    setDeleteMessage("");
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
    setDeleteMessage("");
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
      .then((accessToken) => loadWardrobe(accessToken, userId))
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

  const categories = [...new Set(items.map((item) => item.category).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b));
  const filteredItems = categoryFilter === "all"
    ? items
    : items.filter((item) => item.category === categoryFilter);
  const currentUserId = user?.sub ?? null;
  const currentUserLoaded = currentUserId !== null && loadedForUser === currentUserId;
  const currentUserHasLoadError = currentUserId !== null && loadErrorForUser === currentUserId;
  const editingOutfit = outfits.find((outfit) => outfit.outfit_id === editingOutfitId) ?? null;

  function persistLocalOutfits(nextOutfits: SavedOutfit[]) {
    if (!currentUserId) return;
    try {
      sessionStorage.setItem(
        localOutfitsKey(currentUserId),
        JSON.stringify(nextOutfits.filter((outfit) => outfit.is_local)),
      );
    } catch (error) {
      console.error("Could not save session-only outfit drafts:", error);
      setOutfitEditError("This outfit could not be saved in the current browser session.");
    }
  }

  function createLocalOutfit(itemIds: string[] = [], name = "New outfit"): boolean {
    const uniqueItemIds = [...new Set(itemIds)];
    if (uniqueItemIds.length > 20) {
      setOutfitError("An outfit can contain up to 20 wardrobe items.");
      return false;
    }
    const newOutfit: SavedOutfit = {
      outfit_id: `local-${crypto.randomUUID()}`,
      name,
      source_image_id: null,
      clothing_item_ids: uniqueItemIds,
      created_at: new Date().toISOString(),
      notes: "",
      is_local: true,
    };
    const nextOutfits = [newOutfit, ...outfits];
    setOutfits(nextOutfits);
    persistLocalOutfits(nextOutfits);
    setEditingOutfitId(newOutfit.outfit_id);
    setOutfitEditError("");
    setOutfitError("");
    window.location.assign(`/outfit-creation?id=${encodeURIComponent(newOutfit.outfit_id)}`);
    return true;
  }

  function addOutfit() {
    createLocalOutfit();
  }

  function updateEditingOutfit(updater: (outfit: SavedOutfit) => SavedOutfit) {
    if (!editingOutfit) return;
    const nextOutfits = outfits.map((outfit) =>
      outfit.outfit_id === editingOutfit.outfit_id ? updater(outfit) : outfit,
    );
    setOutfits(nextOutfits);
    if (editingOutfit.is_local) persistLocalOutfits(nextOutfits);
  }

  function toggleEditingItem(itemId: string) {
    if (
      editingOutfit &&
      !editingOutfit.clothing_item_ids.includes(itemId) &&
      editingOutfit.clothing_item_ids.length >= 20
    ) {
      setOutfitEditError("An outfit can contain up to 20 wardrobe items.");
      return;
    }
    updateEditingOutfit((outfit) => ({
      ...outfit,
      clothing_item_ids: outfit.clothing_item_ids.includes(itemId)
        ? outfit.clothing_item_ids.filter((id) => id !== itemId)
        : [...outfit.clothing_item_ids, itemId],
    }));
    setOutfitEditError("");
  }

  async function saveEditedOutfit() {
    if (!editingOutfit || isSavingEditedOutfit) return;
    if (!editingOutfit.name.trim()) {
      setOutfitEditError("Give this outfit a name before saving.");
      return;
    }
    if (!editingOutfit.source_image_id && editingOutfit.clothing_item_ids.length === 0) {
      setOutfitEditError("Add at least one wardrobe item before saving.");
      return;
    }

    setIsSavingEditedOutfit(true);
    setOutfitEditError("");
    try {
      if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");

      const isLocal = editingOutfit.is_local === true;
      const response = await fetch(
        isLocal
          ? "/api/outfits"
          : `/api/outfits/${encodeURIComponent(editingOutfit.outfit_id)}`,
        {
          method: isLocal ? "POST" : "PUT",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            name: editingOutfit.name.trim(),
            source_image_id: editingOutfit.source_image_id,
            clothing_item_ids: editingOutfit.clothing_item_ids,
            notes: editingOutfit.notes ?? "",
          }),
        },
      );
      if (!response.ok) throw new Error(await getApiError(response, "Could not save outfit"));
      const saved = await response.json() as {
        outfit_id: string;
        name: string;
        source_image_id: string | null;
        clothing_item_ids: string[];
        notes: string;
      };
      const nextOutfits = outfits.map((outfit) =>
        outfit.outfit_id === editingOutfit.outfit_id
          ? { ...outfit, ...saved, is_local: false }
          : outfit,
      );
      setOutfits(nextOutfits);
      persistLocalOutfits(nextOutfits);
      setEditingOutfitId(saved.outfit_id);
      window.history.replaceState(
        null,
        "",
        `/outfit-creation?id=${encodeURIComponent(saved.outfit_id)}`,
      );
    } catch (error) {
      setOutfitEditError(error instanceof Error ? error.message : "Could not save outfit.");
    } finally {
      setIsSavingEditedOutfit(false);
    }
  }

  function updateOutfitNotes(notes: string) {
    if (!editingOutfit) return;
    const nextOutfits = outfits.map((outfit) =>
      outfit.outfit_id === editingOutfit.outfit_id ? { ...outfit, notes } : outfit,
    );
    setOutfits(nextOutfits);
    if (editingOutfit.is_local) persistLocalOutfits(nextOutfits);
    setNotesMessage("");
  }

  async function saveOutfitNotes() {
    if (!editingOutfit || editingOutfit.is_local || isSavingNotes) return;
    setIsSavingNotes(true);
    setOutfitEditError("");
    setNotesMessage("");
    try {
      if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");
      const response = await fetch(
        `/api/outfits/${encodeURIComponent(editingOutfit.outfit_id)}/notes`,
        {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ notes: editingOutfit.notes ?? "" }),
        },
      );
      if (!response.ok) throw new Error(await getApiError(response, "Could not save outfit notes"));
      setNotesMessage("Notes saved.");
    } catch (error) {
      setOutfitEditError(error instanceof Error ? error.message : "Could not save outfit notes.");
    } finally {
      setIsSavingNotes(false);
    }
  }

  async function deleteOutfit(outfit: SavedOutfit) {
    if (!window.confirm(`Delete "${outfit.name}"?`)) return;
    const previousOutfits = outfits;
    const wasEditing = editingOutfitId === outfit.outfit_id;
    const nextOutfits = outfits.filter((entry) => entry.outfit_id !== outfit.outfit_id);
    setOutfits(nextOutfits);
    if (wasEditing) setEditingOutfitId(null);
    persistLocalOutfits(nextOutfits);

    if (outfit.is_local) return;
    try {
      if (!auth0Audience) throw new Error("Auth0 API audience is not configured.");
      const accessToken = await getAccessTokenSilently({
        authorizationParams: { audience: auth0Audience },
      });
      if (!accessToken) throw new Error("Auth0 did not return an access token.");
      const response = await fetch(`/api/outfits/${encodeURIComponent(outfit.outfit_id)}`, {
        method: "DELETE",
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!response.ok) throw new Error(await getApiError(response, "Could not delete outfit"));
    } catch (error) {
      setOutfits(previousOutfits);
      if (wasEditing) setEditingOutfitId(outfit.outfit_id);
      persistLocalOutfits(previousOutfits);
      setOutfitEditError(error instanceof Error ? error.message : "Could not delete outfit.");
    }
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
            <p>{isOutfitCreatorPage ? "STYLE YOUR LOOK" : isOutfitDetailPage ? "OUTFIT DETAILS" : "YOUR COLLECTION"}</p>
            <h1>{isOutfitCreatorPage
              ? "Outfit creation"
              : isOutfitDetailPage
                ? editingOutfit?.name ?? "Outfit details"
                : collectionView === "outfits" ? "Your outfits" : "Your wardrobe"}</h1>
          </div>
          <div className="wardrobe-toolbar-actions">
            {isAuthenticated && currentUserLoaded && !isOutfitCreatorPage && !isOutfitDetailPage && (
              <label className="wardrobe-filter">
                <span>Filter collection</span>
                <select
                  value={collectionView === "outfits" ? "__outfits__" : categoryFilter}
                  onChange={(event) => {
                    if (event.target.value === "__outfits__") {
                      window.location.assign("/outfits");
                    } else {
                      const categoryQuery = event.target.value === "all"
                        ? ""
                        : `?category=${encodeURIComponent(event.target.value)}`;
                      window.location.assign(`/wardrobe${categoryQuery}`);
                    }
                  }}
                >
                  <option value="all">All categories</option>
                  <option value="__outfits__">Outfits</option>
                  {categories.map((category) => (
                    <option key={category} value={category}>
                      {category.charAt(0).toUpperCase() + category.slice(1)}
                    </option>
                  ))}
                </select>
              </label>
            )}
            {isAuthenticated && currentUserLoaded && !isOutfitCreatorPage && !isOutfitDetailPage && (
              <button
                className={`wardrobe-view-toggle${collectionView === "outfits" ? " is-active" : ""}`}
                type="button"
                aria-pressed={collectionView === "outfits"}
                onClick={() => {
                  window.location.assign(collectionView === "wardrobe" ? "/outfits" : "/wardrobe");
                  setOutfitError("");
                  setOutfitMessage("");
                }}
              >
                {collectionView === "outfits" ? "Wardrobe" : "Outfits"}
              </button>
            )}
            {isAuthenticated && currentUserLoaded && collectionView === "outfits" && isOutfitListPage && (
              <button
                className="wardrobe-view-toggle"
                type="button"
                onClick={addOutfit}
              >
                Add outfit <span aria-hidden="true">+</span>
              </button>
            )}
            {isAuthenticated && currentUserLoaded && (isOutfitCreatorPage || isOutfitDetailPage) && (
              <>
                <a className="wardrobe-view-toggle" href="/outfits">Back to outfits</a>
                {isOutfitDetailPage && editingOutfit && (
                  <a
                    className="wardrobe-view-toggle"
                    href={`/outfit-creation?id=${encodeURIComponent(editingOutfit.outfit_id)}`}
                  >
                    Edit outfit
                  </a>
                )}
              </>
            )}
            {isAuthenticated && !isOutfitDetailPage && (
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
              if (!createLocalOutfit(selectedItemIds, outfitName.trim() || "My outfit")) return;
              setSelectedItemIds([]);
              setOutfitName("");
              setCollectionView("outfits");
            }}
          >
            <span>{selectedItemIds.length} item{selectedItemIds.length === 1 ? "" : "s"} selected</span>
            <input
              aria-label="Outfit name"
              maxLength={80}
              placeholder="Outfit name (optional)"
              value={outfitName}
              onChange={(event) => setOutfitName(event.target.value)}
            />
            <button type="submit">Create outfit</button>
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
        {deleteMessage && <p className="wardrobe-long-press-hint" role="status">{deleteMessage}</p>}
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
        {isAuthenticated && currentUserLoaded && collectionView === "outfits" &&
          isOutfitListPage && (
          outfits.length ? (
            <section className="outfit-card-grid" aria-label="Your outfits">
              {outfits.map((outfit) => {
                const outfitItems = outfit.clothing_item_ids
                  .map((id) => items.find((item) => item.clothing_item_id === id))
                  .filter((item): item is WardrobeItem => Boolean(item))
                  .sort((a, b) => outfitDisplayOrder(a) - outfitDisplayOrder(b));
                return (
                  <article className="outfit-card" key={outfit.outfit_id}>
                    <a
                      className="outfit-card-link"
                      href={`/outfit?id=${encodeURIComponent(outfit.outfit_id)}`}
                    >
                      <div className="outfit-card-images">
                        {outfit.source_image_id && imageUrls[outfit.source_image_id] && (
                          <img src={imageUrls[outfit.source_image_id]} alt="Outfit starting piece" />
                        )}
                        {outfitItems.map((item) => (
                          <img
                            key={item.clothing_item_id}
                            src={imageUrls[item.image_id] ?? ""}
                            alt={item.subcategory || item.category}
                          />
                        ))}
                      </div>
                      <h2>{outfit.name}</h2>
                      <span>View outfit details →</span>
                    </a>
                    <a
                      className="outfit-card-edit"
                      href={`/outfit-creation?id=${encodeURIComponent(outfit.outfit_id)}`}
                    >
                      Edit outfit
                    </a>
                    <button
                      className="outfit-card-delete"
                      type="button"
                      aria-label={`Delete ${outfit.name}`}
                      onClick={() => void deleteOutfit(outfit)}
                    >
                      Delete
                    </button>
                  </article>
                );
              })}
            </section>
          ) : (
            <p>You haven’t created any outfits yet. Select wardrobe items or create a new outfit.</p>
          )
        )}
        {isAuthenticated && currentUserLoaded && isOutfitDetailPage && (
          editingOutfit ? (
            <section className="outfit-detail-page" aria-label={`Outfit details: ${editingOutfit.name}`}>
              <div className="outfit-detail-heading">
                <div>
                  <p>{editingOutfit.clothing_item_ids.length} PIECE{editingOutfit.clothing_item_ids.length === 1 ? "" : "S"}</p>
                  <h2>{editingOutfit.name}</h2>
                </div>
                {editingOutfit.is_local && <span className="outfit-draft-label">Session draft</span>}
              </div>
              <div className="outfit-detail-pieces">
                {editingOutfit.source_image_id && imageUrls[editingOutfit.source_image_id] && (
                  <article className="outfit-detail-piece">
                    <img src={imageUrls[editingOutfit.source_image_id]} alt="Stylist outfit starting piece" />
                    <div>
                      <p className="outfit-piece-category">Stylist starting piece</p>
                      <h3>Original inspiration</h3>
                    </div>
                  </article>
                )}
                {editingOutfit.clothing_item_ids
                  .map((id) => items.find((item) => item.clothing_item_id === id))
                  .filter((item): item is WardrobeItem => Boolean(item))
                  .sort((a, b) => outfitDisplayOrder(a) - outfitDisplayOrder(b))
                  .map((item, index) => {
                    const description = [
                      item.primary_color,
                      item.pattern,
                      item.material,
                      item.fit && `${item.fit} fit`,
                    ].filter(Boolean);
                    return (
                      <article className="outfit-detail-piece" key={item.clothing_item_id}>
                        <img src={imageUrls[item.image_id] ?? ""} alt={item.subcategory || item.category} />
                        <div>
                          <p className="outfit-piece-category">
                            PIECE {String(index + 1).padStart(2, "0")} · {item.category}
                          </p>
                          <h3>{item.subcategory || item.category}</h3>
                          {description.length > 0 && <p>{description.join(" · ")}</p>}
                          {item.secondary_colors.length > 0 && (
                            <p>Also: {item.secondary_colors.join(", ")}</p>
                          )}
                          {item.style_tags.length > 0 && (
                            <div className="outfit-piece-tags">
                              {item.style_tags.map((tag) => <span key={tag}>{tag}</span>)}
                            </div>
                          )}
                          {(item.formality || item.season.length > 0) && (
                            <p>
                              {[item.formality, ...item.season].filter(Boolean).join(" · ")}
                            </p>
                          )}
                        </div>
                      </article>
                    );
                  })}
                {editingOutfit.clothing_item_ids.length === 0 && !editingOutfit.source_image_id && (
                  <p>This outfit has no clothing pieces.</p>
                )}
              </div>
              <section className="outfit-notes" aria-labelledby="outfit-notes-title">
                <div>
                  <p>YOUR STYLE JOURNAL</p>
                  <h2 id="outfit-notes-title">Notes on this outfit</h2>
                </div>
                <textarea
                  aria-label="Notes on this outfit"
                  maxLength={4000}
                  placeholder="What do you like about this outfit? Where would you wear it?"
                  value={editingOutfit.notes ?? ""}
                  onChange={(event) => updateOutfitNotes(event.target.value)}
                />
                <div className="outfit-notes-footer">
                  <span>{editingOutfit.notes?.length ?? 0}/4000</span>
                  {editingOutfit.is_local ? (
                    <span>Saved for this session</span>
                  ) : (
                    <button
                      className="outfit-save-button"
                      type="button"
                      disabled={isSavingNotes}
                      onClick={() => void saveOutfitNotes()}
                    >
                      {isSavingNotes ? "Saving…" : "Save notes"}
                    </button>
                  )}
                  {notesMessage && <span role="status">{notesMessage}</span>}
                </div>
                {outfitEditError && <p className="wardrobe-storage-error" role="alert">{outfitEditError}</p>}
              </section>
            </section>
          ) : (
            <div className="outfit-editor-empty">
              <p>This outfit could not be found. Return to your outfits to select another.</p>
            </div>
          )
        )}
        {isAuthenticated && currentUserLoaded && isOutfitCreatorPage && (
          editingOutfit ?
            <section className="outfit-workspace" aria-label="Outfit creator">
              <div className="outfit-editor">
                <div className="outfit-editor-heading">
                  <div>
                    <p>{editingOutfit.is_local ? "SESSION DRAFT" : "SAVED OUTFIT"}</p>
                    <input
                      aria-label="Outfit name"
                      maxLength={80}
                      value={editingOutfit.name}
                      onChange={(event) => updateEditingOutfit((outfit) => ({
                        ...outfit,
                        name: event.target.value,
                      }))}
                    />
                  </div>
                  <button
                    type="button"
                    className="outfit-save-button"
                    disabled={isSavingEditedOutfit || (
                      !editingOutfit.source_image_id && editingOutfit.clothing_item_ids.length === 0
                    )}
                    onClick={() => void saveEditedOutfit()}
                  >
                    {isSavingEditedOutfit ? "Saving…" : "Save outfit"}
                  </button>
                </div>
                <p className="outfit-editor-hint">Drag wardrobe pieces into the outfit, or select them below.</p>
                {outfitEditError && <p className="wardrobe-storage-error" role="alert">{outfitEditError}</p>}

                <div
                  className="outfit-drop-zone"
                  onDragOver={(event) => event.preventDefault()}
                  onDrop={(event) => {
                    event.preventDefault();
                    const itemId = event.dataTransfer.getData("text/clothing-item-id");
                    if (itemId && items.some((item) => item.clothing_item_id === itemId)) {
                      updateEditingOutfit((outfit) => ({
                        ...outfit,
                        clothing_item_ids: outfit.clothing_item_ids.includes(itemId)
                          ? outfit.clothing_item_ids
                          : [...outfit.clothing_item_ids, itemId],
                      }));
                    }
                  }}
                >
                  {editingOutfit.source_image_id && imageUrls[editingOutfit.source_image_id] && (
                    <figure>
                      <img src={imageUrls[editingOutfit.source_image_id]} alt="Outfit starting piece" />
                      <figcaption>Starting piece</figcaption>
                    </figure>
                  )}
                  {editingOutfit.clothing_item_ids
                    .map((id) => items.find((item) => item.clothing_item_id === id))
                    .filter((item): item is WardrobeItem => Boolean(item))
                    .sort((a, b) => outfitDisplayOrder(a) - outfitDisplayOrder(b))
                    .map((item) => (
                      <figure key={item.clothing_item_id}>
                        <button
                          className="outfit-remove-item"
                          type="button"
                          aria-label={`Remove ${item.subcategory || item.category} from outfit`}
                          onClick={() => toggleEditingItem(item.clothing_item_id)}
                        >
                          ×
                        </button>
                        <img src={imageUrls[item.image_id] ?? ""} alt={item.subcategory || item.category} />
                        <figcaption>{item.subcategory || item.category}</figcaption>
                      </figure>
                    ))}
                  {editingOutfit.clothing_item_ids.length === 0 && !editingOutfit.source_image_id && (
                    <p>Drop clothing items here to build your outfit.</p>
                  )}
                </div>

                <h3>Wardrobe items</h3>
                {items.length ? (
                  <div className="outfit-item-picker">
                    {items.map((item) => {
                      const selected = editingOutfit.clothing_item_ids.includes(item.clothing_item_id);
                      return (
                        <button
                          className={selected ? "outfit-picker-item is-selected" : "outfit-picker-item"}
                          key={item.clothing_item_id}
                          type="button"
                          draggable
                          aria-pressed={selected}
                          onClick={() => toggleEditingItem(item.clothing_item_id)}
                          onDragStart={(event) => {
                            event.dataTransfer.setData("text/clothing-item-id", item.clothing_item_id);
                            event.dataTransfer.effectAllowed = "copy";
                          }}
                        >
                          <img src={imageUrls[item.image_id] ?? ""} alt="" />
                          <span>{item.subcategory || item.category}</span>
                          <small>{selected ? "In outfit" : "Drag or click to add"}</small>
                        </button>
                      );
                    })}
                  </div>
                ) : <p>Your wardrobe has no items to add yet.</p>}
              </div>
            </section>
            :
              <div className="outfit-editor-empty">
                <p>This outfit could not be found. Return to your wardrobe and select an outfit to edit.</p>
              </div>
        )}
      </main>
      <footer className="site-footer">
        <span>PASSIONISTA</span>
        <span>YOUR STYLE YOUR WAY</span>
      </footer>
    </div>
  );
}
