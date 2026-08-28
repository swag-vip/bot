require("dotenv").config();
const fs = require("fs");
const { execSync } = require("child_process");
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const express = require("express");

const OWNER_ID = "1532548944419229710";
const PREFIX = "!";
const DATA_FILE = "data.json";
const BLACKLIST = ["618042706031280133", "1391860474307411988", "1377301118052208674"];

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMembers,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.GuildPresences,
    GatewayIntentBits.GuildMessageReactions,
  ],
});

const tempChannels = new Map();
const ticketChannels = new Map();
const voiceJoinTimes = new Map();
const lastRoleRename = new Map();
const giveaways = new Map();
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

async function updateRoleCounter(channel, role, guild) {
  if (!channel || !channel.isVoiceBased()) return;
  const count = guild.members.cache.filter(m => m.roles.cache.has(role.id)).size;
  const newName = `Membres: ${count}`;
  if (channel.name === newName) return;

  const last = lastRoleRename.get(guild.id) || 0;
  if (Date.now() - last < 30 * 1000) return;

  console.log(`[RoleCounter] rename ${channel.name} -> ${newName}`);
  try {
    await channel.setName(newName);
    lastRoleRename.set(guild.id, Date.now());
  } catch (e) {
    console.log("[RoleCounter] Erreur rename:", e.message);
  }
}

async function bumpChannel(channel) {
  if (!channel) return;
  const embed = new EmbedBuilder()
    .setColor("#5865F2")
    .setTitle("📢 BUMP DISPONIBLE !")
    .setDescription("Fais **`/bump`** avec **Disboard** pour remonter le serveur dans les resultats de recherche et attirer de nouveaux membres !\n\nTu peux tous les 2 heures.")
    .setTimestamp();
  await channel.send({ embeds: [embed] }).catch(() => {});
}

async function updateAllCounters() {
  for (const [, guild] of client.guilds.cache) {
    const rc = channelConfigs[`rolecounter_${guild.id}`];
    if (rc) {
      const channel = guild.channels.cache.get(rc.channelId);
      const role = guild.roles.cache.get(rc.roleId);
      if (channel && role) updateRoleCounter(channel, role, guild);
    }
  }
}

function buildLeaderboardEmbed(guildId, guild) {
  const stats = getStats(guildId);

  const sortedMsg = Object.entries(stats)
    .filter(([id]) => !BLACKLIST.includes(id))
    .map(([id, data]) => ({ id, messages: data.messages || 0 }))
    .sort((a, b) => b.messages - a.messages)
    .slice(0, 10);

  const sortedVoc = Object.entries(stats)
    .filter(([id]) => !BLACKLIST.includes(id))
    .map(([id, data]) => ({ id, voiceMinutes: data.voiceMinutes || 0 }))
    .sort((a, b) => b.voiceMinutes - a.voiceMinutes)
    .slice(0, 10);

  function getName(id) {
    if (!guild) return id;
    const member = guild.members.cache.get(id);
    return member ? member.user.username : id;
  }

  let descMsg = "```\n";
  descMsg += "=== MESSAGES ===\n";
  descMsg += "#   Membre                   Messages\n";
  descMsg += "──────────────────────────────────────\n";
  for (let i = 0; i < 10; i++) {
    if (i < sortedMsg.length) {
      const e = sortedMsg[i];
      const num = `${i + 1}`.padStart(2, " ");
      const name = getName(e.id).substring(0, 22);
      const msgs = e.messages.toLocaleString().padStart(8, " ");
      descMsg += `${num}   ${name.padEnd(22)} ${msgs}\n`;
    } else {
      const num = `${i + 1}`.padStart(2, " ");
      descMsg += `${num}   -\n`;
    }
  }
  descMsg += "```\n";

  let descVoc = "```\n";
  descVoc += "=== VOCAL ===\n";
  descVoc += "#   Membre                   Temps\n";
  descVoc += "──────────────────────────────────────\n";
  for (let i = 0; i < 10; i++) {
    if (i < sortedVoc.length) {
      const e = sortedVoc[i];
      const num = `${i + 1}`.padStart(2, " ");
      const name = getName(e.id).substring(0, 22);
      const time = formatMinutes(e.voiceMinutes).padStart(10, " ");
      descVoc += `${num}   ${name.padEnd(22)} ${time}\n`;
    } else {
      const num = `${i + 1}`.padStart(2, " ");
      descVoc += `${num}   -\n`;
    }
  }
  descVoc += "```";

  const embed = new EmbedBuilder()
    .setColor("#000000")
    .setTitle("Leaderboard")
    .setDescription(`${descMsg}${descVoc}`)
    .setTimestamp();

  return embed;
}

