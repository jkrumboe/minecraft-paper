/**
 * McGPS Web Viewer - Real-time 3D Player Tracking
 * 
 * This server:
 * 1. Tails Docker logs from the minecraft-paper container
 * 2. Parses JSON telemetry lines from McGpsTelemetry plugin
 * 3. Serves a 3D web interface
 * 4. Streams telemetry updates to browsers via Server-Sent Events (SSE)
 * 
 * Usage:
 *   npm install
 *   npm start
 *   Open http://localhost:3000
 */

const express = require('express');
const path = require('path');
const { spawn } = require('child_process');
const https = require('https');
const skinService = require('./SkinService');
const ChunkCache = require('./ChunkCache');

const app = express();
const PORT = 3000;

// Store recent player positions (keep last 100 per player)
const playerData = new Map();
const MAX_HISTORY = 100;

// Store loaded chunks per world (worldName -> Map<chunkKey, blocks>)
const worldChunks = new Map();

// Track current world for each player
const playerWorlds = new Map();

// Store player skin data (resolved from Mojang API)
const playerSkins = new Map();

// Active SSE clients
const clients = new Set();

// Persistent chunk cache
const chunkCache = new ChunkCache('./chunks');

// Serve static files from public directory (use absolute path)
app.use(express.static(path.join(__dirname, 'public')));

/**
 * Skin proxy endpoint - fetches skin from Mojang and serves to client (bypasses CORS)
 */
app.get('/skin/:uuid', async (req, res) => {
    try {
        const uuid = req.params.uuid.replace(/-/g, '');
        
        // Get skin URL from cache or fetch from Mojang
        const skinData = await skinService.getSkin(uuid);
        
        if (!skinData || !skinData.skinUrl) {
            return res.status(404).send('Skin not found');
        }
        
        // Fetch the skin image from Mojang using https module
        https.get(skinData.skinUrl, { 
            headers: { 'User-Agent': 'McGPS-Telemetry/1.0' }
        }, (skinResponse) => {
            if (skinResponse.statusCode !== 200) {
                return res.status(skinResponse.statusCode).send('Failed to fetch skin');
            }
            
            // Set headers
            res.set('Content-Type', 'image/png');
            res.set('Cache-Control', 'public, max-age=3600');
            res.set('Access-Control-Allow-Origin', '*');
            
            // Pipe the image directly to response
            skinResponse.pipe(res);
        }).on('error', (err) => {
            console.error('Skin fetch error:', err.message);
            res.status(500).send('Error fetching skin');
        });
        
    } catch (error) {
        console.error('Skin proxy error:', error.message);
        res.status(500).send('Error fetching skin');
    }
});

/**
 * Load cached chunks from disk on startup
 */
function loadCachedChunks() {
    console.log('Loading cached chunks from disk...');
    const cachedWorlds = chunkCache.loadAllChunks();
    
    let totalChunks = 0;
    cachedWorlds.forEach((chunks, worldName) => {
        if (!worldChunks.has(worldName)) {
            worldChunks.set(worldName, new Map());
        }
        
        const worldMap = worldChunks.get(worldName);
        chunks.forEach((chunkData, chunkKey) => {
            // Map from stored format (worldName) to runtime format (world)
            worldMap.set(chunkKey, {
                chunkX: chunkData.chunkX,
                chunkZ: chunkData.chunkZ,
                blocks: chunkData.blocks,
                world: chunkData.worldName,  // worldName from disk -> world in memory
                ts: chunkData.timestamp
            });
            totalChunks++;
        });
    });
    
    if (totalChunks > 0) {
        console.log(`✅ Loaded ${totalChunks} cached chunks from ${cachedWorlds.size} worlds`);
    } else {
        console.log('No cached chunks found');
    }
}

/**
 * SSE endpoint - streams telemetry to browsers
 */
