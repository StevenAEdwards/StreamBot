const express = require('express');
const { Client, StageChannel } = require('discord.js-selfbot-v13');
const { command, streamLivestreamVideo, getInputMetadata, inputHasAudio, Streamer } = require('@dank074/discord-video-stream');

//API
const app = express();
app.use(express.json()); 
const port = process.env.PORT || 3000;
app.listen(port, () => {
    console.log(`API server is listening on port ${port}`);
});

// Discord Login
const streamer = new Streamer(new Client());
streamer.client.login(process.env.DISCORD_TOKEN);
streamer.client.on('ready', () => {
    console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

app.post('/play', async (req, res) => {
    const { guildId, channelId, streamURL } = req.body;

    if (!guildId || !channelId || !streamURL) {
        return res.status(400).send('Missing required parameters: guildId, channelId, streamURL');
    }

    try {
        const guild = streamer.client.guilds.cache.get(guildId);
        if (!guild) return res.status(404).send('Guild not found.');

        const channel = guild.channels.cache.get(channelId);
        if (!channel || channel.type !== 'GUILD_VOICE') {
            return res.status(404).send('Voice channel not found or invalid.');
        }

        const currentVoiceState = streamer.client.user.voice;

        if (currentVoiceState && currentVoiceState.channelId === channelId) {
            console.log(`Already connected to voice channel ${guildId}/${channelId}`);
        } else {
            console.log(`Joining voice channel ${guildId}/${channelId}`);
            await streamer.joinVoice(guildId, channelId);

            if (channel instanceof StageChannel) {
                await streamer.client.user.voice.setSuppressed(false);
            }
        }

        let metadata;
        try {
            metadata = await getInputMetadata(streamURL);
        } catch (e) {
            console.log('Error fetching metadata:', e);
            return res.status(500).send('Failed to fetch stream metadata.');
        }

        (async () => {
            try {
                if (currentVoiceState && currentVoiceState.streaming) {
                    console.log('Already streaming, switching streams...');
                    await switchStreams(streamURL, metadata);
                } else {
                    console.log('No active stream, starting new stream...');
                    const streamUdpConn = await streamer.createStream(generateStreamOptions(metadata));
                    await playVideo(streamURL, metadata, streamUdpConn);
                }
            } catch (streamError) {
                console.error('Error while streaming:', streamError);
            }
        })();

        return res.status(200).send('Streaming started successfully.');
    } catch (error) {
        console.error('Error while streaming:', error);
        return res.status(500).send('Failed to start streaming.');
    }
});

app.post('/disconnect', async (req, res) => {
    try {
        await disconnectFromVoice();
        return res.status(200).send('Successfully disconnected and stopped the stream.');
    } catch (error) {
        console.error('Error during disconnect:', error);
        return res.status(500).send('Failed to disconnect.');
    }
});

async function disconnectFromVoice() {
    try {
        if (streamer.voiceConnection?.streamConnection) {
            console.log("Stopping the current stream...");
            const stream = streamer.voiceConnection.streamConnection;
            stream.setSpeaking(false);
            stream.setVideoStatus(false);
            streamer.stopStream();
            command?.kill('SIGINT');
        }
        console.log("Leaving the voice channel...");
        await streamer.leaveVoice();
        console.log("Successfully disconnected from the voice channel.");
    } catch (error) {
        console.error('Error during disconnect:', error);
        throw new Error('Failed to disconnect');
    }
}

async function playVideo(video, metadata, udpConn) {

    let includeAudio = inputHasAudio(metadata);
    console.log('Started playing video');

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);

    try {
        const res = await streamLivestreamVideo(video, udpConn, includeAudio);
    } catch (e) {
        console.log('Error while playing video:', e);
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
    command?.kill("SIGINT");
}

async function switchStreams(streamURL, metadata) {
    try {

        console.log("Stopping the current stream...");

        if (streamer.voiceConnection.streamConnection) {
            const stream = streamer.voiceConnection.streamConnection;
            stream.setSpeaking(false);
            stream.setVideoStatus(false);
            streamer.stopStream();
            command?.kill('SIGINT');

            await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
            console.log("No active stream to stop.");
        }

        console.log("Starting new stream...");
        const streamUdpConn = await streamer.createStream(generateStreamOptions(metadata));

        streamUdpConn.mediaConnection.setSpeaking(true);
        streamUdpConn.mediaConnection.setVideoStatus(true);

        await playVideo(streamURL, metadata, streamUdpConn);

        console.log("Stream switched successfully.");
    } catch (error) {
        console.error('Error while switching streams:', error);
        throw new Error('Failed to switch streams');
    }
}

function generateStreamOptions(metadata) {
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (!videoStream) {
        throw new Error('No video stream found in the metadata');
    }

    const frameRateParts = videoStream.avg_frame_rate.split('/');
    const inputFps = frameRateParts.length === 2 ? parseInt(frameRateParts[0], 10) / parseInt(frameRateParts[1], 10) : parseFloat(videoStream.avg_frame_rate);
    
    const inputHeight = videoStream.height;
    const inputWidth = videoStream.width;

    let defaultBitrateKbps, defaultMaxBitrateKbps;

    if (inputFps >= 45) { 
        if (inputHeight >= 1080) {
            defaultBitrateKbps = 6000;  
            defaultMaxBitrateKbps = 9000;
        } else if (inputHeight >= 720) {
            defaultBitrateKbps = 4000;  
            defaultMaxBitrateKbps = 6000;
        } else {
            defaultBitrateKbps = 2500;  
            defaultMaxBitrateKbps = 3500;
        }
    } else if (inputFps >= 15) { 
        if (inputHeight >= 1080) {
            defaultBitrateKbps = 5000;  
            defaultMaxBitrateKbps = 7000;
        } else if (inputHeight >= 720) {
            defaultBitrateKbps = 3000;  
            defaultMaxBitrateKbps = 4500;
        } else {
            defaultBitrateKbps = 2000;  
            defaultMaxBitrateKbps = 3000;
        }
    } else {
        if (inputHeight >= 1080) {
            defaultBitrateKbps = 4000;  
            defaultMaxBitrateKbps = 6000;
        } else if (inputHeight >= 720) {
            defaultBitrateKbps = 2500;  
            defaultMaxBitrateKbps = 3500;
        } else {
            defaultBitrateKbps = 1500;   
            defaultMaxBitrateKbps = 2000;
        }
    }

    const height = process.env.HEIGHT ? parseInt(process.env.HEIGHT, 10) : inputHeight;
    const width = process.env.WIDTH ? parseInt(process.env.WIDTH, 10) : inputWidth;
    const fps = process.env.FPS ? parseInt(process.env.FPS, 10) : Math.round(inputFps);
    const bitrateKbps = process.env.BITRATE_KBPS ? parseInt(process.env.BITRATE_KBPS, 10) : defaultBitrateKbps;
    const maxBitrateKbps = process.env.MAX_BITRATE_KBPS ? parseInt(process.env.MAX_BITRATE_KBPS, 10) : defaultMaxBitrateKbps;
    const hardwareAcceleratedDecoding = process.env.HARDWARE_ACCELERATION === 'true';
    const h26xPreset = process.env.H26X_PRESET ? process.env.H26X_PRESET : "ultrafast";
    const readAtNativeFps = process.env.READ_AT_NATIVE_FPS ? process.env.READ_AT_NATIVE_FPS : 'true';

    let videoCodec;
    if (videoStream.codec_name === 'vp8' || videoStream.codec_name === 'vp9') {
        videoCodec = 'VP8';
    } else {
        videoCodec = 'H264';
    }

    return {
        width,
        height,
        fps,
        bitrateKbps,
        maxBitrateKbps,
        hardwareAcceleratedDecoding,
        videoCodec,
        h26xPreset,
        readAtNativeFps
    };
}