async function updateLeaderboards() {
  for (const [, guild] of client.guilds.cache) {
    const channelId = channelConfigs[`leaderboard_${guild.id}`];
    if (!channelId) continue;
    try {
      const channel = guild.channels.cache.get(channelId);
      if (!channel) continue;
      const messages = await channel.messages.fetch({ limit: 20 });
      const botMsgs = messages.filter(m => m.author.id === client.user.id).sort((a, b) => b.createdTimestamp - a.createdTimestamp);
      const leaderboardMsg = botMsgs.find(m => m.embeds.length > 0 && m.embeds[0].title === "Leaderboard");
      const embed = buildLeaderboardEmbed(guild.id, guild);
      const infoEmbed = new EmbedBuilder()
        .setColor("#000000")
        .setDescription("Le leaderboard se met a jour automatiquement toutes les 5 minutes.");

      if (leaderboardMsg) {
        await leaderboardMsg.edit({ embeds: [embed, infoEmbed] }).catch(() => {});
      } else {
        await channel.send({ embeds: [embed, infoEmbed] }).catch(() => {});
      }
    } catch (err) {}
  }
}

function loadConfigs() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const raw = fs.readFileSync(DATA_FILE, "utf8");
      if (raw && raw.trim() !== "") {
        channelConfigs = JSON.parse(raw);
        console.log("[Config] Configs chargees");
      } else {
        throw new Error("fichier vide");
      }
    } else {
      throw new Error("fichier absent");
    }
  } catch (err) {
    console.error("[Config] Erreur chargement, tentative backup:", err.message);
    try {
      if (fs.existsSync("config.json")) {
        channelConfigs = JSON.parse(fs.readFileSync("config.json", "utf8"));
        fs.writeFileSync(DATA_FILE, JSON.stringify(channelConfigs, null, 2));
        console.log("[Config] Restaure depuis config.json");
      } else {
        channelConfigs = {};
        fs.writeFileSync(DATA_FILE, JSON.stringify(channelConfigs, null, 2));
        fs.writeFileSync("config.json", "{}");
      }
    } catch (e) {
      channelConfigs = {};
    }
  }
}

const GIVEAWAYS_FILE = "giveaways.json";

function writeDataFile() {
  const data = JSON.parse(JSON.stringify(channelConfigs || {}));
  data["_giveaways"] = [...giveaways.values()];
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function persistGiveaways() {
  try {
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify([...giveaways.values()], null, 2));
  } catch (err) {}
  try {
    writeDataFile();
  } catch (err) {}
}

function loadGiveaways() {
  try {
    const data = JSON.parse(fs.readFileSync(DATA_FILE, "utf8"));
    const arr = data["_giveaways"];
    if (Array.isArray(arr)) {
      arr.forEach((gw) => {
        if (gw && gw.endTime > Date.now()) {
          giveaways.set(gw.messageId, gw);
        }
      });
      console.log(`[Giveaways] ${giveaways.size} giveaway(s) restaure(s)`);
    }
  } catch (err) {
    console.log("[Giveaways] Erreur chargement:", err.message);
  }
}

