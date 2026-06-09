// helpers.js
// All helper functions for your Facebook Live streaming program

import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";
import crypto from "crypto";
import { url } from "inspector";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const JOHAN_PATH = path.join(__dirname, "johan.json");

// this for justifiy the json data

export function extractAndTransformChannels(state) {
  try {
    const channelsArray = [];
    let newChannel = {};
    // Process each channel
    for (const channel of state.CHANNELS) {
      // Create simple channel object for hossam
      newChannel = {
        img: rewriteFacebookUrl(channel.MURL) || "",
        url: rewriteFacebookUrl(channel.MPD),
        name: channel.CN || "Unnamed Channel",
      };

      channelsArray.push(newChannel);
      console.log(`✅ Processed: ${channel.CN}`);
    }

    return channelsArray; // Just the array
  } catch (error) {
    console.error("Error in extractAndTransformChannels:", error);
    throw error;
  }
}

/* ================= ENCRYPTION FUNCTIONS ================= */

export function rewriteFacebookUrl(url) {
  const u = new URL(url);
  let newDomain;

  // Check if the URL is a video (mpd/m3u8 or contains /hvideo/)
  const isVideo = u.pathname.includes("/hvideo") || u.pathname.endsWith(".mpd");

  if (isVideo) {
    // Video URL
    newDomain = "https://MatricNejma@video.xx.fbcdn.net";
  } else {
    // Image URL
    newDomain = "https://scontent-a-mad.xx.fbcdn.net";
  }

  // Rebuild the URL with the new domain, keeping the original path and query string
  return `${newDomain}${u.pathname}${u.search}`;
}

function generateKey(password) {
  try {
    // SHA-256 hash of password (matches Java implementation)
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from(password, "utf-8"));
    const key = hash.digest();
    return key;
  } catch (err) {
    throw new Error(`Key generation error: ${err.message}`);
  }
}

function encryptData(data, password) {
  try {
    // Generate key from password using SHA-256
    const key = generateKey(password);

    // Fixed IV: 16 bytes of zeros (matches Java implementation)
    const iv = Buffer.alloc(16, 0);

    // Create cipher with AES-256-CBC and PKCS7 padding
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);

    // Encrypt the data
    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");

    return encrypted;
  } catch (err) {
    console.log(`❌ Encryption error: ${err.message}`);
    return data;
  }
}

export function decryptData(encryptedData, password) {
  try {
    // Generate key from password using SHA-256
    const key = generateKey(password);

    // Fixed IV: 16 bytes of zeros (matches Java implementation)
    const iv = Buffer.alloc(16, 0);

    // Create decipher with AES-256-CBC
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, iv);

    // Decrypt the data
    let decrypted = decipher.update(encryptedData, "base64", "utf8");
    decrypted += decipher.final("utf8");

    return decrypted;
  } catch (err) {
    console.log(`❌ Decryption error: ${err.message}`);
    return encryptedData;
  }
}

// update facebook post by id

