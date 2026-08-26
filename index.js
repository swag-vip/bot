require("dotenv").config();
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
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
    GatewayIntentBits.GuildPresences,
  ],
});

const tempChannels = new Map();
const channelConfigs = new Map();

function buildPanel(member) {
  const embed = new EmbedBuilder()
    .setColor("#2f3136")
    .setAuthor({ name: member.user.username, iconURL: member.user.displayAvatarURL() })
    .setDescription(`**Salon personnel**\n> Gere ton salon avec les boutons ci-dessous.`)
    .setThumbnail(member.user.displayAvatarURL())
    .setTimestamp();

  const row1 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_lock")
      .setLabel("Lock")
      .setEmoji("🔒")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_unlock")
      .setLabel("Unlock")
      .setEmoji("🔓")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_limit")
      .setLabel("Limite")
      .setEmoji("👥")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_mute")
      .setLabel("Mute All")
      .setEmoji("🔇")
      .setStyle(ButtonStyle.Secondary),
    new ButtonBuilder()
      .setCustomId("panel_deafen")
      .setLabel("Deafen All")
      .setEmoji("🔕")
      .setStyle(ButtonStyle.Secondary),
  );

  const row2 = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId("panel_disconnect")
      .setLabel("Deconnecter")
      .setEmoji("⏏️")
      .setStyle(ButtonStyle.Primary),
    new ButtonBuilder()
      .setCustomId("panel_delete")
      .setLabel("Supprimer")
      .setEmoji("❌")
      .setStyle(ButtonStyle.Danger),
  );

  return { embeds: [embed], components: [row1, row2] };
}

client.once(Events.ClientReady, async () => {
  console.log(`Connecte en tant que ${client.user.tag}`);

  for (const [, guild] of client.guilds.cache) {
    const roleId = channelConfigs.get(`statusrole_${guild.id}`);
    if (!roleId) continue;
    await guild.members.fetch();
    guild.members.cache.forEach((member) => {
      if (!member.user.bot) checkStatusRole(member);
    });
  }
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
    return message.reply("Commandes: `!setup-vocal #salon`, `!setup-autorole @role`, `!setup-statusrole @role`, `!test`");
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

  if (command === "setup-statusrole") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne un role.");

    channelConfigs.set(`statusrole_${message.guild.id}`, role.id);
    message.reply(`Status-role configure sur <@&${role.id}> (cherche .gg/absolu dans le statut)`);
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

  checkStatusRole(member);
});

async function checkStatusRole(member) {
  const roleId = channelConfigs.get(`statusrole_${member.guild.id}`);
  if (!roleId) return;

  const hasStatus = member.presence?.activities?.some(
    (a) => a.type === 4 && a.state?.toLowerCase().includes(".gg/absolu")
  );

  console.log(`[StatusRole] ${member.user.tag}: presences=${JSON.stringify(member.presence?.activities?.map(a => ({type: a.type, state: a.state})))}, hasStatus=${hasStatus}, hasRole=${member.roles.cache.has(roleId)}`);

  if (hasStatus) {
    if (!member.roles.cache.has(roleId)) {
      await member.roles.add(roleId).catch((err) => console.error(`[StatusRole] Erreur ajout role:`, err));
      console.log(`[StatusRole] Role ajoute a ${member.user.tag}`);
    }
  } else {
    if (member.roles.cache.has(roleId)) {
      await member.roles.remove(roleId).catch((err) => console.error(`[StatusRole] Erreur remove role:`, err));
      console.log(`[StatusRole] Role retire de ${member.user.tag}`);
    }
  }
}

client.on(Events.PresenceUpdate, async (oldPresence, newPresence) => {
  const member = newPresence.member;
  if (!member || member.user.bot) return;
  checkStatusRole(member);
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

    try {
      await channel.send(buildPanel(member));
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

client.on(Events.InteractionCreate, async (interaction) => {
  const ownerId = tempChannels.get(interaction.channel?.id);
  if (!ownerId) return;

  if (interaction.isButton()) {
    if (interaction.user.id !== ownerId) {
      return interaction.reply({ content: "Ce n'est pas ton salon !", ephemeral: true });
    }

    const channel = interaction.channel;

    if (interaction.customId === "panel_lock") {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: false, ViewChannel: false });
      await interaction.reply({ content: "Salon **verrouille** 🔒", ephemeral: false });
    }

    if (interaction.customId === "panel_unlock") {
      await channel.permissionOverwrites.edit(interaction.guild.roles.everyone, { Connect: true, ViewChannel: true });
      await interaction.reply({ content: "Salon **deverrouille** 🔓", ephemeral: false });
    }

    if (interaction.customId === "panel_limit") {
      const row = new ActionRowBuilder().addComponents(
        new StringSelectMenuBuilder()
          .setCustomId("select_limit")
          .setPlaceholder("Choisir la limite")
          .addOptions(
            { label: "Pas de limite", value: "0" },
            { label: "1 personne", value: "1" },
            { label: "2 personnes", value: "2" },
            { label: "3 personnes", value: "3" },
            { label: "4 personnes", value: "4" },
            { label: "5 personnes", value: "5" },
            { label: "6 personnes", value: "6" },
            { label: "7 personnes", value: "7" },
            { label: "8 personnes", value: "8" },
            { label: "9 personnes", value: "9" },
            { label: "10 personnes", value: "10" },
          ),
      );
      await interaction.reply({ components: [row], ephemeral: true });
    }

    if (interaction.customId === "panel_mute") {
      channel.members.forEach((m) => {
        if (m.id !== ownerId) m.voice.setMute(true).catch(() => {});
      });
      await interaction.reply({ content: "Tout le monde est **mute** 🔇", ephemeral: false });
    }

    if (interaction.customId === "panel_deafen") {
      channel.members.forEach((m) => {
        if (m.id !== ownerId) m.voice.setDeaf(true).catch(() => {});
      });
      await interaction.reply({ content: "Tout le monde est **deafen** 🔕", ephemeral: false });
    }

    if (interaction.customId === "panel_disconnect") {
      channel.members.forEach((m) => {
        if (m.id !== ownerId) m.voice.disconnect().catch(() => {});
      });
      await interaction.reply({ content: "Tout le monde a ete **deconnecte** ⏏️", ephemeral: false });
    }

    if (interaction.customId === "panel_delete") {
      tempChannels.delete(channel.id);
      await channel.delete();
    }
  }

  if (interaction.isStringSelectMenu()) {
    if (interaction.customId === "select_limit") {
      if (interaction.user.id !== ownerId) {
        return interaction.reply({ content: "Ce n'est pas ton salon !", ephemeral: true });
      }
      const limit = parseInt(interaction.values[0]);
      await interaction.channel.setUserLimit(limit === 0 ? null : limit);
      await interaction.reply({
        content: limit === 0 ? "Limite **supprimee** 👥" : `Limite definie a **${limit}** personnes 👥`,
        ephemeral: false,
      });
    }
  }
});

const app = express();
app.get("/", (req, res) => res.send("Bot actif !"));
app.listen(3000, () => console.log("Serveur keep-alive actif sur le port 3000"));

client.login(process.env.TOKEN);
