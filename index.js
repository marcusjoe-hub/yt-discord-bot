// ═══════════════════════════════════════════════════════
// 🤖 REZE BLOX YT BOT — V4.1 (OWNER-TO-OWNER ENABLED)
// 🛠️ Developed by chill_guy_rblx
// 🔒 Separate DM systems for each owner
// 📩 Text file history exports
// ⚠️ Owners can DM each other (with warning)
// ═══════════════════════════════════════════════════════

require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  ActivityType,
  Partials,
  AttachmentBuilder,
  MessageFlags
} = require('discord.js');
const axios = require('axios');
const express = require('express');

const app = express();
app.get('/', (req, res) => res.send('🟢 Bot is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web server running'));

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔒 OWNER CONFIG
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OWNER_ID = process.env.OWNER_ID;
const OWNER2_ID = process.env.OWNER2_ID;
const GUILD_ID = process.env.GUILD_ID;
const OWNERS = [OWNER_ID, OWNER2_ID].filter(Boolean);

function isOwner(userId) {
  return OWNERS.includes(userId);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 YOUTUBE STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const postedVideos = new Set();
const durationCache = new Map();
const videoCache = new Map();
let videoCacheTime = 0;
let isFirstRun = true;
const botStartTime = Date.now();
const VIDEO_CACHE_TTL = 60 * 1000;

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📩 DM RELAY — SEPARATE per owner
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const ownerData = new Map();

function getOwnerData(ownerId) {
  if (!ownerData.has(ownerId)) {
    ownerData.set(ownerId, {
      whitelist: new Set(),
      history: new Map(),
      blocked: new Set(),
      activeTarget: null
    });
  }
  return ownerData.get(ownerId);
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const publicCommands = [
  new SlashCommandBuilder().setName('latest').setDescription('🎬 Show the latest regular video'),
  new SlashCommandBuilder().setName('latestshort').setDescription('⚡ Show the latest short'),
  new SlashCommandBuilder().setName('ping').setDescription('🏓 Check if the bot is alive'),
  new SlashCommandBuilder().setName('help').setDescription('📋 Show all available commands'),
  new SlashCommandBuilder().setName('channel').setDescription('📺 Show YouTube channel stats'),
  new SlashCommandBuilder().setName('subscribe').setDescription('🔔 Get the subscribe link'),
].map(cmd => cmd.toJSON());

const secretCommands = [
  new SlashCommandBuilder().setName('dm')
    .setDescription('🔒 Send a DM to a user as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to message').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),
  
  new SlashCommandBuilder().setName('reply')
    .setDescription('🔒 Reply to a user via the bot')
    .addUserOption(o => o.setName('user').setDescription('User to reply to').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Reply message').setRequired(true)),
  
  new SlashCommandBuilder().setName('dm-target')
    .setDescription('🔒 Set who your DM replies forward to')
    .addUserOption(o => o.setName('user').setDescription('User to chat with').setRequired(true)),
  
  new SlashCommandBuilder().setName('dm-stop')
    .setDescription('🔒 Stop the active reply chain'),
  
  new SlashCommandBuilder().setName('dm-list')
    .setDescription('🔒 Show all users in your DM whitelist'),
  
  new SlashCommandBuilder().setName('dm-history')
    .setDescription('🔒 Get conversation history as text file (sent to your DMs)')
    .addUserOption(o => o.setName('user').setDescription('User to view history').setRequired(true)),
  
  new SlashCommandBuilder().setName('dm-clear')
    .setDescription('🔒 Clear conversation history with a user')
    .addUserOption(o => o.setName('user').setDescription('User to clear history').setRequired(true)),
  
  new SlashCommandBuilder().setName('dm-block')
    .setDescription('🔒 Block/unblock user from forwarding replies')
    .addUserOption(o => o.setName('user').setDescription('User to block/unblock').setRequired(true)),
].map(cmd => cmd.toJSON());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎬 YOUTUBE HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function batchFetchDurations(videoIds) {
  const needToFetch = videoIds.filter(id => !durationCache.has(id));
  if (needToFetch.length === 0) {
    return videoIds.reduce((acc, id) => { acc[id] = durationCache.get(id); return acc; }, {});
  }
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: { key: process.env.YOUTUBE_API_KEY, id: needToFetch.join(','), part: 'contentDetails' },
      timeout: 15000
    });
    for (const item of (res.data.items || [])) {
      const duration = item.contentDetails?.duration || '';
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const h = parseInt(match?.[1] || 0), m = parseInt(match?.[2] || 0), s = parseInt(match?.[3] || 0);
      durationCache.set(item.id, h * 3600 + m * 60 + s);
    }
  } catch (e) { console.error('⚠️ Duration fetch failed:', e.message); }
  return videoIds.reduce((acc, id) => { acc[id] = durationCache.get(id) || 999; return acc; }, {});
}

