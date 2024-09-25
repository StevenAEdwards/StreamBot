require('dotenv').config();

const config = {
    token: process.env.DISCORD_TOKEN,  
    streamOpts: {
        width: process.env.WIDTH,  
        height: process.env.HEIGHT, 
        fps: process.env.FPS,  
        bitrateKbps: process.env.BITRATE_KBPS,  
        maxBitrateKbps: process.env.MAX_BITRATE_KBPS,  
        hardware_acceleration: process.env.HARDWARE_ACCELERATION === 'true',  
        videoCodec: process.env.VIDEO_CODEC 
    },
    port: process.env.PORT
};

module.exports = config;
