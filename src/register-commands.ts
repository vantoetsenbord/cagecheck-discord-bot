import "dotenv/config";
import { REST, Routes, SlashCommandBuilder } from "discord.js";
import { cagecheckCommand } from "./features/cagecheck.js";

const healthCommand = new SlashCommandBuilder()
  .setName("health")
  .setDescription("Bot health check")
  .toJSON();

const rest = new REST({ version: "10" }).setToken(process.env.DISCORD_TOKEN!);

async function main() {
  const commands = [cagecheckCommand, healthCommand];
  await rest.put(
    Routes.applicationGuildCommands(process.env.APPLICATION_ID!, process.env.GUILD_ID!),
    { body: commands }
  );
  console.log("✅ Commands registered to guild.");
}
main().catch(err => {
  console.error(err);
  process.exit(1);
});