export async function updatePostFb(id, token, data) {
  // Convert to JSON string
  const jsonData = JSON.stringify(data);

  // Encrypt the data with password
  const encryptedData = encryptData(jsonData, "♕\n♕");

  // Create the final payload
  const payload = "ANAMATRIC" + encryptedData + "ENDMATRIC";

  // Update Facebook post
  const response = await fetch(`https://graph.facebook.com/v19.0/${id}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      message: payload,
      access_token: token,
    }).toString(),
  });

  if (!response.ok) {
    const errorData = await response.json();
    throw new Error(`Facebook API error: ${JSON.stringify(errorData)}`);
  }

  console.log(`✅ Facebook post updated with encrypted data`);
}

/* =====================
   TIME HELPERS
===================== */
export function getMachineTime() {
  return Math.floor(Date.now() / 1000);
}

export function isCycleExpired(timeCreated, cycleSeconds) {
  const now = getMachineTime();
  return now - timeCreated >= cycleSeconds;
}

export function ensureValidTimeCycle(state, cycleSeconds) {
  const now = getMachineTime();
  if (!state.TIMECREATED) {
    state.TIMECREATED = now;
    return { state, expired: false };
  }
  if (now - state.TIMECREATED >= cycleSeconds) {
    state.TIMECREATED = now;
    return { state, expired: true };
  }
  return { state, expired: false };
}

/* =====================
   FACEBOOK / GRAPH API
===================== */
export async function generateStreamKeyAndLiveId(channel) {
  const liveId = await createLive(channel.CHTK, channel.CN);
  const data = await getStreamAndDash(liveId, channel.CHTK);
  return { streamKey: data.stream_url, liveId };
}

async function updateRestreamerProcess(channel, streamKey, token, retries = 3) {
  const url = channel.CPI;

  const headers = {
    "User-Agent":
      "Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:147.0) Gecko/20100101 Firefox/147.0",
    Accept: "*/*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    Referer: "http://95.111.224.136:8080/ui/",
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    Origin: "http://95.111.224.136:8080",
    Connection: "keep-alive",
    Cookie:
      "connect.sid=s%3AIB8DxOPAnsJ94qAxHqDJgZ55p7yqirY5.xTpS4csOkmk5lzBg%2FmJDZ1ZJnvQoTTSONEJGAZt1g%2Bo",
    Priority: "u=0",
  };

  const body = {
    type: "ffmpeg",
    id: decodeURIComponent(channel.CPI.split("/").pop()),
    reference: channel.REF,
    input: [
      {
        id: "input_0",
        address: `{memfs}/${channel.REF}.m3u8`,
        options: ["-re"],
      },
    ],
    output: [
      {
        id: "output_0",
        address: streamKey,
        options: [
          "-map",
          "0:0",
          "-codec:v",
          "copy",
          "-map",
          "0:1",
          "-codec:a",
          "copy",
          "-f",
          "flv",
        ],
      },
    ],
    options: ["-loglevel", "level+info", "-err_detect", "ignore_err"],
    autostart: false,
    reconnect: true,
    reconnect_delay_seconds: 30,
    stale_timeout_seconds: 30,
    limits: {
      cpu_usage: 0,
      memory_mbytes: 0,
      waitfor_seconds: 5,
    },
  };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(
        `🔄 Attempt ${attempt}/${retries} to update restreamer process...`,
      );

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const response = await fetch(url, {
        method: "PUT",
        headers: headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`HTTP ${response.status}: ${errorText}`);
      }

      const data = await response.json();
      console.log(
        `✅ Successfully updated restreamer process on attempt ${attempt}`,
      );
      return data;
    } catch (error) {
      console.error(`❌ Attempt ${attempt} failed:`, error.message);

      if (attempt === retries) {
        throw new Error(`Failed after ${retries} attempts: ${error.message}`);
      }

      // Wait before retry with exponential backoff
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

export async function editFacebookProcess(
  channel,
  streamKey,
  name,
  token,
  retries = 3,
) {
  if (!channel.CPI) throw new Error("CPI URL not set for channel");

  const metadataUrl = channel.CPI + "/metadata/restreamer-ui";
  const payload = {
    version: "1.14.0",
    name: name,
    control: {
      process: {
        autostart: false,
        reconnect: true,
        delay: 30,
        staleTimeout: 30,
      },
      source: { source: "hls+memfs" },
      limits: { cpu_usage: 0, memory_mbytes: 0, waitfor_seconds: 5 },
    },
    outputs: [
      {
        address: streamKey,
        options: ["-f", "flv"],
      },
    ],
    settings: {
      rtmp_backup: false,
      rtmp_primary: true,
      stream_key_backup: "",
      stream_key_primary: streamKey.replaceAll(
        "rtmps://live-api-s.facebook.com:443/rtmp/",
        "",
      ),
    },
    profiles: [
      {
        video: {
          source: 0,
          stream: 0,
          encoder: {
            coder: "copy",
            settings: {},
            mapping: { global: [], local: ["-codec:v", "copy"], filter: [] },
          },
          decoder: {
            coder: "default",
            settings: {},
            mapping: { global: [], local: [], filter: [] },
          },
          filter: { graph: "", settings: {} },
        },
        audio: {
          source: 0,
          stream: 1,
          encoder: {
            coder: "copy",
            settings: {},
            mapping: { global: [], local: ["-codec:a", "copy"], filter: [] },
          },
          decoder: {
            coder: "default",
            settings: {},
            mapping: { global: [], local: [], filter: [] },
          },
          filter: { graph: "", settings: {} },
        },
        custom: { selected: false, stream: -1 },
      },
    ],
    streams: [
      {
        url: "",
        index: 0,
        stream: 0,
        type: "video",
        codec: "h264",
        width: 1280,
        height: 720,
        pix_fmt: "",
        sampling_hz: 0,
        layout: "",
        channels: 0,
      },
      {
        url: "",
        index: 0,
        stream: 1,
        type: "audio",
        codec: "aac",
        width: 0,
        height: 0,
        pix_fmt: "",
        sampling_hz: 48000,
        layout: "stereo",
        channels: 2,
      },
    ],
  };

  // First update restreamer process with retry
  await updateRestreamerProcess(channel, streamKey, token, retries);

  // Small delay to let server process
  await new Promise((resolve) => setTimeout(resolve, 500));

  // Then update metadata with retry
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      console.log(`🔄 Attempt ${attempt}/${retries} to update metadata...`);

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 15000); // 15 second timeout

      const r = await fetch(metadataUrl, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "User-Agent": "Mozilla/5.0",
        },
        body: JSON.stringify(payload),
        signal: controller.signal,
      });

      clearTimeout(timeout);

      if (!r.ok) {
        const text = await r.text();
        throw new Error(`Failed to edit Facebook process: ${text}`);
      }

      console.log(`✅ Successfully updated metadata on attempt ${attempt}`);
      return;
    } catch (error) {
      console.error(
        `❌ Metadata update attempt ${attempt} failed:`,
        error.message,
      );

      if (attempt === retries) {
        throw new Error(
          `Failed to update metadata after ${retries} attempts: ${error.message}`,
        );
      }

      // Wait before retry with exponential backoff
      const waitTime = Math.min(1000 * Math.pow(2, attempt - 1), 5000);
      console.log(`⏳ Waiting ${waitTime}ms before retry...`);
      await new Promise((resolve) => setTimeout(resolve, waitTime));
    }
  }
}

async function createLive(token, name) {
  const r = await fetch("https://graph.facebook.com/v19.0/me/live_videos", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      title: name,
      status: "UNPUBLISHED",
      stop_on_delete_stream: true,
      access_token: token,
    }),
  });
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return j.id;
}

// End live video broadcast using Facebook Graph API
// POST request to end the live stream without deleting the video
export async function endLive(token, id) {
  try {
    // Using Facebook Graph API v19.0 to end the live broadcast
    // Uses end_live_video: true parameter to properly end the broadcast
    const r = await fetch(`https://graph.facebook.com/v19.0/${id}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        end_live_video: true,
        access_token: token,
      }),
    });

    if (!r.ok) {
      const errorData = await r.json();
      const errorCode = errorData?.error?.code;
      const errorSubcode = errorData?.error?.error_subcode;

      if (
        errorCode === 100 &&
        (errorSubcode === 33 || errorSubcode === 201 || errorSubcode === 210)
      ) {
        console.warn(
          `⚠️ Live video ${id} could not be ended (not found or no permission), continuing.`,
        );
        return { skipped: true };
      }

      throw new Error(`Failed to end live video: ${JSON.stringify(errorData)}`);
    }

    const result = await r.json();
    console.log(`✅ Live video ${id} ended successfully`);
    return result;
  } catch (error) {
    console.error(`❌ Error ending live video: ${error.message}`);
    throw error;
  }
}

