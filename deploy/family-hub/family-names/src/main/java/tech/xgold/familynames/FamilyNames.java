package tech.xgold.familynames;

import com.destroystokyo.paper.profile.PlayerProfile;
import com.google.gson.JsonElement;
import com.google.gson.JsonObject;
import com.google.gson.JsonParser;
import net.kyori.adventure.text.Component;
import net.kyori.adventure.text.format.NamedTextColor;
import net.kyori.adventure.text.format.TextColor;
import org.bukkit.Bukkit;
import org.bukkit.entity.Player;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerCommandPreprocessEvent;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.event.server.RemoteServerCommandEvent;
import org.bukkit.event.server.ServerCommandEvent;
import org.bukkit.plugin.java.JavaPlugin;

import java.io.IOException;
import java.io.Reader;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.attribute.FileTime;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.logging.Level;

/**
 * Shows each family member by the first name stored in the family directory.
 *
 * names.json (account UUID -> {name, color}) is written by the family website's whitelist
 * worker; the color is the member's Discord role color. Chat uses the first name through the
 * display name, the tab list shows it in that color, and the player's profile is renamed, which
 * changes the name tag above their head, the server-list player sample and leave and death
 * messages. The join line is built by the server before any plugin runs, so it is rebuilt here.
 *
 * Commands: the server looks players up by their login name. The first name is registered as a
 * second lookup name, so "/tp Carter" and the tab-completed first names work from the game, the
 * console, RCON and Discord's console relay, while the Minecraft name keeps working too. If that
 * table cannot be reached on a future server version, typed commands are rewritten instead.
 * Nothing touches permissions, ops or the whitelist, which are keyed by UUID.
 */
public final class FamilyNames extends JavaPlugin implements Listener {
    record Entry(String name, TextColor color) {}

    private static final long CHECK_TICKS = 20L * 30;
    /** Commands whose text after the first argument is free text, which must not be rewritten. */
    private static final Set<String> MESSAGE_COMMANDS = Set.of("msg", "tell", "w", "say", "me", "teammsg", "tm");
    private final Map<UUID, Entry> names = new HashMap<>();
    private final Map<UUID, String> originals = new HashMap<>();
    private final Map<UUID, String> aliases = new HashMap<>();
    private Map<String, Object> playersByName;
    private boolean lookupWarned;
    private FileTime loaded;
    private Path file;

    @Override
    public void onEnable() {
        saveDefaultConfig();
        file = getDataFolder().toPath().resolve("names.json");
        reload();
        if (getConfig().getBoolean("resolve-first-names-in-commands", true)) {
            playersByName = lookupTable();
            if (playersByName == null) getLogger().info("First names in commands will be rewritten to Minecraft names.");
        }
        getServer().getPluginManager().registerEvents(this, this);
        getServer().getScheduler().runTaskTimer(this, () -> {
            if (reload()) getServer().getOnlinePlayers().forEach(this::apply);
        }, CHECK_TICKS, CHECK_TICKS);
    }

    /** LOW priority so plugins that read the display name later in the same event (DiscordSRV) see the first name. */
    @EventHandler(priority = EventPriority.LOW)
    public void onJoin(PlayerJoinEvent event) {
        Player player = event.getPlayer();
        Entry entry = names.get(player.getUniqueId());
        if (entry == null) return;
        originals.put(player.getUniqueId(), player.getName());
        apply(player);
        if (event.joinMessage() != null) {
            event.joinMessage(Component.translatable("multiplayer.player.joined", NamedTextColor.YELLOW, Component.text(entry.name())));
        }
    }