function isShortVideo(title, dur) {
  const t = (title || '').toLowerCase();
  const tags = ['#short', '#shorts', '#ytshort', '#ytshorts'];
  return tags.some(tag => t.includes(tag)) || (dur > 0 && dur <= 65);
}

async function fetchLatestVideos(force = false) {
  const now = Date.now();
  if (!force && videoCache.size > 0 && (now - videoCacheTime) < VIDEO_CACHE_TTL) {
    return Array.from(videoCache.values());
  }
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: { key: process.env.YOUTUBE_API_KEY, channelId: process.env.YOUTUBE_CHANNEL_ID,
        part: 'snippet', order: 'date', maxResults: 10, type: 'video' },
      timeout: 15000
    });
    const videos = res.data.items || [];
    videoCache.clear();
    for (const v of videos) videoCache.set(v.id.videoId, v);
    videoCacheTime = now;
    return videos;
  } catch (e) {
    console.error('⚠️ Fetch failed:', e.message);
    if (videoCache.size > 0) return Array.from(videoCache.values());
    throw e;
  }
}

let channelInfoCache = null, channelInfoCacheTime = 0;
async function fetchChannelInfo() {
  const now = Date.now();
  if (channelInfoCache && (now - channelInfoCacheTime) < 5 * 60 * 1000) return channelInfoCache;
  const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: { key: process.env.YOUTUBE_API_KEY, id: process.env.YOUTUBE_CHANNEL_ID, part: 'snippet,statistics' },
    timeout: 15000
  });
  channelInfoCache = res.data.items[0];
  channelInfoCacheTime = now;
  return channelInfoCache;
}

function createVideoEmbed(video, isShort) {
  const vid = video.id.videoId, title = video.snippet.title;
  const thumb = video.snippet.thumbnails.high.url;
  const pub = new Date(video.snippet.publishedAt).toLocaleString();
  const url = isShort ? `https://www.youtube.com/shorts/${vid}` : `https://www.youtube.com/watch?v=${vid}`;
  return new EmbedBuilder()
    .setTitle(`${isShort ? '⚡' : '🎬'} ${title}`).setURL(url)
    .setColor(isShort ? 0x00ff99 : 0xff0000).setImage(thumb)
    .addFields(
      { name: '📅 Posted', value: pub, inline: true },
      { name: '▶️ Watch', value: `[Click Here](${url})`, inline: true }
    )
    .setFooter({ text: isShort ? 'Reze Blox YT • Latest Short' : 'Reze Blox YT • Latest Video' })
    .setTimestamp();
}

async function findLatestByType(wantShort) {
  const videos = await fetchLatestVideos();
  if (videos.length === 0) return null;
  const ids = videos.map(v => v.id.videoId);
  const durs = await batchFetchDurations(ids);
  for (const v of videos) {
    const isShort = isShortVideo(v.snippet.title, durs[v.id.videoId] || 999);
    if (isShort === wantShort) return v;
  }
  return null;
}

