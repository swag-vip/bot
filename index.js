require("dotenv").config();
const fs = require("fs");
const { execSync } = require("child_process");
const { Client, GatewayIntentBits, PermissionsBitField, ChannelType, Events, EmbedBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, StringSelectMenuBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require("discord.js");
const express = require("express");

const OWNER_ID = "1532548944419229710";
const DATA_FILE = "data.json";
const BLACKLIST = ["618042706031280133", "1391860474307411988", "1377301118052208674"];

process.on("unhandledRejection", (err) => console.error("[UnhandledRejection]", err.message || err));
process.on("uncaughtException", (err) => console.error("[UncaughtException]", err.message || err));

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

client.on("error", (err) => console.error("[ClientError]", err.message));

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
  const count = role.members.size;
  const newName = `Membres: ${count}`;
  if (channel.name === newName) return;

  const last = lastRoleRename.get(guild.id) || 0;
  if (Date.now() - last < 60 * 1000) return;

  console.log(`[RoleCounter] rename ${channel.name} -> ${newName}`);
  try {
    await channel.setName(newName);
    lastRoleRename.set(guild.id, Date.now());
  } catch (e) {
    console.log("[RoleCounter] Erreur rename:", e.message);
  }
}

async function sendLog(guild, category, embed) {
  try {
    const cfg = channelConfigs[`logs_${guild.id}`];
    if (!cfg) return;
    const key = cfg[category] || (category === "arrivals" ? cfg.arrivees : category === "departures" ? cfg.departs : null);
    if (!key) return;
    const channel = guild.channels.cache.get(key);
    if (!channel) return;
    await channel.send({ embeds: [embed] });
  } catch (e) {}
}

async function sendTicketTranscript(channel, reason) {
  if (!channel || !channel.guild) return;
  const cfg = channelConfigs[`logs_${channel.guild.id}`];
  if (!cfg || !cfg.tickets) return;
  const logChannel = channel.guild.channels.cache.get(cfg.tickets);
  if (!logChannel) return;

  let messages = [];
  try {
    messages = [...(await channel.messages.fetch({ limit: 100 })).values()].reverse();
  } catch (e) {}

  if (messages.length === 0) return;

  const lines = [`TRANSCRIPT - ${channel.name}`, `Ferme par: ${reason}`, `Date: ${new Date().toLocaleString("fr-FR")}`, `Nombre de messages: ${messages.length}`, "", "=".repeat(40), ""];
  for (const msg of messages) {
    const author = msg.author ? msg.author.tag : "Inconnu";
    const time = new Date(msg.createdTimestamp).toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
    let content = msg.content || "";
    if (msg.attachments.size > 0) content += (content ? " " : "") + msg.attachments.map(a => a.url).join(" ");
    if (msg.embeds.length > 0) content += (content ? " " : "") + "[embed]";
    lines.push(`[${time}] ${author}: ${content || "(vide)"}`);
  }

  try {
    await logChannel.send({
      content: `Transcript du ticket **${channel.name}** (${messages.length} messages)`,
      files: [{ attachment: Buffer.from(lines.join("\n"), "utf8"), name: `transcript-${channel.name}.txt` }],
    });
  } catch (e) {}
}

const lastMembersFetch = new Map();

