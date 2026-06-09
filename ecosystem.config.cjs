module.exports = {
  apps: [
    {
      name: "opencode-serve",
      script: "opencode",
      args: "serve",
      cwd: "/root/JAVAWORK",
      env: {
        OPENCODE_SERVER_PORT: "4096",
      },
    },
    {
      name: "tg-bot",
      script: "opencode-telegram",
      args: "start",
      env: {
        TELEGRAM_BOT_TOKEN: "8617922374:AAG_CD5GeRHcbLvBKyhgd-Fke8g_Z4I0bDQ",
        TELEGRAM_ALLOWED_USER_ID: "5806630118",
        OPENCODE_API_URL: "http://localhost:4096",
        OPENCODE_MODEL_PROVIDER: "opencode",
        OPENCODE_MODEL_ID: "deepseek-v4-flash-free",
      },
    },
    {
      name: "code",
      script: "code.js",
      cwd: "/root/MBOT",
    },
  ],
};
