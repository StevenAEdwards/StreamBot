# Use Node.js with Alpine as the base image
FROM node:alpine

# Install dependencies
RUN apk add --no-cache \
    libva-utils \
    libva-intel-driver \
    intel-media-driver \
    intel-gmmlib \
    libmfx \
    ffmpeg

# Create the working directory /app/streambot
WORKDIR /app/streambot

# Copy package.json and package-lock.json
COPY package*.json ./

# Install dependencies from package.json
RUN npm install

# Copy app files
COPY . .

# Expose the port
EXPOSE 3123

# Run app
CMD ["node", "index.js"]