app.get('/telemetry-stream', (req, res) => {
    // Set SSE headers
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });

    // Add client to set
    clients.add(res);

    // Send current player data on connect
    const currentData = {};
    playerData.forEach((history, uuid) => {
        if (history.length > 0) {
            const playerInfo = history[history.length - 1];
            
            // Attach skin data if available
            const skinData = playerSkins.get(uuid);
            if (skinData) {
                playerInfo.skinUrl = skinData.skinUrl;
                playerInfo.model = skinData.model;
            }
            
            currentData[uuid] = playerInfo;
        }
    });
    
    res.write(`data: ${JSON.stringify({ type: 'init', players: currentData })}\n\n`);
    
    // Send all cached chunks from all worlds to new client
    let totalChunks = 0;
    worldChunks.forEach((chunks, worldName) => {
        totalChunks += chunks.size;
        chunks.forEach((chunkInfo, chunkKey) => {
            res.write(`data: ${JSON.stringify({ type: 'chunk', data: chunkInfo })}\n\n`);
        });
    });
    if (totalChunks > 0) {
        console.log(`Sending ${totalChunks} cached chunks from ${worldChunks.size} worlds to new client`);
    }

    // Remove client on disconnect
    req.on('close', () => {
        clients.delete(res);
    });
});

/**
 * Broadcast telemetry to all connected clients
 */
