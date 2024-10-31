const express = require('express');
const { Client, StageChannel } = require('discord.js-selfbot-v13');
const { command, streamLivestreamVideo, getInputMetadata, inputHasAudio, Streamer } = require('@dank074/discord-video-stream');
const { exec } = require('child_process');
const STUTTER_FPS_OFFSET = 2; //temp fix that works really well until I figure out a better way to handle skipping frames

//API
const app = express();
app.use(express.json());

const port = process.env.PORT || 3123;
let isPlayTimeoutActive = false;

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
    const { guildId, channelId, streamURL, qualities } = req.body;

    if (!guildId || !channelId || !streamURL) {
        return res.status(400).send('Missing required parameters: guildId, channelId, streamURL');
    }

    if (isPlayTimeoutActive) {
        console.log('Play command is currently in cooldown. Ignoring request.');
        return res.status(429).send('Play command is in cooldown. Please try again in a few seconds.');
    }

    try {
        isPlayTimeoutActive = true;
        setTimeout(() => {
            isPlayTimeoutActive = false;
        }, 5000);

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

        let streamOptions;
        try {
            streamOptions = await generateStreamOptions(qualities, metadata)
        } catch (e) {
            console.log('Error creating stream option:', e);
            return res.status(500).send('Failed to create stream options.');
        }

        try {
            await killAllFfmpegProcesses();

            //To Do: refactor for smarter handling this is kinda dumb
            if (currentVoiceState && currentVoiceState.streaming) {
                console.log('Already streaming, switching streams...');
                switchStreams(streamURL, streamOptions, metadata);
            } else {
                console.log('No active stream, starting new stream...');
                const streamUdpConn = await streamer.createStream(streamOptions);
                playVideo(streamURL, metadata, streamUdpConn);
            }

            await new Promise(resolve => setTimeout(resolve, 2000));

            return res.status(200).send('Streaming started successfully.');
        } catch (streamError) {
            console.error('Error while streaming:', streamError);
            return res.status(500).send('Failed to start streaming.');
        }
    } catch (error) {
        console.error('Unexpected error while processing the /play request:', error);
        return res.status(500).send('Failed to process the /play request.');
    }
});