function saveConfigs() {
  try {
    fs.writeFileSync("config.json", JSON.stringify(channelConfigs, null, 2));
    writeDataFile();
    const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      execSync(`git remote set-url origin https://x-access-token:${token}@github.com/swag-vip/bot.git`, { stdio: "ignore" });
    }
    execSync("git config user.name \"Bot\"", { stdio: "ignore" });
    execSync("git config user.email \"bot@bot.com\"", { stdio: "ignore" });
    execSync("git add data.json", { stdio: "ignore" });
    execSync("git diff --cached --quiet || git commit -m \"Update config\"", { stdio: "ignore" });
    try {
      execSync("git push origin main", { stdio: "ignore" });
    } catch (e) {
      execSync("git pull --rebase origin main", { stdio: "ignore" });
      execSync("git push origin main", { stdio: "ignore" });
    }
    console.log("[Config] Configs sauvegardees");
  } catch (err) {
    console.error("[Config] Erreur sauvegarde:", err.message);
  }
}

loadConfigs();
loadGiveaways();

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
    await guild.members.fetch().catch(() => {});

    guild.channels.cache.forEach((channel) => {
      if (channel.type === ChannelType.GuildVoice) {
        channel.members.forEach((member) => {
          if (!member.user.bot) {
            voiceJoinTimes.set(`${guild.id}_${member.id}`, Date.now());
          }
        });
      }
    });
    updateAllCounters();

    const roleId = channelConfigs[`statusrole_${guild.id}`];
    if (roleId) {
      await guild.members.fetch({ withPresences: true }).catch(() => {});
      guild.members.cache.forEach((member) => {
        if (!member.user.bot) checkStatusRole(member);
      });
    }
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
    return message.reply("Commandes:\n`!setup-vocal #salon` - Salon vocal perso\n`!setup-autorole @role` - Auto-role\n`!setup-statusrole @role` - Status-role\n`!setup-tickets #salon @role` - Systeme de tickets\n`!ticket-close` - Fermer un ticket\n`!setup-leaderboard #salon` - Leaderboard auto\n`!setup-welcome #salon` - Message de bienvenue\n`!setup-rolecounter #salon @role` - Compteur de membres role\n`!setup-bump #salon` - Rappel bump toutes les 2h\n`!leaderboard` - Classement\n`!rank` - Ton rang\n`!snipe` - Snipe un emoji/sticker externe");
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

  if (command === "setup-bump") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildText) {
      return message.reply("Mentionne un salon texte valide.");
    }

    channelConfigs[`bump_${message.guild.id}`] = salon.id;
    saveConfigs();
    await bumpChannel(salon);
    message.reply(`Rappel de bump actif toutes les 120 min dans <#${salon.id}>`);
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

    const embed = buildLeaderboardEmbed(message.guild.id, message.guild);
    const infoEmbed = new EmbedBuilder()
      .setColor("#000000")
      .setDescription("Le leaderboard se met a jour automatiquement toutes les 5 minutes.");

    await salon.send({ embeds: [embed, infoEmbed] });
    message.reply(`Leaderboard auto active dans <#${salon.id}>`);
  }

  if (command === "setup-welcome") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildText) {
      return message.reply("Mentionne un salon texte valide.");
    }

    channelConfigs[`welcome_${message.guild.id}`] = salon.id;
    saveConfigs();
    message.reply(`Message de bienvenue actif dans <#${salon.id}>`);
  }

  if (command === "setup-rolecounter") {
    const salon = message.mentions.channels.first();
    if (!salon || salon.type !== ChannelType.GuildVoice) {
      return message.reply("Mentionne un salon vocal valide.");
    }
    const role = message.mentions.roles.first();
    if (!role) return message.reply("Mentionne un role.");

    channelConfigs[`rolecounter_${message.guild.id}`] = { channelId: salon.id, roleId: role.id };
    saveConfigs();
    await updateRoleCounter(salon, role, message.guild);
    message.reply(`Compteur de role configure sur <#${salon.id}> avec <@&${role.id}>`);
  }

  if (command === "leaderboard" || command === "lb") {
    const embed = buildLeaderboardEmbed(message.guild.id, message.guild);
    message.reply({ embeds: [embed] });
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

  if (command === "snipe") {
    if (!message.reference?.messageId) {
      return message.reply("Reponds a un message qui contient un emoji externe ou un sticker avec `!snipe`.");
    }

    let target;
    try {
      target = await message.channel.messages.fetch(message.reference.messageId);
    } catch (e) {
      return message.reply("Impossible de recuperer le message auquel tu reponds.");
    }

    const done = [];
    const errors = [];

    const emojiRegex = /<a?:(.+?):(\d+)>/g;
    let match;
    let isAnimated = false;
    let foundEmojiId = null;
    let foundEmojiName = "snipe";
    while ((match = emojiRegex.exec(target.content || "")) !== null) {
      foundEmojiId = match[2];
      foundEmojiName = match[1] || "snipe";
      isAnimated = match[0]?.startsWith("<a:");
      break;
    }

    if (foundEmojiId) {
      const name = foundEmojiName.slice(0, 30) || "snipe";
      try {
        const ext = isAnimated ? "gif" : "png";
        const imgRes = await fetch(`https://cdn.discordapp.com/emojis/${foundEmojiId}.${ext}`);
        const buf = Buffer.from(await imgRes.arrayBuffer());
        const created = await message.guild.emojis.create({ attachment: buf, name });
        done.push(`Emoji \`${created.name}\` ajoute !`);
      } catch (e) {
        errors.push(`Emoji: ${e.message}`);
      }
    }

    if (target.stickers && target.stickers.size > 0) {
      for (const sticker of target.stickers.values()) {
        try {
          const imgRes = await fetch(sticker.url);
          const buf = Buffer.from(await imgRes.arrayBuffer());
          const created = await message.guild.stickers.create({
            file: buf,
            name: sticker.name || "snipe",
            tags: sticker.tags || "snipe",
            description: sticker.description || null,
          });
          done.push(`Sticker \`${created.name}\` ajoute !`);
        } catch (e) {
          errors.push(`Sticker: ${e.message}`);
        }
      }
    }

    if (done.length === 0 && errors.length === 0) {
      return message.reply("Aucun emoji externe ou sticker detecte dans ce message.");
    }

    const replyText = [...done, ...errors.map(e => `❌ ${e}`)].join("\n");
    return message.reply(replyText);
  }

  if (command === "giveaway") {
    if (args.length < 3) {
      return message.reply("Usage: `!giveaway [duree] [nbr-gagnants] [prix]`\nExemple: `!giveaway 1h 1 Nitro`\nDuree: `10s`, `5m`, `2h`, `1d`");
    }

    const durRaw = args[0].toLowerCase();
    const winners = parseInt(args[1]);
    const prize = args.slice(2).join(" ");

    const timeRegex = /(\d+)\s*(seconde?s?|min(?:ute)?s?|heure?s?|jour?s?|s|m|h|d|j)/g;
    const matches = [...durRaw.matchAll(timeRegex)];
    if (matches.length === 0) return message.reply("Duree invalide. Utilise `10s`, `5m`, `2h`, `1d`, `30 secondes`, `1 minute`, `1 heure`, `1 jour`...");

    let ms = 0;
    for (const m of matches) {
      const amount = parseInt(m[1]);
      const unit = m[2];
      if (unit.startsWith("seconde") || unit === "s") ms += amount * 1000;
      else if (unit.startsWith("min") || unit === "m") ms += amount * 60000;
      else if (unit.startsWith("heur") || unit === "h") ms += amount * 3600000;
      else if (unit.startsWith("jour") || unit === "d" || unit === "j") ms += amount * 86400000;
    }

    if (ms <= 0) return message.reply("Duree invalide.");
    const endTime = Date.now() + ms;

    const gwEmbed = new EmbedBuilder()
      .setColor("#ff66aa")
      .setTitle("🎉 GIVEAWAY 🎉")
      .setDescription(`**Prix :** ${prize}\n\n**Participants :** 0\n**Temps restant :** ${durRaw}\n**Fin :** <t:${Math.floor(endTime / 1000)}:F>\n\nReagis avec 🎉 pour participer !`)
      .setFooter({ text: `${winners} gagnant(s) · Lance par ${message.author.username}` })
      .setTimestamp();

    const gwMsg = await message.channel.send({ embeds: [gwEmbed] });
    await gwMsg.react("🎉");

    giveaways.set(gwMsg.id, {
      messageId: gwMsg.id,
      channelId: message.channel.id,
      guildId: message.guild.id,
      endTime,
      winners,
      prize,
      hostId: message.author.id,
    });

    persistGiveaways();
    message.delete().catch(() => {});
  }
});

