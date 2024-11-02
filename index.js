import express from 'express';
import { Client, StageChannel } from 'discord.js-selfbot-v13';
import { streamLivestreamVideo, getInputMetadata, inputHasAudio, Streamer } from '@dank074/discord-video-stream';
import PCancelable from "p-cancelable";

//API
const app = express();
app.use(express.json());

const port = process.env.PORT || 3123;

app.listen(port, () => {
    console.log(`API server is listening on port ${port}`);
});

// Discord Login
const streamer = new Streamer(new Client());
streamer.client.login(process.env.DISCORD_TOKEN);
streamer.client.on('ready', () => {
    console.log(`--- ${streamer.client.user.tag} is ready ---`);
});

let isPlayTimeoutActive = false;
let command = new PCancelable((resolve, reject, onCancel) => {
    onCancel(() => {
        console.log('Promise was canceled');
    });
    setTimeout(() => {
        resolve('Done');
    }, 1000);
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

    let streamOptions, includeAudio;
    try {
        let metadata = await getInputMetadata(streamURL);
        let videoStream = metadata.streams.find(stream => stream.codec_type === 'video');

        if (!videoStream) {
            throw new Error('No video stream found in the metadata');
        }

        includeAudio = inputHasAudio(metadata);
        streamOptions = generateStreamOptions(qualities, videoStream)
    } catch (e) {
        console.log(`[${new Date().toISOString()}] Error encountered while fetching metadata or generating stream options:`, e);
        return res.status(500).send('Error encountered while fetching metadata or generating stream options');
    }

    try {
        const currentVoiceState = streamer.client.user.voice;

        if (currentVoiceState && currentVoiceState.channelId !== channelId) {
            console.log(`Joining voice channel ${guildId}/${channelId}`);
            await streamer.joinVoice(guildId, channelId);
        }

        if (!streamer.voiceConnection){
            return res.status(409).send('Desync: Please kick detached Stream Bot instance and try again');
        }

        //end current stream
        if (currentVoiceState && currentVoiceState.streaming) {
            await cancelExistingCommand(command);
            streamer.stopStream();
            await new Promise(resolve => setTimeout(resolve, 1000));
        }

        const streamUdpConn = await streamer.createStream(streamOptions);
        startStream(streamURL, streamUdpConn, includeAudio);

        await new Promise(resolve => setTimeout(resolve, 2000));

        return res.status(200).send('Streaming started successfully.');
    } catch (streamError) {
        console.error('Error while streaming:', streamError);
        return res.status(500).send('Failed to start streaming.');
    }
});

app.post('/disconnect', async (req, res) => {
    try {
        command?.cancel();
        streamer.stopStream();
        await streamer.leaveVoice();
        return res.status(200).send('Successfully disconnected and stopped the stream.');
    } catch (error) {
        console.error('Error during disconnect:', error);
        return res.status(500).send('Failed to disconnect.');
    }
});

function cancelExistingCommand(command) {
    return new Promise((resolve, reject) => {
        try {
            command.cancel();
            resolve();
        } catch (error) {
            reject(error);
        }
    });
}

async function startStream(streamUrl, udpConn, includeAudio) {

    console.log(`[${new Date().toISOString()}] Starting video stream - Stream URL: ${streamUrl} - Stream Options: ${JSON.stringify(udpConn._mediaConnection._streamOptions)}`);

    udpConn.mediaConnection.setSpeaking(true);
    udpConn.mediaConnection.setVideoStatus(true);

    try {
        command = streamLivestreamVideo(streamUrl, udpConn, includeAudio);
        const res = await command;
        console.log("Finished playing video " + res);
    } catch (e) {
        if (command.isCanceled) {
            console.log('Stream was cancelled');
        } else {
            console.log(e);
        }
    } finally {
        udpConn.mediaConnection.setSpeaking(false);
        udpConn.mediaConnection.setVideoStatus(false);
    }
}

function generateStreamOptions(qualities, videoStream) {
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
    const generatedBitrate = generateBitrateFromResolutionAndFramerate(height, width, fps);
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
        process.env.HARDWARE_ACCELERATION !== 'false' && qualities?.hardwareAcceleratedDecoding !== 'false';

    // video codec
    let videoCodec;
    if (videoStream.codec_name === 'vp8' || videoStream.codec_name === 'vp9') {
        videoCodec = 'VP8';
    } else {
        videoCodec = 'H264';
    }

    // native fps (soon deprecated?)
    const readAtNativeFps = process.env.READ_AT_NATIVE_FPS === 'true' || qualities?.readAtNativeFps === 'true';
    
    // rtcp sender report
    const rtcpSenderReportEnabled = process.env.RTCP_SENDER === 'true' || qualities?.rtcpSenderReportEnabled === 'true';

    // h26x preset 
    const h26xPreset = process.env.H26X_PRESET
        ? process.env.H26X_PRESET
        : qualities?.h26xPreset
            ? qualities.h26xPreset
            : "superfast";

    // minimize latency 
    const minimizeLatency = process.env.MINIMIZE_LATENCY !== 'false' && qualities?.minimizeLatency !== 'false';

    // forceChacha20Encryption
    const forceChacha20Encryption = process.env.FORCE_CHACHA === 'true' || qualities?.forceChacha20Encryption === 'true';

    // Prepare final options object
    return {
        width,
        height,
        fps,
        bitrateKbps,
        maxBitrateKbps,
        hardwareAcceleratedDecoding,
        videoCodec,
        readAtNativeFps,
        rtcpSenderReportEnabled,
        h26xPreset,
        minimizeLatency,
        forceChacha20Encryption
    };
}

function generateBitrateFromResolutionAndFramerate(height, width, framerate) {
    let bitrateKbps;
    let maxBitrateKbps;

    if (height >= 2160) {
        bitrateKbps = framerate >= 50 ? 20000 : 18000;
        maxBitrateKbps = framerate >= 50 ? 25000 : 23000;
    } else if (height >= 1440) {
        bitrateKbps = framerate >= 50 ? 14000 : 12000;
        maxBitrateKbps = framerate >= 50 ? 16000 : 14000;
    } else if (height >= 1080) {
        bitrateKbps = framerate >= 50 ? 10000 : 8000;
        maxBitrateKbps = framerate >= 50 ? 12000 : 10000;
    } else if (height >= 720) {
        bitrateKbps = framerate >= 50 ? 7000 : 5000;
        maxBitrateKbps = framerate >= 50 ? 9000 : 7000;
    } else {
        bitrateKbps = 6000;
        maxBitrateKbps = 8000;
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