async function getStreamAndDash(liveId, token) {
  const fields = "stream_url,dash_preview_url,status";
  const r = await fetch(
    `https://graph.facebook.com/v19.0/${liveId}?fields=${fields}&access_token=${token}`,
  );
  const j = await r.json();
  if (j.error) throw new Error(j.error.message);
  return {
    stream_url: j.stream_url || "",
    dash: j.dash_preview_url || "",
    status: j.status || "UNKNOWN",
  };
}

/* =====================
   STREAM PROCESS CONTROL (CPI API)
===================== */
export async function getProgramToken(username, password) {
  const r = await fetch("http://95.111.224.136:8080/api/login", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ username, password }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Failed to get program token: ${text}`);
  }

  const data = await r.json();
  return data.access_token;
}

export async function sendStreamCommand(channel, command, token) {
  if (!channel.CPI) throw new Error("CPI URL not set for channel");

  const r = await fetch(channel.CPI + "/command", {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
      "User-Agent": "Mozilla/5.0",
    },
    body: JSON.stringify({ command }),
  });

  if (!r.ok) {
    const text = await r.text();
    throw new Error(`Failed to ${command} stream: ${text}`);
  }
}

export async function startStream(channel, token) {
  await sendStreamCommand(channel, "start", token);
}

export async function stopStream(channel, token) {
  await sendStreamCommand(channel, "stop", token);
}

export async function restartStreamSafely(channel, token) {
  await stopStream(channel, token);
  await new Promise((r) => setTimeout(r, 1000));
  await startStream(channel, token);
}

/* =====================
   METADATA EXTRACTION
===================== */
export async function extractMpdUrlFromLiveId(liveId, channelToken) {
  const data = await getStreamAndDash(liveId, channelToken);
  return data.dash;
}

export async function extractImageUrlFromPostId(postId, channelToken) {
  const r = await fetch(
    `https://graph.facebook.com/v19.0/${postId}?fields=images&access_token=${channelToken}`,
  );
  if (!r.ok) return "";
  const j = await r.json();
  return j?.images?.[0]?.source || "";
}

/* =====================
   STORAGE (johan.json)
===================== */
export function loadState() {
  if (!fs.existsSync(JOHAN_PATH)) return {};
  return JSON.parse(fs.readFileSync(JOHAN_PATH, "utf-8"));
}

export function saveState(state) {
  fs.writeFileSync(JOHAN_PATH, JSON.stringify(state, null, 2));
}

export function updateChannelState(state, index, updates) {
  state.CHANNELS[index] = { ...state.CHANNELS[index], ...updates };
  saveState(state);
}

/* =====================
   UTILS
===================== */
export function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}
