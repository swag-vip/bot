require("dotenv").config();
const fs = require("fs");
const { execSync } = require("child_process");
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const express = require("express");

const OWNER_ID = "1532548944419229710";
const PREFIX = "!";
const DATA_FILE = "data.json";

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
const ticketChannels = new Map();
const voiceJoinTimes = new Map();
let channelConfigs = {};

function getStats(guildId) {
  if (!channelConfigs[`stats_${guildId}`]) {
    channelConfigs[`stats_${guildId}`] = {};
  }
  return channelConfigs[`stats_${guildId}`];
}

function addMessage(guildId, userId) {
  const stats = getStats(guildId);
  if (!stats[userId]) stats[userId] = { messages: 0, voiceMinutes: 0 };
  stats[userId].messages += 1;
}

function addVoiceTime(guildId, userId, minutes) {
  const stats = getStats(guildId);
  if (!stats[userId]) stats[userId] = { messages: 0, voiceMinutes: 0 };
  stats[userId].voiceMinutes += minutes;
}

function formatMinutes(min) {
  if (min < 60) return `${min}min`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h < 24) return `${h}h${m > 0 ? m + "min" : ""}`;
  const d = Math.floor(h / 24);
  const rh = h % 24;
  return `${d}j${rh > 0 ? rh + "h" : ""}`;
}

function buildLeaderboardEmbed(guildId) {
  const stats = getStats(guildId);

  const sortedMsg = Object.entries(stats)
    .map(([id, data]) => ({ id, messages: data.messages || 0 }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10);

  const sortedVoc = Object.entries(stats)
    .map(([id, data]) => ({ id, voiceMinutes: data.voiceMinutes || 0 }))
    .sort((a, b) => b.voiceMinutes - a.voiceMinutes)
    .slice(0, 10);

  const medals = ["", "", "", "4.", "5.", "6.", "7.", "8.", "9.", "10."];

  let descMsg = "";
  if (sortedMsg.length === 0) {
    descMsg = "Aucune donnee.";
  } else {
    for (let i = 0; i < sortedMsg.length; i++) {
      const e = sortedMsg[i];
      descMsg += `**${medals[i]}** <@${e.id}> - **${e.messages}** messages\n`;
    }
  }

  let descVoc = "";
  if (sortedVoc.length === 0) {
    descVoc = "Aucune donnee.";
  } else {
    for (let i = 0; i < sortedVoc.length; i++) {
      const e = sortedVoc[i];
      descVoc += `**${medals[i]}** <@${e.id}> - **${formatMinutes(e.voiceMinutes)}**\n`;
    }
  }

  const embed1 = new EmbedBuilder()
    .setColor("#000000")
    .setTitle("Top Messages")
    .setDescription(descMsg)
    .setTimestamp();

  const embed2 = new EmbedBuilder()
    .setColor("#000000")
    .setTitle("Top Vocal")
    .setDescription(descVoc)
    .setTimestamp();

  return [embed1, embed2];
}

async function updateLeaderboards() {
  for (const [, guild] of client.guilds.cache) {
    const channelId = channelConfigs[`leaderboard_${guild.id}`];
    if (!channelId) continue;
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const messages = await channel.messages.fetch({ limit: 10 });
      const botMsg = messages.find(m => m.author.id === client.user.id);
      const embeds = buildLeaderboardEmbed(guild.id);
      if (botMsg) {
        await botMsg.edit({ embeds }).catch(() => {});
      } else {
        await channel.send({ embeds }).catch(() => {});
      }
    } catch (err) {}
  }
}

function loadConfigs() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      channelConfigs = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
      console.log("[Config] Configs chargees");
    } else {
      channelConfigs = {};
      fs.writeFileSync(DATA_FILE, "{}");
    }
  } catch (err) {
    console.error("[Config] Erreur chargement:", err);
    channelConfigs = {};
  }
}