async function checkYouTube() {
  try {
    const videos = await fetchLatestVideos(true);
    if (!videos || videos.length === 0) return;
    if (isFirstRun) {
      isFirstRun = false;
      for (const v of videos) postedVideos.add(v.id.videoId);
      console.log(`✅ First run done - ${postedVideos.size} videos memorized (no pings)`);
      return;
    }
    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return;
    const rolePing = `<@&${process.env.ROLE_ID}>`;
    const newVideos = videos.filter(v => !postedVideos.has(v.id.videoId));
    if (newVideos.length === 0) return;
    const ids = newVideos.map(v => v.id.videoId);
    const durs = await batchFetchDurations(ids);
    for (const video of newVideos.reverse()) {
      const videoId = video.id.videoId;
      postedVideos.add(videoId);
      const isShort = isShortVideo(video.snippet.title, durs[videoId] || 999);
      const embed = createVideoEmbed(video, isShort);
      try {
        const message = await channel.send({
          content: `${rolePing} ${isShort ? '🩳 **NEW SHORT UPLOADED!**' : '🎥 **NEW VIDEO UPLOADED!**'}`,
          embeds: [embed]
        });
        try { await message.react('🎉'); await sleep(500); await message.react('🔔'); } catch (e) {}
        console.log(`✅ ${isShort ? 'SHORT' : 'VIDEO'} sent: "${video.snippet.title}"`);
        await sleep(1500);
      } catch (e) { console.error('❌ Send failed:', e.message); }
    }
  } catch (e) {
    if (e.response?.status === 429) console.error('⚠️ Rate limited (429)');
    else console.error('❌ YouTube error:', e.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📩 DM HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function createDmEmbed(message, isReply = false) {
  return new EmbedBuilder()
    .setAuthor({ name: 'Reze Blox YT', iconURL: client.user?.displayAvatarURL() })
    .setTitle(isReply ? '💬 Reply' : '📩 New Message')
    .setDescription(message)
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: 'Sent via Reze Blox YT Bot' });
}

function saveToHistory(ownerId, userId, direction, content) {
  const data = getOwnerData(ownerId);
  if (!data.history.has(userId)) data.history.set(userId, []);
  data.history.get(userId).push({
    direction,
    content,
    timestamp: Date.now()
  });
}

async function sendDM(userId, message, isReply = false) {
  const user = await client.users.fetch(userId);
  const embed = createDmEmbed(message, isReply);
  return await user.send({ embeds: [embed] });
}

async function forwardReplyToOwner(ownerId, fromUser, messageContent) {
  try {
    const owner = await client.users.fetch(ownerId);
    const embed = new EmbedBuilder()
      .setAuthor({ name: `${fromUser.tag}`, iconURL: fromUser.displayAvatarURL() })
      .setTitle('📩 NEW REPLY')
      .setColor(0x00ff00)
      .addFields(
        { name: '👤 From', value: `<@${fromUser.id}>`, inline: true },
        { name: '🆔 User ID', value: fromUser.id, inline: true },
        { name: '⏰ Time', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
        { name: '📝 Message', value: messageContent.substring(0, 1024) || '*(empty)*', inline: false }
      )
      .setFooter({ text: `Use /reply @user, or /dm-target then DM the bot` })
      .setTimestamp();
    await owner.send({ embeds: [embed] });
  } catch (e) { console.error('❌ Forward to owner failed:', e.message); }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💬 MESSAGE EVENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('messageCreate', async (message) => {
  if (message.author.bot) return;
  if (message.guild) return;
  
  const userId = message.author.id;
  const content = message.content || '*(no text)*';
  
  // ━━━ CASE 1: OWNER is DM'ing the bot ━━━
  if (isOwner(userId)) {
    const data = getOwnerData(userId);
    
    if (!data.activeTarget) {
      return message.reply('⚠️ No active reply target. Use `/dm-target @user` first, or use `/dm @user message` to start a conversation.').catch(()=>{});
    }
    
    if (data.activeTarget === userId) {
      return message.reply('❌ Can\'t reply to yourself.').catch(()=>{});
    }
    
    try {
      await sendDM(data.activeTarget, content, true);
      saveToHistory(userId, data.activeTarget, 'sent', content);
      await message.react('✅');
    } catch (e) {
      await message.reply(`❌ Failed to send: ${e.message}\n*(They may have DMs disabled)*`).catch(()=>{});
    }
    return;
  }
  
  // ━━━ CASE 2: Non-owner DM'ing the bot ━━━
  let targetOwner = null;
  for (const oid of OWNERS) {
    const data = getOwnerData(oid);
    if (data.whitelist.has(userId)) {
      targetOwner = oid;
      break;
    }
  }
  
  if (!targetOwner) {
    const data = getOwnerData(OWNERS[0]);
    const existing = data.history.get(userId);
    if (existing && existing.some(h => h.direction === 'auto-reply')) return;
    
    try {
      const autoReply = new EmbedBuilder()
        .setTitle('👋 Hello!')
        .setDescription(
          'Hi! This is an automated bot for **Reze Blox YT**.\n\n' +
          'I can\'t respond to messages directly. ' +
          'For support, please join the Discord server!'
        )
        .setColor(0x5865f2)
        .setFooter({ text: 'Automated Response' });
      await message.reply({ embeds: [autoReply] });
      saveToHistory(OWNERS[0], userId, 'auto-reply', '[Auto-reply sent]');
    } catch (e) {}
    return;
  }
  
  const data = getOwnerData(targetOwner);
  if (data.blocked.has(userId)) return;
  
  await forwardReplyToOwner(targetOwner, message.author, content);
  saveToHistory(targetOwner, userId, 'received', content);
  try { await message.react('📨'); } catch (e) {}
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMAND HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  const cmd = interaction.commandName;
  const userId = interaction.user.id;
  const isSecret = ['dm', 'reply', 'dm-list', 'dm-history', 'dm-clear', 'dm-block', 'dm-target', 'dm-stop'].includes(cmd);
  
  if (isSecret && !isOwner(userId)) {
    return interaction.reply({ content: '❌ Unknown command.', flags: MessageFlags.Ephemeral }).catch(() => {});
  }

  try {
    // ━━━━━ /dm (Owner-to-Owner now allowed with warning) ━━━━━
    if (cmd === 'dm') {
      const user = interaction.options.getUser('user');
      const msg = interaction.options.getString('message');
      
      if (user.id === userId) return interaction.reply({ content: '❌ Can\'t DM yourself!', flags: MessageFlags.Ephemeral });
      if (user.bot) return interaction.reply({ content: '❌ Can\'t DM bots!', flags: MessageFlags.Ephemeral });
      
      const isTargetOwner = isOwner(user.id);
      
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await sendDM(user.id, msg, false);
        const data = getOwnerData(userId);
        data.whitelist.add(user.id);
        data.activeTarget = user.id;
        saveToHistory(userId, user.id, 'sent', msg);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ DM Sent').setColor(isTargetOwner ? 0xffaa00 : 0x00ff00)
          .addFields(
            { name: '👤 To', value: `${user.tag} (\`${user.id}\`)`, inline: false },
            { name: '📝 Message', value: msg.substring(0, 1024), inline: false },
            { name: '🎯 Active Target', value: 'Set to this user — just DM the bot to continue', inline: false }
          )
          .setFooter({ text: 'They\'re whitelisted. Their replies will forward to your DMs.' })
          .setTimestamp();
        
        if (isTargetOwner) {
          embed.addFields({ 
            name: '⚠️ WARNING - Owner-to-Owner DM', 
            value: 'You\'re DMing another owner! Their replies forward to you AND yours forward to them — this can cause **infinite loops**.\n\n🛑 **Use `/dm-stop` when done chatting!**', 
            inline: false 
          });
        }
        
        await interaction.editReply({ embeds: [embed] });
      } catch (e) {
        await interaction.editReply(`❌ Failed: ${e.message}\n*(They may have DMs disabled)*`);
      }
      return;
    }
    
    // ━━━━━ /reply (Owner-to-Owner now allowed) ━━━━━
    if (cmd === 'reply') {
      const user = interaction.options.getUser('user');
      const msg = interaction.options.getString('message');
      
      if (user.id === userId) return interaction.reply({ content: '❌ Can\'t reply to yourself!', flags: MessageFlags.Ephemeral });
      if (user.bot) return interaction.reply({ content: '❌ Can\'t reply to bots!', flags: MessageFlags.Ephemeral });
      
      const isTargetOwner = isOwner(user.id);
      
      await interaction.deferReply({ flags: MessageFlags.Ephemeral });
      try {
        await sendDM(user.id, msg, true);
        const data = getOwnerData(userId);
        data.whitelist.add(user.id);
        data.activeTarget = user.id;
        saveToHistory(userId, user.id, 'sent', msg);
        
        const embed = new EmbedBuilder()
          .setTitle('✅ Reply Sent').setColor(isTargetOwner ? 0xffaa00 : 0x00ff00)
          .setDescription(`Replied to ${user.tag}`)
          .addFields({ name: '📝 Message', value: msg.substring(0, 1024) });
        
        if (isTargetOwner) {
          embed.addFields({ 
            name: '⚠️ WARNING - Owner-to-Owner', 
            value: 'You replied to another owner. Use `/dm-stop` when done to avoid loops!', 
            inline: false 
          });
        }
        
        await interaction.editReply({ embeds: [embed] });
      } catch (e) {
        await interaction.editReply(`❌ Failed: ${e.message}`);
      }
      return;
    }
    
    // ━━━━━ /dm-target (Owner-to-Owner now allowed) ━━━━━
    if (cmd === 'dm-target') {
      const user = interaction.options.getUser('user');
      
      if (user.id === userId) return interaction.reply({ content: '❌ Can\'t target yourself!', flags: MessageFlags.Ephemeral });
      if (user.bot) return interaction.reply({ content: '❌ Can\'t target bots!', flags: MessageFlags.Ephemeral });
      
      const isTargetOwner = isOwner(user.id);
      
      const data = getOwnerData(userId);
      data.activeTarget = user.id;
      data.whitelist.add(user.id);
      
      const embed = new EmbedBuilder()
        .setTitle('🎯 Reply Target Set').setColor(isTargetOwner ? 0xffaa00 : 0x00ff00)
        .setDescription(`Now you can just DM the bot and it will forward to **${user.tag}**`)
        .addFields(
          { name: '👤 Target', value: `${user.tag} (\`${user.id}\`)`, inline: false },
          { name: '💡 Tip', value: 'Use `/dm-stop` to end this conversation', inline: false }
        );
      
      if (isTargetOwner) {
        embed.addFields({ 
          name: '⚠️ WARNING - Owner-to-Owner Chat', 
          value: 'This is another owner! Both your messages forward to each other — this can cause **infinite loops** if you both forget to stop.\n\n🛑 **Use `/dm-stop` when done!**', 
          inline: false 
        });
      }
      
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // ━━━━━ /dm-stop ━━━━━
    if (cmd === 'dm-stop') {
      const data = getOwnerData(userId);
      data.activeTarget = null;
      return interaction.reply({ 
        content: '🛑 Active reply target cleared. DMs won\'t forward until you set a new target.', 
        flags: MessageFlags.Ephemeral 
      });
    }
    
    // ━━━━━ /dm-list ━━━━━
    if (cmd === 'dm-list') {
      const data = getOwnerData(userId);
      if (data.whitelist.size === 0) {
        return interaction.reply({ content: '📭 Your DM whitelist is empty.', flags: MessageFlags.Ephemeral });
      }
      const users = await Promise.all(
        Array.from(data.whitelist).map(async (id) => {
          try {
            const u = await client.users.fetch(id);
            const blocked = data.blocked.has(id) ? ' 🚫' : '';
            const active = id === data.activeTarget ? ' 🎯' : '';
            const owner = isOwner(id) ? ' 👑' : '';
            const count = data.history.get(id)?.length || 0;
            return `• ${u.tag} (\`${id}\`) — ${count} msgs${blocked}${active}${owner}`;
          } catch (e) { return `• Unknown (\`${id}\`)`; }
        })
      );
      const embed = new EmbedBuilder()
        .setTitle('📋 Your DM Whitelist').setDescription(users.join('\n'))
        .setColor(0x5865f2)
        .setFooter({ text: `Total: ${data.whitelist.size} | 🎯 = active | 🚫 = blocked | 👑 = owner` });
      return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    }
    
    // ━━━━━ /dm-history (text file → your DMs) ━━━━━
    if (cmd === 'dm-history') {
      const user = interaction.options.getUser('user');
      const data = getOwnerData(userId);
      const history = data.history.get(user.id);
      
      if (!history || history.length === 0) {
        return interaction.reply({ content: `📭 No history with ${user.tag}`, flags: MessageFlags.Ephemeral });
      }
      
      const lines = [
        `═══════════════════════════════════════════════`,
        `📜 DM HISTORY EXPORT`,
        `═══════════════════════════════════════════════`,
        `👤 Conversation with: ${user.tag} (${user.id})`,
        `👑 Owner: ${interaction.user.tag} (${userId})`,
        `📊 Total messages: ${history.length}`,
        `📅 Exported: ${new Date().toLocaleString()}`,
        `═══════════════════════════════════════════════`,
        ``
      ];
      
      for (const msg of history) {
        const time = new Date(msg.timestamp).toLocaleString();
        let prefix = '➡️ YOU';
        if (msg.direction === 'received') prefix = '⬅️ THEM';
        if (msg.direction === 'auto-reply') prefix = '🤖 AUTO-REPLY';
        lines.push(`[${time}] ${prefix}`);
        lines.push(`${msg.content}`);
        lines.push('');
      }
      
      const fileContent = lines.join('\n');
      const buffer = Buffer.from(fileContent, 'utf-8');
      const filename = `dm-history-${user.username}-${Date.now()}.txt`;
      const attachment = new AttachmentBuilder(buffer, { name: filename });
      
      try {
        const ownerUser = await client.users.fetch(userId);
        await ownerUser.send({
          content: `📜 **DM History Export**\nConversation with ${user.tag} — ${history.length} messages`,
          files: [attachment]
        });
        return interaction.reply({
          content: `✅ History sent to your DMs as a text file! (${history.length} messages)`,
          flags: MessageFlags.Ephemeral
        });
      } catch (e) {
        return interaction.reply({
          content: `❌ Couldn't DM you the file. Make sure your DMs are open!\nError: ${e.message}`,
          flags: MessageFlags.Ephemeral
        });
      }
    }
    
    // ━━━━━ /dm-clear ━━━━━
    if (cmd === 'dm-clear') {
      const user = interaction.options.getUser('user');
      const data = getOwnerData(userId);
      data.history.delete(user.id);
      return interaction.reply({ content: `✅ Cleared history with ${user.tag}`, flags: MessageFlags.Ephemeral });
    }
    
    // ━━━━━ /dm-block ━━━━━
    if (cmd === 'dm-block') {
      const user = interaction.options.getUser('user');
      const data = getOwnerData(userId);
      if (data.blocked.has(user.id)) {
        data.blocked.delete(user.id);
        return interaction.reply({ content: `✅ Unblocked ${user.tag}`, flags: MessageFlags.Ephemeral });
      } else {
        data.blocked.add(user.id);
        return interaction.reply({ content: `🚫 Blocked ${user.tag}`, flags: MessageFlags.Ephemeral });
      }
    }

    // ━━━━━ PUBLIC COMMANDS ━━━━━
    if (cmd === 'ping') {
      const up = Math.floor((Date.now() - botStartTime) / 1000);
      const h = Math.floor(up / 3600), m = Math.floor((up % 3600) / 60), s = up % 60;
      const embed = new EmbedBuilder().setTitle('🏓 Pong!').setColor(0x00ff00)
        .addFields(
          { name: '⚡ Latency', value: `${client.ws.ping}ms`, inline: true },
          { name: '⏰ Uptime', value: `${h}h ${m}m ${s}s`, inline: true },
          { name: '✅ Status', value: 'Online & Watching', inline: true },
          { name: '📺 Tracked', value: `${postedVideos.size}`, inline: true },
          { name: '💾 Cache', value: `${durationCache.size}`, inline: true },
          { name: '🔄 Check', value: 'Every 5 min', inline: true }
        ).setFooter({ text: 'Bot is alive!' }).setTimestamp();
      return await interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Bot Commands Menu')
        .setDescription('Here are all available commands:\n\u200b')
        .setColor(0x5865f2)
        .addFields(
          { name: '🎬 `/latest`', value: 'Show the latest regular video', inline: false },
          { name: '⚡ `/latestshort`', value: 'Show the latest short', inline: false },
          { name: '📺 `/channel`', value: 'Show YouTube channel stats', inline: false },
          { name: '🔔 `/subscribe`', value: 'Get the subscribe link', inline: false },
          { name: '🏓 `/ping`', value: 'Check if bot is online', inline: false },
          { name: '📋 `/help`', value: 'Show this menu', inline: false },
        )
        .setFooter({ text: '🚨 Bot auto-pings the role when a new video drops!' })
        .setTimestamp();
      return await interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'channel') {
      await interaction.deferReply();
      const ch = await fetchChannelInfo();
      const embed = new EmbedBuilder()
        .setTitle(`📺 ${ch.snippet.title}`)
        .setURL(`https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}`)
        .setDescription(ch.snippet.description?.substring(0, 200) || 'No description')
        .setColor(0xff0000).setThumbnail(ch.snippet.thumbnails.high.url)
        .addFields(
          { name: '👥 Subscribers', value: Number(ch.statistics.subscriberCount).toLocaleString(), inline: true },
          { name: '🎥 Videos', value: Number(ch.statistics.videoCount).toLocaleString(), inline: true },
          { name: '👁️ Views', value: Number(ch.statistics.viewCount).toLocaleString(), inline: true }
        ).setTimestamp();
      return await interaction.editReply({ embeds: [embed] });
    }

    if (cmd === 'subscribe') {
      const url = `https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}?sub_confirmation=1`;
      const embed = new EmbedBuilder()
        .setTitle('🔔 Subscribe!').setURL(url)
        .setDescription('👆 **Click the title to subscribe!**\n\nHit the 🔔 bell so you never miss an upload!')
        .setColor(0xff0000);
      return await interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'latest') {
      await interaction.deferReply();
      const video = await findLatestByType(false);
      if (!video) return await interaction.editReply('❌ No videos found!');
      return await interaction.editReply({ content: '🎥 **Latest Video:**', embeds: [createVideoEmbed(video, false)] });
    }

    if (cmd === 'latestshort') {
      await interaction.deferReply();
      const video = await findLatestByType(true);
      if (!video) return await interaction.editReply('❌ No shorts found!');
      return await interaction.editReply({ content: '🩳 **Latest Short:**', embeds: [createVideoEmbed(video, true)] });
    }
  } catch (e) {
    console.error(`❌ Command error (${cmd}):`, e.message);
    let msg = '❌ Something went wrong!';
    if (e.response?.status === 429) msg = '⚠️ Too many requests! Wait a minute.';
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(msg);
      else await interaction.reply({ content: msg, flags: MessageFlags.Ephemeral });
    } catch (err) {}
  }
});

client.once('ready', async () => {
  console.log('═══════════════════════════════════════');
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`👑 Owner 1: ${OWNER_ID}`);
  console.log(`👑 Owner 2: ${OWNER2_ID || 'Not configured'}`);
  console.log('═══════════════════════════════════════');

  client.user.setPresence({
    activities: [{ name: 'Reze Blox YT 📺', type: ActivityType.Watching }],
    status: 'online'
  });

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: publicCommands });
    console.log(`✅ ${publicCommands.length} public commands registered globally`);
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
        body: [...publicCommands, ...secretCommands]
      });
      console.log(`✅ ${secretCommands.length} secret commands registered in guild`);
    }
  } catch (e) { console.error('❌ Registration failed:', e.message); }

  console.log('⏳ Waiting 10s before first YouTube check...');
  await sleep(10000);
  await checkYouTube();
  setInterval(checkYouTube, 5 * 60 * 1000);
  console.log('🟢 Bot fully operational');
});

client.on('error', (e) => console.error('❌ Client error:', e.message));
process.on('unhandledRejection', (e) => console.error('❌ Unhandled:', e.message));
process.on('uncaughtException', (e) => console.error('❌ Uncaught:', e.message));

client.login(process.env.DISCORD_TOKEN);
