require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require("discord.js");
const express = require("express");

const OWNER_ID = "1532548944419229710";
const PREFIX = "!";

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const tempChannels = new Map();
const channelConfigs = new Map();
const lockedChannels = new Set();

client.once(Events.ClientReady, () => {
  console.log(`Connecte en tant que ${client.user.tag}`);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  if (message.author.id !== OWNER_ID) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "test") {
    return message.reply("Ca marche !");
  }

  if (command === "help") {
    return message.reply("Commandes: `!setup-vocal #salon`, `!setup-autorole @role`, `!test`");
  }

  if (command === "setup-vocal") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildVoice) {
      return message.reply("Mentionne un salon vocal valide.");
    }

    const role = message.mentions.roles.first();
    channelConfigs.set(message.guild.id, {
      vocalId: salon.id,
      roleId: role ? role.id : null,
    });

    message.reply(`Salon vocal perso configure sur <#${salon.id}>${role ? ` avec le role <@&${role.id}>` : ""}`);
  }

  if (command === "setup-autorole") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne un role.");

    channelConfigs.set(`autorole_${message.guild.id}`, role.id);
    message.reply(`Auto-role configure sur <@&${role.id}>`);
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
        id: member.id,
        allow: [
          PermissionsBitField.Flags.Connect,
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.Speak,
          PermissionsBitField.Flags.Stream,
          PermissionsBitField.Flags.MuteMembers,
          PermissionsBitField.Flags.DeafenMembers,
          PermissionsBitField.Flags.MoveMembers,
          PermissionsBitField.Flags.ManageChannels,
          PermissionsBitField.Flags.ManageRoles,
          PermissionsBitField.Flags.UseEmbeddedActivities,
          PermissionsBitField.Flags.PrioritySpeaker,
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

    const panelEmbed = new EmbedBuilder()
      .setColor("#2f3136")
      .setAuthor({ name: `${member.user.username}`, iconURL: member.user.displayAvatarURL() })
      .setDescription(`**Salon personnel**\n> Toutes les permissions sont a toi !\n> Gere ton salon avec les boutons ci-dessous.`)
      .setThumbnail(member.user.displayAvatarURL())
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`lock_${channel.id}`)
        .setLabel("Lock")
        .setEmoji("🔒")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`unlock_${channel.id}`)
        .setLabel("Unlock")
        .setEmoji("🔓")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId(`delete_${channel.id}`)
        .setLabel("Supprimer")
        .setEmoji("❌")
        .setStyle(ButtonStyle.Danger),
    );

    try {
      await channel.send({ embeds: [panelEmbed], components: [row] });
    } catch (err) {}
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

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isButton()) return;

  const [action, channelId] = interaction.customId.split("_");
  const channel = interaction.guild.channels.cache.get(channelId);
  if (!channel) return;

  const ownerId = tempChannels.get(channelId);
  if (interaction.user.id !== ownerId) {
    return interaction.reply({ content: "Ce n'est pas ton salon !", ephemeral: true });
  }

  if (action === "lock") {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: false,
      ViewChannel: false,
    });
    lockedChannels.add(channelId);
    await interaction.reply({ content: "Salon **verrouille** 🔒", ephemeral: false });
  }

  if (action === "unlock") {
    await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, {
      Connect: true,
      ViewChannel: true,
    });
    lockedChannels.delete(channelId);
    await interaction.reply({ content: "Salon **deverrouille** 🔓", ephemeral: false });
  }

  if (action === "delete") {
    tempChannels.delete(channelId);
    await channel.delete();
  }
});

client.login(process.env.TOKEN);
