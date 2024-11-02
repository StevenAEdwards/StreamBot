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

let command = new PCancelable((resolve, reject, onCancel) => {
    onCancel(() => {
        console.log('Promise was canceled');
    });
    setTimeout(() => {
        resolve('Done');
    }, 1000);
});

let isPlayTimeoutActive = false;


app.post('/play', async (req, res) => {
    const { guildId, channelId, stream, qualities, user } = req.body;

    console.log(`
        [${new Date().toISOString()}] Incoming request:
        Server / Channel ID: ${guildId} / ${channelId}
        User: ${user.name} (ID: ${user.id})
        Stream Name: ${stream.name}
        Stream URL: ${stream.url}
        Qualities: ${JSON.stringify(qualities, null, 2)}`
    );

    if (!guildId || !channelId || !stream.url) {
        const errorMessage = 'Missing required parameters: guildId, channelId, streamUrl';
        console.log(`[${new Date().toISOString()}] Response: 400 Bad Request - ${errorMessage}`);
        return res.status(400).send(errorMessage);
    }

    if (isPlayTimeoutActive) {
        const message = 'Play command is in cooldown. Please try again in a few seconds.';
        console.log(`[${new Date().toISOString()}] Response: 429 Too Many Requests - Play command is currently in cooldown. Ignoring request.`);
        return res.status(429).send(message);
    }

    isPlayTimeoutActive = true;
    setTimeout(() => {
        isPlayTimeoutActive = false;
    }, 5000);

    const guild = streamer.client.guilds.cache.get(guildId);
    const channel = guild?.channels.cache.get(channelId);

    if (!guild || !channel || channel.type !== 'GUILD_VOICE') {
        const message = !guild
            ? 'Guild not found.'
            : 'Voice channel not found or invalid.';
        console.log(`[${new Date().toISOString()}] Response: 404 Not Found - ${message}`);
        return res.status(404).send(message);
    }

    let streamOptions, includeAudio;
    try {
        let metadata = await getInputMetadata(stream.url);
        let videoStream = metadata.streams.find(stream => stream.codec_type === 'video');
        if (!videoStream) {
            throw new Error('No video stream found in the metadata');
        }
        streamOptions = generateStreamOptions(qualities, videoStream);
        includeAudio = inputHasAudio(metadata);
    } catch (e) {
        const message = 'Error encountered while fetching metadata or generating stream options';
        console.log(`[${new Date().toISOString()}] Response: 500 Internal Server Error - ${message} - Error details:`, e);
        return res.status(500).send(message);
    }

    try {
        const currentVoiceState = streamer.client.user.voice;

        if (currentVoiceState && currentVoiceState.channelId !== channelId) {
            console.log(`[${new Date().toISOString()}] Action: Joining voice channel
            Server ID: ${guildId}
            Target Channel ID: ${channelId}`);
            await streamer.joinVoice(guildId, channelId);
        }

        if (!streamer.voiceConnection) {
            const botUserId = streamer.client.user.id;
            const message = `Desync: Please kick detached Stream Bot instance with User ID ${botUserId} and try again.`;
            console.log(`[${new Date().toISOString()}] Response: 409 Conflict - ${message}`);
            return res.status(409).json({ message, botUserId });
        }

        if (currentVoiceState && currentVoiceState.streaming) {
            endExistingStream(streamer, command)
        }

        const streamUdpConn = await streamer.createStream(streamOptions);

        console.log(`[${new Date().toISOString()}] Starting video stream:
            Stream URL: ${stream.url}
            Stream Options: ${JSON.stringify(streamUdpConn._mediaConnection._streamOptions, null, 2)}
        `);

        startStream(stream.url, streamUdpConn, includeAudio);
        await new Promise(resolve => setTimeout(resolve, 2000));

        return res.status(200).send('Streaming started successfully.');
    } catch (streamError) {
        console.error('Error while streaming:', streamError);
        return res.status(500).send('Failed to start streaming.');
    }
});

