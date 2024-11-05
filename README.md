
# Streambot API Docker Container Documentation

## Overview

Streambot is a self-hosted Node.js Discord self-bot for streaming content directly to Discord voice channels. Deploying via Docker, you can configure stream quality, frame rate, and latency. Note that Streambot functions as a self-bot, meaning it operates using a user account token, not a bot token, to access features that are typically unavailable to traditional bots.

This project is built in tandem with [RemoteBot](https://github.com/StevenAEdwards/RemoteBot), a companion bot that allows users to browse and manage `.m3u` stream files through Discord commands.

> **Disclaimer**: Self-bots operate using a user account, which is against Discord's Terms of Service. Using a self-bot can result in your account being flagged or banned. Proceed with caution and use at your own risk.

## Example Requests

### 1. `/play` Endpoint

**Headers**: `Content-Type: application/json`  
**Endpoint**: `/play`  
**Method**: `POST`

**Request Body**:

```json
{
  "guildId": "542301074717542026",
  "channelId": "542202074717542028",
  "stream": {
    "name": "WeatherSpy.us",
    "url": "https://jukin-weatherspy-1-us.samsung.wurl.tv/playlist.m3u8"
  },
  "user": {
    "name": "discord_name",
    "id": "12345653453"
  },
  "qualities": {  // Optional: If not provided, default values will be applied for each setting
    "width": "1920",
    "height": "1080",
    "fps": "30",
    "bitrateKbps": "10000",
    "maxBitrateKbps": "12000",
    "h26xPreset": "true",
    "hardwareAcceleratedDecoding": "true",
    "rtcpSenderReportEnabled": "false",
    "minimizeLatency": "true",
    "forceChacha20Encryption": "false"
  }
}
```

This endpoint initiates a stream in the specified channel and guild, applying any quality settings provided.

### 2. `/disconnect` Endpoint

**Headers**: `Content-Type: application/json`  
**Endpoint**: `/disconnect`  
**Method**: `POST`

**Request Body**:

```json
{
  "user": {
    "name": "testName",
    "id": "12345653453"
  }
}
```

This endpoint disconnects the user from the active stream session.

### Override Behavior

Overrides work in the following order of precedence:
1. **Docker Compose Values**: These override all other values.
2. **API Call Values**: Values specified in the API call override defaults but not Docker Compose values.
3. **Default Values**: If no Docker Compose or API call values are provided, default behaviors are applied.

## Docker Setup

Streambot can be run using either Docker Compose or `docker run`. Here are the configurations for both:

### Docker Compose

Create a `docker-compose.yml` file with the following configuration:

```yaml
services:
  streambot:
    image: stevenedwards/streambot:latest
    container_name: streambot
    ports:
      - "3123:3123"
    stdin_open: true  
    tty: true        
    devices:
      - /dev/dri:/dev/dri
    privileged: true  
    environment:
      DISCORD_TOKEN: "your_discord_token_here" 
    # v----OPTIONAL ENV VAR EXAMPLES----v (Remove If Not Needed)
      FPS: "30"
      MAX_FPS: "50"
      WIDTH: "1920"
      HEIGHT: "1080"
      BITRATE_KBPS: "10000"
      MAX_BITRATE_KBPS: "12000"
      H26X_PRESET: "ultrafast"
      HARDWARE_ACCELERATION: "true"
      RTCP_SENDER: "false"
      MINIMIZE_LATENCY: "true"
      FORCE_CHACHA: "false"
```

Then run the container:

```bash
docker-compose up -d
```

### Docker Run

Alternatively, you can run Streambot using a single `docker run` command:

```bash
docker run -d   --name streambot   -p 3123:3123   --device /dev/dri:/dev/dri   --privileged   -e DISCORD_TOKEN="your_discord_token_here"   stevenedwards/streambot:latest
```

## Environment Variables

| Variable               | Description                                                                                 | Type      | Default Behavior                     | Optional |
|------------------------|---------------------------------------------------------------------------------------------|-----------|--------------------------------------|----------|
| `DISCORD_TOKEN`        | Discord user token for authentication (self-bot setup).                                     | String    | No default                           | No       |
| `FPS`                  | Target frames per second.                                                                   | Integer   | Takes input stream value             | Yes      |
| `MAX_FPS`              | Maximum frames per second allowed for the stream.                                           | Integer   | No max FPS value                     | Yes      |
| `WIDTH`                | Stream width resolution.                                                                    | Integer   | Takes input stream value             | Yes      |
| `HEIGHT`               | Stream height resolution.                                                                   | Integer   | Takes input stream value             | Yes      |
| `BITRATE_KBPS`         | Target bitrate in kbps.                                                                     | Integer   | Dynamically calculated               | Yes      |
| `MAX_BITRATE_KBPS`     | Max bitrate in kbps.                                                                        | Integer   | Dynamically calculated               | Yes      |
| `H26X_PRESET`          | Encoder preset, e.g., "ultrafast", "fast".                                                  | String    | "ultrafast"                          | Yes      |
| `HARDWARE_ACCELERATION`| Enables hardware acceleration if supported.                                                 | Boolean   | true                                 | Yes      |
| `RTCP_SENDER`          | Enables RTCP for sync and quality.                                                          | Boolean   | false                                | Yes      |
| `MINIMIZE_LATENCY`     | Enables low-latency mode.                                                                   | Boolean   | true                                 | Yes      |
| `FORCE_CHACHA`         | Enables ChaCha20 encryption.                                                                | Boolean   | false                                | Yes      |

## Obtaining Your Discord User Token

To use Streambot, you’ll need your Discord user token. You can follow this [guide on robots.net](https://robots.net/tech/how-to-get-your-discord-token/) for detailed instructions. Note that sharing or misusing your Discord token can compromise your account's security, so handle it with care.

## Usage

1. Copy the Docker Compose file into `docker-compose.yml`, replacing `"your_discord_token_here"` with your actual Discord token.
2. Adjust any environment variables as needed for quality and performance.
3. Start the container (via `docker-compose up -d` or `docker run` as shown above).

4. View logs to confirm the bot is running:

   ```bash
   docker logs -f streambot
   ```
