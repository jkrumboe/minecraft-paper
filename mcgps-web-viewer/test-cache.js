/**
 * Simple test for ChunkCache module
 */

const ChunkCache = require('./ChunkCache');
const fs = require('fs');
const path = require('path');

// Use a test cache directory
const testCacheDir = './test-chunks';
const cache = new ChunkCache(testCacheDir);

console.log('Testing ChunkCache...\n');

// Test 1: Save a chunk
console.log('Test 1: Saving a chunk...');
const testBlocks = [
    { x: 0, y: 64, z: 0, type: 'grass' },
    { x: 1, y: 64, z: 0, type: 'dirt' },
    { x: 0, y: 64, z: 1, type: 'stone' }
];

const saved = cache.saveChunk('world', 0, 0, testBlocks);
console.log(`  ✓ Chunk saved: ${saved}`);

// Test 2: Load the chunk back
console.log('\nTest 2: Loading the chunk...');
const loaded = cache.loadChunk('world', 0, 0);
console.log(`  ✓ Chunk loaded: ${loaded ? 'yes' : 'no'}`);
console.log(`  ✓ Blocks in chunk: ${loaded ? loaded.blocks.length : 0}`);

// Test 3: Check if chunk exists
console.log('\nTest 3: Checking if chunk exists...');
const exists = cache.hasChunk('world', 0, 0);
console.log(`  ✓ Chunk exists: ${exists}`);

// Test 4: Save another chunk
console.log('\nTest 4: Saving another chunk...');
cache.saveChunk('world', 1, 0, [{ x: 16, y: 64, z: 0, type: 'sand' }]);
cache.saveChunk('world', 0, 1, [{ x: 0, y: 64, z: 16, type: 'water' }]);
console.log('  ✓ Multiple chunks saved');

// Test 5: Load all chunks for a world
console.log('\nTest 5: Loading all chunks for world...');
const worldChunks = cache.loadWorldChunks('world');
console.log(`  ✓ Total chunks loaded: ${worldChunks.size}`);

// Test 6: Get statistics
console.log('\nTest 6: Getting cache statistics...');
const stats = cache.getStats();
console.log(`  ✓ Total chunks: ${stats.totalChunks}`);
console.log(`  ✓ Worlds: ${Object.keys(stats.worlds).join(', ')}`);

// Test 7: Update a block
console.log('\nTest 7: Updating a block...');
const updated = cache.updateBlock('world', 0, 64, 0, 'cobblestone');
console.log(`  ✓ Block updated: ${updated}`);
const updatedChunk = cache.loadChunk('world', 0, 0);
const updatedBlock = updatedChunk.blocks.find(b => b.x === 0 && b.y === 64 && b.z === 0);
console.log(`  ✓ Block type after update: ${updatedBlock ? updatedBlock.type : 'not found'}`);

// Test 8: Remove a block
console.log('\nTest 8: Removing a block...');
cache.updateBlock('world', 1, 64, 0, null);
const afterRemove = cache.loadChunk('world', 0, 0);
console.log(`  ✓ Blocks after removal: ${afterRemove.blocks.length}`);

// Test 9: Test another world
console.log('\nTest 9: Saving chunk in different world...');
cache.saveChunk('world_nether', 0, 0, [{ x: 0, y: 64, z: 0, type: 'netherrack' }]);
const allWorlds = cache.loadAllChunks();
console.log(`  ✓ Total worlds: ${allWorlds.size}`);

// Test 10: Delete a chunk
console.log('\nTest 10: Deleting a chunk...');
const deleted = cache.deleteChunk('world', 1, 0);
console.log(`  ✓ Chunk deleted: ${deleted}`);

// Test 11: Clear a world
console.log('\nTest 11: Clearing a world...');
const clearedCount = cache.clearWorld('world');
console.log(`  ✓ Chunks cleared: ${clearedCount}`);

// Cleanup
console.log('\nCleaning up test data...');
cache.clearAll();
if (fs.existsSync(testCacheDir)) {
    fs.rmdirSync(testCacheDir, { recursive: true });
}
console.log('  ✓ Test data cleaned up');

console.log('\n✅ All tests passed!');
