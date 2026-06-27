// ═══════════════════════════════════════════════════════
// 🤖 REZE BLOX YT NOTIFICATION BOT - V2.1 FIXED
// 🛠️ Developed by chill_guy_rblx
// 🚀 Optimized to avoid YouTube rate limits (429 errors)
// ═══════════════════════════════════════════════════════

require('dotenv').config();
const { 
  Client, 
  GatewayIntentBits, 
  EmbedBuilder, 
  REST, 
  Routes, 
  SlashCommandBuilder,
  ActivityType
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
// 🤖 DISCORD CLIENT
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 GLOBAL STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const postedVideos = new Set();
const durationCache = new Map();        // Persistent duration cache
const videoCache = new Map();           // Cache of recent videos (5min TTL)
let videoCacheTime = 0;
let isFirstRun = true;
const botStartTime = Date.now();

const VIDEO_CACHE_TTL = 60 * 1000;      // Cache videos for 1 minute

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMANDS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const commands = [
  new SlashCommandBuilder()
    .setName('latest')
    .setDescription('🎬 Show the latest regular video from the channel'),
  new SlashCommandBuilder()
    .setName('latestshort')
    .setDescription('⚡ Show the latest short from the channel'),
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
    .setDescription('🔔 Get the link to subscribe'),
].map(cmd => cmd.toJSON());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎬 YOUTUBE API - OPTIMIZED (FEWER CALLS!)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Sleep helper for delays
 */
function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * 🚀 BATCH FETCH: Get durations for MULTIPLE videos in ONE API call
 * This is the key optimization - instead of 10 API calls, we make 1
 */
async function batchFetchDurations(videoIds) {
  // Filter out videos we already have cached
  const needToFetch = videoIds.filter(id => !durationCache.has(id));
  
  if (needToFetch.length === 0) {
    // All cached, return from cache
    return videoIds.reduce((acc, id) => {
      acc[id] = durationCache.get(id);
      return acc;
    }, {});
  }

  try {
    // YouTube API supports comma-separated IDs (up to 50 at once!)
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: needToFetch.join(','),  // 🚀 ALL videos in ONE call
        part: 'contentDetails'
      },
      timeout: 15000
    });

    // Parse durations and cache them
    for (const item of (res.data.items || [])) {
      const duration = item.contentDetails?.duration || '';
      const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
      const hours = parseInt(match?.[1] || 0);
      const minutes = parseInt(match?.[2] || 0);
      const seconds = parseInt(match?.[3] || 0);
      const totalSeconds = hours * 3600 + minutes * 60 + seconds;
      durationCache.set(item.id, totalSeconds);
    }
  } catch (error) {
    console.error(`⚠️ Batch duration fetch failed:`, error.message);
  }

  // Return all requested durations (from cache after batch fetch)
  return videoIds.reduce((acc, id) => {
    acc[id] = durationCache.get(id) || 999;
    return acc;
  }, {});
}

/**
 * Smart Short detection
 */
function isShortVideo(title, durationSec) {
  const titleLower = (title || '').toLowerCase();
  const shortKeywords = ['#short', '#shorts', '#ytshort', '#ytshorts'];
  const hasShortTag = shortKeywords.some(tag => titleLower.includes(tag));
  const isShortDuration = durationSec > 0 && durationSec <= 65;
  return hasShortTag || isShortDuration;
}

/**
 * Fetch latest videos (with 1-minute cache to avoid spam)
 */
async function fetchLatestVideos(force = false) {
  const now = Date.now();
  
  // Use cache if fresh (saves API calls!)
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
    
    // Cache the videos
    videoCache.clear();
    for (const v of videos) {
      videoCache.set(v.id.videoId, v);
    }
    videoCacheTime = now;
    
    return videos;
  } catch (error) {
    console.error('⚠️ Fetch videos failed:', error.message);
    // Return cached videos if available, even if expired
    if (videoCache.size > 0) {
      return Array.from(videoCache.values());
    }
    throw error;
  }
}

/**
 * Fetch channel info (cached)
 */
let channelInfoCache = null;
let channelInfoCacheTime = 0;

async function fetchChannelInfo() {
  const now = Date.now();
  
  // Cache channel info for 5 minutes
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

/**
 * Create video embed
 */
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
    .setFooter({ 
      text: isShort ? 'Reze Blox YT • Latest Short' : 'Reze Blox YT • Latest Video' 
    })
    .setTimestamp();
}

/**
 * Find latest video or short (uses batch API!)
 */