function saveConfigs() {
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(channelConfigs, null, 2));
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      execSync(`git remote set-url origin https://x-access-token:${token}@github.com/swag-vip/bot.git`, { stdio: "ignore" });
    }
    execSync("git config user.name \"Bot\"", { stdio: "ignore" });
    execSync("git config user.email \"bot@bot.com\"", { stdio: "ignore" });
    execSync("git add data.json", { stdio: "ignore" });
    execSync("git diff --cached --quiet || git commit -m \"Update config\"", { stdio: "ignore" });
    execSync("git push origin main", { stdio: "ignore" });
    console.log("[Config] Configs sauvegardees");
  } catch (err) {
    console.error("[Config] Erreur sauvegarde:", err.message);
  }
}

loadConfigs();

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
    const roleId = channelConfigs[`statusrole_${guild.id}`];
    if (!roleId) continue;
    await guild.members.fetch({ withPresences: true }).catch(() => {});
    guild.members.cache.forEach((member) => {
      if (!member.user.bot) checkStatusRole(member);
    });
  }
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  addMessage(message.guild.id, message.author.id);

  if (message.author.id !== OWNER_ID) return;
  if (!message.content.startsWith(PREFIX)) return;

  const args = message.content.slice(PREFIX.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "test") {
    return message.reply("Ca marche !");
  }

  if (command === "help") {
    return message.reply("Commandes:\n`!setup-vocal #salon` - Salon vocal perso\n`!setup-autorole @role` - Auto-role\n`!setup-statusrole @role` - Status-role\n`!setup-tickets #salon @role` - Systeme de tickets\n`!ticket-close` - Fermer un ticket\n`!setup-leaderboard #salon` - Leaderboard auto\n`!leaderboard` - Classement\n`!rank` - Ton rang");
  }

  if (command === "setup-vocal") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildVoice) {
      return message.reply("Mentionne un salon vocal valide.");
    }

    const role = message.mentions.roles.first();
    channelConfigs[message.guild.id] = {
      vocalId: salon.id,
      roleId: role ? role.id : null,
    };
    saveConfigs();

    message.reply(`Salon vocal perso configure sur <#${salon.id}>${role ? ` avec le role <@&${role.id}>` : ""}`);
  }

  if (command === "setup-autorole") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne un role.");

    channelConfigs[`autorole_${message.guild.id}`] = role.id;
    saveConfigs();
    message.reply(`Auto-role configure sur <@&${role.id}>`);
  }

  if (command === "setup-statusrole") {
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne un role.");

    channelConfigs[`statusrole_${message.guild.id}`] = role.id;
    saveConfigs();
    message.reply(`Status-role configure sur <@&${role.id}> (cherche .gg/absolu dans le statut)`);
  }

  if (command === "setup-tickets") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildText) {
      return message.reply("Mentionne un salon texte valide.");
    }
    const roles = message.mentions.roles;
    if (roles.size === 0) return message.reply("Mentionne au moins un role staff.");

    const roleIds = roles.map(r => r.id);

    channelConfigs[`tickets_${message.guild.id}`] = {
      channelId: salon.id,
      staffRoleIds: roleIds,
    };
    saveConfigs();

    const roleList = roleIds.map(id => `<@&${id}>`).join(", ");

    const ticketEmbed = new EmbedBuilder()
      .setColor("#2f3136")
      .setTitle("Support")
      .setDescription("Choisis une option ci-dessous pour ouvrir un ticket.")
      .setTimestamp();

    const row = new ActionRowBuilder().addComponents(
      new StringSelectMenuBuilder()
        .setCustomId("ticket_select")
        .setPlaceholder("Choisir une option")
        .addOptions(
          { label: "Souhaite rejoindre le staff", value: "staff", description: "Postule pour rejoindre l'equipe" },
          { label: "Support", value: "support", description: "Besoin d'aide ?" },
          { label: "Suggestion", value: "suggestion", description: "Propose une idee" },
        ),
    );

    await salon.send({ embeds: [ticketEmbed], components: [row] });
    message.reply(`Panel de tickets envoye dans <#${salon.id}> avec les roles : ${roleList}`);
  }

  if (command === "ticket-close") {
    const ticketData = ticketChannels.get(message.channel.id);
    if (!ticketData) return message.reply("Ce n'est pas un salon de ticket.");

    await message.channel.send("Ticket ferme dans 5 secondes...");
    setTimeout(() => {
      message.channel.delete().catch(() => {});
    }, 5000);
  }

  if (command === "setup-leaderboard") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildText) {
      return message.reply("Mentionne un salon texte valide.");
    }

    channelConfigs[`leaderboard_${message.guild.id}`] = salon.id;
    saveConfigs();

    const embeds = buildLeaderboardEmbed(message.guild.id);
    const infoEmbed = new EmbedBuilder()
      .setColor("#000000")
      .setDescription("Le leaderboard se met a jour automatiquement toutes les 10 minutes.");

    await salon.send({ embeds: [...embeds, infoEmbed] });
    message.reply(`Leaderboard auto active dans <#${salon.id}>`);
  }

  if (command === "leaderboard" || command === "lb") {
    const embeds = buildLeaderboardEmbed(message.guild.id);
    message.reply({ embeds });
  }

  if (command === "rank" || command === "rang") {
    const stats = getStats(message.guild.id);
    const data = stats[message.author.id] || { messages: 0, voiceMinutes: 0 };
    const score = (data.messages || 0) + (data.voiceMinutes || 0);

    const allSorted = Object.entries(stats)
      .map(([id, d]) => ({ id, score: (d.messages || 0) + (d.voiceMinutes || 0) }))
      .sort((a, b) => b.score - a.score);

    const rank = allSorted.findIndex(e => e.id === message.author.id) + 1;

    const embed = new EmbedBuilder()
      .setColor("#2f3136")
      .setAuthor({ name: message.author.username, iconURL: message.author.displayAvatarURL() })
      .addFields(
        { name: "Rang", value: `#${rank}`, inline: true },
        { name: "Score", value: `${score} pts`, inline: true },
        { name: "Messages", value: `${data.messages || 0}`, inline: true },
        { name: "Temps vocal", value: formatMinutes(data.voiceMinutes || 0), inline: true },
      )
      .setTimestamp();

    message.reply({ embeds: [embed] });
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const roleId = channelConfigs[`autorole_${member.guild.id}`];
  if (!roleId) return;
  try {
    await member.roles.add(roleId);
  } catch (err) {
    console.error("Erreur auto-role:", err);
  }

  checkStatusRole(member);
});

