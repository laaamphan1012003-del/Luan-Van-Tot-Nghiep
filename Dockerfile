# Multi-stage Dockerfile for OCPP CSMS Simulator
FROM node:18-slim

# Install Python 3 and required system dependencies
RUN apt-get update && apt-get install -y \
    python3 \
    python3-pip \
    make \
    g++ \
    && ln -s /usr/bin/python3 /usr/bin/python \
    && rm -rf /var/lib/apt/lists/*

# Create app directory
WORKDIR /app

# Copy package files
COPY package*.json ./

# Install Node.js dependencies
RUN npm install --production

# Copy application files
COPY . .

# Expose ports
# 9000 - HTTP/WebSocket server
# 4840 - OPC UA server
EXPOSE 9000 4840

# Start the application
CMD ["node", "server.js"]
