package dev.mcgps.telemetry;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
 * This service incrementally sends chunk data as players move.
 * Only surface blocks are sent to minimize data transfer.
 * Already-sent chunks are tracked to avoid resending.
 */
public class ChunkStreamService {
    
    private static final long CHUNK_UPDATE_INTERVAL_TICKS = 20L; // Every 1 second (check more frequently)
    private static final int CHUNK_RADIUS = 8; // 16x16 chunks view distance (256x256 blocks)
    private static final int UNLOAD_CHUNK_RADIUS = 12; // Unload chunks beyond this distance
    private static final int SAMPLE_INTERVAL = 1; // Sample every block for no gaps
    private static final int MAX_HEIGHT_SCAN = 320; // Scan from world height
    private static final int MIN_HEIGHT_SCAN = -64; // Down to world bottom
    private static final int HEIGHT_ABOVE_PLAYER = 50; // Scan this many blocks above player
    private static final int CHUNKS_PER_TICK = 4; // Send up to 4 new chunks per update cycle
    
    private final JavaPlugin plugin;
    private final Map<UUID, PlayerChunkState> playerChunkStates;
    private BukkitTask chunkTask;
    
    public ChunkStreamService(JavaPlugin plugin) {
        this.plugin = plugin;
        this.playerChunkStates = new HashMap<>();
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
        playerChunkStates.clear();
    }
    
    /**
     * Stream chunk data for all online players
     */
    private void streamChunks() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID uuid = player.getUniqueId();
            Location loc = player.getLocation();
            
            // Get or create player's chunk state
            PlayerChunkState state = playerChunkStates.computeIfAbsent(uuid, k -> new PlayerChunkState());
            
            // Get the player's current chunk coordinates
            int playerChunkX = loc.getBlockX() >> 4;
            int playerChunkZ = loc.getBlockZ() >> 4;
            
            // Find chunks that need to be loaded
            List<ChunkCoord> chunksToLoad = new ArrayList<>();
            for (int dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
                for (int dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
                    ChunkCoord coord = new ChunkCoord(playerChunkX + dx, playerChunkZ + dz);
                    if (!state.loadedChunks.contains(coord)) {
                        // Calculate distance for priority loading (closer chunks first)
                        coord.distanceSq = dx * dx + dz * dz;
                        chunksToLoad.add(coord);
                    }
                }
            }
            
            // Sort by distance (load closer chunks first)
            chunksToLoad.sort((a, b) -> Integer.compare(a.distanceSq, b.distanceSq));
            
            // Load up to CHUNKS_PER_TICK new chunks
            int chunksLoaded = 0;
            for (ChunkCoord coord : chunksToLoad) {
                if (chunksLoaded >= CHUNKS_PER_TICK) break;
                
                // Stream this chunk
                streamSingleChunk(player, loc.getWorld(), coord.x, coord.z, loc.getBlockY());
                state.loadedChunks.add(coord);
                chunksLoaded++;
            }
            
            // Unload distant chunks
            Set<ChunkCoord> chunksToUnload = new HashSet<>();
            for (ChunkCoord coord : state.loadedChunks) {
                int dx = coord.x - playerChunkX;
                int dz = coord.z - playerChunkZ;
                if (Math.abs(dx) > UNLOAD_CHUNK_RADIUS || Math.abs(dz) > UNLOAD_CHUNK_RADIUS) {
                    chunksToUnload.add(coord);
                }
            }
            
