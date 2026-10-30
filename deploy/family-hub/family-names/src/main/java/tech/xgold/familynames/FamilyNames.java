package tech.xgold.familynames;

import com.destroystokyo.paper.profile.PlayerProfile;
import com.google.gson.Gson;
import com.google.gson.reflect.TypeToken;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.io.Reader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.logging.Level;

/**
 * Shows each family member by the first name stored in the family directory.
 *
 * names.json (account UUID -> first name) is written by the family website's whitelist worker.
 * Chat and the tab list use the first name through the display name and player-list name.
 * The player's profile is renamed too, which is what changes the name tag above their head,
 * the tab-list entry other players see, the server-list player sample and plain-name uses such
 * as death and leave messages. The join line is built by the server before any plugin runs, so
 * it is rebuilt here. Nothing touches permissions, ops or the whitelist, which are keyed by UUID.
 */
public final class FamilyNames extends JavaPlugin implements Listener {
    private static final Gson GSON = new Gson();
    private static final long CHECK_TICKS = 20L * 30;
    private final Map<UUID, String> names = new HashMap<>();
    private FileTime loaded;
    private Path file;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        file = getDataFolder().toPath().resolve("names.json");
        reload();
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimer(this, () -> {
            if (reload()) getServer().getOnlinePlayers().forEach(this::apply);
        }, CHECK_TICKS, CHECK_TICKS);
    }

    /** LOW priority so plugins that read the display name later in the same event (DiscordSRV) see the first name. */
    @EventHandler(priority = EventPriority.LOW)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        String name = names.get(player.getUniqueId());
        if (name == null) return;
        apply(player);
        if (event.joinMessage() != null) {
            event.joinMessage(Component.translatable("multiplayer.player.joined", NamedTextColor.YELLOW, Component.text(name)));
        }
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onQuit(PlayerQuitEvent event) {
        String name = names.get(event.getPlayer().getUniqueId());
        if (name != null && event.quitMessage() != null) {
            event.quitMessage(Component.translatable("multiplayer.player.left", NamedTextColor.YELLOW, Component.text(name)));
        }
    }

    /** Re-reads names.json when its timestamp changed. Returns true when the mapping changed. */
    private boolean reload() {
        try {
            if (!Files.exists(file)) {
                if (names.isEmpty()) return false;
                names.clear();
                loaded = null;
                return true;
            }
            FileTime modified = Files.getLastModifiedTime(file);
            if (modified.equals(loaded)) return false;
            Map<String, String> raw;
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                raw = GSON.fromJson(reader, new TypeToken<Map<String, String>>() {}.getType());
            }
            Map<UUID, String> next = new HashMap<>();
            if (raw != null) {
                for (Map.Entry<String, String> entry : raw.entrySet()) {
                    String name = displayable(entry.getValue());
                    if (name == null) continue;
                    try {
                        next.put(UUID.fromString(entry.getKey()), name);
                    } catch (IllegalArgumentException ignored) {
                        // Not an account UUID; skip the row rather than fail the whole file.
                    }
                }
            }
            loaded = modified;
            if (next.equals(names)) return false;
            names.clear();
            names.putAll(next);
            getLogger().info("Loaded " + names.size() + " family names.");
            return true;
        } catch (IOException | RuntimeException e) {
            getLogger().log(Level.WARNING, "Could not read names.json; keeping the previous names.", e);
            return false;
        }
    }

    /** Profile names are 1-16 letters, digits or underscores, so the first name is trimmed to that. */
    static String displayable(String value) {
        if (value == null) return null;
        String cleaned = value.strip().replaceAll("[^A-Za-z0-9_]", "");
        if (cleaned.isEmpty()) return null;
        return cleaned.length() > 16 ? cleaned.substring(0, 16) : cleaned;
    }

    private void apply(Player player) {
        String name = names.get(player.getUniqueId());
        if (name == null) return;
        Component display = Component.text(name);
        player.displayName(display);
        player.playerListName(display);
        boolean bedrock = player.getUniqueId().getMostSignificantBits() == 0L;
        if (!getConfig().getBoolean("rename-profiles", true)) return;
        if (bedrock && !getConfig().getBoolean("rename-bedrock-profiles", true)) return;
        // Re-registering the profile mid-join is fragile; do it on the next tick.
        getServer().getScheduler().runTask(this, () -> {
            if (!player.isOnline()) return;
            try {
                PlayerProfile profile = player.getPlayerProfile();
                if (name.equals(profile.getName())) return;
                profile.setName(name);
                player.setPlayerProfile(profile);
            } catch (RuntimeException e) {
                getLogger().log(Level.WARNING, "Could not rename a player's profile; chat and tab list still show " + name + ".", e);
            }
        });
    }
}
