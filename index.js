// ═══════════════════════════════════════════════════════
// 🤖 REZE BLOX YT NOTIFICATION BOT - V2.0
// 🛠️ Developed by chill_guy_rblx
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
// 🌐 KEEP-ALIVE WEB SERVER (for UptimeRobot)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const app = express();
app.get('/', (req, res) => res.send('🟢 Bot is alive and running!'));
app.listen(process.env.PORT || 3000, () => 
  console.log('✅ Web server running')
);

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🤖 DISCORD CLIENT SETUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 📊 GLOBAL STATE
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
const postedVideos = new Set();         // Tracks all videos we've already posted
const durationCache = new Map();        // Caches video durations (saves API calls)
let isFirstRun = true;                  // First run = don't ping, just memorize
const botStartTime = Date.now();        // For uptime tracking

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMAND DEFINITIONS
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
    .setDescription('🏓 Check if the bot is alive and see latency'),
  new SlashCommandBuilder()
    .setName('help')
    .setDescription('📋 Show all available commands'),
  new SlashCommandBuilder()
    .setName('channel')
    .setDescription('📺 Show YouTube channel stats (subs, views, videos)'),
  new SlashCommandBuilder()
    .setName('subscribe')
    .setDescription('🔔 Get the link to subscribe to the channel'),
].map(cmd => cmd.toJSON());

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎬 YOUTUBE API HELPERS
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

/**
 * Get video duration in seconds (with caching to save API quota)
 */
async function getVideoDuration(videoId) {
  // Check cache first
  if (durationCache.has(videoId)) {
    return durationCache.get(videoId);
  }

  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: videoId,
        part: 'contentDetails'
      },
      timeout: 10000
    });

    const duration = res.data.items[0]?.contentDetails?.duration || '';
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match?.[1] || 0);
    const minutes = parseInt(match?.[2] || 0);
    const seconds = parseInt(match?.[3] || 0);
    const totalSeconds = hours * 3600 + minutes * 60 + seconds;

    // Cache it
    durationCache.set(videoId, totalSeconds);
    return totalSeconds;
  } catch (error) {
    console.error(`⚠️ Duration fetch failed for ${videoId}:`, error.message);
    return 999; // Treat as regular video if unknown
  }
}

/**
 * Smart Short detection - catches all common short patterns
 */
function isShortVideo(title, durationSec) {
  const titleLower = (title || '').toLowerCase();
  const shortKeywords = ['#short', '#shorts', '#ytshort', '#ytshorts'];
  
  // Check title hashtags
  const hasShortTag = shortKeywords.some(tag => titleLower.includes(tag));
  
  // Duration check (Shorts are 60 sec or less, give 5sec buffer for accuracy)
  const isShortDuration = durationSec > 0 && durationSec <= 65;
  
  return hasShortTag || isShortDuration;
}

/**
 * Fetch latest videos from YouTube channel
 */
async function fetchLatestVideos(maxResults = 10) {
  const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      key: process.env.YOUTUBE_API_KEY,
      channelId: process.env.YOUTUBE_CHANNEL_ID,
      part: 'snippet',
      order: 'date',
      maxResults: maxResults,
      type: 'video'
    },
    timeout: 10000
  });
  return res.data.items || [];
}

/**
 * Fetch YouTube channel information
 */
async function fetchChannelInfo() {
  const res = await axios.get('https://www.googleapis.com/youtube/v3/channels', {
    params: {
      key: process.env.YOUTUBE_API_KEY,
      id: process.env.YOUTUBE_CHANNEL_ID,
      part: 'snippet,statistics'
    },
    timeout: 10000
  });
  return res.data.items[0];
}

/**
 * Create a beautiful embed for a video (with optional ping)
 */
