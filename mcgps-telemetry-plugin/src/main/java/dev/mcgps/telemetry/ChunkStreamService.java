package dev.mcgps.telemetry;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.block.Block;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * ChunkStreamService - Streams chunk data around players
 * 
 * This service periodically sends chunk snapshots in the area around each player.
 * Only surface blocks are sent to minimize data transfer.
 */
public class ChunkStreamService {
    
    private static final long CHUNK_UPDATE_INTERVAL_TICKS = 60L; // Every 3 seconds
    private static final int CHUNK_RADIUS = 3; // 6x6 chunks (96x96 blocks)
    private static final int SAMPLE_INTERVAL = 1; // Sample every block for no gaps
    private static final int MAX_HEIGHT_SCAN = 320; // Scan from world height
    private static final int MIN_HEIGHT_SCAN = -64; // Down to world bottom
    private static final int HEIGHT_ABOVE_PLAYER = 50; // Scan this many blocks above player
    
    private final JavaPlugin plugin;
    private final Map<UUID, ChunkSnapshot> lastChunkSnapshots;
    private BukkitTask chunkTask;
    
    public ChunkStreamService(JavaPlugin plugin) {
        this.plugin = plugin;
        this.lastChunkSnapshots = new HashMap<>();
    }
    
    /**
     * Start the chunk streaming task
     */
    public void start() {
        chunkTask = Bukkit.getScheduler().runTaskTimer(plugin, this::streamChunks, 
                                                       20L, CHUNK_UPDATE_INTERVAL_TICKS);
    }
    
    /**
     * Stop the chunk streaming task
     */
    public void stop() {
        if (chunkTask != null) {
            chunkTask.cancel();
            chunkTask = null;
        }
        lastChunkSnapshots.clear();
    }
    
    /**
     * Stream chunk data for all online players
     */
    private void streamChunks() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID uuid = player.getUniqueId();
            Location loc = player.getLocation();
            
            // Check if player has moved significantly since last chunk update
            ChunkSnapshot lastSnapshot = lastChunkSnapshots.get(uuid);
            if (lastSnapshot != null && !lastSnapshot.hasMovedSignificantly(loc)) {
                continue;
            }
            
