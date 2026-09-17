require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

// Determine execution environment
const isVercel = Boolean(process.env.VERCEL || process.env.AWS_LAMBDA_FUNCTION_NAME);
const localDbPath = path.join(__dirname, 'db.json');
const writableDbPath = isVercel ? path.join('/tmp', 'db.json') : localDbPath;



// --- Resilient In-Memory & Local Storage Fallback ---
let memoryStore = null;

function loadInitialStore() {
  // 1. Try writableDbPath (e.g. /tmp/db.json in serverless)
  if (fs.existsSync(writableDbPath)) {
    try {
      const raw = fs.readFileSync(writableDbPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Could not parse database from writable path:', e.message);
    }
  }
  // 2. Try bundled localDbPath (__dirname/db.json)
  if (fs.existsSync(localDbPath)) {
    try {
      const raw = fs.readFileSync(localDbPath, 'utf8');
      return JSON.parse(raw);
    } catch (e) {
      console.warn('Could not parse db.json:', e.message);
    }
  }
  // 3. Fallback defaults
  return {
    users: [],
    employees: [],
    bookings: [],
    settings: [],
    services: [],
    emailCampaigns: []
  };
}

function getStore() {
  if (!memoryStore) {
    memoryStore = loadInitialStore();
    if (!memoryStore.employees) memoryStore.employees = [];
    if (!memoryStore.users) memoryStore.users = [];
    if (!memoryStore.bookings) memoryStore.bookings = [];
    if (!memoryStore.settings) memoryStore.settings = [];
    if (!memoryStore.services) memoryStore.services = [];
    if (!memoryStore.emailCampaigns) memoryStore.emailCampaigns = [];
  }
  return memoryStore;
}

function saveStore(data) {
  memoryStore = data;
  try {
    fs.writeFileSync(writableDbPath, JSON.stringify(data, null, 2));
  } catch (err) {
    // Non-fatal if filesystem is read-only; memoryStore maintains state in memory
  }
}

// Fallback Firestore-compatible Query & Collection Builder
function createFallbackCollection(colName) {
  const getColList = () => {
    const store = getStore();
    if (!Array.isArray(store[colName])) {
      store[colName] = [];
    }
    return store[colName];
  };

  const createQueryObj = (filterFn = null, limitCount = null) => {
    return {
      where: (field, op, val) => {
        const newFilter = (item) => {
          const basePass = filterFn ? filterFn(item) : true;
          if (!basePass) return false;
          if (op === '==') return item[field] === val;
          if (op === '!=') return item[field] !== val;
          if (op === '>') return item[field] > val;
          if (op === '>=') return item[field] >= val;
          if (op === '<') return item[field] < val;
          if (op === '<=') return item[field] <= val;
          if (op === 'array-contains') return Array.isArray(item[field]) && item[field].includes(val);
          return true;
        };
        return createQueryObj(newFilter, limitCount);
      },
      limit: (n) => {
        return createQueryObj(filterFn, n);
      },
      orderBy: () => {
        return createQueryObj(filterFn, limitCount);
      },
      get: async () => {
        const list = getColList();
        let filtered = filterFn ? list.filter(filterFn) : [...list];
        if (typeof limitCount === 'number' && limitCount >= 0) {
          filtered = filtered.slice(0, limitCount);
        }
        return {
          empty: filtered.length === 0,
          size: filtered.length,
          docs: filtered.map(item => ({
            id: item.id || (typeof item.email === 'string' ? item.email : ''),
            data: () => ({ ...item }),
            exists: true
          }))
        };
      }
    };
  };

  return {
    ...createQueryObj(),
    doc: (docId) => ({
      get: async () => {
        const list = getColList();
        const found = list.find(x => x.id === docId || (colName === 'users' && x.email === docId));
        return {
          exists: !!found,
          id: docId,
          data: () => (found ? { ...found } : undefined)
        };
      },
      set: async (data, options) => {
        const store = getStore();
        if (!Array.isArray(store[colName])) store[colName] = [];
        const list = store[colName];
        const idx = list.findIndex(x => x.id === docId || (colName === 'users' && x.email === docId));
        const mergedData = options && options.merge && idx !== -1
          ? { ...list[idx], ...data }
          : { ...data, id: docId };

        if (idx !== -1) {
          list[idx] = mergedData;
        } else {
          list.push(mergedData);
        }
        saveStore(store);
        return true;
      },
      update: async (data) => {
        const store = getStore();
        if (!Array.isArray(store[colName])) store[colName] = [];
        const list = store[colName];
        const idx = list.findIndex(x => x.id === docId || (colName === 'users' && x.email === docId));
        if (idx !== -1) {
          list[idx] = { ...list[idx], ...data };
          saveStore(store);
          return true;
        }
        throw new Error(`Document ${docId} not found in collection ${colName}`);
      },
      delete: async () => {
        const store = getStore();
        if (!Array.isArray(store[colName])) store[colName] = [];
        store[colName] = store[colName].filter(x => x.id !== docId && (colName !== 'users' || x.email !== docId));
        saveStore(store);
        return true;
      }
    }),
    add: async (data) => {
      const store = getStore();
      if (!Array.isArray(store[colName])) store[colName] = [];
      const id = colName.substring(0, 3) + '_' + Math.random().toString(36).substr(2, 9);
      const newItem = { ...data, id };
      store[colName].push(newItem);
      saveStore(store);
      return { id, data: () => ({ ...newItem }) };
    }
  };
}

// --- Firebase Admin Real Firestore Initialization ---
let realDb = null;
let isRealDbAvailable = false;

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  try {
    let privateKey = process.env.FIREBASE_PRIVATE_KEY.trim();
    if ((privateKey.startsWith('"') && privateKey.endsWith('"')) || (privateKey.startsWith("'") && privateKey.endsWith("'"))) {
      privateKey = privateKey.slice(1, -1);
    }
    privateKey = privateKey.replace(/\\n/g, '\n');

    if (!admin.apps.length) {
      admin.initializeApp({
        credential: admin.credential.cert({
          projectId: process.env.FIREBASE_PROJECT_ID || 'universalinterior-b1276',
          clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
          privateKey,
        })
      });
    }
    realDb = admin.firestore();
    isRealDbAvailable = true;
  } catch (err) {
    console.warn('Firebase DB: Initialization failed with environment variables:', err.message);
    realDb = null;
    isRealDbAvailable = false;
  }
} else if (fs.existsSync(serviceAccountPath)) {
  try {
    if (!admin.apps.length) {
      const serviceAccount = require(serviceAccountPath);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
    }
    realDb = admin.firestore();
    isRealDbAvailable = true;
  } catch (err) {
    console.warn('Firebase DB: Initialization failed with key file:', err.message);
    realDb = null;
    isRealDbAvailable = false;
  }
}