async function updateAllCounters() {
  for (const [, guild] of client.guilds.cache) {
    const rc = channelConfigs[`rolecounter_${guild.id}`];
    if (rc) {
      const channel = guild.channels.cache.get(rc.channelId);
      const role = guild.roles.cache.get(rc.roleId);
      if (!channel || !role) continue;
      const lastFetch = lastMembersFetch.get(guild.id) || 0;
      if (Date.now() - lastFetch > 10 * 60 * 1000) {
        try {
          await guild.members.fetch();
          lastMembersFetch.set(guild.id, Date.now());
        } catch (e) {}
      }
      updateRoleCounter(channel, role, guild);
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
  data["_giveaways"] = [...giveaways.values()].map(({ _lastEdited, ...gw }) => gw);
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

function persistGiveaways() {
  try {
    const clean = [...giveaways.values()].map(({ _lastEdited, ...gw }) => gw);
    fs.writeFileSync(GIVEAWAYS_FILE, JSON.stringify(clean, null, 2));
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

async function scanGiveawaysFromChannels(client) {
  let found = 0;
  for (const [, guild] of client.guilds.cache) {
    for (const [, channel] of guild.channels.cache) {
      if (channel.type !== ChannelType.GuildText) continue;
      let messages;
      try {
        messages = await channel.messages.fetch({ limit: 100 });
      } catch {
        continue;
      }
      for (const [, msg] of messages) {
        if (giveaways.has(msg.id)) continue;
        if (!msg.author || msg.author.id !== client.user.id) continue;
        const embed = msg.embeds && msg.embeds[0];
        if (!embed || embed.title !== "🎉 GIVEAWAY 🎉" || !embed.footer) continue;
        if (embed.description && /TERMINE|annule/i.test(embed.description)) continue;

        const desc = embed.description || "";
        let endTime = 0;
        const finMatch = desc.match(/<t:(\d+):F>/);
        if (finMatch) endTime = parseInt(finMatch[1], 10) * 1000;
        const now = Date.now();
        if (!endTime || endTime <= now) continue;

        const winnersMatch = (embed.footer.text || "").match(/(\d+) gagnant/);
        const winners = winnersMatch ? parseInt(winnersMatch[1], 10) : 1;
        const hostMatch = (embed.footer.text || "").match(/<@(\d+)>/);
        const hostId = hostMatch ? hostMatch[1] : null;
        const prizeMatch = desc.match(/\*\*Prix :\*\*\s*(.+)/);
        const prize = prizeMatch ? prizeMatch[1].trim() : "Prix";

          giveaways.set(msg.id, {
            messageId: msg.id,
            channelId: msg.channel.id,
            guildId: guild.id,
            endTime,
            winners,
            prize,
            hostId,
          });
          found++;
      }
    }
  }
  if (found > 0) {
    console.log(`[Giveaways] ${found} giveaway(s) retrouve(s) par scan`);
    persistGiveaways();
  }
}

async function scanTempState(client) {
  let tFound = 0;
  for (const [, guild] of client.guilds.cache) {
    for (const [, channel] of guild.channels.cache) {
      if (channel.type === ChannelType.GuildVoice && channel.name.startsWith("Solo de ")) {
        if (channel.members.size === 0) {
          try {
            await channel.delete();
            console.log(`[TempVoice] Salon vide supprime: ${channel.name}`);
          } catch {}
        } else {
          const username = channel.name.slice("Solo de ".length).trim();
          const owner = channel.members.find((m) => m.user.username === username);
          if (owner) {
            tempChannels.set(channel.id, owner.id);
            tFound++;
          }
        }
      }

      if (channel.type === ChannelType.GuildText && channel.name.startsWith("ticket-")) {
        let userId = null;
        const staffRoleIds = [];
        for (const [, perm] of channel.permissionOverwrites.cache) {
          if (perm.deny.has(PermissionsBitField.Flags.ViewChannel) && perm.id === guild.roles.everyone.id) continue;
          if (perm.type === 1) {
            if (perm.allow.has(PermissionsBitField.Flags.ViewChannel) && perm.id !== client.user.id) {
              const isRole = guild.roles.cache.has(perm.id);
              if (isRole) staffRoleIds.push(perm.id);
              else userId = perm.id;
            }
          }
        }
        const type = channel.name.includes("staff") ? "staff" : channel.name.includes("support") ? "support" : "suggestion";
        ticketChannels.set(channel.id, { userId, staffRoleIds, type });
        tFound++;
      }
    }
  }
  if (tFound > 0) console.log(`[TempState] ${tFound} salon(s) tempo/ticket restaure(s)`);
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

  const panelCommand = {
    name: "panel",
    description: "Panel de controle du bot (prive)",
  };

  const sayCommand = {
    name: "say",
    description: "Faire ecrire le bot (salon courant ou choisi)",
    options: [
      {
        name: "message",
        description: "Le message a ecrire",
        type: 3,
        required: true,
      },
      {
        name: "salon",
        description: "Nom ou #mention du salon (ex: general). Sinon salon courant.",
        type: 3,
        required: false,
      },
    ],
  };

  for (const [, guild] of client.guilds.cache) {
    await guild.commands.create(panelCommand).catch(() => {});
    await guild.commands.create(sayCommand).catch(() => {});
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

  await scanGiveawaysFromChannels(client);
  await scanTempState(client);
});

client.on(Events.MessageCreate, async (message) => {
  if (message.author.bot) return;
  addMessage(message.guild.id, message.author.id);

  if (message.author.id !== OWNER_ID) return;
  const prefixUsed = message.content.startsWith("!") ? "!" : message.content.startsWith("+") ? "+" : null;
  if (!prefixUsed) return;

  const args = message.content.slice(prefixUsed.length).trim().split(/ +/);
  const command = args.shift().toLowerCase();

  if (command === "test") {
    return message.reply("Ca marche !");
  }

  if (command === "massdm") {
    if (args.length === 0) return message.reply("Usage: `!massdm [message]`");
    const text = args.join(" ");
    let sent = 0;
    let failed = 0;
    let skipped = 0;
    try {
      await message.guild.members.fetch();
      for (const [, member] of message.guild.members.cache) {
        if (member.user.bot) continue;
        try {
          await member.send(text);
          sent++;
          await new Promise((r) => setTimeout(r, 1500));
        } catch (e) {
          failed++;
        }
      }
    } catch (err) {
      return message.reply(err.message || "Erreur pendant le mass DM.");
    }
    return message.reply(`Mass DM termine.\nEnvoye: ${sent}\nEchec (DM ferme): ${failed}`);
  }

  if (command === "panel") {
    return message.reply("Tape **`/panel`** dans n'importe quel salon : le panel s'affiche uniquement pour toi.");
  }

  if (command === "help" && prefixUsed === "!") {
    return message.reply("Commandes:\n`!setup-vocal #salon` - Salon vocal perso\n`!setup-autorole @role` - Auto-role\n`!setup-statusrole @role` - Status-role\n`!setup-tickets #salon @role` - Systeme de tickets\n`!ticket-close` - Fermer un ticket\n`!setup-leaderboard #salon` - Leaderboard auto\n`!setup-welcome #salon` - Message de bienvenue\n`!setup-rolecounter #salon @role` - Compteur de membres role\n`!setup-logs <categorie> #salon` - Logs (voice/messages/tickets/boost/staff/arrivals/departures)\n`!say #salon message` - Faire parler le bot\n`!send-embed #salon message` - Message stylise\n`!panel` - Panel de controle du bot\n`!bot-status [texte]` - Status du bot\n`!leaderboard` - Classement\n`!rank` - Ton rang\n`!giveaway` - Lancer un giveaway\n`!massdm [message]` - DM a tout le serveur");
  }

  if (command === "say") {
    const salon = message.mentions.channels.first();
    if (!salon || !salon.isTextBased() || salon.type === ChannelType.GuildDM) {
      return message.reply("Mentionne un salon texte valide.");
    }
    const text = args.filter(a => !a.startsWith("<#") && !a.startsWith("<@")).join(" ") || args.join(" ");
    if (!text) return message.reply("Usage: `!say #salon message`");
    try {
      await salon.send(text);
      return message.reply(`Message envoye dans <#${salon.id}>.`);
    } catch (err) {
      return message.reply("Impossible d'envoyer le message (check les permissions du bot).");
    }
  }

  if (command === "send-embed") {
    const salon = message.mentions.channels.first();
    if (!salon || !salon.isTextBased() || salon.type === ChannelType.GuildDM) {
      return message.reply("Mentionne un salon texte valide.");
    }
    const text = args.filter(a => !a.startsWith("<#")).join(" ").trim();
    if (!text) return message.reply("Usage: `!send-embed #salon message`");
    const embed = new EmbedBuilder()
      .setColor("#2f3136")
      .setDescription(text)
      .setTimestamp();
    try {
      await salon.send({ embeds: [embed] });
      return message.reply(`Embed envoye dans <#${salon.id}>.`);
    } catch (err) {
      return message.reply("Impossible d'envoyer l'embed (check les permissions du bot).");
    }
  }

  if (command === "bot-status") {
    const text = args.join(" ").trim();
    if (!text) return message.reply("Usage: `!bot-status [texte]`\nExemple: `!bot-status Jouer à Fortnite`");
    try {
      await client.user.setPresence({ activities: [{ name: text }] });
      return message.reply(`Status du bot change: "${text}".`);
    } catch (err) {
      return message.reply("Impossible de changer le status.");
    }
  }

  if (command === "bot-ping") {
    return message.reply(`Ping du bot: **${Math.round(client.ws.ping)}ms**`);
  }

  if (command === "help" && prefixUsed === "+") {
    return message.reply("Commandes:\n`+lock` - Verrouiller le salon vocal\n`+unlock` - Deverrouiller le salon vocal\n`+pic` - Photo de profil d'un membre\n`+userinfo [id/mention/nom]` - Fiche detaillee d'un membre\n`+snipe` - Snipe un emoji/sticker externe");
  }

  if (command === "lock") {
    const vc = message.member.voice?.channel;
    if (!vc) return message.reply("Tu dois etre dans un salon vocal.");
    if (vc.type !== ChannelType.GuildVoice) return message.reply("Ce n'est pas un salon vocal.");
    try {
      await vc.permissionOverwrites.edit(message.guild.id, {
        Connect: false,
      });
      return message.reply(`Salon vocal <#${vc.id}> verrouille.`);
    } catch (e) {
      return message.reply("Impossible de verrouiller le salon vocal.");
    }
  }

  if (command === "unlock") {
    const vc = message.member.voice?.channel;
    if (!vc) return message.reply("Tu dois etre dans un salon vocal.");
    if (vc.type !== ChannelType.GuildVoice) return message.reply("Ce n'est pas un salon vocal.");
    try {
      await vc.permissionOverwrites.edit(message.guild.id, {
        Connect: null,
      });
      return message.reply(`Salon vocal <#${vc.id}> deverrouille.`);
    } catch (e) {
      return message.reply("Impossible de deverrouiller le salon vocal.");
    }
  }

  if (command === "pic") {
    let target = message.mentions.users.first() || message.author;
    const avatar = target.displayAvatarURL({ extension: "png", size: 1024 });
    const embed = new EmbedBuilder()
      .setColor("#2f3136")
      .setAuthor({ name: target.username, iconURL: target.displayAvatarURL() })
      .setImage(avatar);
    return message.reply({ embeds: [embed] });
  }

  if (command === "userinfo" || command === "lookup" || command === "whois") {
    if (!message.guild) return message.reply("Cette commande marche seulement dans un serveur.");
    let userID = (args[0] || "").replace(/[<@!>]/g, "");
    let target = null;
    if (userID && /^\d+$/.test(userID)) {
      target = message.guild.members.cache.get(userID);
      if (!target) {
        try { target = await message.guild.members.fetch(userID).catch(() => null); } catch (e) {}
      }
    }
    if (!target && message.mentions.members.first()) {
      target = message.mentions.members.first();
    } else if (!target && message.mentions.users.first()) {
      const mentioned = message.mentions.users.first();
      try { target = await message.guild.members.fetch(mentioned.id).catch(() => null); } catch (e) {}
    }
    if (!target) {
      const byName = args.join(" ");
      if (byName) {
        idxById:
        for (const [, m] of message.guild.members.cache) {
          if (m.user.tag.toLowerCase().includes(byName.toLowerCase()) || m.displayName.toLowerCase().includes(byName.toLowerCase())) {
            target = m;
            break;
          }
        }
        if (!target) {
          try { await message.guild.members.fetch().catch(() => {}); } catch (e) {}
          for (const [, m] of message.guild.members.cache) {
            if (m.user.tag.toLowerCase().includes(byName.toLowerCase()) || m.displayName.toLowerCase().includes(byName.toLowerCase())) {
              target = m;
              break;
            }
          }
        }
      }
    }
    if (!target) target = message.member;
    const u = target.user;
    const createdAt = u.createdTimestamp ? new Date(u.createdTimestamp) : null;
    const joinedAt = target.joinedAt ? new Date(target.joinedAt) : null;
    const fmt = (t) => t ? `<t:${Math.floor(t.getTime() / 1000)}:F>` : "Inconnu";
    const rel = (t) => t ? `<t:${Math.floor(t.getTime() / 1000)}:R>` : "Inconnu";

    const flagNames = {
      DiscordEmployee: "Employe Discord",
      PartneredServerOwner: "Partenaire Discord",
      HypeSquadEvents: "HypeSquad Events",
      BugHunterLevel1: "Bug Hunter",
      HypeSquadOnlineHouse1: "HypeSquad Bravery",
      HypeSquadOnlineHouse2: "HypeSquad Brilliance",
      HypeSquadOnlineHouse3: "HypeSquad Balance",
      PremiumEarlySupporter: "Early Supporter",
      BugHunterLevel2: "Bug Hunter Elite",
      VerifiedDeveloper: "Developpeur Verifie",
      CertifiedModerator: "Moderateur Certifie",
      ActiveDeveloper: "Developpeur Actif",
      Staff: "Staff",
    };
    const badges = [];
    if (u.flags) {
      for (const f of u.flags.toArray()) {
        badges.push(flagNames[f] || f.replace(/_/g, " "));
      }
    }
    const ageDays = createdAt ? Math.max(0, Math.floor((Date.now() - u.createdTimestamp) / 86400000)) : null;
    const altRisk = ageDays !== null ? (ageDays < 7 ? "TRES ELEVE (compte recent)" : ageDays < 30 ? "ELEVE" : "normal") : "inconnu";
    const isBot = u.bot ? "Oui" : "Non";
    const boost = target.premiumSince ? rel(target.premiumSince) : "Non-booster";
    const roles = target.roles.cache
      .filter((r) => r.id !== message.guild.id)
      .sort((a, b) => b.position - a.position)
      .map((r) => `${r.toString()} \`${r.id}\``)
      .join(" ");
    const nickname = target.nickname || "Aucun";
    const presenceMap = { online: "En ligne", idle: "Absent", dnd: "Ne pas deranger", offline: "Hors ligne" };
    const presence = target.presence?.status ? presenceMap[target.presence.status] || target.presence.status : "inconnu";
    const activity = target.presence?.activities?.length
      ? target.presence.activities
          .filter((a) => a.type !== 3)
          .map((a) => (a.type === 4 ? a.state || a.name : a.name))
          .filter(Boolean)
          .join(", ")
      : "Aucune";
    const voice = target.voice?.channel;
    const voiceInfo = voice
      ? `Dans <#${voice.id}> (${voice.members.size} pers.) · Fake mute: ${target.voice.selfMute ? "oui" : "non"} · Fake deaf: ${target.voice.selfDeaf ? "oui" : "non"} · Streaming: ${target.voice.streaming ? "oui" : "non"} · Cam: ${target.voice.selfVideo ? "oui" : "non"}`
      : "Pas en vocal";
    const keyPerms = target.permissions?.has([
      PermissionsBitField.Flags.Administrator,
      PermissionsBitField.Flags.ManageMessages,
      PermissionsBitField.Flags.ModerateMembers,
      PermissionsBitField.Flags.ManageRoles,
    ].map((f) => f))
      ? "Oui"
      : "Non";
    const boostCount = target.guild.premiumSubscriptionCount;

    const embed = new EmbedBuilder()
      .setColor(target.displayColor || "#2f3136")
      .setAuthor({ name: u.tag, iconURL: u.displayAvatarURL({ dynamic: true }) })
      .setThumbnail(u.displayAvatarURL({ dynamic: true, size: 512 }))
      .setDescription(u.toString())
      .addFields(
        { name: "ID", value: `\`${u.id}\``, inline: true },
        { name: "Tag", value: `${u.username}#${u.discriminator}`, inline: true },
        { name: "Pseudo", value: nickname, inline: true },
        { name: "Nom d'utilisateur", value: u.username, inline: true },
        { name: "Bot", value: isBot, inline: true },
        { name: "Badges", value: badges.length ? badges.join(", ") : "Aucun", inline: true },
        { name: "Status", value: presence, inline: true },
        { name: "Activite", value: activity, inline: false },
        { name: "Vocal", value: voiceInfo, inline: false },
        { name: "Compte cree", value: `${fmt(createdAt)} (${rel(createdAt)})`, inline: true },
        { name: "Age du compte", value: ageDays !== null ? `${ageDays} jours` : "inconnu", inline: true },
        { name: "Risque ALT", value: altRisk, inline: true },
        { name: "A rejoint le serveur", value: joinedAt ? `${fmt(joinedAt)} (${rel(joinedAt)})` : "Inconnu", inline: true },
        { name: "Boost", value: boost, inline: true },
        { name: "Couleur", value: target.displayHexColor, inline: true },
        { name: "Permissions mod", value: keyPerms, inline: true },
        { name: "Roles", value: roles || "Aucun", inline: false },
      )
      .setFooter({ text: `Demande par ${message.author.username} · +/userinfo <id|mention|nom>` })
      .setTimestamp();
    return message.reply({ embeds: [embed] });
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

    const embed = new EmbedBuilder()
      .setColor("#e74c3c")
      .setAuthor({ name: message.author.tag, iconURL: message.author.displayAvatarURL({ dynamic: true }) })
      .setDescription(`Ticket **${message.channel.name}** ferme par ${message.author}`)
      .setTimestamp();
    sendLog(message.guild, "tickets", embed);
    await sendTicketTranscript(message.channel, message.author.tag);

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

  if (command === "setup-logs") {
    const type = args[0] && args[0].toLowerCase();
    const salon = message.mentions.channels.first();
    const validTypes = ["voice", "messages", "tickets", "boost", "staff", "arrivals", "departures", "arrivees", "departs"];

    if (!type || !salon || salon.type !== ChannelType.GuildText) {
      return message.reply("Usage: `!setup-logs <categorie> #salon`\nCategories: `voice`, `messages`, `tickets`, `boost`, `staff`, `arrivals` (ou `arrivees`), `departures` (ou `departs`)\nExemple: `!setup-logs voice #voice-logs`\nRefais la commande pour chaque categorie avec son salon de ton choix.");
    }

    if (!validTypes.includes(type)) {
      return message.reply(`Categorie invalide. Categories: \`${validTypes.join("`, `")}\``);
    }

    const typeMap = { arrivees: "arrivals", departs: "departures" };
    const storeType = typeMap[type] || type;

    const config = { ...(channelConfigs[`logs_${message.guild.id}`] || {}), [storeType]: salon.id };
    channelConfigs[`logs_${message.guild.id}`] = config;
    saveConfigs();
    message.reply(`Logs **${storeType}** configures dans <#${salon.id}>.\nConfig actuelle:\nVoice: ${config.voice ? `<#${config.voice}>` : "non configure"}\nMessages: ${config.messages ? `<#${config.messages}>` : "non configure"}\nTickets: ${config.tickets ? `<#${config.tickets}>` : "non configure"}\nBoost: ${config.boost ? `<#${config.boost}>` : "non configure"}\nStaff: ${config.staff ? `<#${config.staff}>` : "non configure"}\nArrivals: ${config.arrivals ? `<#${config.arrivals}>` : "non configure"}\nDepartures: ${config.departures ? `<#${config.departures}>` : "non configure"}`);
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
      return message.reply("Reponds a un message qui contient un emoji externe ou un sticker avec `+snipe`.");
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
      return message.reply("Usage: `+giveaway [duree] [nbr-gagnants] [prix]`\nExemple: `+giveaway 1h 1 Nitro`\nDuree: `10s`, `5m`, `2h`, `1d`");
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

client.on(Events.MessageDelete, async (msg) => {
  if (!msg.guild) return;
  if (msg.author && msg.author.bot) return;
  const content = msg.content || "*pas de contenu*";
  const fieldValue = content.length > 1024 ? content.slice(0, 1021) + "..." : content;
  const embed = new EmbedBuilder()
    .setColor("#e67e22")
    .setAuthor({ name: msg.author ? msg.author.tag : "Inconnu", iconURL: msg.author ? msg.author.displayAvatarURL({ dynamic: true }) : null })
    .setDescription(`Message supprime dans <#${msg.channel.id}>`)
    .addFields({ name: "Contenu", value: fieldValue })
    .setFooter({ text: `ID: ${msg.id}` })
    .setTimestamp();
  sendLog(msg.guild, "messages", embed);
});

client.on(Events.MessageUpdate, async (oldMsg, newMsg) => {
  if (!oldMsg.guild) return;
  if (oldMsg.author && oldMsg.author.bot) return;
  if (oldMsg.content === newMsg.content) return;
  const truncate = (s) => {
    const txt = s || "*pas de contenu*";
    return txt.length > 1024 ? txt.slice(0, 1021) + "..." : txt;
  };
  const embed = new EmbedBuilder()
    .setColor("#e67e22")
    .setAuthor({ name: oldMsg.author ? oldMsg.author.tag : "Inconnu", iconURL: oldMsg.author ? oldMsg.author.displayAvatarURL({ dynamic: true }) : null })
    .setDescription(`Message modifie dans <#${oldMsg.channel.id}>`)
    .addFields(
      { name: "Avant", value: truncate(oldMsg.content) },
      { name: "Apres", value: truncate(newMsg.content) },
    )
    .setFooter({ text: `ID: ${oldMsg.id}` })
    .setTimestamp();
  sendLog(oldMsg.guild, "messages", embed);
});

client.on(Events.MessageReactionAdd, async (reaction, user) => {
  if (user.bot) return;
  if (reaction.emoji.name !== "🎉") return;
  if (!giveaways.has(reaction.message.id)) return;
  const gw = giveaways.get(reaction.message.id);
  const now = Date.now();
  if (now >= gw.endTime) return;
  try {
    await reaction.fetch();
    const participants = reaction.count > 1 ? reaction.count - 1 : 0;
    const channel = client.guilds.cache.get(gw.guildId)?.channels.cache.get(gw.channelId);
    if (!channel) return;
    const msg = await channel.messages.fetch(reaction.message.id);
    if (!msg) return;
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
});

client.on(Events.GuildMemberUpdate, async (oldMember, newMember) => {
  if (!oldMember.premiumSince && newMember.premiumSince) {
    const embed = new EmbedBuilder()
      .setColor("#f47fff")
      .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${newMember} a **boost** le serveur !`)
      .setTimestamp();
    sendLog(newMember.guild, "boost", embed);
  }

  const hadTimeout = oldMember.communicationDisabledUntilTimestamp;
  const hasTimeout = newMember.communicationDisabledUntilTimestamp;
  if (!hadTimeout && hasTimeout) {
    const ends = new Date(hasTimeout).toLocaleString("fr-FR");
    const embed = new EmbedBuilder()
      .setColor("#e67e22")
      .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${newMember} a ete **mut (timeout)** jusqu'au ${ends}`)
      .setTimestamp();
    sendLog(newMember.guild, "staff", embed);
  } else if (hadTimeout && !hasTimeout) {
    const embed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${newMember} a ete **unmute**`)
      .setTimestamp();
    sendLog(newMember.guild, "staff", embed);
  }

  const oldRoles = oldMember.roles.cache.map(r => r.id).sort().join(",");
  const newRoles = newMember.roles.cache.map(r => r.id).sort().join(",");
  if (oldRoles !== newRoles) {
    const added = newMember.roles.cache.filter(r => !oldMember.roles.cache.has(r.id)).map(r => `<@&${r.id}>`);
    const removed = oldMember.roles.cache.filter(r => !newMember.roles.cache.has(r.id)).map(r => `<@&${r.id}>`);
    let desc = `Roles de ${newMember} change:` ;
    if (added.length) desc += `\n+ Ajoute: ${added.join(", ")}`;
    if (removed.length) desc += `\n- Retire: ${removed.join(", ")}`;
    if (added.length || removed.length) {
      const embed = new EmbedBuilder()
        .setColor("#9b59b6")
        .setAuthor({ name: newMember.user.tag, iconURL: newMember.user.displayAvatarURL({ dynamic: true }) })
        .setDescription(desc)
        .setTimestamp();
      sendLog(newMember.guild, "staff", embed);
    }
  }
});

client.on(Events.GuildBanAdd, async (ban) => {
  const embed = new EmbedBuilder()
    .setColor("#e74c3c")
    .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`${ban.user} a ete **banni**${ban.reason ? `\nRaison: ${ban.reason}` : ""}`)
    .setTimestamp();
  sendLog(ban.guild, "staff", embed);
});

client.on(Events.GuildBanRemove, async (ban) => {
  const embed = new EmbedBuilder()
    .setColor("#2ecc71")
    .setAuthor({ name: ban.user.tag, iconURL: ban.user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`${ban.user} a ete **deban**`)
    .setTimestamp();
  sendLog(ban.guild, "staff", embed);
});

client.on(Events.GuildMemberAdd, async (member) => {
  const created = new Date(member.user.createdTimestamp).toLocaleDateString("fr-FR");
  const embed = new EmbedBuilder()
    .setColor("#2ecc71")
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`${member} a **rejoint** le serveur !\nCompte cree le ${created}`)
    .setFooter({ text: `Membre ${member.guild.memberCount}` })
    .setTimestamp();
  sendLog(member.guild, "arrivals", embed);

  const roleId = channelConfigs[`autorole_${member.guild.id}`];
  if (roleId) {
    try {
      await member.roles.add(roleId);
    } catch (err) {
      console.error("Erreur auto-role:", err);
    }
  }

  const welcomeChannelId = channelConfigs[`welcome_${member.guild.id}`];
  if (welcomeChannelId) {
    try {
      const channel = member.guild.channels.cache.get(welcomeChannelId);
      if (channel) {
        const rc = channelConfigs[`rolecounter_${member.guild.id}`];
        let roleCount = null;
        if (rc) {
          const role = member.guild.roles.cache.get(rc.roleId);
          if (role) {
            try {
              await member.guild.members.fetch();
            } catch (e) {}
            roleCount = role.members.size;
          }
        }
        const count = roleCount !== null ? roleCount : member.guild.memberCount;
        const welcomeEmbed = new EmbedBuilder()
          .setColor("#000000")
          .setAuthor({ name: "Absolu", iconURL: member.guild.iconURL({ dynamic: true }) || null })
          .setDescription(`Bienvenue sur **Absolu** ${member}\n\nTu es le **${count}** membre du serveur !\n\nSi personne te répond, reviens dans **20 min** !`)
          .setThumbnail(member.user.displayAvatarURL({ dynamic: true, size: 128 }))
          .setFooter({ text: `Membre ${count}` })
          .setTimestamp();
        await channel.send({ content: `${member}`, embeds: [welcomeEmbed] });
      }
    } catch (err) {
      console.error("Erreur message de bienvenue:", err);
    }
  }

  checkStatusRole(member);
});

client.on(Events.GuildMemberRemove, async (member) => {
  const joined = member.joinedAt ? new Date(member.joinedAt).toLocaleDateString("fr-FR") : "inconnue";
  const embed = new EmbedBuilder()
    .setColor("#e74c3c")
    .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
    .setDescription(`${member.user.tag} a **quitte** le serveur.\nRejoint le ${joined}`)
    .setFooter({ text: `Membre ${member.guild.memberCount}` })
    .setTimestamp();
  sendLog(member.guild, "departures", embed);
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

  if (oldState.serverMute !== newState.serverMute) {
    const embed = new EmbedBuilder()
      .setColor(newState.serverMute ? "#e67e22" : "#2ecc71")
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${member} a ete **${newState.serverMute ? "mis en mute micro" : "unmute micro"}** sur le serveur`)
      .setTimestamp();
    sendLog(guild, "staff", embed);
  }

  if (oldState.serverDeaf !== newState.serverDeaf) {
    const embed = new EmbedBuilder()
      .setColor(newState.serverDeaf ? "#e67e22" : "#2ecc71")
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${member} a ete **${newState.serverDeaf ? "mis en mute casque" : "unmute casque"}** sur le serveur`)
      .setTimestamp();
    sendLog(guild, "staff", embed);
  }

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

  if (oldState.channel && !newState.channel) {
    const embed = new EmbedBuilder()
      .setColor("#e74c3c")
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${member} a **quitte** le vocal <#${oldState.channel.id}>`)
      .setTimestamp();
    sendLog(guild, "voice", embed);
  } else if (!oldState.channel && newState.channel) {
    const embed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${member} a **rejoint** le vocal <#${newState.channel.id}>`)
      .setTimestamp();
    sendLog(guild, "voice", embed);
  } else if (oldState.channel && newState.channel && oldState.channel.id !== newState.channel.id) {
    const embed = new EmbedBuilder()
      .setColor("#3498db")
      .setAuthor({ name: member.user.tag, iconURL: member.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`${member} a **change** de vocal: <#${oldState.channel.id}> -> <#${newState.channel.id}>`)
      .setTimestamp();
    sendLog(guild, "voice", embed);
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
    const ownerId = tempChannels.get(channel.id);
    if (channel.members.size === 0) {
      tempChannels.delete(channel.id);
      try {
        await channel.delete();
      } catch (err) {
        console.error("Erreur suppression salon:", err);
      }
    } else if (oldState.id === ownerId) {
      const remaining = channel.members.filter((m) => m.id !== ownerId);
      const membersArr = [...remaining.values()];
      if (membersArr.length > 0) {
        const newOwner = membersArr[Math.floor(Math.random() * membersArr.length)];
        tempChannels.set(channel.id, newOwner.id);
        await channel.setName(`Solo de ${newOwner.user.username}`).catch(() => {});
        try {
          const panelMsg = [...channel.messages.cache.values()].find((m) => m.author.id === client.user.id && m.components.length);
          if (panelMsg) {
            await panelMsg.edit(buildPanel(newOwner)).catch(() => {});
          }
        } catch (e) {}
        const transferEmbed = new EmbedBuilder()
          .setColor("#2f3136")
          .setAuthor({ name: newOwner.user.username, iconURL: newOwner.user.displayAvatarURL() })
          .setDescription(`${newOwner.user} est maintenant le nouveau proprietaire de ce salon vocal !\n> Nom du salon mis a jour : **Solo de ${newOwner.user.username}**`)
          .setTimestamp();
        try {
          await channel.send({ embeds: [transferEmbed] });
        } catch (e) {}
      }
    }
  }
});

client.on(Events.InteractionCreate, async (interaction) => {

  try {

  const resolveChannel = (interaction, input) => {
    const idMatch = input.match(/<#(\d+)>/);
    const id = idMatch ? idMatch[1] : input.trim();
    if (/^\d+$/.test(id)) {
      const byId = client.channels.cache.get(id);
      if (byId && byId.isTextBased()) return byId;
    }
    const guilds = interaction.inGuild() ? [interaction.guild] : [...client.guilds.cache.values()];
    for (const guild of guilds) {
      const byId = guild.channels.cache.get(id);
      if (byId && byId.isTextBased()) return byId;
      const byName = guild.channels.cache
        .filter((c) => c.isTextBased())
        .find((c) => c.name.toLowerCase() === id.toLowerCase());
      if (byName) return byName;
    }
    return null;
  };

  if (interaction.isChatInputCommand() && interaction.commandName === "panel") {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true });
    }
    const embed = new EmbedBuilder()
      .setColor("#2f3136")
      .setTitle("🎛️ Panel de controle du bot")
      .setDescription("Utilise les boutons ci-dessous pour controler le bot.")
      .setTimestamp();
    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId("botpanel_say")
        .setLabel("💬 Parler")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("botpanel_embed")
        .setLabel("📦 Embed")
        .setStyle(ButtonStyle.Primary),
      new ButtonBuilder()
        .setCustomId("botpanel_status")
        .setLabel("🟢 Status")
        .setStyle(ButtonStyle.Secondary),
      new ButtonBuilder()
        .setCustomId("botpanel_ping")
        .setLabel("⚡ Ping")
        .setStyle(ButtonStyle.Secondary),
    );
    return interaction.reply({ embeds: [embed], components: [row], ephemeral: true });
  }

  if (interaction.isChatInputCommand() && interaction.commandName === "say") {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true });
    }
    const text = interaction.options.getString("message");
    let target = null;
    const salonStr = interaction.options.getString("salon");
    if (salonStr) {
      target = resolveChannel(interaction, salonStr);
    }
    if (!target && interaction.channel && interaction.channel.isTextBased && interaction.channel.isTextBased()) target = interaction.channel;
    if (!target && interaction.inGuild && !interaction.inGuild()) {
      try {
        const dm = await interaction.user.createDM();
        target = dm;
      } catch (e) {}
    }
    if (!target) {
      return interaction.reply({ content: "Salon introuvable. Reponds: `salon: nom-du-salon` ou `salon: #mention`.", ephemeral: true });
    }
    try {
      await target.send(text);
      return interaction.reply({ content: `Message envoye dans <#${target.id}>`, ephemeral: true });
    } catch (err) {
      console.error("[SayError]", err.message || err);
      return interaction.reply({ content: "Erreur envoi. Detail: " + (err.message || err), ephemeral: true });
    }
  }

  if (interaction.isButton() && interaction.customId.startsWith("botpanel_")) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true });
    }
    if (interaction.customId === "botpanel_ping") {
      return interaction.reply({ content: `Ping du bot: **${Math.round(client.ws.ping)}ms**`, ephemeral: true });
    }
    const isSay = interaction.customId === "botpanel_say";
    const isStatus = interaction.customId === "botpanel_status";
    const modal = new ModalBuilder()
      .setCustomId(isStatus ? "botpanel_status_submit" : isSay ? "botpanel_say_submit" : "botpanel_embed_submit")
      .setTitle(isSay ? "💬 Faire parler le bot" : isStatus ? "🟢 Changer le status" : "📦 Envoyer un embed");
    const salonInput = new TextInputBuilder()
      .setCustomId("salon")
      .setLabel("#salon (nom ou mention)")
      .setPlaceholder("ex: general")
      .setStyle(TextInputStyle.Short)
      .setRequired(true);
    const messageInput = new TextInputBuilder()
      .setCustomId("message")
      .setLabel("Message")
      .setPlaceholder("Tape ton message...")
      .setStyle(TextInputStyle.Paragraph)
      .setRequired(true);
    if (isStatus) {
      modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
    } else {
      modal.addComponents(new ActionRowBuilder().addComponents(salonInput));
      modal.addComponents(new ActionRowBuilder().addComponents(messageInput));
    }
    return interaction.showModal(modal);
  }

  if (interaction.isModalSubmit() && interaction.customId.startsWith("botpanel_")) {
    if (interaction.user.id !== OWNER_ID) {
      return interaction.reply({ content: "Tu n'as pas la permission.", ephemeral: true });
    }
    const message = interaction.fields.getTextInputValue("message");
    if (interaction.customId === "botpanel_status_submit") {
      try {
        await client.user.setPresence({ activities: [{ name: message }] });
        return interaction.reply({ content: `Status change: **"${message}"**`, ephemeral: true });
      } catch (err) {
        return interaction.reply({ content: "Impossible de changer le status.", ephemeral: true });
      }
    }
    const salonInput = interaction.fields.getTextInputValue("salon");
    const salon = resolveChannel(interaction, salonInput);
    if (!salon) {
      return interaction.reply({ content: "Salon introuvable. Verifie le nom.", ephemeral: true });
    }
    try {
      if (interaction.customId === "botpanel_say_submit") {
        await salon.send(message);
      } else {
        const embed = new EmbedBuilder().setColor("#2f3136").setDescription(message).setTimestamp();
        await salon.send({ embeds: [embed] });
      }
      return interaction.reply({ content: `Envoye dans <#${salon.id}>`, ephemeral: true });
    } catch (err) {
      console.error("[BotPanelSendError]", err.message || err);
      return interaction.reply({ content: "Erreur envoi. Detail: " + (err.message || err), ephemeral: true });
    }
  }

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

    const logEmbed = new EmbedBuilder()
      .setColor("#2ecc71")
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`Ticket **${ticketChannel.name}** ouvert par ${interaction.user} (type: ${labels[choice]})`)
      .setTimestamp();
    sendLog(interaction.guild, "tickets", logEmbed);

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

    await interaction.channel.send("Ticket ferme dans 1 seconde...");
    const embed = new EmbedBuilder()
      .setColor("#e74c3c")
      .setAuthor({ name: interaction.user.tag, iconURL: interaction.user.displayAvatarURL({ dynamic: true }) })
      .setDescription(`Ticket **${interaction.channel.name}** ferme par ${interaction.user}`)
      .setTimestamp();
    sendLog(interaction.guild, "tickets", embed);
    await sendTicketTranscript(interaction.channel, interaction.user.tag);
    setTimeout(() => {
      interaction.channel.delete().catch(() => {});
    }, 1000);
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

  } catch (e) {
    console.error("[InteractionError]", e && e.message ? e.message : e);
    try {
      await interaction.reply({ content: "Erreur interne. Detail: " + (e && e.message ? e.message : e), ephemeral: true });
    } catch (_) {}
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
        const participants = reaction && reaction.count > 1 ? reaction.count - 1 : 0;
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
        if (gw._lastEdited !== timeStr) {
          await msg.edit({ embeds: [gwEmbed] }).catch(() => {});
          gw._lastEdited = timeStr;
        }
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
}, 10000);

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

