/**
 * McGPS Web Viewer - Prismarine Edition
 * 
 * Uses prismarine-viewer to properly render Minecraft worlds with correct textures
 */

const express = require('express');
const { spawn } = require('child_process');
const path = require('path');
const { Vec3 } = require('vec3');
const standaloneViewer = require('prismarine-viewer').standalone;
const mcData = require('minecraft-data')('1.20.4');
const World = require('prismarine-world')(mcData.version.minecraftVersion);
const Anvil = require('prismarine-provider-anvil').Anvil(mcData.version.minecraftVersion);
const skinService = require('./SkinService');

const PORT = 3007;
const VERSION = '1.20.4';

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
    anvilWorld = null;
}

// Store recent player positions
const playerData = new Map();
const MAX_HISTORY = 100;

// Store player skin data (resolved from Mojang API)
const playerSkins = new Map();

// Track where we should center the camera
let cameraCenter = new Vec3(0, 70, 0);

/**
 * Pre-load chunks around a position to ensure they're available
 */
async function preloadChunks(world, centerX, centerZ, radius = 3) {
    console.log(`📦 Pre-loading chunks around (${centerX}, ${centerZ}) with radius ${radius}...`);
    const chunkX = Math.floor(centerX / 16);
    const chunkZ = Math.floor(centerZ / 16);
    
    let loaded = 0;
    let failed = 0;
    
    for (let x = chunkX - radius; x <= chunkX + radius; x++) {
        for (let z = chunkZ - radius; z <= chunkZ + radius; z++) {
            try {
                const column = await world.getColumn(x, z);
                if (column) {
                    loaded++;
                } else {
                    failed++;
                    console.log(`⚠️  Chunk (${x}, ${z}) returned null`);
                }
            } catch (error) {
                failed++;
                console.log(`❌ Failed to load chunk (${x}, ${z}):`, error.message);
            }
        }
    }
    
    console.log(`✅ Pre-loaded ${loaded} chunks (${failed} failed)`);
    return loaded > 0;
}

// Start prismarine-viewer
let viewer = null;

async function initializeViewer() {
    if (!anvilWorld) {
        console.error('❌ Cannot start viewer without world data');
        process.exit(1);
    }
    
    // Try to find a good spawn location by checking multiple positions
    const testPositions = [
        { x: 0, z: 0 },
        { x: 8, z: 8 },
        { x: -8, z: -8 },
        { x: 16, z: 16 }
    ];
    
    let foundChunks = false;
    let spawnPos = testPositions[0];
    
    for (const pos of testPositions) {
        console.log(`🔍 Testing spawn position (${pos.x}, ${pos.z})...`);
        try {
            const hasChunks = await preloadChunks(anvilWorld, pos.x, pos.z, 2);
            if (hasChunks) {
                foundChunks = true;
                spawnPos = pos;
                console.log(`✅ Found valid chunks at (${pos.x}, ${pos.z})`);
                break;
            }
        } catch (error) {
            console.log(`❌ Failed at position (${pos.x}, ${pos.z}):`, error.message);
        }
    }
    
    if (!foundChunks) {
        console.error('❌ Could not find any valid chunks in the world');
        console.log('💡 Make sure the Minecraft world has been generated and saved');
        process.exit(1);
    }
    
    cameraCenter = new Vec3(spawnPos.x, 70, spawnPos.z);
    
    console.log('🎮 Starting Prismarine Viewer...');
    viewer = standaloneViewer({ 
        version: VERSION, 
        world: anvilWorld, 
        center: cameraCenter, 
        port: PORT,
        viewDistance: 4  // Reduced view distance for stability
    });
    console.log(`✅ Prismarine Viewer started on port ${PORT}`);
}

/**
 * Start tailing Docker logs and parse telemetry
 */
function startLogTailing() {
    console.log('📡 Starting Docker log tail for minecraft-paper...');
    
    const docker = spawn('docker', ['logs', '-f', '--tail', '0', 'minecraft-paper']);
    
    let buffer = '';
    
    docker.stdout.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(line => parseTelemetryLine(line));
    });
    
    docker.stderr.on('data', (data) => {
        buffer += data.toString();
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        lines.forEach(line => parseTelemetryLine(line));
    });
    
    docker.on('error', (err) => {
        console.error('Failed to start docker logs:', err.message);
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
        
        // Check if it's chunk data (ignore for now, we're using live world data)
        if (data.type === 'chunks') {
            console.log(`Received chunk data: ${data.blocks.length} blocks (ignoring, using Anvil world)`);
            return;
        }
        
        // Validate it's telemetry data
        if (data.ts && data.uuid && data.x !== undefined) {
            storeTelemetry(data);
            updateViewerForPlayer(data);
        }
    } catch (err) {
        // Not valid JSON, ignore
    }
}

/**
 * Store telemetry in memory
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
                console.log(`✅ Skin resolved for ${data.name || uuid}: ${skinData.model} model`);
            } catch (error) {
                console.error(`❌ Failed to resolve skin for ${uuid}:`, error.message);
            }
        }
    }
    
    const history = playerData.get(uuid);
    history.push(data);
    
    if (history.length > MAX_HISTORY) {
        history.shift();
    }
}

/**
 * Update viewer camera position to follow player
 */
function updateViewerForPlayer(data) {
    if (!viewer) return;
    
    const { x, y, z } = data;
    
    // Update camera center to player position
    cameraCenter = new Vec3(Math.floor(x), Math.floor(y) + 10, Math.floor(z));
    
    // Update viewer (this will trigger chunk loading around the player)
    try {
        viewer.update();
        
        // Draw player marker
        if (viewer.drawLine && data.name) {
            const pos = new Vec3(x, y, z);
            const posAbove = new Vec3(x, y + 2, z);
            viewer.drawLine(`player_${data.uuid}`, [pos, posAbove], 0x00ffff);
        }
    } catch (error) {
        console.error('Error updating viewer:', error.message);
    }
}

// Wait for viewer to initialize, then start log tailing
initializeViewer().then(() => {
    console.log(`╔════════════════════════════════════════════════════╗`);
    console.log(`║  McGPS Prismarine Viewer - Real-time Tracking     ║`);
    console.log(`╚════════════════════════════════════════════════════╝`);
    console.log();
    console.log(`🌐 Viewer running at: http://localhost:${PORT}`);
    console.log(`📊 Open in browser to see real-time Minecraft world`);
    console.log(`🎨 Using Prismarine Viewer with proper textures`);
    console.log();
    console.log(`World path: ${WORLD_PATH}`);
    console.log(`Monitoring Docker container: minecraft-paper`);
    console.log(`Press Ctrl+C to stop`);
    console.log();

    startLogTailing();
}).catch(error => {
    console.error('❌ Failed to initialize:', error);
    process.exit(1);
});

// Start periodic cache cleanup
setInterval(() => {
    skinService.cleanCache();
    const stats = skinService.getCacheStats();
    console.log(`🧹 Cache cleanup: ${stats.size} skins cached, ${stats.pending} pending fetches`);
}, 60 * 60 * 1000);

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down gracefully...');
    process.exit(0);
});