app.post('/disconnect', async (req, res) => {
    try {
        await killAllFfmpegProcesses();
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

async function killAllFfmpegProcesses() {
    return new Promise((resolve, reject) => {
        exec('pkill -f ffmpeg', (err, stdout, stderr) => {
            if (err && err.code !== 1) {
                console.error(`Failed to kill FFmpeg processes: ${stderr}`);
                reject(err);
            } else {
                console.log('All FFmpeg processes terminated successfully.');
                resolve();
            }
        });
    });
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

async function switchStreams(streamURL, streamOptions, metadata) {
    try {

        console.log("Stopping the current stream...");

        if (streamer.voiceConnection.streamConnection) {
            const stream = streamer.voiceConnection.streamConnection;
            stream.setSpeaking(false);
            stream.setVideoStatus(false);
            streamer.stopStream();
            command?.kill('SIGINT'); //To Do: remove and test 99% sure this can be deleted

            await new Promise((resolve) => setTimeout(resolve, 1000));
        } else {
            console.log("No active stream to stop.");
        }

        console.log("Starting new stream...");
        const streamUdpConn = await streamer.createStream(streamOptions);
        streamUdpConn.mediaConnection.setSpeaking(true);
        streamUdpConn.mediaConnection.setVideoStatus(true);

        await playVideo(streamURL, metadata, streamUdpConn);

        console.log("Stream switched successfully.");
    } catch (error) {
        console.error('Error while switching streams:', error);
        throw new Error('Failed to switch streams');
    }
}

function generateStreamOptions(qualities, metadata) {
    const videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
    if (!videoStream) {
        throw new Error('No video stream found in the metadata');
    }


    //WIDTH and HEIGHT
    const inputHeight = videoStream.height;
    const inputWidth = videoStream.width;

    const height = process.env.HEIGHT ? parseInt(process.env.HEIGHT, 10)
        : qualities?.height ? qualities.height
            : inputHeight;

    const width = process.env.WIDTH ? parseInt(process.env.WIDTH, 10)
        : qualities?.width ? qualities.width
            : inputWidth;

    //FPS -- needs refactored
    const frameRateParts = videoStream.avg_frame_rate.split('/');
    const parsedFps = Math.floor(
        frameRateParts.length === 2
            ? parseInt(frameRateParts[0], 10) / parseInt(frameRateParts[1], 10)
            : parseFloat(videoStream.avg_frame_rate)
    );

    const initialFps = process.env.FPS
        ? parseInt(process.env.FPS, 10)
        : qualities?.fps
            ? qualities.fps
            : parsedFps;

    const fps = initialFps > process.env.MAX_FPS
        ? process.env.MAX_FPS
        : initialFps;

    //BITRATE
    const generatedBitrate = generateProperBitrate(height, width, fps);
    const { bitrateKbps: generatedBitrateKbps, maxBitrateKbps: generatedMaxBitrateKbps } = generatedBitrate;

    const bitrateKbps = process.env.BITRATE_KBPS
        ? parseInt(process.env.BITRATE_KBPS, 10)
        : qualities?.bitrateKbps
            ? qualities.bitrateKbps
            : generatedBitrateKbps;

    const maxBitrateKbps = process.env.MAX_BITRATE_KBPS
        ? parseInt(process.env.MAX_BITRATE_KBPS, 10)
        : qualities?.maxBitrateKbps
            ? qualities.maxBitrateKbps
            : generatedMaxBitrateKbps;

    // hw accel
    const hardwareAcceleratedDecoding =
        process.env.HARDWARE_ACCELERATION !== 'false' && qualities?.hwAccel !== 'false';

    // video codec
    let videoCodec;
    if (videoStream.codec_name === 'vp8' || videoStream.codec_name === 'vp9') {
        videoCodec = 'VP8';
    } else {
        videoCodec = 'H264';
    }

    // native fps
    const readAtNativeFps =
    process.env.READ_AT_NATIVE_FPS === 'true' || qualities?.readAtNativeFps === 'true';
    
    // rtcp sender report
    // const rtcpSenderReportEnabled = process.env.RTCP_SENDER === 'true' || qualities?.rtcpSenderReportEnabled === 'true';

    // h26x preset 
    // const h26xPreset = process.env.H26X_PRESET
    //     ? process.env.H26X_PRESET
    //     : qualities?.h26xPreset
    //         ? qualities.h26xPreset
    //         : "superfast";

    // minimize latency 
    // const minimizeLatency = process.env.MINIMIZE_LATENCY === 'false' || qualities?.minimizeLatency === 'false';

    // forceChacha20Encryption
    // const forceChacha20Encryption = process.env.FORCE_CHACHA === 'true' || qualities?.forceChacha20Encryption === 'true';

    // Prepare final options object
    const finalOptions = {
        width,
        height,
        fps,
        bitrateKbps,
        maxBitrateKbps,
        hardwareAcceleratedDecoding,
        videoCodec,
        readAtNativeFps,
        // rtcpSenderReportEnabled,
        // h26xPreset,
        // minimizeLatency,
        // forceChacha20Encryption
    };

    console.log("Started stream with options:", finalOptions);

    return finalOptions;
}

function generateProperBitrate(height, width, framerate) {
    let bitrateKbps;
    let maxBitrateKbps;

    if (height >= 2160) {
        bitrateKbps = framerate >= 50 ? 16000 : 14000;
        maxBitrateKbps = framerate >= 50 ? 20000 : 18000;
    } else if (height >= 1440) {
        bitrateKbps = framerate >= 50 ? 10000 : 9000;
        maxBitrateKbps = framerate >= 50 ? 12000 : 11000;
    } else if (height >= 1080) {
        bitrateKbps = framerate >= 50 ? 7000 : 6000;
        maxBitrateKbps = framerate >= 50 ? 9000 : 8000;
    } else if (height >= 720) {
        bitrateKbps = framerate >= 50 ? 4500 : 3500;
        maxBitrateKbps = framerate >= 50 ? 6000 : 5000;
    } else {
        bitrateKbps = 2500;
        maxBitrateKbps = 3000;
    }

    if (framerate < 30) {
        bitrateKbps *= 0.85;
        maxBitrateKbps *= 0.85;
    }

    return {
        bitrateKbps: Math.round(bitrateKbps),
        maxBitrateKbps: Math.round(maxBitrateKbps),
    };
}
