FROM node:22-bookworm
RUN apt-get update && apt-get install -y --no-install-recommends docker.io ca-certificates curl gnupg \
    && curl -fsSL https://dl.google.com/linux/linux_signing_key.pub | gpg --dearmor -o /usr/share/keyrings/google-chrome.gpg \
    && echo 'deb [arch=amd64 signed-by=/usr/share/keyrings/google-chrome.gpg] https://dl.google.com/linux/chrome/deb/ stable main' > /etc/apt/sources.list.d/google-chrome.list \
    && apt-get update && apt-get install -y --no-install-recommends google-chrome-stable \
    && rm -rf /var/lib/apt/lists/*
ENV EMAIL_INTAKE_QA_CHROME=/usr/bin/google-chrome
ENV NEXT_TELEMETRY_DISABLED=1
USER node
