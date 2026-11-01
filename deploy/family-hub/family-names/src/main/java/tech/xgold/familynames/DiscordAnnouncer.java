package tech.xgold.familynames;

import github.scarsz.discordsrv.DiscordSRV;
import github.scarsz.discordsrv.dependencies.jda.api.EmbedBuilder;
import github.scarsz.discordsrv.dependencies.jda.api.entities.MessageEmbed;
import github.scarsz.discordsrv.dependencies.jda.api.entities.TextChannel;
import github.scarsz.discordsrv.dependencies.jda.api.requests.restaction.MessageAction;
import net.kyori.adventure.text.serializer.plain.PlainTextComponentSerializer;
import org.bukkit.entity.Player;
import org.bukkit.scheduler.BukkitTask;

import java.util.HashMap;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;
import java.util.logging.Level;

/**
 * Posts the Discord join and leave embeds in place of DiscordSRV's own (switched off in its
 * messages.yml), in the same channel, colors and wording, with the member's family-directory photo
 * as the icon. A leave is held for the grace period: back before it runs out, and neither the leave
 * nor the rejoin is posted. Only this class touches DiscordSRV, so FamilyNames still loads without it.
 * Everything runs on the main thread (events and scheduler tasks), so the map needs no locking.
 */
final class DiscordAnnouncer {
    /** DiscordSRV's default embed colors. */
    private static final int JOIN = 0x00ff00, FIRST_JOIN = 0xffd700, LEAVE = 0xff0000;

    record Held(BukkitTask task, MessageEmbed embed) {}

    private final FamilyNames plugin;
    private final long graceTicks;
    private final Map<UUID, Held> held = new HashMap<>();

    DiscordAnnouncer(FamilyNames plugin, long graceTicks) {
        this.plugin = plugin;
        this.graceTicks = graceTicks;
    }

    void joined(Player player, String photo) {
        Held leave = held.remove(player.getUniqueId());
        if (leave != null) {
            leave.task().cancel();
            return;
        }
        if (player.hasPermission("discordsrv.silentjoin")) return;
        boolean first = !player.hasPlayedBefore();
        String text = name(player) + (first ? " joined the server for the first time" : " joined the server");
        send("join", embed(first ? FIRST_JOIN : JOIN, text, icon(player, photo)), false);
    }

    void left(Player player, String photo) {
        if (player.hasPermission("discordsrv.silentquit")) return;
        UUID id = player.getUniqueId();
        MessageEmbed embed = embed(LEAVE, name(player) + " left the server", icon(player, photo));
        Held previous = held.remove(id);
        if (previous != null) previous.task().cancel();
        BukkitTask task = plugin.getServer().getScheduler().runTaskLater(plugin, () -> {
            if (held.remove(id) != null) send("leave", embed, false);
        }, graceTicks);
        held.put(id, new Held(task, embed));
    }

    /** The server is stopping: post the held leaves now instead of losing them. */
    void flush() {
        for (Held leave : held.values()) {
            leave.task().cancel();
            send("leave", leave.embed(), true);
        }
        held.clear();
    }

    private static String name(Player player) {
        return PlainTextComponentSerializer.plainText().serialize(player.displayName());
    }

    private static String icon(Player player, String photo) {
        return photo != null ? photo : DiscordSRV.getAvatarUrl(player);
    }

    private static MessageEmbed embed(int color, String text, String icon) {
        return new EmbedBuilder().setColor(color).setAuthor(text, null, icon).build();
    }

    /** "join" and "leave" go wherever DiscordSRV sends them: a channel by that name, else its main one. */
    private void send(String channel, MessageEmbed embed, boolean wait) {
        if (!DiscordSRV.isReady) return;
        TextChannel target = DiscordSRV.getPlugin().getOptionalTextChannel(channel);
        if (target == null) return;
        MessageAction action = target.sendMessageEmbeds(embed);
        if (!wait) {
            action.queue(null, e -> plugin.getLogger().warning("Could not post a Discord " + channel + " message: " + e.getMessage()));
            return;
        }
        try {
            action.submit().get(5, TimeUnit.SECONDS);
        } catch (Exception e) {
            plugin.getLogger().log(Level.WARNING, "Could not post a Discord " + channel + " message while stopping.", e);
        }
    }
}
