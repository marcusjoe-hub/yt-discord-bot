require('dotenv').config();
const { Client, GatewayIntentBits, EmbedBuilder } = require('discord.js');
const axios = require('axios');
const express = require('express');

// Keep alive web server
const app = express();
app.get('/', (req, res) => res.send('Bot is alive!'));
app.listen(process.env.PORT || 3000, () => console.log('✅ Web server running'));

const client = new Client({
  intents: [GatewayIntentBits.Guilds]
});

let lastVideoId = null;
let lastShortId = null;
let isFirstRun = true;

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

async function checkYouTube() {
  try {
    const res = await axios.get('https://www.googleapis.com/youtube/v3/search', {
      params: {
        key: process.env.YOUTUBE_API_KEY,
        channelId: process.env.YOUTUBE_CHANNEL_ID,
        part: 'snippet',
        order: 'date',
        maxResults: 5,
        type: 'video'
      }
    });

    const videos = res.data.items;
    if (!videos || videos.length === 0) return;

    if (isFirstRun) {
      isFirstRun = false;
      for (const video of videos) {
        const vid = video.id.videoId;
        const title = video.snippet.title.toLowerCase();
        const duration = await getVideoDuration(vid);
        const isShort = title.includes('#short') || duration <= 60;
        if (isShort && !lastShortId) lastShortId = vid;
        else if (!isShort && !lastVideoId) lastVideoId = vid;
      }
      console.log('✅ First run done - saved latest video IDs (no ping)');
      return;
    }

    const channel = client.channels.cache.get(process.env.DISCORD_CHANNEL_ID);
    if (!channel) return console.log('❌ Discord channel not found');

    const rolePing = `<@&${process.env.ROLE_ID}>`;

    for (const video of videos.reverse()) {
      const videoId = video.id.videoId;
      const title = video.snippet.title;
      const thumbnail = video.snippet.thumbnails.high.url;
      const publishedAt = new Date(video.snippet.publishedAt).toLocaleString();
      const duration = await getVideoDuration(videoId);
      const titleLower = title.toLowerCase();
      const isShort = titleLower.includes('#short') || duration <= 60;

      if (isShort && videoId !== lastShortId) {
        lastShortId = videoId;
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
      }

      if (!isShort && videoId !== lastVideoId) {
        lastVideoId = videoId;
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

client.once('ready', () => {
  console.log(`✅ Logged in as ${client.user.tag}`);
  checkYouTube();
  setInterval(checkYouTube, 5 * 60 * 1000);
});

client.login(process.env.DISCORD_TOKEN);