            // Stream chunks around player
            streamChunksAroundPlayer(player, loc);
            lastChunkSnapshots.put(uuid, new ChunkSnapshot(loc));
        }
        
        // Clean up disconnected players
        lastChunkSnapshots.keySet().removeIf(uuid -> Bukkit.getPlayer(uuid) == null);
    }
    
    /**
     * Stream chunks around a specific player
     */
    private void streamChunksAroundPlayer(Player player, Location loc) {
        World world = loc.getWorld();
        if (world == null) return;
        
        int centerX = loc.getBlockX();
        int centerZ = loc.getBlockZ();
        int playerY = loc.getBlockY();
        int radius = CHUNK_RADIUS * 16; // Convert chunks to blocks
        
        // Start scanning from above the player (to catch tall structures/trees)
        int startY = Math.min(playerY + HEIGHT_ABOVE_PLAYER, world.getMaxHeight() - 1);
        int endY = Math.max(playerY - 50, world.getMinHeight()); // Go 50 blocks below player
        
        List<BlockData> blocks = new ArrayList<>();
        
        // Sample blocks in the area
        int scannedPositions = 0;
        int foundBlocks = 0;
        
        for (int x = centerX - radius; x <= centerX + radius; x += SAMPLE_INTERVAL) {
            for (int z = centerZ - radius; z <= centerZ + radius; z += SAMPLE_INTERVAL) {
                // Scan from top to bottom to capture everything (trees, structures, etc.)
                scannedPositions++;
                boolean foundGround = false;
                
                for (int y = startY; y >= endY && !foundGround; y--) {
                    Block block = world.getBlockAt(x, y, z);
                    Material type = block.getType();
                    
                    // Include all solid blocks except vegetation (too small)
                    if (type != Material.AIR && type != Material.CAVE_AIR && type != Material.VOID_AIR) {
                        String blockType = getSimplifiedBlockType(type);
                        
                        // Skip vegetation blocks (short grass, flowers, etc.)
                        if (blockType.equals("vegetation")) {
                            continue;
                        }
                        
                        blocks.add(new BlockData(x, y, z, blockType));
                        foundBlocks++;
                        
                        // Once we hit ground level blocks, go down a bit more for depth then stop
                        if (isGroundBlock(type)) {
                            foundGround = true;
                            // Add 2 more blocks below for depth
                            for (int depth = 1; depth <= 2; depth++) {
                                int belowY = y - depth;
                                if (belowY >= world.getMinHeight()) {
                                    Block belowBlock = world.getBlockAt(x, belowY, z);
                                    if (belowBlock.getType() != Material.AIR) {
                                        String belowType = getSimplifiedBlockType(belowBlock.getType());
                                        if (!belowType.equals("vegetation")) {
                                            blocks.add(new BlockData(x, belowY, z, belowType));
                                            foundBlocks++;
                                        }
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        
        // Debug: log scan results
        if (blocks.isEmpty()) {
            plugin.getLogger().warning("Chunk scan found 0 blocks! Scanned " + scannedPositions + 
                " positions from Y=" + startY + " to Y=" + endY +
                " around (" + centerX + ", " + centerZ + ") playerY=" + playerY);
            
            // Try to get a single block at player location for debugging
            Block testBlock = world.getBlockAt(centerX, playerY, centerZ);
            plugin.getLogger().warning("Block at player feet (" + centerX + "," + playerY + "," + centerZ + "): " + testBlock.getType().name());
            Block testBlockBelow = world.getBlockAt(centerX, playerY - 1, centerZ);
            plugin.getLogger().warning("Block below player (" + centerX + "," + (playerY-1) + "," + centerZ + "): " + testBlockBelow.getType().name());
        } else {
            plugin.getLogger().info("Chunk scan found " + foundBlocks + " blocks from " + scannedPositions + " positions");
        }
        
        // Emit chunk data as JSON
        emitChunkData(player, world, centerX, centerZ, radius, blocks);
    }
    
    /**
     * Check if a block type is a ground-level block
     */
    private boolean isGroundBlock(Material material) {
        String name = material.name().toLowerCase();
        return name.contains("grass") || name.contains("dirt") || 
               name.contains("stone") || name.contains("sand") || 
               name.contains("gravel");
    }
    
    /**
     * Emit chunk data as JSON to the console
     */
    private void emitChunkData(Player player, World world, int centerX, int centerZ, int radius, List<BlockData> blocks) {
        long timestamp = System.currentTimeMillis();
        UUID uuid = player.getUniqueId();
        String worldName = escapeJson(world.getName());
        
        // Build JSON manually
        StringBuilder json = new StringBuilder();
        json.append("{\"type\":\"chunks\",\"ts\":").append(timestamp);
        json.append(",\"uuid\":\"").append(uuid).append("\"");
        json.append(",\"world\":\"").append(worldName).append("\"");
        json.append(",\"center\":{\"x\":").append(centerX).append(",\"z\":").append(centerZ).append("}");
        json.append(",\"radius\":").append(radius);
        json.append(",\"blocks\":[");
        
        for (int i = 0; i < blocks.size(); i++) {
            if (i > 0) json.append(",");
            BlockData block = blocks.get(i);
            json.append("{\"x\":").append(block.x);
            json.append(",\"y\":").append(block.y);
            json.append(",\"z\":").append(block.z);
            json.append(",\"type\":\"").append(block.type).append("\"}");
        }
        
        json.append("]}");
        
        plugin.getLogger().info(json.toString());
    }
    
    /**
     * Simplify Minecraft block types to basic materials
     */
    private String getSimplifiedBlockType(Material material) {
        String name = material.name().toLowerCase();
        
        // Water and lava
        if (name.contains("water")) return "water";
        if (name.contains("lava")) return "stone";
        
        // Grass blocks
        if (name.equals("grass_block")) return "grass";
        
        // Leaves - keep as separate type for transparency
        if (name.contains("leaves") || name.contains("azalea")) return "leaves";
        
        // Short grass, ferns, flowers, etc. - skip (too small to render)
        if (name.contains("grass") && !name.contains("grass_block")) return "vegetation";
        if (name.contains("fern") || name.contains("flower") || name.contains("tulip") ||
            name.contains("dandelion") || name.contains("poppy") || name.contains("orchid") ||
            name.contains("allium") || name.contains("cornflower") || name.contains("lily")) return "vegetation";
        
        // Dirt and soil
        if (name.contains("dirt") || name.contains("podzol") || 
            name.contains("coarse") || name.contains("rooted") || name.contains("mud")) return "dirt";
        
        // Sand
        if (name.contains("sand") && !name.contains("sandstone")) return "sand";
        if (name.contains("sandstone")) return "stone";
        
        // Gravel
        if (name.contains("gravel")) return "gravel";
        
        // Wood blocks (logs)
        if (name.contains("log") || name.contains("stripped") && name.contains("wood")) return "wood";
        
        // Planks
        if (name.contains("planks")) return "planks";
        
        // Stone variants
        if (name.contains("stone") || name.contains("andesite") || 
            name.contains("diorite") || name.contains("granite") ||
            name.contains("cobble") || name.contains("bedrock") ||
            name.contains("deepslate") || name.contains("tuff") ||
            name.contains("ore")) return "stone";
        
        // Snow
        if (name.contains("snow")) return "snow";
        
        // Default to stone for other solid blocks
        return "stone";
    }
    
    /**
     * Escape special characters for JSON strings
     */
    private String escapeJson(String str) {
        if (str == null) return "";
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
    
    /**
     * Simple block data holder
     */
    private static class BlockData {
        final int x, y, z;
        final String type;
        
        BlockData(int x, int y, int z, String type) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.type = type;
        }
    }
    
    /**
     * Snapshot of player's chunk position
     */
    private static class ChunkSnapshot {
        final int chunkX, chunkZ;
        
        ChunkSnapshot(Location loc) {
            this.chunkX = loc.getBlockX() >> 4;
            this.chunkZ = loc.getBlockZ() >> 4;
        }
        
        /**
         * Check if player has moved to a different chunk area
         */
        boolean hasMovedSignificantly(Location newLoc) {
            int newChunkX = newLoc.getBlockX() >> 4;
            int newChunkZ = newLoc.getBlockZ() >> 4;
            int deltaX = Math.abs(newChunkX - chunkX);
            int deltaZ = Math.abs(newChunkZ - chunkZ);
            return deltaX > 2 || deltaZ > 2; // Update if moved 2+ chunks
        }
    }
}
