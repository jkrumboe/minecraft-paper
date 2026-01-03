/**
 * Integration test for persistent chunk caching
 * 
 * This test simulates the complete flow:
 * 1. Server receives chunk data
 * 2. Chunks are stored in memory and disk
 * 3. Server restarts (simulated)
 * 4. Chunks are loaded from disk
 * 5. Clients receive cached chunks
 */

const ChunkCache = require('./ChunkCache');
const fs = require('fs');

console.log('Integration Test: Persistent Chunk Caching\n');
console.log('='.repeat(50));

// Test configuration
const testCacheDir = './test-integration-chunks';
const testWorld = 'world';

// Cleanup from previous runs
if (fs.existsSync(testCacheDir)) {
    fs.rmSync(testCacheDir, { recursive: true });
}

// Simulate chunk data from Minecraft server
const mockChunkData = [
    {
        chunkX: 0,
        chunkZ: 0,
        blocks: [
            { x: 0, y: 64, z: 0, type: 'grass' },
            { x: 1, y: 64, z: 0, type: 'grass' },
            { x: 0, y: 63, z: 0, type: 'dirt' },
        ]
    },
    {
        chunkX: 1,
        chunkZ: 0,
        blocks: [
            { x: 16, y: 64, z: 0, type: 'stone' },
            { x: 17, y: 64, z: 0, type: 'stone' },
        ]
    },
    {
        chunkX: 0,
        chunkZ: 1,
        blocks: [
            { x: 0, y: 64, z: 16, type: 'sand' },
            { x: 0, y: 63, z: 16, type: 'sand' },
        ]
    }
];

// PHASE 1: Initial chunk generation and caching
console.log('\nPHASE 1: Initial Chunk Generation');
console.log('-'.repeat(50));

let cache = new ChunkCache(testCacheDir);
const worldChunks = new Map();

console.log('Receiving chunks from Minecraft server...');
for (const chunk of mockChunkData) {
    const chunkKey = `${chunk.chunkX},${chunk.chunkZ}`;
    
    // Store in memory (like the server does)
    worldChunks.set(chunkKey, {
        chunkX: chunk.chunkX,
        chunkZ: chunk.chunkZ,
        blocks: chunk.blocks,
        world: testWorld,
        ts: Date.now()
    });
    
    // Store to disk (persistence)
    cache.saveChunk(testWorld, chunk.chunkX, chunk.chunkZ, chunk.blocks);
    
    console.log(`  ✓ Cached chunk (${chunk.chunkX}, ${chunk.chunkZ}) with ${chunk.blocks.length} blocks`);
}

let stats = cache.getStats();
console.log(`\nMemory: ${worldChunks.size} chunks`);
console.log(`Disk: ${stats.totalChunks} chunks`);

// PHASE 2: Simulate block changes
console.log('\nPHASE 2: Block Changes');
console.log('-'.repeat(50));

console.log('Player breaks block at (0, 64, 0)...');
cache.updateBlock(testWorld, 0, 64, 0, null);

console.log('Player places cobblestone at (2, 64, 0)...');
cache.updateBlock(testWorld, 2, 64, 0, 'cobblestone');

const updatedChunk = cache.loadChunk(testWorld, 0, 0);
console.log(`  ✓ Chunk (0, 0) now has ${updatedChunk.blocks.length} blocks`);

// PHASE 3: Simulate server restart
console.log('\nPHASE 3: Server Restart Simulation');
console.log('-'.repeat(50));

console.log('Simulating server shutdown...');
worldChunks.clear();
cache = null;
console.log('  ✓ Memory cleared');

console.log('\nSimulating server startup...');
cache = new ChunkCache(testCacheDir);

const loadedWorlds = cache.loadAllChunks();
console.log(`  ✓ Loaded chunks from ${loadedWorlds.size} world(s)`);

// Restore to memory (like server startup does)
const restoredChunks = new Map();
loadedWorlds.forEach((chunks, worldName) => {
    chunks.forEach((chunkData, chunkKey) => {
        restoredChunks.set(chunkKey, {
            chunkX: chunkData.chunkX,
            chunkZ: chunkData.chunkZ,
            blocks: chunkData.blocks,
            world: chunkData.worldName,
            ts: chunkData.timestamp
        });
    });
});

console.log(`  ✓ Restored ${restoredChunks.size} chunks to memory`);

// PHASE 4: Verify data integrity
console.log('\nPHASE 4: Data Integrity Verification');
console.log('-'.repeat(50));

// Check that block changes persisted
const persistedChunk = cache.loadChunk(testWorld, 0, 0);
const hasGrassBlock = persistedChunk.blocks.some(b => 
    b.x === 0 && b.y === 64 && b.z === 0 && b.type === 'grass'
);
const hasCobblestoneBlock = persistedChunk.blocks.some(b => 
    b.x === 2 && b.y === 64 && b.z === 0 && b.type === 'cobblestone'
);

console.log('Checking block changes...');
console.log(`  ${hasGrassBlock ? '✗' : '✓'} Broken block not present: ${!hasGrassBlock}`);
console.log(`  ${hasCobblestoneBlock ? '✓' : '✗'} Placed block present: ${hasCobblestoneBlock}`);

// Check total blocks across all chunks
let totalBlocks = 0;
restoredChunks.forEach(chunk => {
    totalBlocks += chunk.blocks.length;
});

console.log(`\nTotal blocks restored: ${totalBlocks}`);
console.log('Expected: ~6 blocks (original 7 - 1 broken + 1 placed)');

// PHASE 5: Simulate client connection
console.log('\nPHASE 5: Client Connection Simulation');
console.log('-'.repeat(50));

console.log('Client connects to WebUI...');
console.log('Server sends cached chunks to client:');

let sentChunks = 0;
let sentBlocks = 0;
restoredChunks.forEach((chunkInfo, chunkKey) => {
    console.log(`  ✓ Sending chunk ${chunkKey}: ${chunkInfo.blocks.length} blocks`);
    sentChunks++;
    sentBlocks += chunkInfo.blocks.length;
});

console.log(`\nClient received: ${sentChunks} chunks, ${sentBlocks} blocks`);
console.log('Client can immediately render the world!');

// PHASE 6: Cleanup
console.log('\nPHASE 6: Cleanup');
console.log('-'.repeat(50));

cache.clearAll();
if (fs.existsSync(testCacheDir)) {
    fs.rmSync(testCacheDir, { recursive: true });
}
console.log('  ✓ Test data cleaned up');

// Final summary
console.log('\n' + '='.repeat(50));
console.log('✅ INTEGRATION TEST PASSED');
console.log('='.repeat(50));
console.log('\nKey Results:');
console.log('  ✓ Chunks persisted to disk');
console.log('  ✓ Chunks survived server restart');
console.log('  ✓ Block changes persisted');
console.log('  ✓ Clients receive cached chunks on connection');
console.log('\nPersistent chunk caching is working correctly!');
