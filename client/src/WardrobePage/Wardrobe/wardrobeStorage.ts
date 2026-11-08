export type SavedWardrobePhoto = {
  id: string;
  file: Blob;
  caption: string;
  savedAt: string;
};

const DATABASE_NAME = "passionista-wardrobe";
const STORE_NAME = "photos";

function openDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) {
      reject(new Error("This browser does not support local photo storage."));
      return;
    }

    const request = indexedDB.open(DATABASE_NAME, 1);
    request.onupgradeneeded = () => {
      if (!request.result.objectStoreNames.contains(STORE_NAME)) {
        request.result.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("Could not open local photo storage."));
  });
}

export async function loadSavedPhotos(): Promise<SavedWardrobePhoto[]> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readonly");
    const request = transaction.objectStore(STORE_NAME).getAll();
    request.onsuccess = () => resolve(request.result as SavedWardrobePhoto[]);
    request.onerror = () => reject(request.error ?? new Error("Could not load saved photos."));
    transaction.oncomplete = () => database.close();
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not load saved photos."));
    };
  });
}

export async function savePhoto(photo: SavedWardrobePhoto): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).put(photo);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not save this photo."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not save this photo."));
    };
  });
}

export async function deletePhoto(id: string): Promise<void> {
  const database = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, "readwrite");
    transaction.objectStore(STORE_NAME).delete(id);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not remove this photo."));
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error ?? new Error("Could not remove this photo."));
    };
  });
}
