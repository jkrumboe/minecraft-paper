package dev.mcgps.telemetry;

import java.util.HashMap;
import java.util.HashSet;
import java.util.Map;
import java.util.Set;
import java.util.UUID;

import org.bukkit.Bukkit;
import org.bukkit.Location;
import org.bukkit.Material;
import org.bukkit.World;
import org.bukkit.entity.Player;
import org.bukkit.inventory.ItemStack;
import org.bukkit.inventory.PlayerInventory;
import org.bukkit.plugin.java.JavaPlugin;
import org.bukkit.scheduler.BukkitTask;

/**
 * TelemetryService - Tracks player positions and emits JSON telemetry
 * 
 * This service runs a Bukkit scheduler task every 2 ticks (10 times per second)
 * to check all online players. Telemetry is only emitted if a player has moved
 * at least 0.10 blocks or rotated at least 3.0 degrees since the last emission.
 */
public class TelemetryService {
    
    private static final long TASK_INTERVAL_TICKS = 2L; // 10 times per second
    private static final double MIN_MOVEMENT_THRESHOLD = 0.10; // blocks
    private static final double MIN_ROTATION_THRESHOLD = 3.0; // degrees
    
    private final JavaPlugin plugin;
    private final Map<UUID, LastState> lastStates;
    private final Set<UUID> disabledPlayers;
    private BukkitTask telemetryTask;
    
    public TelemetryService(JavaPlugin plugin) {
        this.plugin = plugin;
        this.lastStates = new HashMap<>();
        this.disabledPlayers = new HashSet<>();
    }
    
    /**
     * Start the telemetry task
     */
    public void start() {
        telemetryTask = Bukkit.getScheduler().runTaskTimer(plugin, this::emitTelemetry, 
                                                           0L, TASK_INTERVAL_TICKS);
    }
    
    /**
     * Stop the telemetry task
     */
    public void stop() {
        if (telemetryTask != null) {
            telemetryTask.cancel();
            telemetryTask = null;
        }
        lastStates.clear();
        disabledPlayers.clear();
    }
    
    /**
     * Enable telemetry for a specific player
     */
    public void enableTelemetry(UUID playerId) {
        disabledPlayers.remove(playerId);
    }
    
    /**
     * Disable telemetry for a specific player
     */
    public void disableTelemetry(UUID playerId) {
        disabledPlayers.add(playerId);
        lastStates.remove(playerId); // Clear last state when disabled
    }
    
    /**
     * Force emit telemetry for a specific player (used for inventory updates)
     */
    public void forceEmit(Player player) {
        if (player == null || !player.isOnline()) return;
        UUID uuid = player.getUniqueId();
        if (disabledPlayers.contains(uuid)) return;
        
        emitTelemetryRecord(player, player.getLocation());
        lastStates.put(uuid, new LastState(player.getLocation()));
    }
    
    /**
     * Main telemetry emission logic - called every 2 ticks
     */
    private void emitTelemetry() {
        for (Player player : Bukkit.getOnlinePlayers()) {
            UUID uuid = player.getUniqueId();
            
            // Skip if telemetry is disabled for this player
            if (disabledPlayers.contains(uuid)) {
                continue;
            }
            
            Location loc = player.getLocation();
            LastState last = lastStates.get(uuid);
            
            // Always emit on first observation
            if (last == null) {
                emitTelemetryRecord(player, loc);
                lastStates.put(uuid, new LastState(loc));
                continue;
            }
            
            // Check if player moved enough or rotated enough
            double distance = calculateDistance(last.x, last.y, last.z, loc.getX(), loc.getY(), loc.getZ());
            double yawDelta = Math.abs(angleDelta(last.yaw, loc.getYaw()));
            double pitchDelta = Math.abs(angleDelta(last.pitch, loc.getPitch()));
            
            boolean movedEnough = distance >= MIN_MOVEMENT_THRESHOLD;
            boolean rotatedEnough = (yawDelta >= MIN_ROTATION_THRESHOLD) || (pitchDelta >= MIN_ROTATION_THRESHOLD);
            
            if (movedEnough || rotatedEnough) {
                emitTelemetryRecord(player, loc);
                lastStates.put(uuid, new LastState(loc));
            }
        }
        
        // Clean up disconnected players
        lastStates.keySet().removeIf(uuid -> Bukkit.getPlayer(uuid) == null);
    }
    
