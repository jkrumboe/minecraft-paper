# Mojang Official Skin Resolution Implementation

## Overview
Production-ready skin resolution pipeline using Mojang's official Session Server API for an online-mode Minecraft Paper 1.20.4 server.

## Architecture

### Backend (Node.js)

#### SkinService.js
A singleton service that handles all skin resolution:

**Key Features:**
- ✅ Uses official Mojang Session Server API: `https://sessionserver.mojang.com/session/minecraft/profile/{uuid}`
- ✅ Decodes base64-encoded texture property
- ✅ Extracts `textures.SKIN.url` and `textures.SKIN.metadata.model`
- ✅ In-memory caching (6 hours per UUID)
- ✅ Prevents duplicate concurrent fetches
- ✅ 5-second timeout per request
- ✅ Graceful error handling with fallback to default Steve skin

**API Response:**
```javascript
{
  skinUrl: "https://textures.minecraft.net/texture/...",
  model: "default" // or "slim" for Alex
}
```

**Methods:**
- `getSkin(uuid)` - Async function to resolve skin data
- `cleanCache()` - Remove expired cache entries
- `getCacheStats()` - Get cache statistics

#### Server Integration (server.js)

**Skin Resolution Flow:**
1. When a player first appears in telemetry, `storeTelemetry()` detects it
2. Calls `skinService.getSkin(uuid)` to resolve their skin
3. Caches the result in `playerSkins` Map
4. Attaches `skinUrl` and `model` to all subsequent telemetry updates

**New API Endpoints:**
- `GET /api/players` - Returns all players with skin data attached
- `GET /api/players/:uuid/skin` - Get skin data for specific player

**Cache Management:**
- Automatic cleanup every hour
- Logs cache statistics during cleanup

### Frontend (index.html)

**Player Model Updates:**
- Extracts `skinUrl` and `model` from telemetry data
- Adjusts body width for Alex (slim) model: 0.35 vs 0.4 for Steve
- Loads skin texture from backend-provided URL
- Applies `NearestFilter` for authentic pixelated Minecraft look
- Falls back to colored head if skin loading fails

**Model Support:**
- ✅ Steve (classic/default) - wider body
- ✅ Alex (slim) - narrower body/arms

## Security & Performance

### Security
- ✅ Mojang API calls only from backend (not exposed to browser)
- ✅ No direct browser access to Mojang endpoints
- ✅ UUID validation through existing telemetry system

### Performance
- ✅ 6-hour cache per UUID (prevents excessive API calls)
- ✅ Concurrent fetch prevention (same UUID won't trigger multiple API calls)
- ✅ 5-second timeout prevents hanging requests
- ✅ Async/non-blocking skin resolution
- ✅ Frontend continues rendering while skins load
- ✅ Hourly cache cleanup prevents memory bloat

## API Flow Diagram

```
Minecraft Server (online-mode=true)
    ↓
  Player Joins (UUID + Name)
    ↓
  Telemetry Plugin → Docker Logs
    ↓
  server.js parses telemetry
    ↓
  First appearance detected
    ↓
  SkinService.getSkin(uuid)
    ↓
  Check cache → if expired/missing:
    ↓
  GET https://sessionserver.mojang.com/session/minecraft/profile/{uuid}
    ↓
  Parse base64 textures property
    ↓
  Extract skinUrl + model
    ↓
  Cache for 6 hours
    ↓
  Return { skinUrl, model }
    ↓
  Attach to telemetry data
    ↓
  SSE broadcast to browser
    ↓
  Frontend loads texture
    ↓
  Applies to player head mesh
```

## Error Handling

**Backend:**
- Mojang API timeout → Default Steve skin
- 404 (player not found) → Default Steve skin
- 429 (rate limit) → Default Steve skin, log warning
- Network errors → Default Steve skin
- Invalid JSON → Default Steve skin

**Frontend:**
- Skin texture load failure → Colored fallback head
- Missing skinUrl in data → Colored fallback head
- Invalid texture URL → Colored fallback head

## Testing

1. Start server: `node server.js`
2. Join Minecraft server (online-mode=true)
3. Check console for: `🎨 Resolving skin for new player...`
4. Verify: `✅ Skin resolved for {name}: {model} model`
5. Open browser: http://localhost:3000
6. Player head should show their actual Minecraft skin

## Cache Statistics

Monitor cache performance:
```
🧹 Cache cleanup: X skins cached, Y pending fetches
```

Logged every hour during cleanup cycle.

## Dependencies

No additional packages required - uses Node.js built-in `fetch` (Node 18+).

## Default Skin

Falls back to official Steve skin texture:
```
https://textures.minecraft.net/texture/31f477eb1a7beee631c2ca64d06f8f68fa93a3386d04452ab27f43acdf1b60cb
```

## Configuration

Constants in `SkinService.js`:
- `CACHE_DURATION_MS` - 6 hours (21,600,000 ms)
- `FETCH_TIMEOUT_MS` - 5 seconds (5,000 ms)
- `SESSION_SERVER_URL` - Mojang endpoint

---

## Block Texture Improvements (Jan 2, 2026)

### Enhanced Block Type Support

Added comprehensive block type recognition and proper texture mapping:

**New Block Types:**
-  **Cobblestone** - proper cobblestone texture (was mapped to generic stone)
-  **Gravel** - dedicated gravel texture  
-  **Oak Logs** - with top/side different textures (bark on sides, rings on top/bottom)
-  **Oak Planks** - wooden plank texture
-  **Oak Leaves** - transparent leaf texture with proper alpha channel
-  **Snow** - bright white snow texture
-  **Sand** - now properly mapped to sand texture (was incorrectly mapped to stone)

**Improved Block Mapping Logic:**
- Checks for cobblestone BEFORE stone to avoid substring matching issues
- Separates _log blocks from generic wood/planks  
- Proper leaves recognition with transparency
- Dedicated snow texture
- All ores map to stone appearance

**Frontend Improvements:**
- Added 7 new textures from Minecraft 1.20.4 assets
- Multi-material support for logs (different top vs. side)
- Transparency for leaves (alpha: 0.9) and water (alpha: 0.6)
- NearestFilter for authentic pixelated look

**Performance:**
- Multi-material blocks (grass, wood) rendered individually
- Single-material blocks use geometry merging
- Face culling active to skip hidden faces