// Background verification of real Firestore availability
let isCheckingDb = false;

async function checkRealDbAvailability() {
  if (!realDb || isCheckingDb) return;
  isCheckingDb = true;
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore connection timeout')), 8000)
    );
    await Promise.race([
      realDb.collection('users').limit(1).get(),
      timeoutPromise
    ]);
    isRealDbAvailable = true;
  } catch (error) {
    if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
      console.warn('Firebase DB Notice: Firestore database not created in Firebase Console yet. Resilient fallback database is active.');
      isRealDbAvailable = false;
    } else {
      console.warn('Firebase DB Notice: Firestore latency (' + (error.message || error.code) + '). Firestore remains active with failover.');
    }
  }
}

if (realDb) {
  checkRealDbAvailability();
}

// Helper to execute realDb operations with a fast timeout and failover
async function execWithFailover(realFn, fallbackFn, timeoutMs = 6000) {
  if (!isRealDbAvailable || !realDb) {
    return await fallbackFn();
  }
  try {
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Firestore operation timed out')), timeoutMs)
    );
    return await Promise.race([realFn(), timeoutPromise]);
  } catch (err) {
    console.warn('[Firestore Failover] Real DB operation failed, switching to fallback store:', err.message || err);
    if (err.code === 5 || err.message?.includes('NOT_FOUND')) {
      isRealDbAvailable = false;
    }
    return await fallbackFn();
  }
}

// --- Resilient Unified DB Adapter ---
// Controllers always hold a permanent reference to this object
const db = {
  collection: (colName) => {
    const fallbackCol = createFallbackCollection(colName);

    if (isRealDbAvailable && realDb) {
      const realCol = realDb.collection(colName);

      return {
        get: async () => {
          return execWithFailover(
            () => realCol.get(),
            () => fallbackCol.get()
          );
        },
        doc: (docId) => {
          const realDoc = realCol.doc(docId);
          const fallbackDoc = fallbackCol.doc(docId);
          return {
            id: docId,
            get: async () => {
              const res = await execWithFailover(
                () => realDoc.get(),
                () => fallbackDoc.get()
              );
              if (res && res.exists) return res;
              // If not found in primary, check fallback store just in case
              const fbRes = await fallbackDoc.get();
              if (fbRes && fbRes.exists) {
                // Background sync to real Firestore
                try { realDoc.set(fbRes.data()); } catch (_) {}
                return fbRes;
              }
              return res;
            },
            set: async (data, options) => {
              // Write to fallback store immediately so local state is synchronous
              await fallbackDoc.set(data, options);
              // Also persist to real Firestore
              return execWithFailover(
                () => (options !== undefined ? realDoc.set(data, options) : realDoc.set(data)),
                () => true
              );
            },
            update: async (data) => {
              try { await fallbackDoc.update(data); } catch (_) {}
              return execWithFailover(
                () => realDoc.update(data),
                () => true
              );
            },
            delete: async () => {
              try { await fallbackDoc.delete(); } catch (_) {}
              return execWithFailover(
                () => realDoc.delete(),
                () => true
              );
            }
          };
        },
        where: (...args) => {
          const fallbackQuery = fallbackCol.where(...args);
          if (isRealDbAvailable && realDb) {
            try {
              const realQuery = realCol.where(...args);
              return {
                get: async () => {
                  return execWithFailover(
                    () => realQuery.get(),
                    () => fallbackQuery.get()
                  );
                }
              };
            } catch (err) {
              return fallbackQuery;
            }
          }
          return fallbackQuery;
        },
        add: async (data) => {
          return execWithFailover(
            () => realCol.add(data),
            () => fallbackCol.add(data)
          );
        }
      };
    }

    // Default to resilient fallback store
    return fallbackCol;
  }
};

module.exports = {
  db,
  getDb: () => db,
  isMockDatabase: () => !isRealDbAvailable
};

