import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const STORE_DIR = path.resolve(__dirname, '../../store');

export class LocalStore {
  constructor(collection) {
    this.collection = collection;
    this.filepath = path.join(STORE_DIR, `${collection}.json`);
    this.cache = null;
  }
  
  _ensureStore() {
    if (!fs.existsSync(STORE_DIR)) {
      fs.mkdirSync(STORE_DIR, { recursive: true });
    }
    
    if (!fs.existsSync(this.filepath)) {
      fs.writeFileSync(this.filepath, JSON.stringify({ items: [] }, null, 2));
    }
  }
  
  _load() {
    this._ensureStore();
    try {
      const content = fs.readFileSync(this.filepath, 'utf-8');
      this.cache = JSON.parse(content);
      return this.cache;
    } catch (error) {
      console.error(`Error loading store ${this.collection}:`, error.message);
      this.cache = { items: [] };
      return this.cache;
    }
  }
  
  _save() {
    try {
      fs.writeFileSync(this.filepath, JSON.stringify(this.cache, null, 2));
      return true;
    } catch (error) {
      console.error(`Error saving store ${this.collection}:`, error.message);
      return false;
    }
  }
  
  getAll() {
    if (!this.cache) {
      this._load();
    }
    return this.cache.items || [];
  }
  
  getById(id) {
    const items = this.getAll();
    return items.find(item => item.id === id) || null;
  }
  
  add(item) {
    if (!this.cache) {
      this._load();
    }
    
    const newItem = {
      ...item,
      id: item.id || `${this.collection}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      createdAt: item.createdAt || Date.now()
    };
    
    this.cache.items.push(newItem);
    this._save();
    return newItem;
  }
  
  update(id, updates) {
    if (!this.cache) {
      this._load();
    }
    
    const index = this.cache.items.findIndex(item => item.id === id);
    if (index === -1) return null;
    
    this.cache.items[index] = {
      ...this.cache.items[index],
      ...updates,
      updatedAt: Date.now()
    };
    
    this._save();
    return this.cache.items[index];
  }
  
  delete(id) {
    if (!this.cache) {
      this._load();
    }
    
    const index = this.cache.items.findIndex(item => item.id === id);
    if (index === -1) return false;
    
    this.cache.items.splice(index, 1);
    this._save();
    return true;
  }
  
  query(filter) {
    const items = this.getAll();
    
    if (!filter) return items;
    
    return items.filter(item => {
      for (const [key, value] of Object.entries(filter)) {
        if (item[key] !== value) return false;
      }
      return true;
    });
  }
}

export const forecastStore = new LocalStore('forecasts');
export const errorLogStore = new LocalStore('error_logs');
export const universeStore = new LocalStore('universe');
