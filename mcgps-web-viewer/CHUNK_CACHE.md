# Persistent Chunk Caching

## Overview

The McGPS Web Viewer now implements persistent chunk caching to maintain the world state across:
- WebUI page refreshes
- WebUI server restarts  
- Minecraft server restarts

## How It Works

### Storage Format

Chunks are stored in a file-based cache using the following structure:

```
chunks/
├── world/
│   ├── 0,0.json
│   ├── 0,1.json
│   ├── 1,0.json
│   └── ...
├── world_nether/
│   ├── 0,0.json
│   └── ...
└── world_the_end/
    └── ...
```

Each chunk file contains:
```json
{
  "worldName": "world",
  "chunkX": 0,
  "chunkZ": 0,
  "blocks": [
    {"x": 0, "y": 64, "z": 0, "type": "grass"},
    {"x": 1, "y": 64, "z": 0, "type": "dirt"},
    ...
  ],
  "timestamp": 1704268800000,
  "version": 1
}
```

### Cache Operations

#### On Server Startup
1. Server loads all cached chunks from disk
2. Chunks are loaded into memory for each world
3. When a client connects, all cached chunks are sent to them immediately

#### When New Chunks Are Generated
1. Plugin sends chunk data to the server (as before)
2. Server stores chunk in memory (as before)
3. Server **also** saves chunk to disk asynchronously

#### When Blocks Change
1. Plugin sends block change events (as before)
2. Server updates the chunk in memory (as before)
3. Server **also** updates the chunk file on disk

#### When Chunks Are Unloaded
1. Plugin sends chunk unload events
2. Server removes chunks from memory
3. Server **also** deletes chunk files from disk

### Smart Caching

The system only caches chunks that have been rendered:
- Only visible blocks (those with exposed faces) are stored
- Water blocks are fully cached for proper rendering
- Vegetation and air blocks are filtered out by the plugin

This approach minimizes disk usage while ensuring complete world reconstruction.

## API Endpoints

### Get Cache Statistics
```bash
curl http://localhost:3000/api/cache/stats
```

Response:
```json
{
  "totalChunks": 128,
  "worlds": {
    "world": 100,
    "world_nether": 20,
    "world_the_end": 8
  }
}
```

### Clear Cache

Clear all worlds:
```bash
curl -X POST http://localhost:3000/api/cache/clear
```

Clear specific world:
```bash
curl -X POST http://localhost:3000/api/cache/clear?world=world_nether
```

## Performance

### Memory Usage
- Chunks are kept in memory for fast access
- Disk operations are performed asynchronously to avoid blocking

### Disk Usage
- Each chunk file is typically 1-10 KB (depending on terrain complexity)
- 100 chunks ≈ 100-1000 KB (0.1-1 MB)
- A typical play session might cache 200-500 chunks (0.2-5 MB)

### I/O Operations
- **Write**: Chunks are saved asynchronously using `setImmediate()`
- **Read**: All chunks are loaded once on server startup
- **Update**: Block changes trigger immediate file updates

## Benefits

### For Users
1. **Instant World Loading**: When you refresh the WebUI or restart the server, the world is already there
2. **Persistent Progress**: World state is maintained even if the Minecraft server restarts
3. **No Regeneration Delay**: No need to wait for chunks to be generated again

### For Developers
1. **Simple Implementation**: File-based storage is easy to understand and debug
2. **No External Dependencies**: Uses only Node.js built-in `fs` module
3. **Easy Backup**: Just copy the `chunks/` directory

## Limitations

### Current Limitations
1. **No Expiration**: Cached chunks never expire automatically
2. **No Compression**: Chunks are stored as plain JSON (could be optimized)
3. **No Validation**: Server doesn't detect if chunks are outdated

### Future Enhancements
Possible improvements:
- Add chunk versioning to detect when world seed changes
- Implement chunk expiration based on age or access time
- Add compression to reduce disk usage
- Add incremental updates instead of full chunk rewrites

## Troubleshooting

### Cache Not Persisting
- Check that the server has write permissions in the working directory
- Verify `chunks/` directory is not in `.gitignore` (it should be)
- Check server logs for any error messages

### Stale Data After World Reset
If you reset your Minecraft world, clear the cache:
```bash
curl -X POST http://localhost:3000/api/cache/clear
```

### High Disk Usage
Check cache statistics:
```bash
curl http://localhost:3000/api/cache/stats
```

Clear cache if needed:
```bash
curl -X POST http://localhost:3000/api/cache/clear
```

## Testing

A test suite is provided in `test-cache.js`:

```bash
cd mcgps-web-viewer
node test-cache.js
```

This verifies:
- Chunk save/load operations
- Multi-world support
- Block updates
- Cache statistics
- Cleanup operations