app.post('/disconnect', async (req, res) => {
    const { user } = req.body;
    try {
        await endExistingStream(streamer, command);
        streamer.leaveVoice();
        const successMessage = `Successfully disconnected and stopped the stream.`;
        console.log(`[${new Date().toISOString()}] Endpoint: /disconnect - ${successMessage}
            User: ${user.name} (ID: ${user.id})`);
        return res.status(200).send(successMessage);
    } catch (error) {
        const errorMessage = 'Failed to disconnect.';
        console.error(`[${new Date().toISOString()}] Endpoint: /disconnect - Error: ${errorMessage}
            User: ${user.name} (ID: ${user.id}) - Error details:`, error);
        return res.status(500).send(errorMessage);
    }
});

function endExistingStream(streamer, command) {
    return new Promise((resolve, reject) => {
        try {
            command.cancel();
            streamer.stopStream();
            setTimeout(() => {
                resolve();
            }, 1000);
        } catch (error) {
            reject(error);
        }
    });
}

async function startStream(streamUrl, udpConn, includeAudio) {

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

// Generate settings with priority: environment variable > api parameters > default value
function generateStreamOptions(qualities, videoStream) {

    const height = process.env.HEIGHT ? parseInt(process.env.HEIGHT, 10)
        : qualities?.height ? qualities.height
            : videoStream.height;

    const width = process.env.WIDTH ? parseInt(process.env.WIDTH, 10)
        : qualities?.width ? qualities.width
            : videoStream.width;

    const fps = (() => {
        const envFps = process.env.FPS ? parseInt(process.env.FPS, 10) : null;
        const qualityFps = qualities?.fps || null;
        const parsedFps = envFps ?? qualityFps ?? parseFps(videoStream.avg_frame_rate);

        const maxFps = parseInt(process.env.MAX_FPS, 10);
        return maxFps && parsedFps > maxFps ? maxFps : parsedFps;
    })();

    const { bitrateKbps: generatedBitrateKbps, maxBitrateKbps: generatedMaxBitrateKbps } = generateBitrateFromResolutionAndFramerate(height, width, fps);

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

    let videoCodec;
    if (videoStream.codec_name === 'vp8' || videoStream.codec_name === 'vp9') {
        videoCodec = 'VP8';
    } else {
        videoCodec = 'H264';
    }

    const h26xPreset = process.env.H26X_PRESET
        ? process.env.H26X_PRESET
        : qualities?.h26xPreset
            ? qualities.h26xPreset
            : "superfast";

    const readAtNativeFps = getBooleanSetting(
        process.env.READ_AT_NATIVE_FPS,
        qualities?.readAtNativeFps,
        false
    );

    const rtcpSenderReportEnabled = getBooleanSetting(
        process.env.RTCP_SENDER,
        qualities?.rtcpSenderReportEnabled,
        false
    );

    const forceChacha20Encryption = getBooleanSetting(
        process.env.FORCE_CHACHA,
        qualities?.forceChacha20Encryption,
        false
    );

    const hardwareAcceleratedDecoding = getBooleanSetting(
        process.env.HARDWARE_ACCELERATION,
        qualities?.hardwareAcceleratedDecoding,
        true
    );

    const minimizeLatency = getBooleanSetting(
        process.env.MINIMIZE_LATENCY,
        qualities?.minimizeLatency,
        true
    );

    return {
        width,
        height,
        fps,
        bitrateKbps,
        maxBitrateKbps,
        h26xPreset,
        videoCodec,
        hardwareAcceleratedDecoding,
        readAtNativeFps,
        rtcpSenderReportEnabled,
        minimizeLatency,
        forceChacha20Encryption
    };
}

function parseFps(avgFrameRate) {
    const [numerator, denominator] = avgFrameRate.split('/').map(Number);
    return denominator ? Math.floor(numerator / denominator) : Math.floor(numerator);
}

function getBooleanSetting(envVar, qualityVar, defaultValue) {
    const envValue = envVar === 'true' ? true : envVar === 'false' ? false : undefined;
    const qualityValue = qualityVar === 'true' ? true : qualityVar === 'false' ? false : undefined;

    return envValue ?? qualityValue ?? defaultValue;
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