    /**
     * Emit a single telemetry record as JSON to the console
     */
    private void emitTelemetryRecord(Player player, Location loc) {
        long timestamp = System.currentTimeMillis();
        UUID uuid = player.getUniqueId();
        String name = escapeJson(player.getName());
        World world = loc.getWorld();
        String worldName = world != null ? escapeJson(world.getName()) : "unknown";
        double x = loc.getX();
        double y = loc.getY();
        double z = loc.getZ();
        float yaw = loc.getYaw();
        float pitch = loc.getPitch();
        boolean onGround = player.isOnGround();
        
        // Get inventory data
        String inventoryJson = getInventoryJson(player);
        
        // Build JSON manually (no external libraries)
        String json = String.format(
            "{\"ts\":%d,\"uuid\":\"%s\",\"name\":\"%s\",\"world\":\"%s\",\"x\":%.3f,\"y\":%.3f,\"z\":%.3f,\"yaw\":%.2f,\"pitch\":%.2f,\"onGround\":%b,\"health\":%.1f,\"food\":%d,\"level\":%d,\"inventory\":%s}",
            timestamp, uuid, name, worldName, x, y, z, yaw, pitch, onGround,
            player.getHealth(), player.getFoodLevel(), player.getLevel(), inventoryJson
        );
        
        plugin.getLogger().info(json);
    }
    
    /**
     * Calculate Euclidean distance between two 3D points
     */
    private double calculateDistance(double x1, double y1, double z1, double x2, double y2, double z2) {
        double dx = x2 - x1;
        double dy = y2 - y1;
        double dz = z2 - z1;
        return Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    
    /**
     * Calculate the shortest angular distance between two angles
     */
    private double angleDelta(float angle1, float angle2) {
        double delta = angle2 - angle1;
        // Normalize to [-180, 180]
        while (delta > 180.0) delta -= 360.0;
        while (delta < -180.0) delta += 360.0;
        return delta;
    }
    
    /**
     * Get player inventory as JSON array
     */
    private String getInventoryJson(Player player) {
        PlayerInventory inv = player.getInventory();
        StringBuilder json = new StringBuilder();
        json.append("{");
        
        // Hotbar (slots 0-8)
        json.append("\"hotbar\":[");
        for (int i = 0; i < 9; i++) {
            if (i > 0) json.append(",");
            json.append(itemToJson(inv.getItem(i)));
        }
        json.append("],");
        
        // Main inventory (slots 9-35)
        json.append("\"main\":[");
        for (int i = 9; i < 36; i++) {
            if (i > 9) json.append(",");
            json.append(itemToJson(inv.getItem(i)));
        }
        json.append("],");
        
        // Armor (helmet, chestplate, leggings, boots)
        json.append("\"armor\":[");
        ItemStack[] armor = inv.getArmorContents();
        for (int i = armor.length - 1; i >= 0; i--) { // Reverse order: helmet first
            if (i < armor.length - 1) json.append(",");
            json.append(itemToJson(armor[i]));
        }
        json.append("],");
        
        // Offhand
        json.append("\"offhand\":").append(itemToJson(inv.getItemInOffHand()));
        
        // Held slot
        json.append(",\"heldSlot\":").append(inv.getHeldItemSlot());
        
        json.append("}");
        return json.toString();
    }
    
    /**
     * Convert an ItemStack to JSON object
     */
    private String itemToJson(ItemStack item) {
        if (item == null || item.getType() == Material.AIR) {
            return "null";
        }
        String type = escapeJson(item.getType().name().toLowerCase());
        int amount = item.getAmount();
        return String.format("{\"type\":\"%s\",\"amount\":%d}", type, amount);
    }
    
    /**
     * Escape special characters for JSON strings
     */
    private String escapeJson(String str) {
        if (str == null) {
            return "";
        }
        return str.replace("\\", "\\\\")
                  .replace("\"", "\\\"")
                  .replace("\n", "\\n")
                  .replace("\r", "\\r")
                  .replace("\t", "\\t");
    }
    
    /**
     * Inner class to store the last emitted state for a player
     */
    private static class LastState {
        final double x, y, z;
        final float yaw, pitch;
        
        LastState(Location loc) {
            this.x = loc.getX();
            this.y = loc.getY();
            this.z = loc.getZ();
            this.yaw = loc.getYaw();
            this.pitch = loc.getPitch();
        }
    }
}
