// ═══════════════════════════════════════════════════════
// 🤖 REZE BLOX YT BOT — V3.0 (DM RELAY EDITION)
// 🛠️ Developed by chill_guy_rblx
// 🔒 Includes private DM relay system (owner-only)
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
  Partials
} = require('discord.js');
const axios = require('axios');
const express = require('express');

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🌐 KEEP-ALIVE WEB SERVER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const app = express();
app.get('/', (req, res) => res.send('🟢 Bot is alive!'));
app.listen(process.env.PORT || 3000, () => 
  console.log('✅ Web server running')
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🤖 DISCORD CLIENT (with DM intents for relay)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.DirectMessages,
    GatewayIntentBits.MessageContent
  ],
  partials: [Partials.Channel, Partials.Message]
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 GLOBAL STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const OWNER_ID = process.env.OWNER_ID;
const GUILD_ID = process.env.GUILD_ID;

const postedVideos = new Set();
const durationCache = new Map();
const videoCache = new Map();
let videoCacheTime = 0;
let isFirstRun = true;
const botStartTime = Date.now();
const VIDEO_CACHE_TTL = 60 * 1000;

// 📩 DM RELAY SYSTEM STATE
const dmWhitelist = new Set();           // User IDs you've messaged
const dmHistory = new Map();             // userId → array of message objects
const dmBlocked = new Set();             // User IDs blocked from forwarding
let lastDmTarget = null;                 // Last user you DM'd (for quick reply)

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 PUBLIC SLASH COMMANDS (everyone sees)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const publicCommands = [
  new SlashCommandBuilder()
    .setName('latest')
    .setDescription('🎬 Show the latest regular video'),
  new SlashCommandBuilder()
    .setName('latestshort')
    .setDescription('⚡ Show the latest short'),
  new SlashCommandBuilder()
    .setName('ping')
    .setDescription('🏓 Check if the bot is alive'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('📋 Show all available commands'),
  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('📺 Show YouTube channel stats'),
  new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('🔔 Get the subscribe link'),
].map(cmd => cmd.toJSON());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔒 SECRET DM COMMANDS (only YOU see/use)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const secretCommands = [
  new SlashCommandBuilder()
    .setName('dm')
    .setDescription('🔒 Send a DM to a user as the bot')
    .addUserOption(o => o.setName('user').setDescription('User to message').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Message to send').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('reply')
    .setDescription('🔒 Reply to a user via the bot')
    .addUserOption(o => o.setName('user').setDescription('User to reply to').setRequired(true))
    .addStringOption(o => o.setName('message').setDescription('Reply message').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('dm-list')
    .setDescription('🔒 Show all users in your DM whitelist'),
  
  new SlashCommandBuilder()
    .setName('dm-history')
    .setDescription('🔒 Show your conversation history with a user')
    .addUserOption(o => o.setName('user').setDescription('User to view history with').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('dm-clear')
    .setDescription('🔒 Clear conversation history with a user')
    .addUserOption(o => o.setName('user').setDescription('User to clear history').setRequired(true)),
  
  new SlashCommandBuilder()
    .setName('dm-block')
    .setDescription('🔒 Block/unblock user from forwarding replies')
    .addUserOption(o => o.setName('user').setDescription('User to block/unblock').setRequired(true)),
].map(cmd => cmd.toJSON());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎬 YOUTUBE HELPERS (same as V2.1 - kept perfect)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function batchFetchDurations(videoIds) {
  const needToFetch = videoIds.filter(id => !durationCache.has(id));
  if (needToFetch.length === 0) {
    return videoIds.reduce((acc, id) => {
      acc[id] = durationCache.get(id);
      return acc;
    }, {});
  }

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: needToFetch.join(','),
        part: 'contentDetails'
      },
      timeout: 15000
    });

    for (const item of (res.data.items || [])) {
      const duration = item.contentDetails?.duration || '';
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const hours = parseInt(match?.[1] || 0);
      const minutes = parseInt(match?.[2] || 0);
      const seconds = parseInt(match?.[3] || 0);
      durationCache.set(item.id, hours * 3600 + minutes * 60 + seconds);
    }
  } catch (error) {
    console.error('⚠️ Batch duration fetch failed:', error.message);
  }

  return videoIds.reduce((acc, id) => {
    acc[id] = durationCache.get(id) || 999;
    return acc;
  }, {});
}

