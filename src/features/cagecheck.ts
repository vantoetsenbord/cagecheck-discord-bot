// src/features/cagecheck.ts
import {
  SlashCommandBuilder,
  ChatInputCommandInteraction,
  PermissionFlagsBits,
  ChannelType,
  EmbedBuilder,
  Attachment,
  GuildMemberRoleManager,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ComponentType,
  Message,
  TextChannel,
  ForumChannel,
  ThreadChannel,
  userMention,
} from "discord.js";
import { nanoid } from "nanoid";
import { DB } from "../lib/storage.js";
import { cfg } from "../lib/ids.js";
import type { CageCheck } from "../types.js";

/* ---------- helpers ---------- */

function memberHasRole(inter: ChatInputCommandInteraction, roleId: string) {
  const roles = inter.member?.roles as GuildMemberRoleManager | undefined;
  return roles?.cache.has(roleId) ?? false;
}

function requireRole(inter: ChatInputCommandInteraction, roleId: string, roleName: string) {
  if (!memberHasRole(inter, roleId)) {
    throw new Error(`You need the **${roleName}** role to use this command.`);
  }
}

function requireAnyRole(
  inter: ChatInputCommandInteraction,
  roles: Array<{ id: string; name: string }>
) {
  if (!roles.some((role) => memberHasRole(inter, role.id))) {
    throw new Error(`You need one of these roles to use this command: **${roles.map((role) => role.name).join("**, **")}**.`);
  }
}

function isInCageArea(inter: ChatInputCommandInteraction) {
  if (!inter.channel) return false;
  if (inter.channel.id === cfg.CAGECHECK_CHANNEL_ID) return true;
  if (
    inter.channel.type === ChannelType.PublicThread ||
    inter.channel.type === ChannelType.PrivateThread
  ) {
    const th = inter.channel as ThreadChannel;
    return th.parentId === cfg.CAGECHECK_CHANNEL_ID;
  }
  return false;
}

/* ---------- slash command definition ---------- */

