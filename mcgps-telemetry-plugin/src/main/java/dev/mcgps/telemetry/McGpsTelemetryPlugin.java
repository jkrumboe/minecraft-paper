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
    
    @Override
    public void onEnable() {
        // Initialize telemetry service
        telemetryService = new TelemetryService(this);
        
        // Start the telemetry task (runs every 2 ticks = 10 times per second)
        telemetryService.start();
        
        getLogger().info("Telemetry plugin enabled - tracking at 10Hz (every 2 ticks)");
    }
    
    @Override
    public void onDisable() {
        // Stop the telemetry task
        if (telemetryService != null) {
            telemetryService.stop();
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
