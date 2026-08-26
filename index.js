require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, SlashCommandBuilder, REST, Routes, Events } = require("discord.js");
const express = require("express");

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
  ],
});

const tempChannels = new Map();
const channelConfigs = new Map();

client.once(Events.ClientReady, () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
  registerCommands();
});

async function registerCommands() {
  const commands = [
    new SlashCommandBuilder()
      .setName("setup-vocal")
      .setDescription("Configurer le salon vocal perso")
      .addChannelOption((opt) =>
        opt.setName("salon").setDescription("Salon vocal de creation").setRequired(true).addChannelTypes(ChannelType.GuildVoice)
      )
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role a donner aux membres").setRequired(false)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),

    new SlashCommandBuilder()
      .setName("setup-autorole")
      .setDescription("Configurer l'auto-role")
      .addRoleOption((opt) =>
        opt.setName("role").setDescription("Role a assigner automatiquement").setRequired(true)
      )
      .setDefaultMemberPermissions(PermissionsBitField.Flags.Administrator),
  ];

  const rest = new REST({ version: "10" }).setToken(process.env.TOKEN);

  try {
    await rest.put(Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID), {
      body: commands.map((c) => c.toJSON()),
    });
    console.log("Commandes enregistrees.");
  } catch (err) {
    console.error(err);
  }
}

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === "setup-vocal") {
    const salon = interaction.options.getChannel("salon");
    const role = interaction.options.getRole("role");
    channelConfigs.set(interaction.guild.id, {
      vocalId: salon.id,
      roleId: role ? role.id : null,
    });
    await interaction.reply({
      content: `Salon vocal perso configure sur <#${salon.id}>${role ? ` avec le role <@&${role.id}>` : ""}`,
      ephemeral: true,
    });
  }

  if (interaction.commandName === "setup-autorole") {
    const role = interaction.options.getRole("role");
    channelConfigs.set(`autorole_${interaction.guild.id}`, role.id);
    await interaction.reply({
      content: `Auto-role configure sur <@&${role.id}>`,
      ephemeral: true,
    });
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const roleId = channelConfigs.get(`autorole_${member.guild.id}`);
  if (!roleId) return;
  try {
    await member.roles.add(roleId);
  } catch (err) {
    console.error("Erreur auto-role:", err);
  }
});

client.on(Events.VoiceStateUpdate, async (oldState, newState) => {
  const guild = newState.guild || oldState.guild;
  const config = channelConfigs.get(guild.id);
  if (!config) return;

  const member = newState.member || oldState.member;
  if (member.user.bot) return;

  if (newState.channel && newState.channel.id === config.vocalId) {
    const category = newState.channel.parent;
    const permOverwrites = [
      {
        id: guild.roles.everyone,
        deny: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: member.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.Stream,
          PermissionsBitField.Flags.UseVad,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.ManageChannels,
        ],
      },
    ];

    if (config.roleId) {
      permOverwrites.push({
        id: config.roleId,
        allow: [PermissionsBitField.Flags.Connect, PermissionsBitField.Flags.ViewChannel],
      });
    }

    const channel = await guild.channels.create({
      name: `Solo de ${member.user.username}`,
      type: ChannelType.GuildVoice,
      parent: category ? category.id : null,
      permissionOverwrites: permOverwrites,
    });

    tempChannels.set(channel.id, member.id);
    await member.voice.setChannel(channel);
  }

  if (oldState.channel && tempChannels.has(oldState.channel.id)) {
    const channel = oldState.channel;
    if (channel.members.size === 0) {
      tempChannels.delete(channel.id);
      try {
        await channel.delete();
      } catch (err) {
        console.error("Erreur suppression salon:", err);
      }
    }
  }
});

const app = express();
app.get("/", (req, res) => res.send("Bot actif !"));
app.listen(3000, () => console.log("Serveur keep-alive actif sur le port 3000"));

client.login(process.env.TOKEN);