function createVideoEmbed(video, isShort) {
  const videoId = video.id.videoId;
  const title = video.snippet.title;
  const thumbnail = video.snippet.thumbnails.high.url;
  const publishedAt = new Date(video.snippet.publishedAt).toLocaleString();
  
  const baseUrl = isShort 
    ? `https://www.youtube.com/shorts/${videoId}` 
    : `https://www.youtube.com/watch?v=${videoId}`;
  
  return new EmbedBuilder()
    .setTitle(`${isShort ? '⚡' : '🎬'} ${title}`)
    .setURL(baseUrl)
    .setColor(isShort ? 0x00ff99 : 0xff0000)
    .setImage(thumbnail)
    .addFields(
      { name: '📅 Posted', value: publishedAt, inline: true },
      { name: '▶️ Watch', value: `[Click Here](${baseUrl})`, inline: true }
    )
    .setFooter({ 
      text: isShort ? 'Reze Blox YT • Latest Short' : 'Reze Blox YT • Latest Video' 
    })
    .setTimestamp();
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔄 MAIN YOUTUBE CHECK LOOP (PINGS ROLE ON NEW UPLOADS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
async function checkYouTube() {
  try {
    const videos = await fetchLatestVideos();
    if (!videos || videos.length === 0) {
      console.log('⚠️ No videos returned from API');
      return;
    }

    // First run: memorize all current videos, don't ping
    if (isFirstRun) {
      isFirstRun = false;
      for (const video of videos) {
        postedVideos.add(video.id.videoId);
      }
      console.log(`✅ First run complete - ${postedVideos.size} videos memorized (no pings sent)`);
      return;
    }

    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) {
      console.log('❌ Discord channel not found - check DISCORD_CHANNEL_ID');
      return;
    }

    const rolePing = `<@&${process.env.ROLE_ID}>`;

    // Process oldest-new first (so videos appear in correct order)
    for (const video of videos.reverse()) {
      const videoId = video.id.videoId;
      
      // Skip if already posted
      if (postedVideos.has(videoId)) continue;
      
      // Mark as posted IMMEDIATELY to prevent double-posting on errors
      postedVideos.add(videoId);

      const title = video.snippet.title;
      const duration = await getVideoDuration(videoId);
      const isShort = isShortVideo(title, duration);

      const embed = createVideoEmbed(video, isShort);

      const message = await channel.send({ 
        content: `${rolePing} ${isShort ? '🩳 **NEW SHORT UPLOADED!**' : '🎥 **NEW VIDEO UPLOADED!**'}`, 
        embeds: [embed] 
      });

      // Auto-react with emojis for extra hype ✨
      try {
        await message.react('🎉');
        await message.react('🔔');
      } catch (e) {
        // Reactions aren't critical, ignore if they fail
      }

      console.log(`✅ ${isShort ? 'SHORT' : 'VIDEO'} notification sent: "${title}"`);
    }
  } catch (error) {
    console.error('❌ YouTube check error:', error.message);
  }
}

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🎮 SLASH COMMAND HANDLERS (NO PINGS - USER REQUESTS)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  
  const cmd = interaction.commandName;

  try {
    // ━━━━━━━━━━━━━━━ /ping ━━━━━━━━━━━━━━━
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
          { name: '💾 Cache Size', value: `${durationCache.size}`, inline: true },
          { name: '🔄 Check Interval', value: 'Every 5 minutes', inline: true }
        )
        .setFooter({ text: 'Bot is alive and watching for new uploads!' })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }

    // ━━━━━━━━━━━━━━━ /help ━━━━━━━━━━━━━━━
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
        .setFooter({ text: '🚨 Bot auto-pings the role whenever a new video drops!' })
        .setTimestamp();

      return await interaction.reply({ embeds: [embed] });
    }

    // ━━━━━━━━━━━━━━━ /channel ━━━━━━━━━━━━━━━
    if (cmd === 'channel') {
      await interaction.deferReply();
      const ch = await fetchChannelInfo();
      
      const embed = new EmbedBuilder()
        .setTitle(`📺 ${ch.snippet.title}`)
        .setURL(`https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}`)
        .setDescription(ch.snippet.description?.substring(0, 200) || 'No description available')
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

    // ━━━━━━━━━━━━━━━ /subscribe ━━━━━━━━━━━━━━━
    if (cmd === 'subscribe') {
      const subUrl = `https://www.youtube.com/channel/${process.env.YOUTUBE_CHANNEL_ID}?sub_confirmation=1`;
      
      const embed = new EmbedBuilder()
        .setTitle('🔔 Subscribe to the channel!')
        .setURL(subUrl)
        .setDescription(
          '👆 **Click the title above to subscribe!**\n\n' +
          'Don\'t forget to hit the 🔔 bell so you never miss an upload!\n\n' +
          '✨ Thanks for the support!'
        )
        .setColor(0xff0000)
        .setFooter({ text: 'Smash that subscribe button!' });

      return await interaction.reply({ embeds: [embed] });
    }

    // ━━━━━━━━━━━━━━━ /latest (NO PING) ━━━━━━━━━━━━━━━
    if (cmd === 'latest') {
      await interaction.deferReply();
      const videos = await fetchLatestVideos();
      
      let latestVideo = null;
      for (const v of videos) {
        const dur = await getVideoDuration(v.id.videoId);
        if (!isShortVideo(v.snippet.title, dur)) {
          latestVideo = v;
          break;
        }
      }

      if (!latestVideo) {
        return await interaction.editReply('❌ No regular videos found on the channel!');
      }

      const embed = createVideoEmbed(latestVideo, false);
      return await interaction.editReply({ 
        content: '🎥 **Latest Video:**', 
        embeds: [embed] 
      });
    }

    // ━━━━━━━━━━━━━━━ /latestshort (NO PING) ━━━━━━━━━━━━━━━
    if (cmd === 'latestshort') {
      await interaction.deferReply();
      const videos = await fetchLatestVideos();
      
      let latestShort = null;
      for (const v of videos) {
        const dur = await getVideoDuration(v.id.videoId);
        if (isShortVideo(v.snippet.title, dur)) {
          latestShort = v;
          break;
        }
      }

      if (!latestShort) {
        return await interaction.editReply('❌ No shorts found on the channel!');
      }

      const embed = createVideoEmbed(latestShort, true);
      return await interaction.editReply({ 
        content: '🩳 **Latest Short:**', 
        embeds: [embed] 
      });
    }

  } catch (error) {
    console.error(`❌ Command error (${cmd}):`, error.message);
    
    // Reply with error message (only if not already replied)
    try {
      if (interaction.deferred || interaction.replied) {
        await interaction.editReply('❌ Something went wrong. Try again later!');
      } else {
        await interaction.reply({ content: '❌ Something went wrong. Try again later!', ephemeral: true });
      }
    } catch (e) {
      // Silent fail if we can't reply
    }
  }
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🚀 BOT STARTUP
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.once('ready', async () => {
  console.log('═══════════════════════════════════════');
  console.log(`✅ Logged in as ${client.user.tag}`);
  console.log(`📺 Tracking channel: ${process.env.YOUTUBE_CHANNEL_ID}`);
  console.log(`💬 Notifying in channel: ${process.env.DISCORD_CHANNEL_ID}`);
  console.log(`🔔 Pinging role: ${process.env.ROLE_ID}`);
  console.log('═══════════════════════════════════════');

  // Set custom 24/7 status
  client.user.setPresence({
    activities: [{ 
      name: 'Reze Blox YT 📺', 
      type: ActivityType.Watching 
    }],
    status: 'online'
  });
  console.log('✅ Status set to "Watching Reze Blox YT"');

  // Register slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(
      Routes.applicationCommands(client.user.id), 
      { body: commands }
    );
    console.log(`✅ ${commands.length} slash commands registered globally`);
  } catch (error) {
    console.error('❌ Failed to register commands:', error.message);
  }

  // Start YouTube monitoring
  console.log('🔄 Starting YouTube monitor...');
  await checkYouTube();
  setInterval(checkYouTube, 5 * 60 * 1000); // Every 5 minutes
  console.log('🟢 Bot fully operational - monitoring every 5 minutes');
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🛡️ ERROR HANDLERS (PREVENT CRASHES)
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.on('error', (error) => {
  console.error('❌ Discord client error:', error.message);
});

process.on('unhandledRejection', (error) => {
  console.error('❌ Unhandled promise rejection:', error.message);
});

process.on('uncaughtException', (error) => {
  console.error('❌ Uncaught exception:', error.message);
});

// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
// 🔐 LOGIN
// ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
client.login(process.env.DISCORD_TOKEN);
