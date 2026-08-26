require('dotenv').config();
const admin = require('firebase-admin');
const fs = require('fs');
const path = require('path');

let db;
let isMock = false;

const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');

// Initial seed data
const initialEmployees = [
  { id: 'emp_1', name: 'Muhammad Ali', specialty: 'Plumber', email: 'ali@universalinterior.pk', phone: '+92 300 7654321', rating: 4.8, jobs: 342 },
  { id: 'emp_2', name: 'Zeeshan Khan', specialty: 'Electrician', email: 'zeeshan@universalinterior.pk', phone: '+92 301 2345678', rating: 4.9, jobs: 218 },
  { id: 'emp_3', name: 'Sajid Mehmood', specialty: 'AC Repair', email: 'sajid@universalinterior.pk', phone: '+92 302 8765432', rating: 4.7, jobs: 195 },
  { id: 'emp_4', name: 'Yasir Ahmed', specialty: 'Carpenter', email: 'yasir@universalinterior.pk', phone: '+92 303 5556667', rating: 4.6, jobs: 89 }
];

// Firebase Admin Initialization (Secure Env Variables)
if (process.env.FIREBASE_PRIVATE_KEY && process.env.FIREBASE_CLIENT_EMAIL) {
  try {
    admin.initializeApp({
      credential: admin.credential.cert({
        projectId: process.env.FIREBASE_PROJECT_ID || 'universalinterior-b1276',
        clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
        privateKey: process.env.FIREBASE_PRIVATE_KEY.replace(/\\n/g, '\n'),
      })
    });
    db = admin.firestore();
    console.log('Firebase DB: Successfully initialized Firebase Firestore via .env Environment Variables');
    seedRealFirestore();
  } catch (err) {
    console.error('Firebase DB: Initialization failed with environment variables:', err.message);
    setupLocalDb();
  }
} else if (fs.existsSync(serviceAccountPath)) {
  try {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount)
    });
    db = admin.firestore();
    console.log('Firebase DB: Successfully initialized Firebase Firestore via serviceAccountKey.json');
    seedRealFirestore();
  } catch (err) {
    console.error('Firebase DB: Initialization failed with key file:', err.message);
    setupLocalDb();
  }
} else {
  console.log('Firebase DB: No credentials found in .env. Using local JSON database (db.json)');
  setupLocalDb();
}

async function seedRealFirestore() {
  try {
    const snapshot = await db.collection('employees').limit(1).get();
    if (snapshot.empty) {
      for (const emp of initialEmployees) {
        await db.collection('employees').doc(emp.id).set(emp);
      }
    }
  } catch (error) {
    if (error.code === 5 || error.message?.includes('NOT_FOUND')) {
      console.warn('Firebase DB Notice: Firestore database not created in Firebase Console yet. Using local database (db.json)');
      setupLocalDb();
    } else {
      console.error('Firebase DB: Error seeding Firestore:', error.message);
    }
  }
}

function setupLocalDb() {
  isMock = true;
  const dbPath = path.join(__dirname, 'db.json');
  
  const readData = () => {
    if (!fs.existsSync(dbPath)) {
      const initial = { users: [], employees: [], bookings: [] };
      fs.writeFileSync(dbPath, JSON.stringify(initial, null, 2));
      return initial;
    }
    try {
      return JSON.parse(fs.readFileSync(dbPath, 'utf8'));
    } catch (e) {
      console.error('Error reading db.json, returning empty database structure', e);
      return { users: [], employees: [], bookings: [] };
    }
  };

  const writeData = (data) => {
    try {
      fs.writeFileSync(dbPath, JSON.stringify(data, null, 2));
    } catch (e) {
      console.error('Error writing to db.json:', e);
    }
  };

  // Seed local DB if empty
  const data = readData();
  if (!data.employees || data.employees.length === 0) {
    data.employees = initialEmployees;
    writeData(data);
  }

  // Abstract Firestore API interface
  db = {
    collection: (colName) => {
      return {
        get: async () => {
          const dbData = readData();
          const list = dbData[colName] || [];
          return {
            empty: list.length === 0,
            docs: list.map(item => ({
              id: item.id,
              data: () => item
            }))
          };
        },
        doc: (docId) => {
          return {
            get: async () => {
              const dbData = readData();
              const list = dbData[colName] || [];
              const found = list.find(x => x.id === docId);
              return {
                exists: !!found,
                data: () => found,
                id: docId
              };
            },
            set: async (data, options) => {
              const dbData = readData();
              if (!dbData[colName]) dbData[colName] = [];
              const list = dbData[colName];
              const idx = list.findIndex(x => x.id === docId);
              
              const mergedData = options && options.merge && idx !== -1 
                ? { ...list[idx], ...data } 
                : { ...data, id: docId };

              if (idx !== -1) {
                list[idx] = mergedData;
              } else {
                list.push(mergedData);
              }
              writeData(dbData);
              return true;
            },
            update: async (data) => {
              const dbData = readData();
              if (!dbData[colName]) dbData[colName] = [];
              const list = dbData[colName];
              const idx = list.findIndex(x => x.id === docId);
              if (idx !== -1) {
                list[idx] = { ...list[idx], ...data };
                writeData(dbData);
                return true;
              }
              throw new Error(`Document ${docId} not found in collection ${colName}`);
            },
            delete: async () => {
              const dbData = readData();
              if (!dbData[colName]) dbData[colName] = [];
              const list = dbData[colName];
              const filtered = list.filter(x => x.id !== docId);
              dbData[colName] = filtered;
              writeData(dbData);
              return true;
            }
          };
        },
        add: async (data) => {
          const dbData = readData();
          if (!dbData[colName]) dbData[colName] = [];
          const id = colName.substring(0, 3) + '_' + Math.random().toString(36).substr(2, 9);
          const newItem = { ...data, id };
          dbData[colName].push(newItem);
          writeData(dbData);
          return { id, data: () => newItem };
        },
        where: function(field, op, value) {
          return {
            get: async () => {
              const dbData = readData();
              const list = dbData[colName] || [];
              const filtered = list.filter(item => {
                if (op === '==') return item[field] === value;
                if (op === '!=') return item[field] !== value;
                return false;
              });
              return {
                empty: filtered.length === 0,
                docs: filtered.map(item => ({
                  id: item.id,
                  data: () => item
                }))
              };
            }
          };
        }
      };
    }
  };
}

module.exports = {
  db,
  getDb: () => db,
  isMockDatabase: () => isMock
};
