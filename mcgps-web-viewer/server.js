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
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const { promisify } = require('util');
const mcData = require('minecraft-data')('1.20.4');
const World = require('prismarine-world')(mcData.version.minecraftVersion);
const Anvil = require('prismarine-provider-anvil').Anvil(mcData.version.minecraftVersion);

const readFile = promisify(fs.readFile);

const app = express();
const PORT = 3000;

// Minecraft world data path (mounted from Docker)
const WORLD_PATH = path.join(__dirname, '..', 'data', 'world');

// Initialize Anvil world reader
let anvilWorld = null;
try {
    const anvilProvider = new Anvil(WORLD_PATH);
    anvilWorld = new World((x, z) => anvilProvider.load(x, z), null);
    console.log('✅ Anvil world reader initialized for path:', WORLD_PATH);
} catch (error) {
    console.error('⚠️  Failed to initialize Anvil reader:', error.message);
    console.error(error.stack);
}

// Store recent player positions (keep last 100 per player)
const playerData = new Map();
const MAX_HISTORY = 100;

// Store chunk data per player
const chunkData = new Map();

// Active SSE clients
const clients = new Set();

// Serve static files from public directory
app.use(express.static('public'));

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
            currentData[uuid] = history[history.length - 1];
        }
    });
    
    res.write(`data: ${JSON.stringify({ type: 'init', players: currentData })}\n\n`);

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
 * Store telemetry in memory (limited history)
 */
function storeTelemetry(data) {
    const uuid = data.uuid;
    
    if (!playerData.has(uuid)) {
        playerData.set(uuid, []);
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
            result[uuid] = history[history.length - 1];
        }
    });
    
    res.json(result);
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
 * API endpoint to get block data around a position
 * Returns a simplified chunk of blocks for rendering
 * Now also returns streamed chunk data if available
 */
app.get('/api/blocks', async (req, res) => {
    try {
        const x = parseInt(req.query.x) || 0;
        const z = parseInt(req.query.z) || 0;
        const radius = parseInt(req.query.radius) || 32;
        
        // First, check if we have streamed chunk data for any player
        // Use the most recent chunk data available
        let streamedBlocks = [];
        let latestChunkData = null;
        let latestTimestamp = 0;
        
        chunkData.forEach((data, uuid) => {
            if (data.ts > latestTimestamp) {
                latestTimestamp = data.ts;
                latestChunkData = data;
            }
        });
        
        if (latestChunkData && latestChunkData.blocks.length > 0) {
            console.log(`Returning ${latestChunkData.blocks.length} blocks from streamed chunk data (center: ${latestChunkData.center.x}, ${latestChunkData.center.z})`);
            return res.json({ 
                blocks: latestChunkData.blocks, 
                center: latestChunkData.center, 
                radius: latestChunkData.radius, 
                source: 'stream' 
            });
        }
        
        // Fallback to simplified terrain if no streamed data available
        console.log('No streamed chunk data available, using fallback terrain');
        const blocks = generateSimplifiedTerrain(x, z, radius);
        res.json({ blocks, center: { x, z }, radius, source: 'generated' });
    } catch (error) {
        console.error('Error getting block data:', error);
        // Fallback to simplified terrain
        const blocks = generateSimplifiedTerrain(x, z, radius);
        res.json({ blocks, center: { x, z }, radius, source: 'generated' });
    }
});

/**
 * Read actual block data from Minecraft world using Anvil format
 */