async function checkStatusRole(member) {
  const roleId = channelConfigs[`statusrole_${member.guild.id}`];
  if (!roleId) return;

  const activities = member.presence?.activities || [];
  const text = activities.map(a => `${a.name || ""} ${a.state || ""} ${a.details || ""}`).join(" ").toLowerCase();

  const hasStatus = text.includes(".gg/absolu");

  console.log(`[StatusRole] ${member.user.tag}: text="${text}", hasStatus=${hasStatus}, hasRole=${member.roles.cache.has(roleId)}`);

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
  const member = newState.member || oldState.member;
  if (member.user.bot) return;

  if (oldState.channel && !newState.channel) {
    const joinTime = voiceJoinTimes.get(`${guild.id}_${member.id}`);
    if (joinTime) {
      const minutes = Math.floor((Date.now() - joinTime) / 60000);
      if (minutes > 0) addVoiceTime(guild.id, member.id, minutes);
      voiceJoinTimes.delete(`${guild.id}_${member.id}`);
    }
  }

  if (!oldState.channel && newState.channel) {
    voiceJoinTimes.set(`${guild.id}_${member.id}`, Date.now());
  }

  if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    const joinTime = voiceJoinTimes.get(`${guild.id}_${member.id}`);
    if (joinTime) {
      const minutes = Math.floor((Date.now() - joinTime) / 60000);
      if (minutes > 0) addVoiceTime(guild.id, member.id, minutes);
    }
    voiceJoinTimes.set(`${guild.id}_${member.id}`, Date.now());
  }

  const config = channelConfigs[guild.id];
  if (!config) return;

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

  if (interaction.isStringSelectMenu() && interaction.customId === "ticket_select") {
    const config = channelConfigs[`tickets_${interaction.guild.id}`];
    if (!config) return;

    const choice = interaction.values[0];
    const labels = {
      staff: "Rejoindre le staff",
      support: "Support",
      suggestion: "Suggestion",
    };

    const permOverwrites = [
      {
        id: interaction.guild.roles.everyone,
        deny: [PermissionsBitField.Flags.ViewChannel],
      },
      {
        id: interaction.user.id,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      },
    ];

    for (const roleId of config.staffRoleIds) {
      permOverwrites.push({
        id: roleId,
        allow: [
          PermissionsBitField.Flags.ViewChannel,
          PermissionsBitField.Flags.SendMessages,
          PermissionsBitField.Flags.ReadMessageHistory,
        ],
      });
    }

    const ticketChannel = await interaction.guild.channels.create({
      name: `ticket-${choice}-${interaction.user.username}`,
      type: ChannelType.GuildText,
      parent: interaction.channel.parent,
      permissionOverwrites: permOverwrites,
    });

    ticketChannels.set(ticketChannel.id, {
      userId: interaction.user.id,
      staffRoleIds: config.staffRoleIds,
      type: choice,
    });

    const mentionRoles = config.staffRoleIds.map(id => `<@&${id}>`).join(" ");

    const ticketEmbed = new EmbedBuilder()
      .setColor("#2f3136")
      .setTitle(labels[choice])
      .setDescription(`${interaction.user} a ouvert un ticket **${labels[choice]}**\n\nDecris ta demande et le staff t'assistera.`)
      .setTimestamp();

    const closeRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("ticket_close")
        .setLabel("Fermer le ticket")
        .setStyle(ButtonStyle.Danger),
    );

    await ticketChannel.send({
      content: `<@${interaction.user.id}> ${mentionRoles}`,
      embeds: [ticketEmbed],
      components: [closeRow],
    });

    return interaction.reply({ content: `Ticket cree : ${ticketChannel}`, ephemeral: true });
  }

  if (interaction.isButton() && interaction.customId === "ticket_close") {
    const ticketData = ticketChannels.get(interaction.channel.id);
    if (!ticketData) return;

    const config = channelConfigs[`tickets_${interaction.guild.id}`];
    const isStaff = config && config.staffRoleIds.some(roleId => interaction.member.roles.cache.has(roleId));
    const isOwner = interaction.user.id === ticketData.userId;
    if (!isStaff && !isOwner) {
      return interaction.reply({ content: "Tu ne peux pas fermer ce ticket.", ephemeral: true });
    }

    await interaction.channel.send("Ticket ferme dans 5 secondes...");
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 5000);
    ticketChannels.delete(interaction.channel.id);
    return;
  }

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

setInterval(() => {
  updateLeaderboards();
  try {
    fs.writeFileSync(DATA_FILE, JSON.stringify(channelConfigs, null, 2));
    const token = process.env.GITHUB_TOKEN;
    if (token) {
      execSync(`git remote set-url origin https://x-access-token:${token}@github.com/swag-vip/bot.git`, { stdio: "ignore" });
    }
    execSync("git config user.name \"Bot\"", { stdio: "ignore" });
    execSync("git config user.email \"bot@bot.com\"", { stdio: "ignore" });
    execSync("git add data.json", { stdio: "ignore" });
    execSync("git diff --cached --quiet || git commit -m \"Update stats\"", { stdio: "ignore" });
    execSync("git push origin main", { stdio: "ignore" });
  } catch (err) {}
}, 10 * 60 * 1000);