client.on(Events.GuildMemberAdd, async (member) => {
  const welcomeChannelId = channelConfigs[`welcome_${member.guild.id}`];
  if (welcomeChannelId) {
    try {
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (channel) {
        const welcomeEmbed = new EmbedBuilder()
          .setColor("#000000")
          .setAuthor({ name: "Absolu", iconURL: member.guild.iconURL({ dynamic: true }) || null })
          .setDescription(`Bienvenue sur **Absolu** ${member}\n\nTu es le **${member.guild.memberCount}** membre du serveur !\n\nSi personne te répond, reviens dans **20 min** !`)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
          .setFooter({ text: `Membre ${member.guild.memberCount}` })
          .setTimestamp();
        await channel.send({ content: `${member}`, embeds: [welcomeEmbed] });
      }
    } catch (err) {
      console.error("Erreur message de bienvenue:", err);
    }
  }

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

  console.log(`[VoiceUpdate] ${member.user.tag}: ${oldState.channelId} -> ${newState.channelId}`);

  updateAllCounters();

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

setInterval(async () => {
  const now = Date.now();
  for (const [msgId, gw] of giveaways) {
    if (now < gw.endTime) {
      try {
        const channel = client.guilds.cache.get(gw.guildId)?.channels.cache.get(gw.channelId);
        if (!channel) continue;
        const msg = await channel.messages.fetch(gw.messageId);
        if (!msg) continue;
        const reaction = msg.reactions.cache.get("🎉");
        const participants = reaction ? reaction.count - 1 : 0;
        const remaining = gw.endTime - now;
        const secs = Math.floor(remaining / 1000);
        const days = Math.floor(secs / 86400);
        const hours = Math.floor((secs % 86400) / 3600);
        const mins = Math.floor((secs % 3600) / 60);
        const sec = secs % 60;
        const timeStr = days > 0 ? `${days}j ${hours}h ${mins}m` : hours > 0 ? `${hours}h ${mins}m ${sec}s` : mins > 0 ? `${mins}m ${sec}s` : `${sec}s`;

        const gwEmbed = new EmbedBuilder()
          .setColor("#ff66aa")
          .setTitle("🎉 GIVEAWAY 🎉")
          .setDescription(`**Prix :** ${gw.prize}\n\n**Participants :** ${participants}\n**Temps restant :** ${timeStr}\n**Fin :** <t:${Math.floor(gw.endTime / 1000)}:F>\n\nReagis avec 🎉 pour participer !`)
          .setFooter({ text: `${gw.winners} gagnant(s) · Lance par <@${gw.hostId}>` })
          .setTimestamp();
        await msg.edit({ embeds: [gwEmbed] }).catch(() => {});
      } catch (err) {}
      continue;
    }

    try {
      giveaways.delete(msgId);
      persistGiveaways();
      const channel = client.guilds.cache.get(gw.guildId)?.channels.cache.get(gw.channelId);
      if (!channel) continue;
      const msg = await channel.messages.fetch(gw.messageId);
      if (!msg) continue;
      const reaction = msg.reactions.cache.get("🎉");
      const users = reaction ? await reaction.users.fetch() : null;
      let participants = [];
      if (users) {
        users.forEach((u) => {
          if (!u.bot) participants.push(u.id);
        });
      }

      if (participants.length === 0) {
        const embed = new EmbedBuilder()
          .setColor("#ff66aa")
          .setTitle("🎉 GIVEAWAY 🎉")
          .setDescription(`**Prix :** ${gw.prize}\n\nAucun participant. Giveaway annule.`);
        return msg.edit({ embeds: [embed] }).catch(() => {});
      }

      const winners = [];
      for (let i = 0; i < Math.min(gw.winners, participants.length); i++) {
        const idx = Math.floor(Math.random() * participants.length);
        winners.push(participants.splice(idx, 1)[0]);
      }

      const winnerMentions = winners.map(w => `<@${w}>`).join(", ");
      const embed = new EmbedBuilder()
        .setColor("#ff66aa")
        .setTitle("🎉 GIVEAWAY TERMINE 🎉")
        .setDescription(`**Prix :** ${gw.prize}\n\n**Gagnant(s) :** ${winnerMentions}\n\nFelicitations !`)
        .setTimestamp();

      await msg.edit({ embeds: [embed] });
      await channel.send(`🎉 Felicitations ${winnerMentions} ! Tu as gagne **${gw.prize}** !`);
    } catch (err) {}
  }
}, 1000);

client.login(process.env.TOKEN);

setInterval(() => {
  for (const [key, joinTime] of voiceJoinTimes) {
    const parts = key.split("_");
    const guildId = parts[0];
    const userId = parts.slice(1).join("_");
    const guild = client.guilds.cache.get(guildId);
    if (!guild) continue;
    const member = guild.members.cache.get(userId);
    if (member && member.voice.channel) {
      const elapsed = Math.floor((Date.now() - joinTime) / 60000);
      if (elapsed > 0) {
        addVoiceTime(guildId, userId, elapsed);
        voiceJoinTimes.set(key, Date.now());
      }
    }
  }
  updateLeaderboards();
}, 60 * 1000);

setInterval(() => {
  updateAllCounters();
}, 5 * 1000);

setInterval(() => {
  for (const [key, value] of Object.entries(channelConfigs)) {
    if (key.startsWith("bump_")) {
      const guildId = key.split("_")[1];
      const guild = client.guilds.cache.get(guildId);
      if (!guild) continue;
      const channel = guild.channels.cache.get(value);
      if (channel) bumpChannel(channel);
    }
  }
}, 120 * 60 * 1000);

setInterval(() => {
  try {
    fs.writeFileSync("config.json", JSON.stringify(channelConfigs, null, 2));
    writeDataFile();
    const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      execSync(`git remote set-url origin https://x-access-token:${token}@github.com/swag-vip/bot.git`, { stdio: "ignore" });
    }
    execSync("git config user.name \"Bot\"", { stdio: "ignore" });
    execSync("git config user.email \"bot@bot.com\"", { stdio: "ignore" });
    execSync("git add data.json", { stdio: "ignore" });
    execSync("git diff --cached --quiet || git commit -m \"Update stats\"", { stdio: "ignore" });
    try {
      execSync("git push origin main", { stdio: "ignore" });
    } catch (e) {
      execSync("git pull --rebase origin main", { stdio: "ignore" });
      execSync("git push origin main", { stdio: "ignore" });
    }
  } catch (err) {}
}, 10 * 60 * 1000);

const BOT_START_TIME = Date.now();
const AUTO_RELAUNCH_MS = 3 * 60 * 60 * 1000 + 54 * 60 * 1000;

async function autoRelaunch() {
  console.log("[AutoRelaunch] Relance automatique dans 60s...");
  try {
    fs.writeFileSync("config.json", JSON.stringify(channelConfigs, null, 2));
    writeDataFile();
    const token = process.env.PAT_TOKEN || process.env.GITHUB_TOKEN;
    if (token) {
      const res = await fetch("https://api.github.com/repos/swag-vip/bot/actions/workflows/run-bot.yml/dispatches", {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${token}`,
          "Accept": "application/vnd.github.v3+json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ ref: "main" }),
      });
      if (res.ok) {
        console.log("[AutoRelaunch] Nouveau workflow lance avec succes !");
      } else {
        console.log(`[AutoRelaunch] Echec lancement: ${res.status}`);
      }
    }
  } catch (err) {
    console.log("[AutoRelaunch] Erreur:", err.message);
  }
}

setInterval(() => {
  const elapsed = Date.now() - BOT_START_TIME;
  if (elapsed >= AUTO_RELAUNCH_MS) {
    autoRelaunch();
    clearInterval(this);
  }
}, 60 * 1000);

