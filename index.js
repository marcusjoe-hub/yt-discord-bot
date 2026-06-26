require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder, REST, Routes, SlashCommandBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// Keep alive web server
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web server running'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

const postedVideos = new Set();
let isFirstRun = true;

// Register slash commands
const commands = [
  new SlashCommandBuilder()
    .setName('latest')
    .setDescription('Show the latest video from the YouTube channel'),
  new SlashCommandBuilder()
    .setName('latestshort')
    .setDescription('Show the latest short from the YouTube channel'),
].map(cmd => cmd.toJSON());

async function getVideoDuration(videoId) {
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/videos', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        id: videoId,
        part: 'contentDetails'
      }
    });
    const duration = res.data.items[0]?.contentDetails?.duration || '';
    const match = duration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
    const hours = parseInt(match[1] || 0);
    const minutes = parseInt(match[2] || 0);
    const seconds = parseInt(match[3] || 0);
    return hours * 3600 + minutes * 60 + seconds;
  } catch (e) {
    return 999;
  }
}

async function fetchLatestVideos() {
  const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
    params: {
      key: process.env.YOUTUBE_API_KEY,
      channelId: process.env.YOUTUBE_CHANNEL_ID,
      part: 'snippet',
      order: 'date',
      maxResults: 10,
      type: 'video'
    }
  });
  return res.data.items || [];
}

async function checkYouTube() {
  try {
    const videos = await fetchLatestVideos();
    if (videos.length === 0) return;

    if (isFirstRun) {
      isFirstRun = false;
      for (const video of videos) {
        postedVideos.add(video.id.videoId);
      }
      console.log(`✅ First run done - saved ${postedVideos.size} existing videos (no ping)`);
      return;
    }

    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return console.log('❌ Discord channel not found');

    const rolePing = `<@&${process.env.ROLE_ID}>`;

    for (const video of videos.reverse()) {
      const videoId = video.id.videoId;
      if (postedVideos.has(videoId)) continue;
      postedVideos.add(videoId);

      const title = video.snippet.title;
      const thumbnail = video.snippet.thumbnails.high.url;
      const publishedAt = new Date(video.snippet.publishedAt).toLocaleString();
      const duration = await getVideoDuration(videoId);
      const isShort = title.toLowerCase().includes('#short') || duration <= 60;

      if (isShort) {
        const embed = new EmbedBuilder()
          .setTitle(`⚡ ${title}`)
          .setURL(`https://www.youtube.com/shorts/${videoId}`)
          .setColor(0x00ff99)
          .setImage(thumbnail)
          .addFields(
            { name: '📅 Posted', value: publishedAt, inline: true },
            { name: '▶️ Watch', value: `[Click Here](https://www.youtube.com/shorts/${videoId})`, inline: true }
          )
          .setFooter({ text: 'New Short Just Dropped!' });

        await channel.send({ content: `${rolePing} 🩳 **NEW SHORT UPLOADED!**`, embeds: [embed] });
        console.log(`✅ Short notification sent: ${title}`);
      } else {
        const embed = new EmbedBuilder()
          .setTitle(`🎬 ${title}`)
          .setURL(`https://www.youtube.com/watch?v=${videoId}`)
          .setColor(0xff0000)
          .setImage(thumbnail)
          .addFields(
            { name: '📅 Posted', value: publishedAt, inline: true },
            { name: '▶️ Watch', value: `[Click Here](https://www.youtube.com/watch?v=${videoId})`, inline: true }
          )
          .setFooter({ text: 'New Video Just Dropped!' });

        await channel.send({ content: `${rolePing} 🎥 **NEW VIDEO UPLOADED!**`, embeds: [embed] });
        console.log(`✅ Video notification sent: ${title}`);
      }
    }
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

// Handle slash commands
client.on('interactionCreate', async (interaction) => {
  if (!interaction.isChatInputCommand()) return;

  if (interaction.commandName === 'latest') {
    await interaction.deferReply();
    try {
      const videos = await fetchLatestVideos();
      // Find the latest REGULAR video (not a short)
      let latestVideo = null;
      for (const v of videos) {
        const dur = await getVideoDuration(v.id.videoId);
        const isShort = v.snippet.title.toLowerCase().includes('#short') || dur <= 60;
        if (!isShort) {
          latestVideo = v;
          break;
        }
      }

      if (!latestVideo) {
        return interaction.editReply('❌ No regular videos found!');
      }

      const videoId = latestVideo.id.videoId;
      const embed = new EmbedBuilder()
        .setTitle(`🎬 ${latestVideo.snippet.title}`)
        .setURL(`https://www.youtube.com/watch?v=${videoId}`)
        .setColor(0xff0000)
        .setImage(latestVideo.snippet.thumbnails.high.url)
        .addFields(
          { name: '📅 Posted', value: new Date(latestVideo.snippet.publishedAt).toLocaleString(), inline: true },
          { name: '▶️ Watch', value: `[Click Here](https://www.youtube.com/watch?v=${videoId})`, inline: true }
        )
        .setFooter({ text: 'Latest Video' });

      await interaction.editReply({ content: '🎥 **Latest Video:**', embeds: [embed] });
    } catch (e) {
      await interaction.editReply('❌ Error fetching latest video.');
      console.error(e.message);
    }
  }

  if (interaction.commandName === 'latestshort') {
    await interaction.deferReply();
    try {
      const videos = await fetchLatestVideos();
      let latestShort = null;
      for (const v of videos) {
        const dur = await getVideoDuration(v.id.videoId);
        const isShort = v.snippet.title.toLowerCase().includes('#short') || dur <= 60;
        if (isShort) {
          latestShort = v;
          break;
        }
      }

      if (!latestShort) {
        return interaction.editReply('❌ No shorts found!');
      }

      const videoId = latestShort.id.videoId;
      const embed = new EmbedBuilder()
        .setTitle(`⚡ ${latestShort.snippet.title}`)
        .setURL(`https://www.youtube.com/shorts/${videoId}`)
        .setColor(0x00ff99)
        .setImage(latestShort.snippet.thumbnails.high.url)
        .addFields(
          { name: '📅 Posted', value: new Date(latestShort.snippet.publishedAt).toLocaleString(), inline: true },
          { name: '▶️ Watch', value: `[Click Here](https://www.youtube.com/shorts/${videoId})`, inline: true }
        )
        .setFooter({ text: 'Latest Short' });

      await interaction.editReply({ content: '🩳 **Latest Short:**', embeds: [embed] });
    } catch (e) {
      await interaction.editReply('❌ Error fetching latest short.');
      console.error(e.message);
    }
  }
});

client.once('ready', async () => {
  console.log(`✅ Logged in as ${client.user.tag}`);

  // Register slash commands
  try {
    const rest = new REST({ version: '10' }).setToken(process.env.DISCORD_TOKEN);
    await rest.put(Routes.applicationCommands(client.user.id), { body: commands });
    console.log('✅ Slash commands registered!');
  } catch (e) {
    console.error('❌ Failed to register commands:', e.message);
  }

  checkYouTube();
  setInterval(checkYouTube, 5 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