async function findLatestByType(wantShort) {
  const videos = await fetchLatestVideos();
  if (videos.length === 0) return null;

  // BATCH fetch all durations in ONE call (saves 9 API calls!)
  const videoIds = videos.map(v => v.id.videoId);
  const durations = await batchFetchDurations(videoIds);

  // Find first matching video
  for (const v of videos) {
    const dur = durations[v.id.videoId] || 999;
    const isShort = isShortVideo(v.snippet.title, dur);
    if (isShort === wantShort) {
      return v;
    }
  }
  return null;
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 MAIN YOUTUBE CHECK LOOP (AUTO-PINGS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkYouTube() {
  try {
    const videos = await fetchLatestVideos(true); // Force fresh fetch
    if (!videos || videos.length === 0) return;

    // First run: memorize, don't ping
    if (isFirstRun) {
      isFirstRun = false;
      for (const v of videos) {
        postedVideos.add(v.id.videoId);
      }
      console.log(`✅ First run done - ${postedVideos.size} videos memorized (no pings)`);
      return;
    }

    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return console.log('❌ Discord channel not found');

    const rolePing = `<@&${process.env.ROLE_ID}>`;
    
    // Find any NEW videos
    const newVideos = videos.filter(v => !postedVideos.has(v.id.videoId));
    if (newVideos.length === 0) return;

    // BATCH fetch durations for all new videos in ONE call
    const newVideoIds = newVideos.map(v => v.id.videoId);
    const durations = await batchFetchDurations(newVideoIds);

    // Post oldest-first
    for (const video of newVideos.reverse()) {
      const videoId = video.id.videoId;
      postedVideos.add(videoId); // Mark immediately

      const title = video.snippet.title;
      const duration = durations[videoId] || 999;
      const isShort = isShortVideo(title, duration);

      const embed = createVideoEmbed(video, isShort);

      try {
        const message = await channel.send({
          content: `${rolePing} ${isShort ? '🩳 **NEW SHORT UPLOADED!**' : '🎥 **NEW VIDEO UPLOADED!**'}`,
          embeds: [embed]
        });

        // Auto-react for hype ✨
        try {
          await message.react('🎉');
          await sleep(500);
          await message.react('🔔');
        } catch (e) {}

        console.log(`✅ ${isShort ? 'SHORT' : 'VIDEO'} notification sent: "${title}"`);
        
        // Small delay between multiple posts
        await sleep(1500);
      } catch (sendErr) {
        console.error(`❌ Failed to send notification:`, sendErr.message);
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
// 🎮 SLASH COMMAND HANDLERS (NO PINGS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const cmd = interaction.commandName;

  try {
    // ━━━ /ping ━━━
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
          { name: '💾 Duration Cache', value: `${durationCache.size}`, inline: true },
          { name: '🔄 Check Every', value: '5 minutes', inline: true }
        )
        .setFooter({ text: 'Bot is alive and watching for uploads!' })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }

    // ━━━ /help ━━━
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

    // ━━━ /channel ━━━
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
          { name: '🎥 Total Videos', value: Number(ch.statistics.videoCount).toLocaleString(), inline: true },
          { name: '👁️ Total Views', value: Number(ch.statistics.viewCount).toLocaleString(), inline: true }
        )
        .setFooter({ text: 'YouTube Channel Statistics' })
        .setTimestamp();

      return await interaction.editReply({ embeds: [embed] });
    }

    // ━━━ /subscribe ━━━
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

    // ━━━ /latest (NO PING) ━━━
    if (cmd === 'latest') {
      await interaction.deferReply();
      const video = await findLatestByType(false);
      
      if (!video) {
        return await interaction.editReply('❌ No regular videos found!');
      }

      const embed = createVideoEmbed(video, false);
      return await interaction.editReply({ 
        content: '🎥 **Latest Video:**', 
        embeds: [embed] 
      });
    }

    // ━━━ /latestshort (NO PING) ━━━
    if (cmd === 'latestshort') {
      await interaction.deferReply();
      const video = await findLatestByType(true);
      
      if (!video) {
        return await interaction.editReply('❌ No shorts found!');
      }

      const embed = createVideoEmbed(video, true);
      return await interaction.editReply({ 
        content: '🩳 **Latest Short:**', 
        embeds: [embed] 
      });
    }

  } catch (error) {
    console.error(`❌ Command error (${cmd}):`, error.message);
    
    let errorMsg = '❌ Something went wrong. Try again in a minute!';
    if (error.response?.status === 429) {
      errorMsg = '⚠️ Too many requests! Please wait a minute and try again.';
    } else if (error.response?.status === 403) {
      errorMsg = '❌ YouTube API issue. Try again later.';
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
  console.log(`📺 Channel: ${process.env.YOUTUBE_CHANNEL_ID}`);
  console.log(`💬 Notify: ${process.env.DISCORD_CHANNEL_ID}`);
  console.log(`🔔 Role: ${process.env.ROLE_ID}`);
  console.log('═══════════════════════════════════════');

  // Set status
  client.user.setPresence({
    activities: [{ name: 'Reze Blox YT 📺', type: ActivityType.Watching }],
    status: 'online'
  });

  // Register commands
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log(`✅ ${commands.length} slash commands registered`);
  } catch (e) {
    console.error('❌ Command registration failed:', e.message);
  }

  // Wait a bit before first check (avoid hitting limits at startup)
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
