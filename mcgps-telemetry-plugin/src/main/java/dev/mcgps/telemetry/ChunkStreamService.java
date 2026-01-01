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
    private static final int MAX_HEIGHT_SCAN = 120; // Scan up to Y=120
    private static final int MIN_HEIGHT_SCAN = 50; // Start scanning from Y=50
    
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
        int radius = CHUNK_RADIUS * 16; // Convert chunks to blocks
        
        List<BlockData> blocks = new ArrayList<>();
        
        // Sample blocks in the area
        for (int x = centerX - radius; x <= centerX + radius; x += SAMPLE_INTERVAL) {
            for (int z = centerZ - radius; z <= centerZ + radius; z += SAMPLE_INTERVAL) {
                // Scan from top to bottom to capture everything (trees, structures, etc.)
                boolean foundAny = false;
                
                for (int y = MAX_HEIGHT_SCAN; y >= MIN_HEIGHT_SCAN; y--) {
                    Block block = world.getBlockAt(x, y, z);
                    Material type = block.getType();
                    
                    // Include all solid blocks and vegetation
                    if (type != Material.AIR && type != Material.CAVE_AIR) {
                        String blockType = getSimplifiedBlockType(type);
                        blocks.add(new BlockData(x, y, z, blockType));
                        foundAny = true;
                        
                        // Once we hit ground level blocks, go down a bit more for depth
                        if (isGroundBlock(type)) {
                            // Add 2 more blocks below for depth
                            for (int depth = 1; depth <= 2; depth++) {
                                int belowY = y - depth;
                                if (belowY >= world.getMinHeight()) {
                                    Block belowBlock = world.getBlockAt(x, belowY, z);
                                    if (belowBlock.getType() != Material.AIR) {
                                        String belowType = getSimplifiedBlockType(belowBlock.getType());
                                        blocks.add(new BlockData(x, belowY, z, belowType));
                                    }
                                }
                            }
                            break; // Stop scanning down once we hit ground
                        }
                    } else if (foundAny) {
                        // We were finding blocks but now hit air - stop scanning
                        break;
                    }
                }
            }
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
        
        // Grass and vegetation
        if (name.contains("grass_block") || name.contains("grass")) return "grass";
        if (name.contains("leaves") || name.contains("azalea")) return "grass";
        
        // Dirt and soil
        if (name.contains("dirt") || name.contains("podzol") || name.contains("coarse")) return "dirt";
        if (name.contains("rooted")) return "dirt";
        
        // Stone variants
        if (name.contains("stone") || name.contains("andesite") || 
            name.contains("diorite") || name.contains("granite") ||
            name.contains("cobble") || name.contains("bedrock")) return "stone";
        
        // Sand and gravel
        if (name.contains("sand") || name.contains("gravel")) return "stone";
        
        // Wood blocks (logs and planks)
        if (name.contains("log") || name.contains("wood") || 
            name.contains("planks") || name.contains("stripped")) return "dirt";
        
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
