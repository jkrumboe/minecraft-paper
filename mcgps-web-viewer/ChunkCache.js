/**
 * ChunkCache - Persistent storage for chunk data
 * 
 * Stores chunk data to disk to persist across:
 * - WebUI refreshes
 * - WebUI server restarts
 * - Minecraft server restarts
 * 
 * Storage format:
 * - chunks/
 *   - world/
 *     - 0,0.json (chunk at coordinates 0,0)
 *     - 0,1.json
 *     - ...
 *   - world_nether/
 *     - ...
 *   - world_the_end/
 *     - ...
 */

const fs = require('fs');
const path = require('path');

class ChunkCache {
    constructor(cacheDir = './chunks') {
        this.cacheDir = cacheDir;
        this.ensureCacheDir();
    }

    /**
     * Ensure cache directory exists
     */
    ensureCacheDir() {
        if (!fs.existsSync(this.cacheDir)) {
            fs.mkdirSync(this.cacheDir, { recursive: true });
        }
    }

    /**
     * Ensure world directory exists
     */
    ensureWorldDir(worldName) {
        const worldDir = path.join(this.cacheDir, this.sanitizeWorldName(worldName));
        if (!fs.existsSync(worldDir)) {
            fs.mkdirSync(worldDir, { recursive: true });
        }
        return worldDir;
    }

    /**
     * Sanitize world name for use as directory name
     */
    sanitizeWorldName(worldName) {
        return worldName.replace(/[^a-zA-Z0-9_-]/g, '_');
    }

    /**
     * Get chunk file path
     */
    getChunkPath(worldName, chunkX, chunkZ) {
        const worldDir = this.ensureWorldDir(worldName);
        return path.join(worldDir, `${chunkX},${chunkZ}.json`);
    }

    /**
     * Save a chunk to disk
     * @param {string} worldName - World name
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @param {Array} blocks - Array of block objects {x, y, z, type}
     * @param {number} timestamp - Timestamp when chunk was generated
     */
    saveChunk(worldName, chunkX, chunkZ, blocks, timestamp = Date.now()) {
        try {
            const chunkPath = this.getChunkPath(worldName, chunkX, chunkZ);
            const chunkData = {
                worldName,
                chunkX,
                chunkZ,
                blocks,
                timestamp,
                version: 1
            };
            
            fs.writeFileSync(chunkPath, JSON.stringify(chunkData), 'utf8');
            return true;
        } catch (error) {
            console.error(`Error saving chunk ${worldName}:${chunkX},${chunkZ}:`, error.message);
            return false;
        }
    }

    /**
     * Load a chunk from disk
     * @param {string} worldName - World name
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {Object|null} Chunk data or null if not found
     */
    loadChunk(worldName, chunkX, chunkZ) {
        try {
            const chunkPath = this.getChunkPath(worldName, chunkX, chunkZ);
            
            if (!fs.existsSync(chunkPath)) {
                return null;
            }
            
            const data = fs.readFileSync(chunkPath, 'utf8');
            const chunkData = JSON.parse(data);
            
            // Validate chunk data structure
            if (!chunkData.blocks || !Array.isArray(chunkData.blocks)) {
                console.error(`Invalid chunk data in ${chunkPath}`);
                return null;
            }
            
            return chunkData;
        } catch (error) {
            console.error(`Error loading chunk ${worldName}:${chunkX},${chunkZ}:`, error.message);
            return null;
        }
    }

    /**
     * Check if a chunk exists in cache
     * @param {string} worldName - World name
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {boolean} True if chunk exists
     */
    hasChunk(worldName, chunkX, chunkZ) {
        const chunkPath = this.getChunkPath(worldName, chunkX, chunkZ);
        return fs.existsSync(chunkPath);
    }

    /**
     * Load all chunks for a world
     * @param {string} worldName - World name
     * @returns {Map} Map of chunk keys to chunk data
     */
    loadWorldChunks(worldName) {
        const chunks = new Map();
        
        try {
            const worldDir = path.join(this.cacheDir, this.sanitizeWorldName(worldName));
            
            if (!fs.existsSync(worldDir)) {
                return chunks;
            }
            
            const files = fs.readdirSync(worldDir);
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                // Parse chunk coordinates from filename (e.g., "0,0.json")
                const match = file.match(/^(-?\d+),(-?\d+)\.json$/);
                if (!match) continue;
                
                const chunkX = parseInt(match[1], 10);
                const chunkZ = parseInt(match[2], 10);
                
                const chunkData = this.loadChunk(worldName, chunkX, chunkZ);
                if (chunkData) {
                    const chunkKey = `${chunkX},${chunkZ}`;
                    chunks.set(chunkKey, chunkData);
                }
            }
            
            console.log(`Loaded ${chunks.size} cached chunks for world: ${worldName}`);
        } catch (error) {
            console.error(`Error loading chunks for world ${worldName}:`, error.message);
        }
        
