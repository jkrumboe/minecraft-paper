package dev.mcgps.telemetry;

import org.bukkit.command.Command;
import org.bukkit.command.CommandSender;
import org.bukkit.entity.Player;
import org.bukkit.plugin.java.JavaPlugin;
import org.jetbrains.annotations.NotNull;

/**
 * McGpsTelemetry Plugin - Main Entry Point
 * 
 * This plugin logs player telemetry data as JSON to the server console
 * for external visualization in a web-based 3D GPS system.
 */
public class McGpsTelemetryPlugin extends JavaPlugin {
    
    private TelemetryService telemetryService;
    private ChunkStreamService chunkStreamService;
    private BlockChangeListener blockChangeListener;
    private InventoryChangeListener inventoryChangeListener;
    
    @Override
    public void onEnable() {
        // Initialize telemetry service
        telemetryService = new TelemetryService(this);
        chunkStreamService = new ChunkStreamService(this);
        
        // Register block change listener for real-time updates
        blockChangeListener = new BlockChangeListener(this);
        getServer().getPluginManager().registerEvents(blockChangeListener, this);
        
        // Register inventory change listener for real-time inventory updates
        inventoryChangeListener = new InventoryChangeListener(this, telemetryService);
        getServer().getPluginManager().registerEvents(inventoryChangeListener, this);
        
        // Start the telemetry task (runs every 2 ticks = 10 times per second)
        telemetryService.start();
        
        // Start chunk streaming (runs every 3 seconds)
        chunkStreamService.start();
        
        getLogger().info("Telemetry plugin enabled - tracking at 10Hz with chunk streaming and real-time block updates");
    }
    
    @Override
    public void onDisable() {
        // Stop the telemetry task
        if (telemetryService != null) {
            telemetryService.stop();
        }
        
        // Stop chunk streaming
        if (chunkStreamService != null) {
            chunkStreamService.stop();
        }
        
        getLogger().info("Telemetry plugin disabled");
    }
    
    @Override
    public boolean onCommand(@NotNull CommandSender sender, @NotNull Command command, 
                            @NotNull String label, @NotNull String[] args) {
        if (command.getName().equalsIgnoreCase("mcgpsdebug")) {
            // Only players can toggle their own telemetry
            if (!(sender instanceof Player)) {
                sender.sendMessage("§cThis command can only be used by players.");
                return true;
            }
            
            Player player = (Player) sender;
            
            // Check arguments
            if (args.length != 1) {
                player.sendMessage("§eUsage: /mcgpsdebug <on|off>");
                return true;
            }
            
            String toggle = args[0].toLowerCase();
            
            if (toggle.equals("on")) {
                telemetryService.enableTelemetry(player.getUniqueId());
                player.sendMessage("§aTelemetry logging enabled for you.");
            } else if (toggle.equals("off")) {
                telemetryService.disableTelemetry(player.getUniqueId());
                player.sendMessage("§cTelemetry logging disabled for you.");
            } else {
                player.sendMessage("§eUsage: /mcgpsdebug <on|off>");
            }
            
            return true;
        }
        
        return false;
    }
}
