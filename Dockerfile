FROM mcr.microsoft.com/playwright:focal

# Working directory
WORKDIR /app

# Copy package manifest first to leverage layer caching
COPY package.json package-lock.json* ./

# Install dependencies
RUN npm ci --production=false || npm install

# Copy source
COPY . .

# Ensure Playwright browsers and dependencies are installed
RUN npx playwright install --with-deps || true

# Default command
CMD ["node", "src/bot.js"]
