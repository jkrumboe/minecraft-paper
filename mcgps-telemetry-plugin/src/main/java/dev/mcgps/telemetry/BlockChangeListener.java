package dev.mcgps.telemetry;

import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.block.Block;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.block.BlockBreakEvent;
import org.bukkit.event.block.BlockPlaceEvent;
import org.bukkit.plugin.java.JavaPlugin;

/**
 * Listens for block changes and streams them in real-time
 */
public class BlockChangeListener implements Listener {
    
    private final JavaPlugin plugin;
    
    public BlockChangeListener(JavaPlugin plugin) {
        this.plugin = plugin;
    }
    
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockBreak(BlockBreakEvent event) {
        Block block = event.getBlock();
        Location loc = block.getLocation();
        
        // Output block break event as JSON
        String json = String.format(
            "{\"type\":\"block_break\",\"x\":%d,\"y\":%d,\"z\":%d,\"world\":\"%s\",\"player\":\"%s\"}",
            loc.getBlockX(),
            loc.getBlockY(),
            loc.getBlockZ(),
            loc.getWorld().getName(),
            event.getPlayer().getName()
        );
        
        System.out.println("MCGPS_BLOCK:" + json);
    }
    
    @EventHandler(priority = EventPriority.MONITOR, ignoreCancelled = true)
    public void onBlockPlace(BlockPlaceEvent event) {
        Block block = event.getBlock();
        Location loc = block.getLocation();
        String blockType = getSimplifiedBlockType(block.getType());
        
        // Skip vegetation and other non-solid blocks
        if (blockType == null) {
            return;
        }
        
        // Output block place event as JSON
        String json = String.format(
            "{\"type\":\"block_place\",\"x\":%d,\"y\":%d,\"z\":%d,\"world\":\"%s\",\"blockType\":\"%s\",\"player\":\"%s\"}",
            loc.getBlockX(),
            loc.getBlockY(),
            loc.getBlockZ(),
            loc.getWorld().getName(),
            blockType,
            event.getPlayer().getName()
        );
        
        System.out.println("MCGPS_BLOCK:" + json);
    }
    
    /**
     * Convert Minecraft material to simplified block type
     */
    private String getSimplifiedBlockType(Material material) {
        String name = material.name();
        
        // Skip air and vegetation
        if (material.isAir() || name.equals("CAVE_AIR") || name.equals("VOID_AIR")) {
            return null;
        }
        
        // Skip non-solid vegetation
        if (name.contains("GRASS") && !name.equals("GRASS_BLOCK")) return null;
        if (name.contains("FLOWER") || name.contains("TULIP") || name.contains("ORCHID") ||
            name.contains("DANDELION") || name.contains("POPPY") || name.contains("ALLIUM") ||
            name.contains("AZURE") || name.contains("CORNFLOWER") || name.contains("LILY")) return null;
        if (name.contains("FERN") || name.contains("SEAGRASS") || name.contains("KELP")) return null;
        if (name.contains("MUSHROOM") && !name.contains("BLOCK")) return null;
        if (name.contains("SAPLING") || name.contains("VINE") || name.contains("DEAD_BUSH")) return null;
        if (name.contains("SWEET_BERRY") || name.contains("SUGAR_CANE") || name.contains("BAMBOO")) return null;
        
        // Map to simplified types
        if (name.equals("GRASS_BLOCK") || name.equals("PODZOL") || name.equals("MYCELIUM")) {
            return "grass";
        }
        if (name.contains("DIRT") || name.contains("COARSE") || name.contains("ROOTED") || name.equals("FARMLAND")) {
            return "dirt";
        }
        if (name.equals("STONE") || name.contains("ANDESITE") || name.contains("DIORITE") || 
            name.contains("GRANITE") || name.contains("DEEPSLATE") || name.contains("TUFF") ||
            name.contains("CALCITE") || name.contains("BASALT") || name.contains("BEDROCK") ||
            name.contains("ORE") || name.contains("NETHERRACK") || name.contains("BLACKSTONE") ||
            name.contains("END_STONE") || name.contains("OBSIDIAN")) {
            return "stone";
        }
        if (name.contains("COBBLESTONE") || name.contains("MOSSY")) {
            return "cobblestone";
        }
        if (name.contains("SAND") && !name.contains("STONE")) {
            return "sand";
        }
        if (name.contains("GRAVEL")) {
            return "gravel";
        }
        if (name.contains("WATER")) {
            return "water";
        }
        if (name.contains("LAVA")) {
            return null; // Skip lava for now
        }
        if (name.contains("LOG") || name.contains("WOOD") || name.contains("STEM")) {
            return "wood";
        }
        if (name.contains("LEAVES") || name.contains("AZALEA")) {
            return "leaves";
        }
        if (name.contains("PLANK")) {
            return "planks";
        }
        if (name.contains("SNOW")) {
            return "snow";
        }
        
        // Default to stone for other solid blocks
        if (material.isSolid()) {
            return "stone";
        }
        
        return null;
    }
}
