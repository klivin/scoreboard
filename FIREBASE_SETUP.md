# Firebase / Firestore Setup for Scoreboard

## Overview

Scoreboard uses a store adapter pattern that allows swapping between local JSON storage and Firestore with configuration only - no code rewrite required.

## Current Setup (Default)

By default, Scoreboard uses **local JSON files** in the `store/` directory:
- `store/forecasts.json`
- `store/error_logs.json`
- `store/universe.json`

This works out of the box with no configuration.

## Migrating to Firestore

### Step 1: Create a New Firebase Project

1. Go to [console.firebase.google.com](https://console.firebase.google.com)
2. Click "Add project"
3. **Project name:** `Scoreboard` (NOT pooli-19f1c)
4. Accept terms and click "Create project"
5. Wait for project creation

### Step 2: Enable Firestore Database

1. In the Firebase Console, click "Firestore Database" in the left sidebar
2. Click "Create database"
3. Choose "Start in production mode" (or test mode for development)
4. Select a Firestore location (choose closest to your users)
5. Click "Enable"

### Step 3: Get Firebase Configuration

1. In Firebase Console, click the gear icon → "Project settings"
2. Scroll down to "Your apps"
3. Click the web icon `</>` to add a web app
4. Register app name: "Scoreboard Web"
5. Copy the Firebase configuration object:

```javascript
{
  apiKey: "AIza...",
  authDomain: "scoreboard-xxxxx.firebaseapp.com",
  projectId: "scoreboard-xxxxx",
  storageBucket: "scoreboard-xxxxx.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:xxxxx"
}
```

### Step 4: Configure Scoreboard

Create a `.env` file in the project root:

```bash
# Store Type: 'local' or 'firestore'
STORE_TYPE=firestore

# Firebase Configuration (JSON string)
FIREBASE_CONFIG='{"apiKey":"AIza...","authDomain":"scoreboard-xxxxx.firebaseapp.com","projectId":"scoreboard-xxxxx","storageBucket":"scoreboard-xxxxx.appspot.com","messagingSenderId":"123456789","appId":"1:123456789:web:xxxxx"}'
```

### Step 5: Install Firebase SDK (if using Firestore)

```bash
npm install firebase
```

### Step 6: Restart Server

```bash
npm start
```

The store adapter will automatically use Firestore instead of local JSON files.

## Store Adapter Architecture

### Unified Interface

Both local and Firestore stores implement the same interface:

```javascript
interface Store {
  getAll(): Promise<Array<any>>
  getById(id: string): Promise<any | null>
  add(item: object): Promise<object>
  update(id: string, updates: object): Promise<object>
  delete(id: string): Promise<boolean>
  query(filter: object): Promise<Array<any>>
}
```

### Collections

Scoreboard uses three collections:

1. **forecasts** - Forecast predictions and metadata
2. **error_logs** - Error tracking and MAE calculations
3. **universe** - Crypto universe data (top 100, categories)

### Data Models

#### Forecasts Collection
```json
{
  "id": "forecast_1234567890_abc",
  "symbol": "BTC",
  "horizonDays": 7,
  "forecast": {
    "prediction": 42000,
    "upper": 45000,
    "lower": 39000,
    "naive": 41000
  },
  "timestamp": 1693526400000,
  "createdAt": 1693526400000
}
```

#### Error Logs Collection
```json
{
  "id": "error_1234567890_xyz",
  "symbol": "BTC",
  "horizonDays": 7,
  "mae": 1250.5,
  "mape": 3.2,
  "method": "trend",
  "timestamp": 1693526400000,
  "createdAt": 1693526400000
}
```

#### Universe Collection
```json
{
  "id": "universe_20260831",
  "coins": [
    {
      "symbol": "BTC",
      "name": "Bitcoin",
      "market_cap": 850000000000,
      "rank": 1
    }
  ],
  "updated": 1693526400000,
  "createdAt": 1693526400000
}
```

## Switching Back to Local Storage

To switch back to local JSON storage:

1. Update `.env`:
```bash
STORE_TYPE=local
```

2. Restart server:
```bash
npm start
```

## Migration Script

To migrate existing local data to Firestore:

```javascript
// migrate-to-firestore.js
import { LocalStore } from './src/model/store.js';
import { storeAdapter } from './src/model/store-adapter.js';

async function migrate(collection) {
  const local = new LocalStore(collection);
  const firestore = storeAdapter.getStore(collection);
  
  const items = local.getAll();
  console.log(`Migrating ${items.length} items from ${collection}...`);
  
  for (const item of items) {
    await firestore.add(item);
  }
  
  console.log(`✓ ${collection} migrated`);
}

migrate('forecasts');
migrate('error_logs');
migrate('universe');
```

## Security Rules (Production)

Set Firestore security rules in Firebase Console:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    // Forecasts - read public, write authenticated
    match /forecasts/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
    
    // Error logs - read/write authenticated only
    match /error_logs/{document} {
      allow read, write: if request.auth != null;
    }
    
    // Universe - read public, write authenticated
    match /universe/{document} {
      allow read: if true;
      allow write: if request.auth != null;
    }
  }
}
```

## Testing

Test the adapter with:

```bash
# Local storage
STORE_TYPE=local npm start

# Firestore (requires Firebase config)
STORE_TYPE=firestore npm start
```

## Important Notes

- **Never use** `pooli-19f1c` - create a NEW project named "Scoreboard"
- Firebase config should be in `.env`, never committed to git
- `.env` is already in `.gitignore`
- Local JSON files in `store/` are also gitignored
- The store adapter automatically handles the abstraction
- Same API endpoints work with both storage types
- No code changes needed to swap storage backends

## Environment Variables

```bash
# Required for Firestore
STORE_TYPE=firestore
FIREBASE_CONFIG='{"apiKey":"...","authDomain":"...","projectId":"...","storageBucket":"...","messagingSenderId":"...","appId":"..."}'

# Optional
PORT=3000
NODE_ENV=development
```

## Verifying Firestore Connection

After configuration, check logs for:

```
✓ Firestore connected to project: scoreboard-xxxxx
✓ Collections initialized: forecasts, error_logs, universe
```

If you see errors, verify:
1. Firebase config is correct JSON in `.env`
2. `firebase` package is installed (`npm install firebase`)
3. Firestore is enabled in Firebase Console
4. Security rules allow read/write access
