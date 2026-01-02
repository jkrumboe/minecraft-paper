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
const skinService = require('./SkinService');

const app = express();
const PORT = 3000;

// Store recent player positions (keep last 100 per player)
const playerData = new Map();
const MAX_HISTORY = 100;

// Store chunk data per player
const chunkData = new Map();

// Store the most recent chunk data for initial load
let lastChunkData = null;

// Store player skin data (resolved from Mojang API)
const playerSkins = new Map();

// Active SSE clients
const clients = new Set();

// Serve static files from public directory (use absolute path)
app.use(express.static(path.join(__dirname, 'public')));

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
    
    // Send cached chunk data if available
    if (lastChunkData) {
        console.log(`Sending cached chunk data (${lastChunkData.blocks.length} blocks) to new client`);
        res.write(`data: ${JSON.stringify({ type: 'chunks', data: lastChunkData })}\n\n`);
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
        
        // Check if it's chunk data
        if (data.type === 'chunks' && data.uuid && data.blocks) {
            console.log(`Received chunk data: ${data.blocks.length} blocks for player ${data.uuid}`);
            storeChunkData(data);
            broadcastChunkData(data);
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
 * Broadcast block change to all connected clients
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
 * Store chunk data for a player
 */
function storeChunkData(data) {
    const uuid = data.uuid;
    chunkData.set(uuid, {
        blocks: data.blocks,
        center: data.center,
        radius: data.radius,
        world: data.world,
        ts: data.ts
    });
    
    // Cache the chunk data for new clients
    lastChunkData = {
        blocks: data.blocks,
        center: data.center,
        radius: data.radius
    };
    console.log(`Cached chunk data with ${data.blocks.length} blocks`);
}

/**
 * Broadcast chunk data to all connected clients
 */
function broadcastChunkData(data) {
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
 * API endpoint to get cached chunk data (legacy endpoint, mainly for debugging)
 */
app.get('/api/blocks', (req, res) => {
    // Return cached chunk data if available
    if (lastChunkData && lastChunkData.blocks.length > 0) {
        return res.json({ 
            blocks: lastChunkData.blocks, 
            center: lastChunkData.center, 
            radius: lastChunkData.radius, 
            source: 'stream' 
        });
    }
    
    // No data available
    res.json({ blocks: [], center: { x: 0, z: 0 }, radius: 0, source: 'none' });
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
    console.log(`Monitoring Docker container: minecraft-paper`);
    console.log(`Press Ctrl+C to stop`);
    console.log();
    
    startLogTailing();
    
    // Start periodic cache cleanup (every hour)
    setInterval(() => {
        skinService.cleanCache();
        const stats = skinService.getCacheStats();
        console.log(`🧹 Cache cleanup: ${stats.size} skins cached, ${stats.pending} pending fetches`);
    }, 60 * 60 * 1000);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});