function isShortVideo(title, durationSec) {
  const titleLower = (title || '').toLowerCase();
  const shortKeywords = ['#short', '#shorts', '#ytshort', '#ytshorts'];
  const hasShortTag = shortKeywords.some(tag => titleLower.includes(tag));
  const isShortDuration = durationSec > 0 && durationSec <= 65;
  return hasShortTag || isShortDuration;
}

async function fetchLatestVideos(force = false) {
  const now = Date.now();
  if (!force && videoCache.size > 0 && (now - videoCacheTime) < VIDEO_CACHE_TTL) {
    return Array.from(videoCache.values());
  }

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        channelId: process.env.YOUTUBE_CHANNEL_ID,
        part: 'snippet',
        order: 'date',
        maxResults: 10,
        type: 'video'
      },
      timeout: 15000
    });

    const videos = res.data.items || [];
    videoCache.clear();
    for (const v of videos) {
      videoCache.set(v.id.videoId, v);
    }
    videoCacheTime = now;
    return videos;
  } catch (error) {
    console.error('⚠️ Fetch videos failed:', error.message);
    if (videoCache.size > 0) return Array.from(videoCache.values());
    throw error;
  }
}

let channelInfoCache = null;
let channelInfoCacheTime = 0;

async function fetchChannelInfo() {
  const now = Date.now();
  if (channelInfoCache && (now - channelInfoCacheTime) < 5 * 60 * 1000) {
    return channelInfoCache;
  }
  const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: {
      key: process.env.YOUTUBE_API_KEY,
      id: process.env.YOUTUBE_CHANNEL_ID,
      part: 'snippet,statistics'
    },
    timeout: 15000
  });
  channelInfoCache = res.data.items[0];
  channelInfoCacheTime = now;
  return channelInfoCache;
}

function createVideoEmbed(video, isShort) {
  const videoId = video.id.videoId;
  const title = video.snippet.title;
  const thumbnail = video.snippet.thumbnails.high.url;
  const publishedAt = new Date(video.snippet.publishedAt).toLocaleString();
  const url = isShort 
    ? `https://www.youtube.com/shorts/${videoId}` 
    : `https://www.youtube.com/watch?v=${videoId}`;
  
  return new EmbedBuilder()
    .setTitle(`${isShort ? '⚡' : '🎬'} ${title}`)
    .setURL(url)
    .setColor(isShort ? 0x00ff99 : 0xff0000)
    .setImage(thumbnail)
    .addFields(
      { name: '📅 Posted', value: publishedAt, inline: true },
      { name: '▶️ Watch', value: `[Click Here](${url})`, inline: true }
    )
    .setFooter({ text: isShort ? 'Reze Blox YT • Latest Short' : 'Reze Blox YT • Latest Video' })
    .setTimestamp();
}