        return chunks;
    }

    /**
     * Load all chunks from all worlds
     * @returns {Map} Map of world names to Map of chunk data
     */
    loadAllChunks() {
        const worldChunks = new Map();
        
        try {
            if (!fs.existsSync(this.cacheDir)) {
                return worldChunks;
            }
            
            const worldDirs = fs.readdirSync(this.cacheDir);
            
            for (const worldDir of worldDirs) {
                const worldPath = path.join(this.cacheDir, worldDir);
                const stat = fs.statSync(worldPath);
                
                if (!stat.isDirectory()) continue;
                
                // Load chunk files and read world name from the first chunk's data
                const files = fs.readdirSync(worldPath);
                const jsonFiles = files.filter(f => f.endsWith('.json'));
                
                if (jsonFiles.length === 0) continue;
                
                // Read actual world name from first chunk file
                const firstChunkPath = path.join(worldPath, jsonFiles[0]);
                const firstChunkData = JSON.parse(fs.readFileSync(firstChunkPath, 'utf8'));
                const worldName = firstChunkData.worldName || worldDir;
                
                // Now load all chunks using the actual world name
                const chunks = this.loadWorldChunks(worldName);
                
                if (chunks.size > 0) {
                    worldChunks.set(worldName, chunks);
                }
            }
            
            console.log(`Loaded chunks from ${worldChunks.size} worlds`);
        } catch (error) {
            console.error('Error loading all chunks:', error.message);
        }
        
        return worldChunks;
    }

    /**
     * Delete a chunk from disk
     * @param {string} worldName - World name
     * @param {number} chunkX - Chunk X coordinate
     * @param {number} chunkZ - Chunk Z coordinate
     * @returns {boolean} True if deleted successfully
     */
    deleteChunk(worldName, chunkX, chunkZ) {
        try {
            const chunkPath = this.getChunkPath(worldName, chunkX, chunkZ);
            
            if (fs.existsSync(chunkPath)) {
                fs.unlinkSync(chunkPath);
                return true;
            }
            
            return false;
        } catch (error) {
            console.error(`Error deleting chunk ${worldName}:${chunkX},${chunkZ}:`, error.message);
            return false;
        }
    }

    /**
     * Clear all cached chunks for a world
     * @param {string} worldName - World name
     * @returns {number} Number of chunks deleted
     */
    clearWorld(worldName) {
        try {
            const worldDir = path.join(this.cacheDir, this.sanitizeWorldName(worldName));
            
            if (!fs.existsSync(worldDir)) {
                return 0;
            }
            
            const files = fs.readdirSync(worldDir);
            let deleted = 0;
            
            for (const file of files) {
                if (!file.endsWith('.json')) continue;
                
                fs.unlinkSync(path.join(worldDir, file));
                deleted++;
            }
            
            // Remove world directory if empty
            const remaining = fs.readdirSync(worldDir);
            if (remaining.length === 0) {
                fs.rmSync(worldDir, { recursive: true });
            }
            
            return deleted;
        } catch (error) {
            console.error(`Error clearing world ${worldName}:`, error.message);
            return 0;
        }
    }

    /**
     * Clear all cached chunks
     * @returns {number} Number of chunks deleted
     */
    clearAll() {
        try {
            if (!fs.existsSync(this.cacheDir)) {
                return 0;
            }
            
            const worldDirs = fs.readdirSync(this.cacheDir);
            let totalDeleted = 0;
            
            for (const worldDir of worldDirs) {
                const worldPath = path.join(this.cacheDir, worldDir);
                const stat = fs.statSync(worldPath);
                
                if (!stat.isDirectory()) continue;
                
                const files = fs.readdirSync(worldPath);
                
                for (const file of files) {
                    if (!file.endsWith('.json')) continue;
                    
                    fs.unlinkSync(path.join(worldPath, file));
                    totalDeleted++;
                }
                
                // Remove world directory
                fs.rmSync(worldPath, { recursive: true });
            }
            
            return totalDeleted;
        } catch (error) {
            console.error('Error clearing all chunks:', error.message);
            return 0;
        }
    }

    /**
     * Get cache statistics
     * @returns {Object} Cache stats {totalChunks, worlds: {worldName: count}}
     */
    getStats() {
        const stats = {
            totalChunks: 0,
            worlds: {}
        };
        
        try {
            if (!fs.existsSync(this.cacheDir)) {
                return stats;
            }
            
            const worldDirs = fs.readdirSync(this.cacheDir);
            
            for (const worldDir of worldDirs) {
                const worldPath = path.join(this.cacheDir, worldDir);
                const stat = fs.statSync(worldPath);
                
                if (!stat.isDirectory()) continue;
                
                const files = fs.readdirSync(worldPath);
                const chunkCount = files.filter(f => f.endsWith('.json')).length;
                
                stats.worlds[worldDir] = chunkCount;
                stats.totalChunks += chunkCount;
            }
        } catch (error) {
            console.error('Error getting cache stats:', error.message);
        }
        
        return stats;
    }

    /**
     * Update a block in a cached chunk
     * @param {string} worldName - World name
     * @param {number} x - Block X coordinate
     * @param {number} y - Block Y coordinate
     * @param {number} z - Block Z coordinate
     * @param {string|null} blockType - New block type, or null to remove
     * @returns {boolean} True if updated successfully
     */
    updateBlock(worldName, x, y, z, blockType) {
        try {
            // Calculate chunk coordinates
            const chunkX = Math.floor(x / 16);
            const chunkZ = Math.floor(z / 16);
            
            // Load existing chunk
            const chunkData = this.loadChunk(worldName, chunkX, chunkZ);
            if (!chunkData) {
                return false;
            }
            
            // Find and update/remove block
            const blockIndex = chunkData.blocks.findIndex(
                b => b.x === x && b.y === y && b.z === z
            );
            
            if (blockType === null) {
                // Remove block
                if (blockIndex >= 0) {
                    chunkData.blocks.splice(blockIndex, 1);
                }
            } else {
                // Update or add block
                if (blockIndex >= 0) {
                    chunkData.blocks[blockIndex].type = blockType;
                } else {
                    chunkData.blocks.push({ x, y, z, type: blockType });
                }
            }
            
            // Update timestamp
            chunkData.timestamp = Date.now();
            
            // Save updated chunk
            return this.saveChunk(worldName, chunkX, chunkZ, chunkData.blocks, chunkData.timestamp);
        } catch (error) {
            console.error(`Error updating block at ${worldName}:${x},${y},${z}:`, error.message);
            return false;
        }
    }
}

module.exports = ChunkCache;