function broadcastTelemetry(data) {
    const message = `data: ${JSON.stringify({ type: 'update', player: data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * Broadcast world change to all connected clients
 */
function broadcastWorldChange(data) {
    const message = `data: ${JSON.stringify({ type: 'world_change', data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * Start tailing Docker logs and parse telemetry
 */
function startLogTailing() {
    console.log('Starting Docker log tail for minecraft-paper...');
    
    // Spawn docker logs process
    const docker = spawn('docker', ['logs', '-f', '--tail', '0', 'minecraft-paper']);
    
    let buffer = '';
    
    docker.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        
        // Keep last incomplete line in buffer
        buffer = lines.pop() || '';
        
        // Process complete lines
        lines.forEach(line => {
            parseTelemetryLine(line);
        });
    });
    
    docker.stderr.on('data', (data) => {
        // Docker logs can come through stderr too
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        
        lines.forEach(line => {
            parseTelemetryLine(line);
        });
    });
    
    docker.on('error', (err) => {
        console.error('Failed to start docker logs:', err.message);
        console.error('Make sure Docker is running and minecraft-paper container exists.');
        process.exit(1);
    });
    
    docker.on('close', (code) => {
        console.log(`Docker logs process exited with code ${code}`);
        console.log('Reconnecting in 5 seconds...');
        setTimeout(startLogTailing, 5000);
    });
}

/**
 * Parse a log line and extract telemetry JSON
 */
function parseTelemetryLine(line) {
    // Check for block change events (MCGPS_BLOCK: prefix)
    if (line.includes('MCGPS_BLOCK:')) {
        const blockJsonStart = line.indexOf('MCGPS_BLOCK:') + 12;
        const blockJsonStr = line.substring(blockJsonStart).trim();
        try {
            const blockData = JSON.parse(blockJsonStr);
            console.log(`Block ${blockData.type}: (${blockData.x}, ${blockData.y}, ${blockData.z}) by ${blockData.player}`);
            broadcastBlockChange(blockData);
            return;
        } catch (err) {
            // Invalid block JSON
        }
    }
    
    // Look for JSON objects in the line - handle both small and large JSON
    // Match opening brace to closing brace, handling nested structures
    const jsonStart = line.indexOf('{');
    if (jsonStart === -1) return;
    
    let braceCount = 0;
    let jsonEnd = -1;
    
    for (let i = jsonStart; i < line.length; i++) {
        if (line[i] === '{') braceCount++;
        if (line[i] === '}') {
            braceCount--;
            if (braceCount === 0) {
                jsonEnd = i + 1;
                break;
            }
        }
    }
    
    if (jsonEnd === -1) return;
    
    const jsonStr = line.substring(jsonStart, jsonEnd);
    
    try {
        const data = JSON.parse(jsonStr);
        
        // Check if it's a single chunk (new incremental format)
        if (data.type === 'chunk' && data.uuid && data.blocks) {
            const chunkKey = `${data.chunkX},${data.chunkZ}`;
            console.log(`Received chunk (${chunkKey}) in ${data.world || 'world'}: ${data.blocks.length} blocks`);
            storeChunk(data);
            broadcastChunk(data);
            return;
        }
        
        // Check if it's a world change event
        if (data.type === 'world_change' && data.uuid && data.world) {
            console.log(`Player ${data.uuid} changed to world: ${data.world}`);
            playerWorlds.set(data.uuid, data.world);
            broadcastWorldChange(data);
            return;
        }
        
        // Check if it's chunk unload data
        if (data.type === 'chunk_unload' && data.chunks) {
            console.log(`Unloading ${data.chunks.length} chunks from ${data.world || 'world'}`);
            unloadChunks(data.chunks, data.world);
            broadcastChunkUnload(data);
            return;
        }
        
        // Check if it's old-style bulk chunks (backwards compatibility)
        if (data.type === 'chunks' && data.uuid && data.blocks) {
            console.log(`Received bulk chunk data: ${data.blocks.length} blocks for player ${data.uuid}`);
            // Convert to individual chunk format for storage
            storeBulkChunks(data);
            broadcastBulkChunks(data);
            return;
        }
        
        // Validate it's telemetry data
        if (data.ts && data.uuid && data.x !== undefined) {
            storeTelemetry(data);
            broadcastTelemetry(data);
        }
    } catch (err) {
        // Not valid JSON, ignore
    }
}

/**
 * Broadcast block change to all connected clients and update cache
 */
function broadcastBlockChange(data) {
    const message = `data: ${JSON.stringify({ type: 'block_change', data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
    
    // Update cached chunk with block change
    const worldName = data.world || 'world';
    const { x, y, z, type, blockType } = data;
    
    if (type === 'block_break') {
        // Remove block from cache
        setImmediate(() => {
            chunkCache.updateBlock(worldName, x, y, z, null);
        });
    } else if (type === 'block_place' && blockType) {
        // Add/update block in cache
        setImmediate(() => {
            chunkCache.updateBlock(worldName, x, y, z, blockType);
        });
    }
}

/**
 * Store telemetry in memory (limited history)
 */
async function storeTelemetry(data) {
    const uuid = data.uuid;
    
    if (!playerData.has(uuid)) {
        playerData.set(uuid, []);
        
        // First time seeing this player - resolve their skin
        if (!playerSkins.has(uuid)) {
            console.log(`🎨 Resolving skin for new player ${data.name || uuid}...`);
            try {
                const skinData = await skinService.getSkin(uuid);
                playerSkins.set(uuid, skinData);
                
                // Attach skin data to this telemetry update
                data.skinUrl = skinData.skinUrl;
                data.model = skinData.model;
                
                console.log(`✅ Skin resolved for ${data.name || uuid}: ${skinData.model} model`);
            } catch (error) {
                console.error(`❌ Failed to resolve skin for ${uuid}:`, error.message);
            }
        }
    }
    
    // Always attach skin data if available
    const skinData = playerSkins.get(uuid);
    if (skinData) {
        data.skinUrl = skinData.skinUrl;
        data.model = skinData.model;
    }
    
    const history = playerData.get(uuid);
    history.push(data);
    
    // Trim history if too long
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
}

/**
 * Store a single chunk in world-specific cache (in-memory and on disk)
 */
function storeChunk(data) {
    const worldName = data.world || 'world';
    const chunkKey = `${data.chunkX},${data.chunkZ}`;
    
    // Get or create world's chunk map
    if (!worldChunks.has(worldName)) {
        worldChunks.set(worldName, new Map());
    }
    const chunks = worldChunks.get(worldName);
    
    const chunkInfo = {
        chunkX: data.chunkX,
        chunkZ: data.chunkZ,
        blocks: data.blocks,
        world: worldName,
        ts: data.ts
    };
    
    chunks.set(chunkKey, chunkInfo);
    
    // Persist to disk asynchronously
    setImmediate(() => {
        chunkCache.saveChunk(worldName, data.chunkX, data.chunkZ, data.blocks, data.ts);
    });
}

/**
 * Unload chunks from a specific world (memory and disk)
 */
function unloadChunks(chunks, worldName = 'world') {
    const worldMap = worldChunks.get(worldName);
    if (!worldMap) return;
    
    for (const chunk of chunks) {
        const chunkKey = `${chunk.x},${chunk.z}`;
        worldMap.delete(chunkKey);
        
        // Delete from disk asynchronously
        setImmediate(() => {
            chunkCache.deleteChunk(worldName, chunk.x, chunk.z);
        });
    }
}

/**
 * Store bulk chunks (backwards compatibility)
 */
function storeBulkChunks(data) {
    // Group blocks by chunk
    const chunkBlocks = new Map();
    for (const block of data.blocks) {
        const chunkX = Math.floor(block.x / 16);
        const chunkZ = Math.floor(block.z / 16);
        const key = `${chunkX},${chunkZ}`;
        if (!chunkBlocks.has(key)) {
            chunkBlocks.set(key, { chunkX, chunkZ, blocks: [] });
        }
        chunkBlocks.get(key).blocks.push(block);
    }
    
    // Store each chunk
    chunkBlocks.forEach((chunkInfo, key) => {
        loadedChunks.set(key, {
            ...chunkInfo,
            world: data.world,
            ts: data.ts
        });
    });
}

/**
 * Broadcast a single chunk to all connected clients
 */
function broadcastChunk(data) {
    const message = `data: ${JSON.stringify({ type: 'chunk', data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * Broadcast chunk unload to all clients
 */
function broadcastChunkUnload(data) {
    const message = `data: ${JSON.stringify({ type: 'chunk_unload', data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * Broadcast bulk chunks (backwards compatibility)
 */
function broadcastBulkChunks(data) {
    const message = `data: ${JSON.stringify({ type: 'chunks', data })}\n\n`;
    
    clients.forEach(client => {
        try {
            client.write(message);
        } catch (err) {
            clients.delete(client);
        }
    });
}

/**
 * API endpoint to get all player data
 */
app.get('/api/players', (req, res) => {
    const result = {};
    
    playerData.forEach((history, uuid) => {
        if (history.length > 0) {
            const playerInfo = history[history.length - 1];
            
            // Attach skin data if available
            const skinData = playerSkins.get(uuid);
            if (skinData) {
                playerInfo.skinUrl = skinData.skinUrl;
                playerInfo.model = skinData.model;
            }
            
            result[uuid] = playerInfo;
        }
    });
    
    res.json(result);
});

/**
 * API endpoint to get skin data for a specific player
 */
app.get('/api/players/:uuid/skin', async (req, res) => {
    const uuid = req.params.uuid;
    
    try {
        // Check cache first
        let skinData = playerSkins.get(uuid);
        
        if (!skinData) {
            // Resolve from Mojang if not cached
            skinData = await skinService.getSkin(uuid);
            playerSkins.set(uuid, skinData);
        }
        
        res.json(skinData);
    } catch (error) {
        console.error(`Error resolving skin for ${uuid}:`, error);
        res.status(500).json({ error: 'Failed to resolve skin' });
    }
});

/**
 * API endpoint to get player history
 */
app.get('/api/players/:uuid/history', (req, res) => {
    const uuid = req.params.uuid;
    const history = playerData.get(uuid) || [];
    res.json(history);
});

/**
 * API endpoint to get chunk cache statistics
 */
app.get('/api/cache/stats', (req, res) => {
    const stats = chunkCache.getStats();
    res.json(stats);
});

/**
 * API endpoint to clear chunk cache
 */
app.post('/api/cache/clear', (req, res) => {
    const world = req.query.world;
    
    if (world) {
        // Clear specific world
        const deleted = chunkCache.clearWorld(world);
        
        // Also clear from memory
        if (worldChunks.has(world)) {
            worldChunks.get(world).clear();
        }
        
        res.json({ success: true, deleted, world });
    } else {
        // Clear all worlds
        const deleted = chunkCache.clearAll();
        
        // Also clear from memory
        worldChunks.clear();
        
        res.json({ success: true, deleted });
    }
});

/**
 * API endpoint to get cached chunk data (legacy endpoint, mainly for debugging)
 */
app.get('/api/blocks', (req, res) => {
    // Collect all blocks from loaded chunks
    const allBlocks = [];
    loadedChunks.forEach((chunkInfo) => {
        allBlocks.push(...chunkInfo.blocks);
    });
    
    if (allBlocks.length > 0) {
        return res.json({ 
            blocks: allBlocks, 
            chunkCount: loadedChunks.size,
            source: 'stream' 
        });
    }
    
    // No data available
    res.json({ blocks: [], chunkCount: 0, source: 'none' });
});

/**
 * Simplify Minecraft block types to basic materials for rendering
 */
function getSimplifiedBlockType(blockName) {
    // Grass and dirt variants
    if (blockName.includes('grass_block')) return 'grass';
    if (blockName.includes('dirt') || blockName.includes('coarse_dirt') || blockName.includes('podzol') || blockName.includes('mycelium')) return 'dirt';
    
    // Cobblestone (before stone to avoid matching 'stone' in 'cobblestone')
    if (blockName.includes('cobblestone') || blockName.includes('mossy_cobblestone')) return 'cobblestone';
    
    // Stone variants
    if (blockName.includes('stone') || blockName.includes('andesite') || blockName.includes('diorite') || 
        blockName.includes('granite') || blockName.includes('deepslate')) return 'stone';
    
    // Gravel
    if (blockName.includes('gravel')) return 'gravel';
    
    // Sand variants
    if (blockName.includes('sand')) return 'sand';
    
    // Water and ice
    if (blockName.includes('water') || blockName.includes('ice')) return 'water';
    
    // Wood variants (logs specifically)
    if (blockName.includes('_log') || blockName.includes('stripped_') && blockName.includes('log')) return 'wood';
    
    // Planks
    if (blockName.includes('planks')) return 'planks';
    
    // Leaves (with transparency)
    if (blockName.includes('leaves')) return 'leaves';
    
    // Snow
    if (blockName.includes('snow')) return 'snow';
    
    // Ores (map to stone)
    if (blockName.includes('_ore') || blockName.includes('coal_block') || blockName.includes('iron_block')) return 'stone';
    
    // Default to stone for unknown blocks
    return 'stone';
}

// Start server
app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════════════╗`);
    console.log(`║  McGPS Web Viewer - Real-time Player Tracking     ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
    console.log();
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📊 Open in browser to see real-time 3D player positions`);
    console.log(`🎨 Skin resolution enabled via Mojang Session Server API`);
    console.log();
    
    // Load cached chunks from disk
    loadCachedChunks();
    
    console.log(`Monitoring Docker container: minecraft-paper`);
    console.log(`Press Ctrl+C to stop`);
    console.log();
    
    startLogTailing();
    
    // Start periodic cache cleanup (every hour)
    setInterval(() => {
        skinService.cleanCache();
        const stats = skinService.getCacheStats();
        console.log(`🧹 Cache cleanup: ${stats.size} skins cached, ${stats.pending} pending fetches`);
        
        // Log chunk cache stats
        const chunkStats = chunkCache.getStats();
        console.log(`💾 Chunk cache: ${chunkStats.totalChunks} chunks across ${Object.keys(chunkStats.worlds).length} worlds`);
    }, 60 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});