async function readRealWorldBlocks(centerX, centerZ, radius) {
    const blocks = [];
    const startX = Math.floor(centerX - radius);
    const endX = Math.floor(centerX + radius);
    const startZ = Math.floor(centerZ - radius);
    const endZ = Math.floor(centerZ + radius);
    
    console.log(`Reading world blocks from (${startX}, ${startZ}) to (${endX}, ${endZ})`);
    
    // Sample blocks more sparsely for performance (every 2 blocks)
    const step = 2;
    let errorCount = 0;
    let checkedPositions = 0;
    
    for (let x = startX; x <= endX; x += step) {
        for (let z = startZ; z <= endZ; z += step) {
            try {
                checkedPositions++;
                // Find the top solid block at this X, Z position
                let foundSurface = false;
                
                // Start from a reasonable height and scan down
                for (let y = 120; y >= 50 && !foundSurface; y--) {
                    try {
                        // Use the correct prismarine-world API
                        const block = await anvilWorld.getBlock({ x, y, z });
                        
                        if (block && block.name !== 'air') {
                            // Found a solid block
                            const blockType = getSimplifiedBlockType(block.name);
                            
                            // Add the surface block
                            blocks.push({ x, y, z, type: blockType });
                            
                            // Add a few blocks below for depth
                            for (let depth = 1; depth <= 2; depth++) {
                                const belowY = y - depth;
                                if (belowY >= 0) {
                                    try {
                                        const belowBlock = await anvilWorld.getBlock({ x, y: belowY, z });
                                        if (belowBlock && belowBlock.name !== 'air') {
                                            const belowType = getSimplifiedBlockType(belowBlock.name);
                                            blocks.push({ x, y: belowY, z, type: belowType });
                                        }
                                    } catch (e) {
                                        // Skip this depth layer
                                    }
                                }
                            }
                            
                            foundSurface = true;
                        }
                    } catch (e) {
                        // Skip this Y level
                        errorCount++;
                        if (errorCount < 3) {
                            console.log(`Error reading block at (${x}, ${y}, ${z}):`, e.message);
                        }
                    }
                }
            } catch (error) {
                // Skip blocks that fail to load
                errorCount++;
                continue;
            }
        }
    }
    
    console.log(`Checked ${checkedPositions} positions, found ${blocks.length} real blocks from world (${errorCount} errors)`);
    return blocks;
}

/**
 * Simplify Minecraft block types to basic materials for rendering
 */
function getSimplifiedBlockType(blockName) {
    if (blockName.includes('grass')) return 'grass';
    if (blockName.includes('dirt') || blockName.includes('coarse_dirt') || blockName.includes('podzol')) return 'dirt';
    if (blockName.includes('stone') || blockName.includes('andesite') || blockName.includes('diorite') || blockName.includes('granite')) return 'stone';
    if (blockName.includes('sand')) return 'stone'; // Use stone for sand
    if (blockName.includes('gravel')) return 'stone';
    if (blockName.includes('log') || blockName.includes('wood')) return 'dirt'; // Use dirt color for wood
    if (blockName.includes('leaves')) return 'grass'; // Use grass color for leaves
    
    // Default to stone for unknown blocks
    return 'stone';
}

/**
 * Generate simplified terrain for fallback
 * Used when real world data is not available
 */
function generateSimplifiedTerrain(centerX, centerZ, radius) {
    const blocks = [];
    const startX = Math.floor(centerX - radius);
    const endX = Math.floor(centerX + radius);
    const startZ = Math.floor(centerZ - radius);
    const endZ = Math.floor(centerZ + radius);
    
    // Use player positions to determine ground height if available
    let averageHeight = 70; // Default Minecraft ground level
    if (playerData.size > 0) {
        let totalY = 0;
        let count = 0;
        playerData.forEach((history) => {
            if (history.length > 0) {
                const lastPos = history[history.length - 1];
                totalY += lastPos.y;
                count++;
            }
        });
        if (count > 0) {
            averageHeight = Math.floor(totalY / count);
        }
    }
    
    // Create terrain with continuous blocks - no gaps
    for (let x = startX; x <= endX; x++) {
        for (let z = startZ; z <= endZ; z++) {
            // More natural terrain using multiple noise octaves
            const noise1 = Math.sin(x * 0.05) * Math.cos(z * 0.05) * 3;
            const noise2 = Math.sin(x * 0.2) * Math.cos(z * 0.2) * 1;
            const height = Math.floor(averageHeight - 1 + noise1 + noise2);
            
            // Add grass block at surface
            blocks.push({
                x: x,
                y: height,
                z: z,
                type: 'grass'
            });
            
            // Add dirt layers below (only 2 layers for performance)
            for (let y = height - 1; y >= height - 2; y--) {
                blocks.push({
                    x: x,
                    y: y,
                    z: z,
                    type: 'dirt'
                });
            }
        }
    }
    
    return blocks;
}

// Start server
app.listen(PORT, () => {
    console.log(`╔════════════════════════════════════════════════════╗`);
    console.log(`║  McGPS Web Viewer - Real-time Player Tracking     ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
    console.log();
    console.log(`🌐 Server running at: http://localhost:${PORT}`);
    console.log(`📊 Open in browser to see real-time 3D player positions`);
    console.log();
    console.log(`Monitoring Docker container: minecraft-paper`);
    console.log(`Press Ctrl+C to stop`);
    console.log();
    
    startLogTailing();
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});
