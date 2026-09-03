import { LocalStore } from './store.js';

export class StoreAdapter {
  constructor(config = {}) {
    this.type = config.type || 'local';
    this.config = config;
    this.stores = new Map();
  }
  
  getStore(collection) {
    if (this.stores.has(collection)) {
      return this.stores.get(collection);
    }
    
    let store;
    switch (this.type) {
      case 'local':
        store = new LocalStore(collection);
        break;
      
      case 'firestore':
        store = this.createFirestoreStore(collection);
        break;
      
      default:
        store = new LocalStore(collection);
    }
    
    this.stores.set(collection, store);
    return store;
  }
  
  createFirestoreStore(collection) {
    return {
      collection,
      _firestore: null,
      
      async _initFirestore() {
        if (this._firestore) return this._firestore;
        
        if (!this.config.firebase) {
          throw new Error('Firebase config required for Firestore adapter');
        }
        
        const { initializeApp } = await import('firebase/app');
        const { getFirestore, collection: firestoreCollection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc } = await import('firebase/firestore');
        
        const app = initializeApp(this.config.firebase);
        this._firestore = getFirestore(app);
        this._firestoreLib = { collection: firestoreCollection, getDocs, addDoc, updateDoc, deleteDoc, doc, query, where, setDoc, getDoc };
        
        return this._firestore;
      },
      
      async getAll() {
        await this._initFirestore();
        const { collection, getDocs } = this._firestoreLib;
        const querySnapshot = await getDocs(collection(this._firestore, this.collection));
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      },
      
      async getById(id) {
        await this._initFirestore();
        const { doc, getDoc } = this._firestoreLib;
        const docRef = doc(this._firestore, this.collection, id);
        const docSnap = await getDoc(docRef);
        return docSnap.exists() ? { id: docSnap.id, ...docSnap.data() } : null;
      },
      
      async add(item) {
        await this._initFirestore();
        const { collection, addDoc } = this._firestoreLib;
        const docRef = await addDoc(collection(this._firestore, this.collection), {
          ...item,
          createdAt: item.createdAt || Date.now()
        });
        return { id: docRef.id, ...item };
      },
      
      async update(id, updates) {
        await this._initFirestore();
        const { doc, updateDoc } = this._firestoreLib;
        const docRef = doc(this._firestore, this.collection, id);
        await updateDoc(docRef, {
          ...updates,
          updatedAt: Date.now()
        });
        return { id, ...updates };
      },
      
      async delete(id) {
        await this._initFirestore();
        const { doc, deleteDoc } = this._firestoreLib;
        const docRef = doc(this._firestore, this.collection, id);
        await deleteDoc(docRef);
        return true;
      },
      
      async query(filter) {
        await this._initFirestore();
        const { collection, query, where, getDocs } = this._firestoreLib;
        
        let q = collection(this._firestore, this.collection);
        
        if (filter) {
          const conditions = Object.entries(filter).map(([key, value]) => 
            where(key, '==', value)
          );
          q = query(q, ...conditions);
        }
        
        const querySnapshot = await getDocs(q);
        return querySnapshot.docs.map(doc => ({ id: doc.id, ...doc.data() }));
      },

      async upsert(id, item) {
        await this._initFirestore();
        const { doc, setDoc } = this._firestoreLib;
        const payload = {
          ...item,
          id,
          updatedAt: Date.now()
        };
        await setDoc(doc(this._firestore, this.collection, id), payload, { merge: true });
        return { item: payload, inserted: true };
      },

      async upsertMany(items) {
        let inserted = 0;
        let updated = 0;
        for (const item of items || []) {
          if (!item || item.id == null) continue;
          const existing = await this.getById(item.id);
          await this.upsert(item.id, item);
          if (existing) updated += 1;
          else inserted += 1;
        }
        const all = await this.getAll();
        return { inserted, updated, total: all.length };
      }
    };
  }
}

export const storeAdapter = new StoreAdapter({
  type: process.env.STORE_TYPE || 'local',
  firebase: process.env.FIREBASE_CONFIG ? JSON.parse(process.env.FIREBASE_CONFIG) : null
});

export const forecastStore = storeAdapter.getStore('forecasts');
export const errorLogStore = storeAdapter.getStore('error_logs');
export const universeStore = storeAdapter.getStore('universe');
export const ingestWatermarkStore = storeAdapter.getStore('ingest_watermarks');
export const ingestSeriesStore = storeAdapter.getStore('ingest_series');
export const scannerFlipsStore = storeAdapter.getStore('scanner_flips');
