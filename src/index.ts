// src/index.ts
import "dotenv/config";
import {
  ActivityType,
  Client,
  GatewayIntentBits,
  TextChannel,
  ThreadChannel,
} from "discord.js";
import { DB } from "./lib/storage.js";
import { cfg } from "./lib/ids.js";
import { handleCagecheck } from "./features/cagecheck.js";

// ---------- client ----------
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,       // slash commands, channels, guild info
    GatewayIntentBits.GuildMembers, // needed for role checks/removals
  ],
});

// ---------- logging & diagnostics ----------
process.on("unhandledRejection", (r) => console.error("UNHANDLED REJECTION:", r));
process.on("uncaughtException", (e) => console.error("UNCAUGHT EXCEPTION:", e));
client.on("error", (e) => console.error("CLIENT ERROR:", e));
client.on("shardDisconnect", (ev, id) => console.warn(`[ws] shard ${id} disconnected (${ev.code})`));
client.on("shardReconnecting", (id) => console.warn(`[ws] shard ${id} reconnecting...`));
client.on("shardResume", (id, replayed) => console.log(`[ws] shard ${id} resumed, replayed: ${replayed}`));

// ---------- ready ----------
client.once("ready", () => {
  console.log(`✅ Logged in as ${client.user?.tag}`);
  client.user?.setPresence({
    activities: [{ name: "/cagecheck", type: ActivityType.Playing }],
    status: "online",
  });
});

// ---------- command router ----------
client.on("interactionCreate", async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  try {
    // — /health — fast immediate reply, no defer
    if (interaction.commandName === "health") {
      await interaction.reply({ content: "✅ I'm alive!", ephemeral: true });

      const ms = client.ws.ping;
      const uptimeMs = client.uptime ?? 0;
      const pad = (n: number) => String(n).padStart(2, "0");
      const d = Math.floor(uptimeMs / 86_400_000);
      const h = Math.floor((uptimeMs % 86_400_000) / 3_600_000);
      const m = Math.floor((uptimeMs % 3_600_000) / 60_000);
      const s = Math.floor((uptimeMs % 60_000) / 1_000);

      // Optional: check permissions for #cage-check
      let permsLine = "—";
      try {
        const ch = await client.channels.fetch(cfg.CAGECHECK_CHANNEL_ID);
        const me = interaction.guild?.members.me; // cached self member
        const needed = [
          "ViewChannel",
          "SendMessages",
          "ReadMessageHistory",
          "CreatePublicThreads",
          "SendMessagesInThreads",
          "ManageThreads",
          "ManageMessages",
        ] as const;
        const hasAll =
          !!ch?.isTextBased() &&
          !!me &&
          needed.every((p) => (ch as TextChannel).permissionsFor(me)?.has(p as any));
        permsLine = hasAll ? "✅ perms OK for #cage-check" : "⚠️ missing perms for #cage-check";
      } catch {
        permsLine = "⚠️ couldn't check #cage-check perms";
      }

      await interaction
        .editReply(
          [
            "✅ I'm alive!",
            `• Uptime: ${d}d ${pad(h)}h:${pad(m)}m:${pad(s)}s`,
            `• WS ping: ${ms} ms`,
            `• ${permsLine}`,
          ].join("\n")
        )
        .catch(() => {});
      return;
    }

    // — /cagecheck — defer once here so handler can editReply(...)
    if (interaction.commandName === "cagecheck") {
      if (!interaction.deferred && !interaction.replied) {
        await interaction.deferReply({ ephemeral: true });
      }
      await handleCagecheck(interaction);
      return;
    }
  } catch (err) {
    console.error("interaction handler error:", err);
    if (interaction.deferred || interaction.replied) {
      await interaction
        .editReply({ content: "Something went wrong processing that command." })
        .catch(() => {});
    } else {
      await interaction
        .reply({ content: "Something went wrong processing that command.", ephemeral: true })
        .catch(() => {});
    }
  }
});

// ---------- schedulers ----------