async function findLatestByType(wantShort) {
  const videos = await fetchLatestVideos();
  if (videos.length === 0) return null;
  const videoIds = videos.map(v => v.id.videoId);
  const durations = await batchFetchDurations(videoIds);
  for (const v of videos) {
    const dur = durations[v.id.videoId] || 999;
    const isShort = isShortVideo(v.snippet.title, dur);
    if (isShort === wantShort) return v;
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 MAIN YOUTUBE CHECK LOOP (AUTO-PINGS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
    if (!channel) return console.log('❌ Discord channel not found');

    const rolePing = `<@&${process.env.ROLE_ID}>`;
    const newVideos = videos.filter(v => !postedVideos.has(v.id.videoId));
    if (newVideos.length === 0) return;

    const newVideoIds = newVideos.map(v => v.id.videoId);
    const durations = await batchFetchDurations(newVideoIds);

    for (const video of newVideos.reverse()) {
      const videoId = video.id.videoId;
      postedVideos.add(videoId);

      const title = video.snippet.title;
      const duration = durations[videoId] || 999;
      const isShort = isShortVideo(title, duration);
      const embed = createVideoEmbed(video, isShort);

      try {
        const message = await channel.send({
          content: `${rolePing} ${isShort ? '🩳 **NEW SHORT UPLOADED!**' : '🎥 **NEW VIDEO UPLOADED!**'}`,
          embeds: [embed]
        });

        try {
          await message.react('🎉');
          await sleep(500);
          await message.react('🔔');
        } catch (e) {}

        console.log(`✅ ${isShort ? 'SHORT' : 'VIDEO'} notification sent: "${title}"`);
        await sleep(1500);
      } catch (sendErr) {
        console.error('❌ Failed to send notification:', sendErr.message);
      }
    }
  } catch (error) {
    if (error.response?.status === 429) {
      console.error('⚠️ Rate limited (429) - will retry next interval');
    } else {
      console.error('❌ YouTube check error:', error.message);
    }
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📩 DM RELAY HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Create a beautiful DM embed (Royal Guard style)
 */
function createDmEmbed(message, isReply = false) {
  return new EmbedBuilder()
    .setAuthor({ 
      name: 'Reze Blox YT',
      iconURL: client.user?.displayAvatarURL()
    })
    .setTitle(isReply ? '💬 Reply' : '📩 New Message')
    .setDescription(message)
    .setColor(0x5865f2)
    .setTimestamp()
    .setFooter({ text: 'Sent via Reze Blox YT Bot' });
}

/**
 * Save message to history
 */
function saveToHistory(userId, direction, content) {
  if (!dmHistory.has(userId)) {
    dmHistory.set(userId, []);
  }
  const history = dmHistory.get(userId);
  history.push({
    direction,        // 'sent' or 'received'
    content,
    timestamp: Date.now()
  });
  // Keep only last 50 messages per user (memory management)
  if (history.length > 50) {
    history.shift();
  }
}

/**
 * Send a DM to a user as the bot
 */
async function sendDM(userId, message, isReply = false) {
  const user = await client.users.fetch(userId);
  const embed = createDmEmbed(message, isReply);
  return await user.send({ embeds: [embed] });
}

/**
 * Forward a reply to the owner
 */
async function forwardReplyToOwner(fromUser, messageContent) {
  try {
    const owner = await client.users.fetch(OWNER_ID);
    
    const embed = new EmbedBuilder()
      .setAuthor({ 
        name: `${fromUser.tag}`, 
        iconURL: fromUser.displayAvatarURL() 
      })
      .setTitle('📩 NEW REPLY')
      .setColor(0x00ff00)
      .addFields(
        { name: '👤 From', value: `<@${fromUser.id}>`, inline: true },
        { name: '🆔 User ID', value: fromUser.id, inline: true },
        { name: '⏰ Time', value: `<t:${Math.floor(Date.now()/1000)}:R>`, inline: true },
        { name: '📝 Message', value: messageContent.substring(0, 1024) || '*(empty)*', inline: false }
      )
      .setFooter({ text: `Use /reply @user to respond, or just DM the bot back` })
      .setTimestamp();
    
    await owner.send({ embeds: [embed] });
    lastDmTarget = fromUser.id;
  } catch (e) {
    console.error('❌ Failed to forward to owner:', e.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 💬 MESSAGE EVENT — Listen for DMs to the bot
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('messageCreate', async (message) => {
  // Ignore bot messages
  if (message.author.bot) return;
  
  // Only care about DMs
  if (message.guild) return;
  
  const userId = message.author.id;
  const content = message.content || '*(no text)*';
  
  // ━━━ CASE 1: Owner is DMing the bot ━━━
  // Auto-forward to the last person they messaged
  if (userId === OWNER_ID) {
    if (!lastDmTarget) {
      return message.reply('❌ No recent DM target. Use `/dm @user message` first to start a conversation.');
    }
    
    try {
      await sendDM(lastDmTarget, content, true);
      saveToHistory(lastDmTarget, 'sent', content);
      await message.react('✅');
    } catch (e) {
      await message.reply(`❌ Failed to send: ${e.message}`);
    }
    return;
  }
  
  // ━━━ CASE 2: Non-owner DMing the bot ━━━
  // Check if user is in whitelist (you've messaged them before)
  if (!dmWhitelist.has(userId)) {
    // Send auto-reply (non-whitelisted)
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
    } catch (e) {}
    return;
  }
  
  // Check if blocked
  if (dmBlocked.has(userId)) return;
  
  // Forward to owner!
  await forwardReplyToOwner(message.author, content);
  saveToHistory(userId, 'received', content);
  
  // React to confirm we received it
  try { await message.react('📨'); } catch (e) {}
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMAND HANDLER
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const cmd = interaction.commandName;
  const isSecretCmd = ['dm', 'reply', 'dm-list', 'dm-history', 'dm-clear', 'dm-block'].includes(cmd);
  
  // 🔒 SECURITY: Block non-owners from secret commands
  if (isSecretCmd && interaction.user.id !== OWNER_ID) {
    return interaction.reply({ content: '❌ Unknown command.', ephemeral: true }).catch(() => {});
  }

  try {
    // ═══════════════════════════════════════════════
    // 🔒 SECRET DM COMMANDS
    // ═══════════════════════════════════════════════
    
    if (cmd === 'dm') {
      const user = interaction.options.getUser('user');
      const message = interaction.options.getString('message');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        await sendDM(user.id, message, false);
        dmWhitelist.add(user.id);
        saveToHistory(user.id, 'sent', message);
        lastDmTarget = user.id;
        
        const confirmEmbed = new EmbedBuilder()
          .setTitle('✅ DM Sent')
          .setColor(0x00ff00)
          .addFields(
            { name: '👤 To', value: `${user.tag} (\`${user.id}\`)`, inline: false },
            { name: '📝 Message', value: message.substring(0, 1024), inline: false }
          )
          .setFooter({ text: 'They\'re now whitelisted - replies will forward to you' })
          .setTimestamp();
        
        await interaction.editReply({ embeds: [confirmEmbed] });
      } catch (e) {
        await interaction.editReply(`❌ Failed to DM: ${e.message}\n*(They may have DMs disabled)*`);
      }
      return;
    }
    
    if (cmd === 'reply') {
      const user = interaction.options.getUser('user');
      const message = interaction.options.getString('message');
      
      await interaction.deferReply({ ephemeral: true });
      
      try {
        await sendDM(user.id, message, true);
        dmWhitelist.add(user.id);
        saveToHistory(user.id, 'sent', message);
        lastDmTarget = user.id;
        
        await interaction.editReply({
          embeds: [new EmbedBuilder()
            .setTitle('✅ Reply Sent')
            .setColor(0x00ff00)
            .setDescription(`Replied to ${user.tag}`)
            .addFields({ name: '📝 Message', value: message.substring(0, 1024) })
          ]
        });
      } catch (e) {
        await interaction.editReply(`❌ Failed: ${e.message}`);
      }
      return;
    }
    
    if (cmd === 'dm-list') {
      if (dmWhitelist.size === 0) {
        return interaction.reply({ content: '📭 Your DM whitelist is empty.', ephemeral: true });
      }
      
      const users = await Promise.all(
        Array.from(dmWhitelist).map(async (id) => {
          try {
            const u = await client.users.fetch(id);
            const blocked = dmBlocked.has(id) ? ' 🚫' : '';
            const msgCount = dmHistory.get(id)?.length || 0;
            return `• ${u.tag} (\`${id}\`) — ${msgCount} messages${blocked}`;
          } catch (e) {
            return `• Unknown (\`${id}\`)`;
          }
        })
      );
      
      const embed = new EmbedBuilder()
        .setTitle('📋 DM Whitelist')
        .setDescription(users.join('\n'))
        .setColor(0x5865f2)
        .setFooter({ text: `Total: ${dmWhitelist.size} users | 🚫 = blocked` });
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    if (cmd === 'dm-history') {
      const user = interaction.options.getUser('user');
      const history = dmHistory.get(user.id);
      
      if (!history || history.length === 0) {
        return interaction.reply({ content: `📭 No history with ${user.tag}`, ephemeral: true });
      }
      
      const messages = history.slice(-20).map(msg => {
        const arrow = msg.direction === 'sent' ? '➡️ You' : '⬅️ Them';
        const time = `<t:${Math.floor(msg.timestamp/1000)}:t>`;
        return `${arrow} ${time}\n\`${msg.content.substring(0, 200)}\``;
      }).join('\n\n');
      
      const embed = new EmbedBuilder()
        .setTitle(`💬 History with ${user.tag}`)
        .setDescription(messages.substring(0, 4000))
        .setColor(0x5865f2)
        .setFooter({ text: `Showing last ${Math.min(20, history.length)} of ${history.length} messages` });
      
      await interaction.reply({ embeds: [embed], ephemeral: true });
      return;
    }
    
    if (cmd === 'dm-clear') {
      const user = interaction.options.getUser('user');
      dmHistory.delete(user.id);
      
      await interaction.reply({ 
        content: `✅ Cleared conversation history with ${user.tag}`, 
        ephemeral: true 
      });
      return;
    }
    
    if (cmd === 'dm-block') {
      const user = interaction.options.getUser('user');
      
      if (dmBlocked.has(user.id)) {
        dmBlocked.delete(user.id);
        await interaction.reply({ 
          content: `✅ Unblocked ${user.tag} - their replies will forward again`, 
          ephemeral: true 
        });
      } else {
        dmBlocked.add(user.id);
        await interaction.reply({ 
          content: `🚫 Blocked ${user.tag} - their replies won't forward`, 
          ephemeral: true 
        });
      }
      return;
    }

    // ═══════════════════════════════════════════════
    // 🌍 PUBLIC COMMANDS
    // ═══════════════════════════════════════════════
    
    if (cmd === 'ping') {
      const uptime = Math.floor((Date.now() - botStartTime) / 1000);
      const hours = Math.floor(uptime / 3600);
      const minutes = Math.floor((uptime % 3600) / 60);
      const seconds = uptime % 60;

      const embed = new EmbedBuilder()
        .setTitle('🏓 Pong!')
        .setColor(0x00ff00)
        .addFields(
          { name: '⚡ Latency', value: `${client.ws.ping}ms`, inline: true },
          { name: '⏰ Uptime', value: `${hours}h ${minutes}m ${seconds}s`, inline: true },
          { name: '✅ Status', value: 'Online & Watching', inline: true },
          { name: '📺 Videos Tracked', value: `${postedVideos.size}`, inline: true },
          { name: '💾 Cache', value: `${durationCache.size}`, inline: true },
          { name: '🔄 Check Every', value: '5 minutes', inline: true }
        )
        .setFooter({ text: 'Bot is alive and watching for uploads!' })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'help') {
      const embed = new EmbedBuilder()
        .setTitle('📋 Bot Commands Menu')
        .setDescription('Here are all the commands you can use:\n\u200b')
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
        .setColor(0xff0000)
        .setThumbnail(ch.snippet.thumbnails.high.url)
        .addFields(
          { name: '👥 Subscribers', value: Number(ch.statistics.subscriberCount).toLocaleString(), inline: true },
          { name: '🎥 Videos', value: Number(ch.statistics.videoCount).toLocaleString(), inline: true },
          { name: '👁️ Views', value: Number(ch.statistics.viewCount).toLocaleString(), inline: true }
        )
        .setFooter({ text: 'YouTube Channel Statistics' })
        .setTimestamp();
      return await interaction.editReply({ embeds: [embed] });
    }

    if (cmd === 'subscribe') {
      const subUrl = `https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}?sub_confirmation=1`;
      const embed = new EmbedBuilder()
        .setTitle('🔔 Subscribe to the channel!')
        .setURL(subUrl)
        .setDescription(
          '👆 **Click the title to subscribe!**\n\n' +
          'Don\'t forget to hit the 🔔 bell so you never miss an upload!\n\n' +
          '✨ Thanks for the support!'
        )
        .setColor(0xff0000)
        .setFooter({ text: 'Smash that subscribe button!' });
      return await interaction.reply({ embeds: [embed] });
    }

    if (cmd === 'latest') {
      await interaction.deferReply();
      const video = await findLatestByType(false);
      if (!video) return await interaction.editReply('❌ No regular videos found!');
      const embed = createVideoEmbed(video, false);
      return await interaction.editReply({ content: '🎥 **Latest Video:**', embeds: [embed] });
    }

    if (cmd === 'latestshort') {
      await interaction.deferReply();
      const video = await findLatestByType(true);
      if (!video) return await interaction.editReply('❌ No shorts found!');
      const embed = createVideoEmbed(video, true);
      return await interaction.editReply({ content: '🩳 **Latest Short:**', embeds: [embed] });
    }

  } catch (error) {
    console.error(`❌ Command error (${cmd}):`, error.message);
    
    let errorMsg = '❌ Something went wrong. Try again!';
    if (error.response?.status === 429) {
      errorMsg = '⚠️ Too many requests! Wait a minute.';
    }

    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply(errorMsg);
      } else {
        await interaction.reply({ content: errorMsg, ephemeral: true });
      }
    } catch (e) {}
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 STARTUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.once('ready', async () => {
  console.log('═══════════════════════════════════════');
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`👑 Owner ID: ${OWNER_ID}`);
  console.log(`📺 YT Channel: ${process.env.YOUTUBE_CHANNEL_ID}`);
  console.log(`💬 Notify Channel: ${process.env.DISCORD_CHANNEL_ID}`);
  console.log(`🔔 Role: ${process.env.ROLE_ID}`);
  console.log('═══════════════════════════════════════');

  client.user.setPresence({
    activities: [{ name: 'Reze Blox YT 📺', type: ActivityType.Watching }],
    status: 'online'
  });

  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    
    // Public commands → registered globally
    await rest.put(Routes.applicationCommands(client.user.id), { body: publicCommands });
    console.log(`✅ ${publicCommands.length} public commands registered globally`);
    
    // Secret commands → registered ONLY in your guild
    if (GUILD_ID) {
      await rest.put(Routes.applicationGuildCommands(client.user.id, GUILD_ID), {
        body: [...publicCommands, ...secretCommands]
      });
      console.log(`✅ ${secretCommands.length} secret commands registered in guild ${GUILD_ID}`);
    }
  } catch (e) {
    console.error('❌ Command registration failed:', e.message);
  }

  console.log('⏳ Waiting 10s before first YouTube check...');
  await sleep(10000);
  await checkYouTube();
  setInterval(checkYouTube, 5 * 60 * 1000);
  console.log('🟢 Bot fully operational');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🛡️ ERROR HANDLERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('error', (e) => console.error('❌ Client error:', e.message));
process.on('unhandledRejection', (e) => console.error('❌ Unhandled:', e.message));
process.on('uncaughtException', (e) => console.error('❌ Uncaught:', e.message));

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔐 LOGIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.login(process.env.DISCORD_TOKEN);
