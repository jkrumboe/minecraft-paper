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
    private static final int CHUNK_RADIUS = 4; // 8x8 chunks view distance (128x128 blocks)
    private static final int UNLOAD_CHUNK_RADIUS = 6; // Unload chunks beyond this distance
    private static final int SAMPLE_INTERVAL = 1; // Sample every block for no gaps
    private static final int SURFACE_DEPTH = 48; // Scan deeper to capture cave entrances and ravines
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
            World world = loc.getWorld();
            if (world == null) continue;
            
            String worldName = world.getName();
            
            // Get or create player's chunk state
            PlayerChunkState state = playerChunkStates.computeIfAbsent(uuid, k -> new PlayerChunkState());
            
            // Check if player changed worlds or this is first time tracking them
            boolean isNewPlayer = state.currentWorld == null;
            boolean worldChanged = !isNewPlayer && !state.currentWorld.equals(worldName);
            if (isNewPlayer || worldChanged) {
                // Emit world change event so client can switch displayed world
                emitWorldChange(player, worldName);
            }
            state.currentWorld = worldName;
            
            // Get chunks for current world
            Set<ChunkCoord> loadedChunks = state.getChunksForWorld(worldName);
            
            // Get the player's current chunk coordinates
            int playerChunkX = loc.getBlockX() >> 4;
            int playerChunkZ = loc.getBlockZ() >> 4;
            
            // Find chunks that need to be loaded
            List<ChunkCoord> chunksToLoad = new ArrayList<>();
            for (int dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx++) {
                for (int dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz++) {
                    ChunkCoord coord = new ChunkCoord(playerChunkX + dx, playerChunkZ + dz);
                    if (!loadedChunks.contains(coord)) {
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
                streamSingleChunk(player, world, coord.x, coord.z, loc.getBlockY());
                loadedChunks.add(coord);
                chunksLoaded++;
            }
            
            // Unload distant chunks (only for current world)
            Set<ChunkCoord> chunksToUnload = new HashSet<>();
            for (ChunkCoord coord : loadedChunks) {
                int dx = coord.x - playerChunkX;
                int dz = coord.z - playerChunkZ;
                if (Math.abs(dx) > UNLOAD_CHUNK_RADIUS || Math.abs(dz) > UNLOAD_CHUNK_RADIUS) {
                    chunksToUnload.add(coord);
                }
            }
            
            if (!chunksToUnload.isEmpty()) {
                loadedChunks.removeAll(chunksToUnload);
                // Notify client to unload these chunks
                emitChunkUnload(player, world, chunksToUnload);
            }
        }
        
        // Clean up disconnected players
        playerChunkStates.keySet().removeIf(uuid -> Bukkit.getPlayer(uuid) == null);
    }
    
    /**
     * Emit world change event
     */
    private void emitWorldChange(Player player, String newWorld) {
        String json = String.format(
            "{\"type\":\"world_change\",\"ts\":%d,\"uuid\":\"%s\",\"world\":\"%s\"}",
            System.currentTimeMillis(), player.getUniqueId(), escapeJson(newWorld)
        );
        plugin.getLogger().info(json);
    }
    
    /**
     * Stream a single chunk worth of blocks
     * Uses heightmap-based surface detection to capture terrain including cliffs
     */
    private void streamSingleChunk(Player player, World world, int chunkX, int chunkZ, int playerY) {
        if (world == null) return;
        
        int startX = chunkX * 16;
        int startZ = chunkZ * 16;
        
        List<BlockData> blocks = new ArrayList<>();
        
        // First pass: Build heightmap to find surface at each X,Z position
        int[][] heightMap = new int[16][16];
        int maxSurfaceY = world.getMinHeight();
        int minSurfaceY = world.getMaxHeight();
        
        for (int lx = 0; lx < 16; lx++) {
            for (int lz = 0; lz < 16; lz++) {
                int x = startX + lx;
                int z = startZ + lz;
                
                // Find highest non-air block (the surface)
                int surfaceY = world.getMinHeight();
                for (int y = world.getMaxHeight() - 1; y >= world.getMinHeight(); y--) {
                    Material type = world.getBlockAt(x, y, z).getType();
                    if (!isAir(type)) {
                        surfaceY = y;
                        break;
                    }
                }
                heightMap[lx][lz] = surfaceY;
                maxSurfaceY = Math.max(maxSurfaceY, surfaceY);
                minSurfaceY = Math.min(minSurfaceY, surfaceY);
            }
        }
        
        // Calculate global scan floor based on chunk's lowest surface point
        // This ensures cliff faces are captured (we scan down from each column's surface
        // to the chunk's global minimum minus depth buffer)
        int globalFloor = Math.max(world.getMinHeight(), minSurfaceY - SURFACE_DEPTH);
        
        // For overworld, limit to Y >= 0 (skip deep underground/deepslate layer)
        // The important surface features are above Y=0
        String worldName = world.getName();
        boolean isOverworld = worldName.equals("world") || worldName.equals("overworld");
        if (isOverworld) {
            globalFloor = Math.max(0, globalFloor);
        }
        
        // Second pass: Collect blocks from each column's surface down to global floor
        // This captures cliff faces where neighboring columns are lower
        for (int lx = 0; lx < 16; lx++) {
            for (int lz = 0; lz < 16; lz++) {
                int x = startX + lx;
                int z = startZ + lz;
                int localSurface = heightMap[lx][lz];
                
                // Scan from this column's surface down to the global floor
                // This ensures cliff faces exposed to lower terrain are included
                for (int y = localSurface; y >= globalFloor; y--) {
                    Block block = world.getBlockAt(x, y, z);
                    Material type = block.getType();
                    
                    // Skip air blocks
                    if (isAir(type)) continue;
                    
                    String blockType = getSimplifiedBlockType(type);
                    
                    // Skip vegetation
                    if (blockType.equals("vegetation")) continue;
                    
                    // Get light level from exposed faces (adjacent transparent blocks)
                    // For solid blocks, the light inside is 0, but we want the light hitting the visible faces
                    int light = getExposedFaceLight(world, x, y, z);
                    
                    // Include water blocks
                    if (blockType.equals("water")) {
                        blocks.add(new BlockData(x, y, z, blockType, light));
                        continue;
                    }
                    
                    // Check if this solid block has any exposed face
                    if (hasExposedFace(world, x, y, z)) {
                        blocks.add(new BlockData(x, y, z, blockType, light));
                    }
                }
            }
        }
        
        // Also scan above surface for floating blocks, trees, structures
        for (int lx = 0; lx < 16; lx++) {
            for (int lz = 0; lz < 16; lz++) {
                int x = startX + lx;
                int z = startZ + lz;
                int localSurface = heightMap[lx][lz];
                
                // Scan above surface up to world height
                for (int y = localSurface + 1; y < world.getMaxHeight(); y++) {
                    Block block = world.getBlockAt(x, y, z);
                    Material type = block.getType();
                    
                    if (isAir(type)) continue;
                    
                    String blockType = getSimplifiedBlockType(type);
                    if (blockType.equals("vegetation")) continue;
                    
                    if (blockType.equals("water") || hasExposedFace(world, x, y, z)) {
                        // Get light from exposed faces for proper rendering
                        int light = getExposedFaceLight(world, x, y, z);
                        blocks.add(new BlockData(x, y, z, blockType, light));
                    }
                }
            }
        }
        
        if (!blocks.isEmpty()) {
            emitChunkData(player, world, chunkX, chunkZ, blocks);
        }
    }
    
    /**
     * Check if a block is air (any type)
     */
    private boolean isAir(Material type) {
        return type == Material.AIR || type == Material.CAVE_AIR || type == Material.VOID_AIR;
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
     * Get the maximum light level from adjacent transparent blocks
     * This gives us the light level that would illuminate the exposed faces of a solid block
     */
    private int getExposedFaceLight(World world, int x, int y, int z) {
        int maxLight = 0;
        
        // Check all 6 adjacent blocks
        int[][] offsets = {{1,0,0}, {-1,0,0}, {0,1,0}, {0,-1,0}, {0,0,1}, {0,0,-1}};
        for (int[] off : offsets) {
            Block adj = world.getBlockAt(x + off[0], y + off[1], z + off[2]);
            if (isTransparent(adj.getType())) {
                int light = Math.max(adj.getLightFromSky(), adj.getLightFromBlocks());
                if (light > maxLight) maxLight = light;
            }
        }
        
        return maxLight;
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
     * Emit chunk unload message with world name
     */
    private void emitChunkUnload(Player player, World world, Set<ChunkCoord> chunks) {
        StringBuilder json = new StringBuilder();
        json.append("{\"type\":\"chunk_unload\",\"ts\":").append(System.currentTimeMillis());
        json.append(",\"uuid\":\"").append(player.getUniqueId()).append("\"");
        json.append(",\"world\":\"").append(escapeJson(world.getName())).append("\"");
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
            json.append(",\"type\":\"").append(block.type).append("\"");
            json.append(",\"l\":").append(block.light).append("}");
        }
        
        json.append("]}");
        
        plugin.getLogger().info(json.toString());
    }
    
    /**
     * Simplify Minecraft block types to basic materials
     */
    private String getSimplifiedBlockType(Material material) {
        String name = material.name().toLowerCase();
        
        // Water and lava - keep lava as separate type for proper rendering
        if (name.contains("water")) return "water";
        if (name.contains("lava")) return "lava";
        
        // Grass blocks - use grass_block for proper multi-face texture
        if (name.equals("grass_block")) return "grass_block";
        
        // Leaves - keep specific types for different colors
        if (name.contains("azalea_leaves") || name.contains("flowering_azalea")) return "azalea_leaves";
        if (name.contains("cherry_leaves")) return "cherry_leaves";
        if (name.contains("birch_leaves")) return "birch_leaves";
        if (name.contains("spruce_leaves")) return "spruce_leaves";
        if (name.contains("jungle_leaves")) return "jungle_leaves";
        if (name.contains("acacia_leaves")) return "acacia_leaves";
        if (name.contains("dark_oak_leaves")) return "dark_oak_leaves";
        if (name.contains("mangrove_leaves")) return "mangrove_leaves";
        if (name.contains("leaves")) return "oak_leaves";
        
        // Short grass, ferns, flowers, etc. - skip (too small to render)
        if (name.contains("short_grass") || name.contains("tall_grass")) return "vegetation";
        if (name.contains("fern") || name.contains("flower") || name.contains("tulip") ||
            name.contains("dandelion") || name.contains("poppy") || name.contains("orchid") ||
            name.contains("allium") || name.contains("cornflower") || name.contains("lily")) return "vegetation";
        
        // Dirt and soil variants
        if (name.equals("coarse_dirt")) return "coarse_dirt";
        if (name.equals("rooted_dirt")) return "rooted_dirt";
        if (name.equals("podzol")) return "podzol";
        if (name.equals("mycelium")) return "mycelium";
        if (name.contains("mud") && !name.contains("muddy")) return "mud";
        if (name.contains("dirt")) return "dirt";
        
        // Clay
        if (name.equals("clay")) return "clay";
        
        // Terracotta
        if (name.contains("terracotta")) return name;
        
        // Sand variants
        if (name.equals("red_sand")) return "red_sand";
        if (name.contains("sand") && !name.contains("sandstone")) return "sand";
        if (name.contains("red_sandstone")) return "red_sandstone";
        if (name.contains("sandstone")) return "sandstone";
        
        // Gravel
        if (name.contains("gravel")) return "gravel";
        
        // Wood blocks (logs) - keep specific types
        if (name.contains("oak_log")) return "oak_log";
        if (name.contains("birch_log")) return "birch_log";
        if (name.contains("spruce_log")) return "spruce_log";
        if (name.contains("jungle_log")) return "jungle_log";
        if (name.contains("acacia_log")) return "acacia_log";
        if (name.contains("dark_oak_log")) return "dark_oak_log";
        if (name.contains("cherry_log")) return "cherry_log";
        if (name.contains("mangrove_log")) return "mangrove_log";
        if (name.contains("crimson_stem")) return "crimson_stem";
        if (name.contains("warped_stem")) return "warped_stem";
        if (name.contains("log") || (name.contains("stripped") && name.contains("wood"))) return "oak_log";
        
        // Planks - keep specific types
        if (name.contains("oak_planks")) return "oak_planks";
        if (name.contains("birch_planks")) return "birch_planks";
        if (name.contains("spruce_planks")) return "spruce_planks";
        if (name.contains("jungle_planks")) return "jungle_planks";
        if (name.contains("acacia_planks")) return "acacia_planks";
        if (name.contains("dark_oak_planks")) return "dark_oak_planks";
        if (name.contains("cherry_planks")) return "cherry_planks";
        if (name.contains("planks")) return "oak_planks";
        
        // Stone variants - be more specific
        if (name.equals("stone")) return "stone";
        if (name.equals("andesite")) return "andesite";
        if (name.equals("diorite")) return "diorite";
        if (name.equals("granite")) return "granite";
        if (name.contains("cobblestone")) return "cobblestone";
        if (name.equals("bedrock")) return "bedrock";
        if (name.contains("deepslate") && name.contains("ore")) return name;
        if (name.contains("deepslate")) return "deepslate";
        if (name.contains("tuff")) return "tuff";
        
        // Ores - keep specific types
        if (name.contains("coal_ore")) return "coal_ore";
        if (name.contains("iron_ore")) return "iron_ore";
        if (name.contains("gold_ore")) return "gold_ore";
        if (name.contains("diamond_ore")) return "diamond_ore";
        if (name.contains("redstone_ore")) return "redstone_ore";
        if (name.contains("lapis_ore")) return "lapis_ore";
        if (name.contains("emerald_ore")) return "emerald_ore";
        if (name.contains("copper_ore")) return "copper_ore";
        
        // Nether blocks
        if (name.equals("netherrack")) return "netherrack";
        if (name.equals("soul_sand")) return "soul_sand";
        if (name.equals("soul_soil")) return "soul_soil";
        if (name.equals("glowstone")) return "glowstone";
        if (name.equals("magma_block")) return "magma_block";
        if (name.contains("nether_brick")) return "nether_bricks";
        if (name.contains("basalt")) return "basalt";
        if (name.contains("blackstone")) return "blackstone";
        
        // End blocks
        if (name.equals("end_stone")) return "end_stone";
        if (name.contains("end_stone_bricks")) return "end_stone_bricks";
        if (name.contains("end_stone")) return "end_stone";
        if (name.contains("purpur")) return "purpur_block";
        if (name.contains("end_portal_frame")) return "end_portal_frame";
        if (name.contains("end_portal")) return "end_portal";
        if (name.contains("end_gateway")) return "end_gateway";
        if (name.contains("end_rod")) return "end_rod";
        if (name.contains("dragon_egg")) return "dragon_egg";
        
        // Beacon and conduit
        if (name.equals("beacon")) return "beacon";
        if (name.equals("conduit")) return "conduit";
        
        // Command blocks
        if (name.contains("command_block")) return "command_block";
        if (name.contains("structure_block")) return "structure_block";
        if (name.contains("jigsaw")) return "jigsaw";
        
        // Functional blocks
        if (name.equals("enchanting_table")) return "enchanting_table";
        if (name.equals("lectern")) return "lectern";
        if (name.equals("brewing_stand")) return "brewing_stand";
        if (name.contains("cauldron")) return "cauldron";
        if (name.contains("anvil")) return "anvil";
        if (name.equals("grindstone")) return "grindstone";
        if (name.equals("stonecutter")) return "stonecutter";
        if (name.equals("loom")) return "loom";
        if (name.equals("cartography_table")) return "cartography_table";
        if (name.equals("smithing_table")) return "smithing_table";
        if (name.equals("fletching_table")) return "fletching_table";
        if (name.equals("barrel")) return "barrel";
        if (name.equals("composter")) return "composter";
        if (name.contains("campfire")) return name.contains("soul") ? "soul_campfire" : "campfire";
        if (name.contains("beehive")) return "beehive";
        if (name.contains("bee_nest")) return "bee_nest";
        
        // Respawn anchor
        if (name.contains("respawn_anchor")) return "respawn_anchor";
        if (name.contains("crying_obsidian")) return "crying_obsidian";
        
        // Obsidian
        if (name.contains("obsidian")) return "obsidian";
        
        // Glass
        if (name.contains("glass")) return "glass";
        
        // Snow and ice
        if (name.contains("snow")) return "snow";
        if (name.contains("ice")) return "ice";
        
        // Prismarine
        if (name.contains("prismarine")) return "prismarine";
        
        // Moss
        if (name.contains("moss_block")) return "moss_block";
        
        // Amethyst - be more specific
        if (name.equals("budding_amethyst")) return "budding_amethyst";
        if (name.equals("amethyst_block")) return "amethyst_block";
        if (name.contains("amethyst_bud")) return name;
        if (name.equals("amethyst_cluster")) return "amethyst_cluster";
        if (name.contains("amethyst")) return "amethyst_block";
        
        // Sculk - be more specific
        if (name.equals("sculk")) return "sculk";
        if (name.equals("sculk_catalyst")) return "sculk_catalyst";
        if (name.equals("sculk_sensor")) return "sculk_sensor";
        if (name.equals("sculk_shrieker")) return "sculk_shrieker";
        if (name.equals("sculk_vein")) return "sculk_vein";
        if (name.contains("sculk")) return "sculk";
        
        // Dripstone
        if (name.contains("pointed_dripstone")) return "pointed_dripstone";
        if (name.contains("dripstone")) return "dripstone_block";
        
        // Calcite
        if (name.equals("calcite")) return "calcite";
        
        // Nether vegetation
        if (name.equals("crimson_nylium")) return "crimson_nylium";
        if (name.equals("warped_nylium")) return "warped_nylium";
        if (name.equals("nether_wart_block")) return "nether_wart_block";
        if (name.equals("warped_wart_block")) return "warped_wart_block";
        if (name.equals("shroomlight")) return "shroomlight";
        if (name.contains("crimson_roots")) return "crimson_roots";
        if (name.contains("warped_roots")) return "warped_roots";
        if (name.contains("nether_sprouts")) return "nether_sprouts";
        if (name.contains("twisting_vines")) return "twisting_vines";
        if (name.contains("weeping_vines")) return "weeping_vines";
        
        // Froglight
        if (name.contains("froglight")) return name;
        
        // Dripleaf
        if (name.contains("big_dripleaf")) return "big_dripleaf";
        if (name.contains("small_dripleaf")) return "small_dripleaf";
        
        // Glow lichen
        if (name.equals("glow_lichen")) return "glow_lichen";
        if (name.equals("hanging_roots")) return "hanging_roots";
        if (name.equals("spore_blossom")) return "spore_blossom";
        
        // Coral
        if (name.contains("coral_block")) return name;
        if (name.contains("coral")) return name;
        
        // Shulker boxes
        if (name.contains("shulker_box")) return name;
        
        // Glazed terracotta (already handled by terracotta above, but be explicit)
        if (name.contains("glazed_terracotta")) return name;
        
        // Concrete powder
        if (name.contains("concrete_powder")) return name;
        if (name.contains("concrete")) return name;
        
        // Wool (already handled but be explicit)
        if (name.contains("wool")) return name;
        
        // Candles
        if (name.contains("candle")) return name;
        
        // Redstone components
        if (name.equals("redstone_wire")) return "redstone_wire";
        if (name.contains("redstone_torch")) return "redstone_torch";
        if (name.equals("repeater")) return "repeater";
        if (name.equals("comparator")) return "comparator";
        if (name.equals("daylight_detector")) return "daylight_detector";
        if (name.equals("observer")) return "observer";
        if (name.equals("dispenser")) return "dispenser";
        if (name.equals("dropper")) return "dropper";
        if (name.equals("hopper")) return "hopper";
        if (name.contains("piston")) return name.contains("sticky") ? "sticky_piston" : "piston";
        if (name.equals("lever")) return "lever";
        if (name.equals("tripwire_hook")) return "tripwire_hook";
        if (name.equals("target")) return "target";
        if (name.equals("lightning_rod")) return "lightning_rod";
        
        // Bookshelf
        if (name.contains("chiseled_bookshelf")) return "chiseled_bookshelf";
        if (name.equals("bookshelf")) return "bookshelf";
        
        // Miscellaneous
        if (name.equals("sponge")) return "sponge";
        if (name.equals("wet_sponge")) return "wet_sponge";
        if (name.equals("slime_block")) return "slime_block";
        if (name.equals("honey_block")) return "honey_block";
        if (name.equals("honeycomb_block")) return "honeycomb_block";
        if (name.equals("sea_lantern")) return "sea_lantern";
        if (name.equals("redstone_lamp")) return "redstone_lamp";
        if (name.equals("note_block")) return "note_block";
        if (name.equals("jukebox")) return "jukebox";
        if (name.equals("spawner")) return "spawner";
        if (name.equals("cobweb")) return "cobweb";
        
        // Mushroom blocks
        if (name.contains("mushroom_block")) return name;
        if (name.equals("mushroom_stem")) return "mushroom_stem";
        if (name.equals("red_mushroom")) return "red_mushroom";
        if (name.equals("brown_mushroom")) return "brown_mushroom";
        
        // Rails
        if (name.contains("rail")) return name;
        
        // Chains and lanterns
        if (name.equals("chain")) return "chain";
        if (name.equals("lantern")) return "lantern";
        if (name.equals("soul_lantern")) return "soul_lantern";
        if (name.equals("torch")) return "torch";
        if (name.equals("soul_torch")) return "soul_torch";
        
        // Ladder and vines
        if (name.equals("ladder")) return "ladder";
        if (name.equals("vine")) return "vine";
        
        // Cactus
        if (name.equals("cactus")) return "cactus";
        if (name.equals("sugar_cane")) return "sugar_cane";
        if (name.equals("bamboo")) return "bamboo";
        if (name.equals("dead_bush")) return "dead_bush";
        
        // Pumpkin and melon
        if (name.contains("pumpkin")) return name;
        if (name.equals("melon")) return "melon";
        
        // Hay and bone blocks
        if (name.equals("hay_block")) return "hay_block";
        if (name.equals("bone_block")) return "bone_block";
        
        // Metal and gem blocks
        if (name.equals("iron_block")) return "iron_block";
        if (name.equals("gold_block")) return "gold_block";
        if (name.equals("diamond_block")) return "diamond_block";
        if (name.equals("emerald_block")) return "emerald_block";
        if (name.equals("lapis_block")) return "lapis_block";
        if (name.equals("redstone_block")) return "redstone_block";
        if (name.equals("copper_block")) return "copper_block";
        if (name.equals("netherite_block")) return "netherite_block";
        if (name.equals("coal_block")) return "coal_block";
        if (name.contains("raw_") && name.contains("_block")) return name;
        
        // TNT
        if (name.equals("tnt")) return "tnt";
        
        // Crafting and furnaces
        if (name.equals("crafting_table")) return "crafting_table";
        if (name.equals("furnace")) return "furnace";
        if (name.equals("blast_furnace")) return "blast_furnace";
        if (name.equals("smoker")) return "smoker";
        
        // Bricks
        if (name.equals("bricks")) return "bricks";
        if (name.contains("stone_brick")) return name.contains("mossy") ? "mossy_stone_bricks" : 
                                                 name.contains("cracked") ? "cracked_stone_bricks" :
                                                 name.contains("chiseled") ? "chiseled_stone_bricks" : "stone_bricks";
        
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
        final int light; // Combined light level (0-15)
        
        BlockData(int x, int y, int z, String type, int light) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.type = type;
            this.light = light;
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
     * Tracks which chunks have been sent to a player per world
     */
    private static class PlayerChunkState {
        final Map<String, Set<ChunkCoord>> worldChunks = new HashMap<>();
        String currentWorld = null;
        
        Set<ChunkCoord> getChunksForWorld(String worldName) {
            return worldChunks.computeIfAbsent(worldName, k -> new HashSet<>());
        }
    }
}