    @EventHandler(priority = EventPriority.LOW)
    public void onQuit(PlayerQuitEvent event) {
        Player player = event.getPlayer();
        Entry entry = names.get(player.getUniqueId());
        if (entry != null && event.quitMessage() != null) {
            event.quitMessage(Component.translatable("multiplayer.player.left", NamedTextColor.YELLOW, Component.text(entry.name())));
        }
        unalias(player);
        originals.remove(player.getUniqueId());
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onPlayerCommand(PlayerCommandPreprocessEvent event) {
        if (playersByName != null || !getConfig().getBoolean("resolve-first-names-in-commands", true)) return;
        String rewritten = rewrite(event.getMessage().substring(1));
        if (rewritten != null) event.setMessage("/" + rewritten);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onServerCommand(ServerCommandEvent event) {
        if (playersByName != null || !getConfig().getBoolean("resolve-first-names-in-commands", true)) return;
        String rewritten = rewrite(event.getCommand());
        if (rewritten != null) event.setCommand(rewritten);
    }

    @EventHandler(priority = EventPriority.LOWEST)
    public void onRemoteCommand(RemoteServerCommandEvent event) {
        onServerCommand(event);
    }

    /** Fallback only: swaps first-name arguments for the player's Minecraft name. Returns null when nothing changed. */
    String rewrite(String command) {
        String[] parts = command.split(" ", -1);
        if (parts.length < 2) return null;
        Map<String, String> byFirst = new HashMap<>();
        Set<String> ambiguous = new java.util.HashSet<>();
        for (Player online : getServer().getOnlinePlayers()) {
            Entry entry = names.get(online.getUniqueId());
            String original = originals.get(online.getUniqueId());
            if (entry == null || original == null) continue;
            String key = entry.name().toLowerCase(Locale.ROOT);
            if (byFirst.put(key, original) != null) ambiguous.add(key);
        }
        boolean message = MESSAGE_COMMANDS.contains(parts[0].toLowerCase(Locale.ROOT).replace("minecraft:", ""));
        boolean changed = false;
        for (int i = 1; i < parts.length && !(message && i > 1); i++) {
            String key = parts[i].toLowerCase(Locale.ROOT);
            String original = byFirst.get(key);
            if (original != null && !ambiguous.contains(key) && !original.equalsIgnoreCase(parts[i])) {
                parts[i] = original;
                changed = true;
            }
        }
        return changed ? String.join(" ", parts) : null;
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
            JsonElement root;
            try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
                root = JsonParser.parseReader(reader);
            }
            Map<UUID, Entry> next = new HashMap<>();
            if (root != null && root.isJsonObject()) {
                for (Map.Entry<String, JsonElement> item : root.getAsJsonObject().entrySet()) {
                    Entry entry = parse(item.getValue());
                    if (entry == null) continue;
                    try {
                        next.put(UUID.fromString(item.getKey()), entry);
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

    /** Accepts "First" or {"name": "First", "color": "#rrggbb"}. */
    static Entry parse(JsonElement value) {
        if (value == null) return null;
        String name = null, color = null;
        if (value.isJsonPrimitive()) name = value.getAsString();
        else if (value.isJsonObject()) {
            JsonObject object = value.getAsJsonObject();
            if (object.has("name") && object.get("name").isJsonPrimitive()) name = object.get("name").getAsString();
            if (object.has("color") && object.get("color").isJsonPrimitive()) color = object.get("color").getAsString();
        }
        name = displayable(name);
        return name == null ? null : new Entry(name, color == null ? null : TextColor.fromHexString(color));
    }

    /** Profile names are 1-16 letters, digits or underscores, so the first name is trimmed to that. */
    static String displayable(String value) {
        if (value == null) return null;
        String cleaned = value.strip().replaceAll("[^A-Za-z0-9_]", "");
        if (cleaned.isEmpty()) return null;
        return cleaned.length() > 16 ? cleaned.substring(0, 16) : cleaned;
    }

    private void apply(Player player) {
        Entry entry = names.get(player.getUniqueId());
        if (entry == null) return;
        String name = entry.name();
        player.displayName(Component.text(name));
        boolean colored = entry.color() != null && getConfig().getBoolean("color-tab-list", true);
        player.playerListName(colored ? Component.text(name, entry.color()) : Component.text(name));
        if (getConfig().getBoolean("resolve-first-names-in-commands", true)) alias(player, name);
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

    /** The server's own name -> player table (CraftBukkit's playersByName), or null when it is not where expected. */
    private Map<String, Object> lookupTable() {
        try {
            Object server = Bukkit.getServer().getClass().getMethod("getServer").invoke(Bukkit.getServer());
            Object list = server.getClass().getMethod("getPlayerList").invoke(server);
            for (Class<?> type = list.getClass(); type != null; type = type.getSuperclass()) {
                for (Field field : type.getDeclaredFields()) {
                    if (field.getName().equals("playersByName") && Map.class.isAssignableFrom(field.getType())) {
                        field.setAccessible(true);
                        @SuppressWarnings("unchecked") Map<String, Object> table = (Map<String, Object>) field.get(list);
                        return table;
                    }
                }
            }
            getLogger().warning("The server's player lookup table was not found.");
        } catch (ReflectiveOperationException | RuntimeException e) {
            getLogger().log(Level.WARNING, "The server's player lookup table is not reachable.", e);
        }
        return null;
    }

    private Object handle(Player player) throws ReflectiveOperationException {
        return player.getClass().getMethod("getHandle").invoke(player);
    }

    /** Registers the first name as an extra lookup key unless another online player already owns that name. */
    private void alias(Player player, String name) {
        if (playersByName == null) return;
        String key = name.toLowerCase(Locale.ROOT);
        try {
            Object self = handle(player);
            Object owner = playersByName.get(key);
            if (owner != null && owner != self) return;
            playersByName.put(key, self);
            aliases.put(player.getUniqueId(), key);
        } catch (ReflectiveOperationException | RuntimeException e) {
            if (!lookupWarned) getLogger().log(Level.WARNING, "Could not register a first name for commands.", e);
            lookupWarned = true;
        }
    }

    /** Removes this player's keys (first name and login name) so a renamed player leaves no stale lookup entry. */
    private void unalias(Player player) {
        if (playersByName == null) return;
        try {
            Object self = handle(player);
            String alias = aliases.remove(player.getUniqueId());
            String original = originals.get(player.getUniqueId());
            for (String key : new String[] {alias, original == null ? null : original.toLowerCase(Locale.ROOT)}) {
                if (key != null && playersByName.get(key) == self) playersByName.remove(key);
            }
        } catch (ReflectiveOperationException | RuntimeException e) {
            if (!lookupWarned) getLogger().log(Level.WARNING, "Could not clean up a player's lookup names.", e);
            lookupWarned = true;
        }
    }
}