            if (!chunksToUnload.isEmpty()) {
                state.loadedChunks.removeAll(chunksToUnload);
                // Notify client to unload these chunks
                emitChunkUnload(player, chunksToUnload);
            }
        }
        
        // Clean up disconnected players
        playerChunkStates.keySet().removeIf(uuid -> Bukkit.getPlayer(uuid) == null);
    }
    
    /**
     * Stream a single chunk worth of blocks
     * Now captures ALL blocks with exposed faces (adjacent to air or water)
     */
    private void streamSingleChunk(Player player, World world, int chunkX, int chunkZ, int playerY) {
        if (world == null) return;
        
        int startX = chunkX * 16;
        int startZ = chunkZ * 16;
        int endX = startX + 15;
        int endZ = startZ + 15;
        
        // Scan range based on player position
        int startY = Math.min(playerY + HEIGHT_ABOVE_PLAYER, world.getMaxHeight() - 1);
        int endY = Math.max(playerY - 100, world.getMinHeight());
        
        List<BlockData> blocks = new ArrayList<>();
        
        // Scan every block in the chunk volume
        for (int x = startX; x <= endX; x += SAMPLE_INTERVAL) {
            for (int z = startZ; z <= endZ; z += SAMPLE_INTERVAL) {
                for (int y = startY; y >= endY; y--) {
                    Block block = world.getBlockAt(x, y, z);
                    Material type = block.getType();
                    
                    // Skip air blocks
                    if (type == Material.AIR || type == Material.CAVE_AIR || type == Material.VOID_AIR) {
                        continue;
                    }
                    
                    String blockType = getSimplifiedBlockType(type);
                    
                    // Skip vegetation
                    if (blockType.equals("vegetation")) {
                        continue;
                    }
                    
                    // Always include ALL water blocks - viewer needs complete water data
                    // to properly cull internal faces at chunk boundaries
                    if (blockType.equals("water")) {
                        blocks.add(new BlockData(x, y, z, blockType));
                        continue;
                    }
                    
                    // Check if this solid block has any exposed face (adjacent to air or water)
                    if (hasExposedFace(world, x, y, z)) {
                        blocks.add(new BlockData(x, y, z, blockType));
                    }
                }
            }
        }
        
        if (!blocks.isEmpty()) {
            emitChunkData(player, world, chunkX, chunkZ, blocks);
        }
    }
    
    /**
     * Check if a water block has any face exposed to air or non-water blocks
     */
    private boolean hasWaterExposedFace(World world, int x, int y, int z) {
        return isNotWater(world.getBlockAt(x + 1, y, z).getType()) ||
               isNotWater(world.getBlockAt(x - 1, y, z).getType()) ||
               isNotWater(world.getBlockAt(x, y + 1, z).getType()) ||
               isNotWater(world.getBlockAt(x, y - 1, z).getType()) ||
               isNotWater(world.getBlockAt(x, y, z + 1).getType()) ||
               isNotWater(world.getBlockAt(x, y, z - 1).getType());
    }
    
    /**
     * Check if a material is NOT water (for water surface detection)
     */
    private boolean isNotWater(Material material) {
        return material != Material.WATER;
    }
    
    /**
     * Check if a block has any face exposed to air or water
     */
    private boolean hasExposedFace(World world, int x, int y, int z) {
        return isTransparent(world.getBlockAt(x + 1, y, z).getType()) ||
               isTransparent(world.getBlockAt(x - 1, y, z).getType()) ||
               isTransparent(world.getBlockAt(x, y + 1, z).getType()) ||
               isTransparent(world.getBlockAt(x, y - 1, z).getType()) ||
               isTransparent(world.getBlockAt(x, y, z + 1).getType()) ||
               isTransparent(world.getBlockAt(x, y, z - 1).getType());
    }
    
    /**
     * Check if a material is transparent (air or water)
     */
    private boolean isTransparent(Material material) {
        return material == Material.AIR || 
               material == Material.CAVE_AIR || 
               material == Material.VOID_AIR ||
               material == Material.WATER ||
               material.name().contains("LEAVES");
    }
    
    /**
     * Emit chunk unload message
     */
    private void emitChunkUnload(Player player, Set<ChunkCoord> chunks) {
        StringBuilder json = new StringBuilder();
        json.append("{\"type\":\"chunk_unload\",\"ts\":").append(System.currentTimeMillis());
        json.append(",\"uuid\":\"").append(player.getUniqueId()).append("\"");
        json.append(",\"chunks\":[");
        
        boolean first = true;
        for (ChunkCoord coord : chunks) {
            if (!first) json.append(",");
            json.append("{\"x\":").append(coord.x).append(",\"z\":").append(coord.z).append("}");
            first = false;
        }
        
        json.append("]}");
        plugin.getLogger().info(json.toString());
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
     * Emit chunk data as JSON to the console (single chunk format)
     */
    private void emitChunkData(Player player, World world, int chunkX, int chunkZ, List<BlockData> blocks) {
        long timestamp = System.currentTimeMillis();
        UUID uuid = player.getUniqueId();
        String worldName = escapeJson(world.getName());
        
        // Build JSON for single chunk
        StringBuilder json = new StringBuilder();
        json.append("{\"type\":\"chunk\",\"ts\":").append(timestamp);
        json.append(",\"uuid\":\"").append(uuid).append("\"");
        json.append(",\"world\":\"").append(worldName).append("\"");
        json.append(",\"chunkX\":").append(chunkX);
        json.append(",\"chunkZ\":").append(chunkZ);
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
     * Chunk coordinate holder
     */
    private static class ChunkCoord {
        final int x, z;
        int distanceSq; // For priority sorting
        
        ChunkCoord(int x, int z) {
            this.x = x;
            this.z = z;
        }
        
        @Override
        public boolean equals(Object o) {
            if (this == o) return true;
            if (o == null || getClass() != o.getClass()) return false;
            ChunkCoord that = (ChunkCoord) o;
            return x == that.x && z == that.z;
        }
        
        @Override
        public int hashCode() {
            return 31 * x + z;
        }
    }
    
    /**
     * Tracks which chunks have been sent to a player
     */
    private static class PlayerChunkState {
        final Set<ChunkCoord> loadedChunks = new HashSet<>();
    }
}