// 1) every 60s: mark overdue checks LATE, increment strikes, enforce role removal at 3
setInterval(async () => {
  const checks = DB.getAllChecks();
  const now = Date.now();
  let changed = false;

  for (const c of checks) {
    if (c.status === "PENDING" && now > c.dueAt) {
      // Re-read this record before applying a strike. A verification may have
      // completed after this scheduler loaded its initial snapshot.
      const latest = DB.getAllChecks().find((check) => check.id === c.id);
      if (!latest || latest.status !== "PENDING") continue;

      c.status = "LATE";
      c.verifiedAt = now;
      changed = true;

      // strike bookkeeping
      const state = DB.getSubState(c.guildId, c.targetId);
      state.consecutiveMisses += 1;
      state.lastUpdated = now;
      DB.updateSubState(state);

      // logs + enforcement
      const guild = await client.guilds.fetch(c.guildId).catch(() => null);
      if (!guild) continue;

      const logCh = (await guild.channels.fetch(cfg.LOG_CHANNEL_ID).catch(() => null)) as
        | TextChannel
        | null;
      if (logCh?.isTextBased()) {
        await logCh
          .send(
            `❌ Check **${c.id}**: non-compliant from <@${c.targetId}> (requested by <@${c.requesterId}>). Strike **${state.consecutiveMisses}/3**.`
          )
          .catch(() => {});
      }

      if (state.consecutiveMisses >= 3) {
        const member = await guild.members.fetch(c.targetId).catch(() => null);
        if (member?.roles.cache.has(cfg.CAGEDSUB_ROLE_ID)) {
          await member.roles.remove(cfg.CAGEDSUB_ROLE_ID, "Three consecutive non-compliances").catch(
            () => {}
          );
        }

        if (logCh?.isTextBased()) {
          await logCh
            .send(`🚫 Removed **CagedSub** from <@${c.targetId}> after 3 consecutive non-compliances.`)
            .catch(() => {});
        }

        const cageChannel = (await guild.channels
          .fetch(cfg.CAGECHECK_CHANNEL_ID)
          .catch(() => null)) as TextChannel | null;
        if (cageChannel?.isTextBased()) {
          await cageChannel
            .send(
              `🚫 <@${c.targetId}> has been removed from **CagedSub** after 3 consecutive non-compliances. Re-apply is manual.`
            )
            .catch(() => {});
        }

        // reset streak after removal
        const st = DB.getSubState(c.guildId, c.targetId);
        st.consecutiveMisses = 0;
        DB.updateSubState(st);
      }
    }
  }

  if (changed) DB.setAllChecks(checks);
}, 60_000);

// 2) every 5 min: delete proof messages older than PROOF_LIFETIME_HOURS
setInterval(async () => {
  const checks = DB.getAllChecks();
  const now = Date.now();
  const lifetimeMs = cfg.PROOF_LIFETIME_HOURS * 60 * 60 * 1000;
  let changed = false;

  for (const c of checks) {
    if (!c.proofMessageId || !c.verifiedAt) continue;
    if (now < c.verifiedAt + lifetimeMs) continue;

    const guild = await client.guilds.fetch(c.guildId).catch(() => null);
    if (!guild) continue;

    const ch = (await guild.channels.fetch(c.threadId).catch(() => null)) as
      | TextChannel
      | ThreadChannel
      | null;
    if (ch?.isTextBased()) {
      try {
        const msg = await ch.messages.fetch(c.proofMessageId).catch(() => null);
        if (msg) await msg.delete().catch(() => {});
      } catch {
        // ignore fetch/delete hiccups
      }
    }

    c.proofMessageId = undefined; // stop trying next sweep
    changed = true;
  }

  if (changed) DB.setAllChecks(checks);
}, 5 * 60_000);

// 3) daily: purge old records based on retention window
setInterval(() => {
  try {
    DB.purgeOldChecks(cfg.RECORD_RETENTION_DAYS);
  } catch (e) {
    console.error("purgeOldChecks error:", e);
  }
}, 24 * 60 * 60 * 1000);

// ---------- login ----------
client.login(process.env.DISCORD_TOKEN).catch((error) => {
  console.error("Discord login failed. Check DISCORD_TOKEN and network access:", error);
  process.exit(1);
});
