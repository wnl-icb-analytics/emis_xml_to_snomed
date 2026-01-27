/**
 * Storage utility for handling large XML data using IndexedDB
 * IndexedDB can handle much larger files than sessionStorage (typically 50MB+)
 */

const DB_NAME = 'emis-xml-analyser';
const STORE_NAME = 'parsedXmlData';
const DB_VERSION = 6; // v6: add listReport/columnGroups support

let dbPromise: Promise<IDBDatabase> | null = null;

function openDatabase(): Promise<IDBDatabase> {
  if (dbPromise) {
    return dbPromise;
  }

  dbPromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => {
      reject(new Error('Failed to open IndexedDB'));
    };

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      const oldVersion = event.oldVersion;

      // Clear old data on any version upgrade to force re-parse
      if (oldVersion < DB_VERSION) {
        console.log(`Upgrading database from v${oldVersion} to v${DB_VERSION} - clearing old data`);
        if (db.objectStoreNames.contains(STORE_NAME)) {
          db.deleteObjectStore(STORE_NAME);
        }
      }

      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
  });

  return dbPromise;
}

export async function saveParsedXmlData(data: any): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.put(data, 'current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to save data to IndexedDB'));
    });
  } catch (error) {
    console.error('Error saving to IndexedDB:', error);
    throw error;
  }
}

export async function loadParsedXmlData(): Promise<any | null> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readonly');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.get('current');
      request.onsuccess = () => {
        resolve(request.result || null);
      };
      request.onerror = () => {
        reject(new Error('Failed to load data from IndexedDB'));
      };
    });
  } catch (error) {
    console.error('Error loading from IndexedDB:', error);
    return null;
  }
}

export async function clearParsedXmlData(): Promise<void> {
  try {
    const db = await openDatabase();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    const store = transaction.objectStore(STORE_NAME);

    return new Promise((resolve, reject) => {
      const request = store.delete('current');
      request.onsuccess = () => resolve();
      request.onerror = () => reject(new Error('Failed to clear data from IndexedDB'));
    });
  } catch (error) {
    console.error('Error clearing IndexedDB:', error);
  }
}

export async function hasParsedXmlData(): Promise<boolean> {
  try {
    const data = await loadParsedXmlData();
    return data !== null;
  } catch {
    return false;
  }
}