export const cagecheckCommand = new SlashCommandBuilder()
  .setName("cagecheck")
  .setDescription("Cage check workflow")
  .addSubcommand((sc) =>
    sc
      .setName("request")
      .setDescription("Dom, Alpha, or Keyholder: request a check from a sub")
      .addUserOption((o) =>
        o
          .setName("sub")
          .setDescription("Target sub (must have CagedSub role)")
          .setRequired(true)
      )
      .addIntegerOption((o) =>
        o
          .setName("duration")
          .setDescription(`Deadline in minutes (${cfg.MIN_DURATION_MIN}–${cfg.MAX_DURATION_MIN})`)
          .setRequired(true)
      )
      .addStringOption((o) =>
        o.setName("reason").setDescription("Reason/context").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("verify")
      .setDescription("CagedSub: verify your active cage check with one image")
      .addAttachmentOption((o) =>
        o.setName("photo").setDescription("Proof image").setRequired(true)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("history")
      .setDescription("Keyholders: show recent results for a sub")
      .addUserOption((o) => o.setName("sub").setDescription("Target sub").setRequired(true))
  )
  .addSubcommand((sc) =>
    sc
      .setName("forgive")
      .setDescription("Keyholders: decrement consecutive misses")
      .addUserOption((o) => o.setName("sub").setDescription("Target sub").setRequired(true))
      .addIntegerOption((o) =>
        o.setName("count").setDescription("How many to remove (default 1)").setRequired(false)
      )
  )
  .addSubcommand((sc) =>
    sc
      .setName("reset")
      .setDescription("Keyholders: reset consecutive misses to 0")
      .addUserOption((o) => o.setName("sub").setDescription("Target sub").setRequired(true))
  )
  .setDefaultMemberPermissions(PermissionFlagsBits.SendMessages)
  .toJSON();

/* ---------- handler ---------- */

export async function handleCagecheck(inter: ChatInputCommandInteraction) {
  try {
    const sub = inter.options.getSubcommand();

    /* ===== /cagecheck request ===== */
    if (sub === "request") {
      try {
        requireAnyRole(inter, [
          { id: cfg.DOM_ROLE_ID, name: "DOM" },
          { id: cfg.ALPHA_ROLE_ID, name: "Alpha" },
          { id: cfg.KEYHOLDER_ROLE_ID, name: "Keyholder" },
        ]);
      } catch (e: any) {
        await inter.editReply({ content: e.message });
        return;
      }

      const target = inter.options.getUser("sub", true);
      const duration = inter.options.getInteger("duration", true);
      const reason = inter.options.getString("reason") ?? undefined;

      if (duration < cfg.MIN_DURATION_MIN || duration > cfg.MAX_DURATION_MIN) {
        await inter.editReply({
          content: `Duration must be between ${cfg.MIN_DURATION_MIN} and ${cfg.MAX_DURATION_MIN} minutes.`,
        });
        return;
      }

      // ensure target has CagedSub
      const member = await inter.guild!.members.fetch(target.id).catch(() => null);
      if (!member?.roles.cache.has(cfg.CAGEDSUB_ROLE_ID)) {
        await inter.editReply({ content: `Target must have the **CagedSub** role.` });
        return;
      }

      // ensure only one active
      const active = DB.getAllChecks().find(
        (c) => c.guildId === inter.guildId && c.targetId === target.id && c.status === "PENDING"
      );
      if (active) {
        await inter.editReply({
          content: `There is already an active request for ${userMention(target.id)}.`,
        });
        return;
      }

      // fetch cage channel (Text or Forum)
      const raw = await inter.guild!.channels
        .fetch(cfg.CAGECHECK_CHANNEL_ID)
        .catch(() => null);
      if (!raw) {
        await inter.editReply({
          content:
            "Configured #cage-check channel is invalid or I can't see it. Check the ID and my permissions.",
        });
        return;
      }

      let threadId: string | undefined;

      if (raw.type === ChannelType.GuildText) {
        const ch = raw as TextChannel;
        try {
          const header = await ch.send(
            `⛓️ **Cage check** requested by ${userMention(inter.user.id)} for ${userMention(
              target.id
            )}.`
          );
          const thread = await header.startThread({
            name: `cage-${member?.displayName ?? target.username}-${Date.now()}`,
            autoArchiveDuration: 60,
            reason: "Cage check thread",
            // type: ChannelType.PublicThread,
          });
          threadId = thread.id;
        } catch {
          await inter.editReply({
            content:
              "I can’t send messages or create threads in #cage-check. Please allow **Send Messages**, **Create Public Threads**, and **Send Messages in Threads**.",
          });
          return;
        }
      } else if (raw.type === ChannelType.GuildForum) {
        const forum = raw as ForumChannel;
        try {
          const created = await forum.threads.create({
            name: `cage-${member?.displayName ?? target.username}-${Date.now()}`,
            autoArchiveDuration: 60,
            message: {
              content: `⛓️ **Cage check** requested by ${userMention(
                inter.user.id
              )} for ${userMention(target.id)}.`,
            },
          });
          threadId = created.id;
        } catch {
          await inter.editReply({
            content:
              "I can’t create posts in the Forum channel. Please allow **Create Posts**/**Create Public Threads** and **Send Messages in Threads**.",
          });
          return;
        }
      } else {
        await inter.editReply({
          content: "Configured #cage-check must be a **Text** or **Forum** channel.",
        });
        return;
      }

      if (!threadId) {
        await inter.editReply({ content: "I couldn't create the thread." });
        return;
      }

      const createdAt = Date.now();
      const dueAt = createdAt + duration * 60_000;

      const record: CageCheck = {
        id: nanoid(10),
        guildId: inter.guildId!,
        requesterId: inter.user.id,
        targetId: target.id,
        reason,
        createdAt,
        dueAt,
        status: "PENDING",
        threadId,
      };

      DB.setAllChecks([...DB.getAllChecks(), record]);

      const embed = new EmbedBuilder()
        .setTitle("Cage Check Requested")
        .setDescription(
          [
            `**Sub:** ${userMention(target.id)}`,
            `**Requested by:** ${userMention(inter.user.id)}`,
            `**Due:** <t:${Math.floor(dueAt / 1000)}:R>`,
            reason ? `**Reason:** ${reason}` : null,
          ]
            .filter(Boolean)
            .join("\n")
        )
        .setFooter({
          text: `ID: ${record.id} • Use /cagecheck verify in this thread (one photo).`,
        });

      const thread = (await inter.guild!.channels.fetch(threadId).catch(() => null)) as
        | ThreadChannel
        | TextChannel
        | null;

      if (!thread?.isTextBased()) {
        await inter.editReply({
          content:
            "I created the thread but can't post in it. Please allow **Send Messages in Threads**.",
        });
        return;
      }

      await thread.send({ content: `${userMention(target.id)}`, embeds: [embed] });
      await inter.editReply({ content: `Cage check started in ${thread}.` });
      return;
    }

    /* ===== /cagecheck verify ===== */
    if (sub === "verify") {
      try {
        requireRole(inter, cfg.CAGEDSUB_ROLE_ID, "CagedSub");
      } catch (e: any) {
        await inter.editReply({ content: e.message });
        return;
      }

      if (!isInCageArea(inter)) {
        await inter.editReply({
          content: "Please verify **inside #cage-check or its check thread**.",
        });
        return;
      }

      const photo = inter.options.getAttachment("photo", true) as Attachment;
      if (!photo.contentType?.startsWith("image/")) {
        await inter.editReply({ content: "Please attach an **image** file." });
        return;
      }

      const checks = DB.getAllChecks();
      const pendingChecks = checks.filter(
        (c) => c.guildId === inter.guildId && c.status === "PENDING" && c.targetId === inter.user.id
      );
      const cc = pendingChecks.find((c) => c.threadId === inter.channelId);
      if (!cc) {
        await inter.editReply({
          content: pendingChecks.length
            ? "This is not the thread for your active cage check. Please verify in the request's own thread."
            : "No active cage check found for you.",
        });
        return;
      }

      const onTime = Date.now() <= cc.dueAt;
      cc.status = onTime ? "VERIFIED" : "LATE";
      cc.verifiedAt = Date.now();

      // Build the proof embed
      const proof = new EmbedBuilder()
        .setTitle(onTime ? "✅ Verified" : "❌ Late (Non-compliant)")
        .setDescription(
          `**Sub:** ${userMention(inter.user.id)}\n**Time:** <t:${Math.floor(Date.now() / 1000)}:t>`
        )
        .setImage(photo.url)
        .setFooter({
          text: `Proof auto-deletes in ${cfg.PROOF_LIFETIME_HOURS}h • ID: ${cc.id}`,
        });

      // Post the proof in the current thread/channel (non-ephemeral) so we can delete it later
      if (!inter.channel?.isTextBased()) {
        await inter.editReply({ content: "This channel isn't text-based; can't post the proof." });
        return;
      }
      const sent = await (inter.channel as TextChannel).send({ embeds: [proof] });
      cc.proofMessageId = sent.id;

      // Persist change
      DB.setAllChecks(checks.map((c) => (c.id === cc.id ? cc : c)));

      // Update strike state
      const state = DB.getSubState(inter.guildId!, inter.user.id);
      if (onTime) state.consecutiveMisses = 0;
      else state.consecutiveMisses += 1;
      state.lastUpdated = Date.now();
      DB.updateSubState(state);

      // Private log
      const log = await inter.guild!.channels.fetch(cfg.LOG_CHANNEL_ID).catch(() => null);
      if (log && log.isTextBased()) {
        await (log as TextChannel).send(
          `${onTime ? "✅" : "❌"} Check **${cc.id}** ${onTime ? "verified" : "late"} by ${userMention(
            inter.user.id
          )} (requested by ${userMention(cc.requesterId)}).`
        );
      }

      // Ephemeral confirmation back to the user
      await inter.editReply({ content: onTime ? "✅ Verified." : "❌ Marked late (non-compliant)." });

      // Enforce 3 strikes
      if (!onTime && state.consecutiveMisses >= 3) {
        const member = await inter.guild!.members.fetch(inter.user.id).catch(() => null);
        if (member?.roles.cache.has(cfg.CAGEDSUB_ROLE_ID)) {
          await member.roles.remove(cfg.CAGEDSUB_ROLE_ID, "Three consecutive non-compliances");
        }
        if (log && log.isTextBased()) {
          await (log as TextChannel).send(
            `🚫 Removed **CagedSub** from ${userMention(
              inter.user.id
            )} after 3 consecutive non-compliances.`
          );
        }
        const parent =
          (inter.channel as ThreadChannel | null)?.parent ?? inter.channel;
        if (parent?.isTextBased()) {
          await (parent as TextChannel).send(
            `🚫 ${userMention(
              inter.user.id
            )} has been removed from **CagedSub** after 3 consecutive non-compliances. Re-apply is manual.`
          );
        }
        const st = DB.getSubState(inter.guildId!, inter.user.id);
        st.consecutiveMisses = 0;
        DB.updateSubState(st);
      }
      return;
    }

    // Kept as a defensive guard while Discord clients refresh the registered
    // command definition. The bulk workflow is intentionally disabled.
    if (sub === "request-all") {
      await inter.editReply({ content: "The request-all function is temporarily disabled." });
      return;
    }

    /* ===== Disabled legacy /cagecheck request-all implementation ===== */
    if (sub === "request-all") {
      try {
        requireRole(inter, cfg.KEYHOLDER_ROLE_ID, "Keyholder");
      } catch (e: any) {
        await inter.editReply({ content: e.message });
        return;
      }

      const duration = inter.options.getInteger("duration", true);
      const reason = inter.options.getString("reason") ?? undefined;

      if (duration < cfg.MIN_DURATION_MIN || duration > cfg.MAX_DURATION_MIN) {
        await inter.editReply({
          content: `Duration must be between ${cfg.MIN_DURATION_MIN} and ${cfg.MAX_DURATION_MIN} minutes.`,
        });
        return;
      }

      // fetch guild and ensure we can list members
      const guild = inter.guild!;
      await guild.members.fetch(); // ensure cache populated

      // gather caged subs
      const members = guild.members.cache.filter((m) => m.roles.cache.has(cfg.CAGEDSUB_ROLE_ID));
      if (!members.size) {
        await inter.editReply({ content: "No members with the CagedSub role were found." });
        return;
      }

  // preview info for confirmation
  const totalCaged = members.size;

      const uid = `${inter.user.id}-${Date.now()}`;
      const confirmId = `request-all:confirm:${uid}`;
      const cancelId = `request-all:cancel:${uid}`;

      const row = new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder().setCustomId(confirmId).setLabel("Confirm").setStyle(ButtonStyle.Danger),
        new ButtonBuilder().setCustomId(cancelId).setLabel("Cancel").setStyle(ButtonStyle.Secondary)
      );

      await inter.editReply({ content: `You're about to request checks for ${totalCaged} CagedSubs. Confirm?`, components: [row] });

      const replyMsg = (await inter.fetchReply()) as Message;

      const collector = replyMsg.createMessageComponentCollector({
        filter: (i) => i.user.id === inter.user.id,
        componentType: ComponentType.Button,
        time: 60_000,
        max: 1,
      });

      collector.on("collect", async (btn) => {
        try {
          if (btn.customId === cancelId) {
            await btn.update({ content: "Cancelled mass request.", components: [] });
            return;
          }

          // acknowledge and clear components while processing
          await btn.update({ content: "Processing mass request...", components: [] });

          // now run the creation logic (same as before)
          const checks = DB.getAllChecks();
          const created: string[] = [];
          const skipped: string[] = [];

          // fetch raw channel once
          const raw = await guild.channels.fetch(cfg.CAGECHECK_CHANNEL_ID).catch(() => null);
          if (!raw) {
            await inter.followUp({ content: "Configured #cage-check channel is invalid or I can't see it.", ephemeral: true });
            return;
          }

          // helper: sleep for ms
          const sleep = (ms: number) => new Promise((res) => setTimeout(res, ms));

          const spreadMs = cfg.REQUEST_ALL_SPREAD_MIN * 60_000;
          let processed = 0;
          const progressInterval = Math.max(1, Math.floor(members.size / 10)); // update ~10 times

          for (const [, member] of members) {
            // skip if already has a pending check
            const active = checks.find(
              (c) => c.guildId === inter.guildId && c.targetId === member.id && c.status === "PENDING"
            );
            if (active) {
              skipped.push(member.id);
              continue;
            }

            let threadId: string | undefined;
            // create thread/post depending on channel type
            try {
              if (raw.type === ChannelType.GuildText) {
                const ch = raw as TextChannel;
                const header = await ch.send(
                  `⛓️ **Cage check** requested by ${userMention(inter.user.id)} for ${userMention(
                    member.id
                  )}.`
                );
                const thread = await header.startThread({
                  name: `cage-${member.displayName ?? member.user.username}-${Date.now()}`,
                  autoArchiveDuration: 60,
                  reason: "Cage check thread",
                });
                threadId = thread.id;
              } else if (raw.type === ChannelType.GuildForum) {
                const forum = raw as ForumChannel;
                const createdThread = await forum.threads.create({
                  name: `cage-${member.displayName ?? member.user.username}-${Date.now()}`,
                  autoArchiveDuration: 60,
                  message: { content: `⛓️ **Cage check** requested by ${userMention(
                    inter.user.id
                  )} for ${userMention(member.id)}.` },
                });
                threadId = createdThread.id;
              } else {
                skipped.push(member.id);
                continue;
              }
            } catch {
              skipped.push(member.id);
              continue;
            }

            if (!threadId) {
              skipped.push(member.id);
              continue;
            }

            const createdAt = Date.now();
            const record: CageCheck = {
              id: nanoid(10),
              guildId: inter.guildId!,
              requesterId: inter.user.id,
              targetId: member.id,
              reason,
              createdAt,
              dueAt: createdAt + duration * 60_000,
              status: "PENDING",
              threadId,
            };

            checks.push(record);
            created.push(member.id);
            processed += 1;

            const thread = await guild.channels.fetch(threadId).catch(() => null);
            if (thread?.isTextBased()) {
              const embed = new EmbedBuilder()
                .setTitle("Cage Check Requested")
                .setDescription([
                  `**Sub:** ${userMention(member.id)}`,
                  `**Requested by:** ${userMention(inter.user.id)}`,
                  `**Due:** <t:${Math.floor(record.dueAt / 1000)}:R>`,
                  reason ? `**Reason:** ${reason}` : null,
                ].filter(Boolean).join("\n"))
                .setFooter({ text: `ID: ${record.id} • Use /cagecheck verify in this thread (one photo).` });
              await thread.send({ content: userMention(member.id), embeds: [embed] }).catch(() => {});
            }

            // periodically persist and post progress
            if (processed % progressInterval === 0) {
              DB.setAllChecks(checks);
              try {
                await inter.followUp({ content: `Progress: created ${created.length}/${members.size} checks...`, ephemeral: true });
              } catch {}
            }

            // wait a bit before the next creation to spread notifications
            if (spreadMs > 0) await sleep(spreadMs);
          }

          DB.setAllChecks(checks);

          const parts: string[] = [];
          if (created.length) parts.push(`Created checks for ${created.length} members.`);
          if (skipped.length) parts.push(`Skipped ${skipped.length} (already have active checks or failed).`);
          if (!created.length && !skipped.length) parts.push("No checks created.");

          await inter.followUp({ content: parts.join(" "), ephemeral: true });
        } catch (err) {
          console.error("request-all collect error:", err);
          try { await inter.followUp({ content: "Error while processing mass request.", ephemeral: true }); } catch {}
        }
      });

      collector.on("end", async (collected) => {
        if (collected.size === 0) {
          try { await inter.editReply({ content: "Confirmation timed out.", components: [] }); } catch {}
        }
      });
      return;
    }

    /* ===== /cagecheck history ===== */
    if (sub === "history") {
      try {
        requireRole(inter, cfg.KEYHOLDER_ROLE_ID, "Keyholder");
      } catch (e: any) {
        await inter.editReply({ content: e.message });
        return;
      }

      const target = inter.options.getUser("sub", true);
      const last = DB.getAllChecks()
        .filter((c) => c.guildId === inter.guildId && c.targetId === target.id)
        .sort((a, b) => b.createdAt - a.createdAt)
        .slice(0, 10);

      const state = DB.getSubState(inter.guildId!, target.id);
      const lines = last.length
        ? last.map((c) => {
            const icon = c.status === "PENDING" ? "⏳" : c.status === "VERIFIED" ? "✅" : "❌";
            return `${icon} **${c.id}** — created <t:${Math.floor(
              c.createdAt / 1000
            )}:R> — due <t:${Math.floor(c.dueAt / 1000)}:R> — ${c.status}${
              c.reason ? ` — ${c.reason}` : ""
            }`;
          })
        : ["No records."];

      await inter.editReply({
        content: [
          `History for ${userMention(target.id)} (last ${last.length}):`,
          ...lines,
          `\nConsecutive misses: **${state.consecutiveMisses}**`,
        ].join("\n"),
      });
      return;
    }


  /* ===== /cagecheck forgive ===== */
if (sub === "forgive") {
  try {
    // must be Keyholder
    if (!cfg.KEYHOLDER_ROLE_ID) {
      await inter.editReply({ content: "Config error: KEYHOLDER_ROLE_ID is missing in .env" });
      return;
    }
    requireRole(inter, cfg.KEYHOLDER_ROLE_ID, "Keyholder");

    // validate options
    const target = inter.options.getUser("sub", true);
    const rawCount = inter.options.getInteger("count") ?? 1;
    const count = Math.max(1, rawCount); // ensure >= 1

    // update state (auto-creates record if not present)
    const state = DB.getSubState(inter.guildId!, target.id);
    const before = state.consecutiveMisses;
    state.consecutiveMisses = Math.max(0, state.consecutiveMisses - count);
    state.lastUpdated = Date.now();
    DB.updateSubState(state);

    await inter.editReply({
      content: `Reduced consecutive misses for ${userMention(target.id)} from **${before}** to **${state.consecutiveMisses}**.`,
    });
  } catch (err: any) {
    console.error("forgive error:", {
      message: err?.message,
      stack: err?.stack,
      guildId: inter.guildId,
      options: {
        sub: inter.options.getSubcommand(false),
        target: inter.options.getUser("sub", false)?.id,
        count: inter.options.getInteger("count"),
      }
    });
    await inter.editReply({ content: "Couldn't process /cagecheck forgive (see logs)." }).catch(()=>{});
  }
  return;
}


    /* ===== /cagecheck reset ===== */
    if (sub === "reset") {
      try {
        requireRole(inter, cfg.KEYHOLDER_ROLE_ID, "Keyholder");
      } catch (e: any) {
        await inter.editReply({ content: e.message });
        return;
      }

      const target = inter.options.getUser("sub", true);
      const state = DB.getSubState(inter.guildId!, target.id);
      state.consecutiveMisses = 0;
      DB.updateSubState(state);
      await inter.editReply({
        content: `Consecutive misses for ${userMention(target.id)} reset to **0**.`,
      });
      return;
    }
  } catch (err: any) {
    console.error("cagecheck error:", err);
    if (inter.deferred || inter.replied) {
      await inter
        .editReply({ content: "Something went wrong while handling that command." })
        .catch(() => {});
    } else {
      await inter
        .reply({ content: "Something went wrong while handling that command.", ephemeral: true })
        .catch(() => {});
    }
  }
}
