import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { cagecheckCommand } from "./features/cagecheck.js";

const healthCommand = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health check")
  .toJSON();

// Validate required env vars early to give actionable errors
const MISSING: string[] = [];
if (!process.env.DISCORD_TOKEN) MISSING.push("DISCORD_TOKEN");
if (!process.env.APPLICATION_ID) MISSING.push("APPLICATION_ID");
if (!process.env.GUILD_ID) MISSING.push("GUILD_ID");
if (MISSING.length) {
  console.error("Missing required env vars:", MISSING.join(", "));
  process.exit(1);
}

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

async function main() {
  const commands = [cagecheckCommand, healthCommand];
  try {
    await rest.put(
      Routes.applicationGuildCommands(process.env.APPLICATION_ID!, process.env.GUILD_ID!),
      { body: commands }
    );
    console.log("✅ Commands registered to guild.");
  } catch (err: any) {
    if (err?.status === 401) {
      console.error("Discord returned 401 Unauthorized. Check your DISCORD_TOKEN is a valid bot token (not the client secret) and that it hasn't been regenerated.");
    } else {
      console.error(err);
    }
    process.exit(1);
  }
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
