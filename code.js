import crypto from "crypto";
import { execFile } from "child_process";
import { fileURLToPath } from "url";
import { resolve } from "path";
import { readFileSync, writeFileSync, existsSync, statSync } from "fs";
import { decryptData } from "./helpers.js";

const scriptDir = resolve(fileURLToPath(import.meta.url), "..");

// ================= CONFIG =================
// Post 1: For extracting data (reading)
const EXTRACT_POST_ID = "763635856835934_122100266457032246";
const EXTRACT_ACCESS_TOKEN =
  "EAAOPZBncGzdwBQNedGzUnE2oY6nKxIMIvOy6PHyninvLfNXnsL2misgbJk53ioBR7V0vgKM8Vv7TTxTZA5rtw7nMdZA7cZCm6AvMedje0320IIxEHL0U1Vs7IVlT57QpArjRWHI220RZAtcvfGh72y8Ac67cQKGNomvIz8KokUuCWwTDU73NvkdXZBSzZCjsKXt6ZBFN";

// Post 2: For posting transformed data (writing)
const POST_ID = "1056893400840557_122097302576774488";
const POST_ACCESS_TOKEN =
  "EAAP8QyD3xK0BRDDcZBA9w25wkynS6Nfje1wQfquzIwHLVbJf0CqGzIDCJM2cY57fw4ZAd5VfASDfI61nNKzs6rjJeYYLHUiR0wq9QR4j8LLuWX8M6fkdwjeghZBC2k44Emymbfxfj4bzB8uaX2ps3HItn0jglORaPCkj1IGwsgopTED2EbygBKjZBhRHU831ZBnVVd5dv";

const DECRYPT_PASSWORD = "set.password=5501;)";
const ENCRYPT_PASSWORD = "♕\n♕";

// ================= MATCH IMAGE CACHE =================

const MATCH_IMG_CACHE = "/tmp/match_images_cache.json";

function loadMatchImageCache() {
  try {
    if (existsSync(MATCH_IMG_CACHE)) {
      const raw = readFileSync(MATCH_IMG_CACHE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {
    // ignore
  }
  return {};
}

function saveMatchImageCache(cache) {
  try {
    writeFileSync(MATCH_IMG_CACHE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {
    // ignore
  }
}

// ================= POSTED MATCH TRACKING =================

const POSTED_MATCH_CACHE = "/tmp/posted_matches_cache.json";

function loadPostedMatchCache() {
  try {
    if (existsSync(POSTED_MATCH_CACHE)) {
      const raw = readFileSync(POSTED_MATCH_CACHE, "utf-8");
      return JSON.parse(raw);
    }
  } catch {}
  return {};
}

function savePostedMatchCache(cache) {
  try {
    writeFileSync(POSTED_MATCH_CACHE, JSON.stringify(cache, null, 2), "utf-8");
  } catch {}
}

// ================= TRANSFORMATION FUNCTIONS =================

/**
 * Transform raw channel data to new JSON structure
 * Returns simple array of channel objects as specified
 */
function transformChannelData(rawData) {
  try {
    const channelsArray = [];

    // Handle different input formats
    let channelsToProcess = [];

    if (rawData.CHANNELS && Array.isArray(rawData.CHANNELS)) {
      // Original format with CHANNELS array
      channelsToProcess = rawData.CHANNELS;
    } else if (Array.isArray(rawData)) {
      // Direct array format
      channelsToProcess = rawData;
    } else if (rawData.channels && Array.isArray(rawData.channels)) {
      // Already transformed format
      channelsToProcess = rawData.channels;
    }

    for (const channel of channelsToProcess) {
      let newChannel = {};

      // Handle old format: {name, img, url1, url2, url3, url4}
      if (channel.name && channel.img && channel.url1) {
        // Convert old format to new format
        newChannel = {
          img: rewriteFacebookUrl(channel.img) || "",
          url: rewriteFacebookUrl(channel.url1), // Use url1 as the main URL
          name: channel.name || "Unnamed Channel",
        };
      }
      // Handle original format: {CN, MURL, MPD}
      else if (channel.CN || channel.MURL || channel.MPD) {
        newChannel = {
          img: rewriteFacebookUrl(channel.MURL) || "",
          url: rewriteFacebookUrl(channel.MPD),
          name: channel.CN || "Unnamed Channel",
        };
      }
      // Handle already transformed format
      else if (channel.name || channel.img || channel.url) {
        newChannel = {
          img: channel.img || "",
          url: channel.url || "",
          name: channel.name || "Unnamed Channel",
        };
      }

      if (newChannel.name) {
        // Filter: Only keep HD channels (remove SD channels)
        if (!isSDChannel(newChannel.name)) {
          // Rename channel to standardized format
          newChannel.name = renameChannel(newChannel.name);
          channelsArray.push(newChannel);
          console.log(`✅ Processed: ${newChannel.name}`);
        } else {
          console.log(`⏭️  Skipped SD channel: ${newChannel.name}`);
        }
      }
    }

    // Return just the channels array as specified
    return channelsArray;
  } catch (error) {
    console.error("❌ Error transforming data:", error);
    throw error;
  }
}

/**
 * Check if channel is SD (Standard Definition)
 */
function isSDChannel(channelName) {
  const name = channelName.toLowerCase();
  // Skip SD channels
  return name.includes("sd") || name.includes("standard");
}

/**
 * Rename channels to standardized format
 */
function renameChannel(channelName) {
  return channelName;
}

/**
 * Fetch channels from Python TV app scraper
 */
function getPythonChannels() {
  return new Promise((res) => {
    const scriptPath = resolve(scriptDir, "facebook_scraper.py");
    if (!existsSync(scriptPath)) {
      console.error("❌ facebook_scraper.py not found at:", scriptPath);
      res([]);
      return;
    }
    execFile("python3", ["facebook_scraper.py", "--channels-only"], {
      timeout: 60000,
      cwd: scriptDir,
    }, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Python channels error:", error.message);
        if (stderr) console.error("   stderr:", stderr);
        res([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const channels = Array.isArray(parsed) ? parsed : [];
        console.log(`✅ Got ${channels.length} channels from Python scraper`);
        res(channels);
      } catch (parseErr) {
        console.error("❌ Failed to parse Python output:", parseErr.message);
        res([]);
      }
    });
  });
}

/**
 * Transform Python channels to match the standard {img, url, name} format
 */
function transformPythonChannels(pythonChannels) {
  if (!Array.isArray(pythonChannels)) {
    console.error("  ⚠️ pythonChannels is not an array, skipping");
    return [];
  }
  return pythonChannels.map((ch) => ({
    img: rewriteFacebookUrl(ch.img) || "",
    url: rewriteFacebookUrl(ch.url) || "",
    name: ch.name || "Unnamed Channel",
  })).filter((ch) => {
    if (!ch.url || !ch.name) return false;
    if (isSDChannel(ch.name)) {
      console.log(`⏭️  Skipped SD channel (Python): ${ch.name}`);
      return false;
    }
    ch.name = renameChannel(ch.name);
    return true;
  });
}

/**
 * Fetch matches from Python TV app scraper
 */
function getPythonMatches() {
  return new Promise((res) => {
    const scriptPath = resolve(scriptDir, "facebook_scraper.py");
    if (!existsSync(scriptPath)) {
      console.error("❌ facebook_scraper.py not found at:", scriptPath);
      res([]);
      return;
    }
    execFile("python3", ["facebook_scraper.py", "--matches-only"], {
      timeout: 60000,
      cwd: scriptDir,
    }, (error, stdout, stderr) => {
      if (error) {
        console.error("❌ Python matches error:", error.message);
        if (stderr) console.error("   stderr:", stderr);
        res([]);
        return;
      }
      try {
        const parsed = JSON.parse(stdout.trim());
        const matches = Array.isArray(parsed) ? parsed : [];
        console.log(`✅ Got ${matches.length} matches from Python scraper`);
        res(matches);
      } catch (parseErr) {
        console.error("❌ Failed to parse matches output:", parseErr.message);
        res([]);
      }
    });
  });
}

/**
 * Upload a merged match image (flags or text) to Facebook and return the direct URL
 */
function uploadMatchLogo(st_name, ft_name, img_1_url = "", img_2_url = "") {
  return new Promise((res) => {
    const scriptPath = resolve(scriptDir, "facebook_scraper.py");
    if (!existsSync(scriptPath)) {
      res("");
      return;
    }
    const args = ["facebook_scraper.py", "--upload-vs", st_name, ft_name, POST_ACCESS_TOKEN];
    if (img_1_url) args.push(img_1_url);
    if (img_2_url) args.push(img_2_url);
    execFile("python3", args, {
      timeout: 45000,
      cwd: scriptDir,
    }, (error, stdout, stderr) => {
      if (error) {
        console.error(`❌ Failed to upload image for ${st_name} vs ${ft_name}:`, error.message);
        res("");
        return;
      }
      const url = stdout.trim();
      if (url) console.log(`  📸 Image URL: ${url.slice(0, 60)}...`);
      res(url);
    });
  });
}

/**
 * Only filter matches by date (yesterday or earlier).
 * Expiry-by-time is handled by posted cache (24h from first-seen).
 */
function filterMatchesByTime(matches) {
  const nowDate = new Date();
  return matches.filter((m) => {
    const matchName = m.name || (m.st_name + " vs " + m.ft_name);

    // Check date field (DD-MM-YYYY) — if before today, expired
    if (m.date) {
      const parts = m.date.split("-").map(Number);
      if (parts.length === 3 && !isNaN(parts[0]) && !isNaN(parts[1]) && !isNaN(parts[2])) {
        const matchDate = new Date(parts[2], parts[1] - 1, parts[0]);
        const today = new Date(nowDate.getFullYear(), nowDate.getMonth(), nowDate.getDate());
        if (matchDate < today) {
          console.log(`  ❌ Expired match (date ${m.date}): ${matchName}`);
          return false;
        }
      }
    }

    return true;
  });
}

/**
 * Generate a merged match image with team flags, or fall back to generic placeholder.
 * Caches per match (keyed by st_name|ft_name) to avoid re-uploading.
 */
async function getOrCreateMatchImage(m) {
  const cache = loadMatchImageCache();
  const key = (m.st_name || "") + "|" + (m.ft_name || "");
  const cached = cache[key];
  if (cached) return cached;
  const img_1 = m.img_1 || "";
  const img_2 = m.img_2 || "";
  const hasFlags = img_1 && img_2;
  let imgUrl;
  if (hasFlags) {
    imgUrl = await uploadMatchLogo(m.st_name || "", m.ft_name || "", img_1, img_2);
  } else {
    // Fall back to generic placeholder (cached as "default")
    if (cache["default"]) {
      imgUrl = cache["default"];
    } else {
      imgUrl = await uploadMatchLogo("", "");
      if (imgUrl) cache["default"] = imgUrl;
    }
  }
  if (imgUrl) {
    cache[key] = imgUrl;
    saveMatchImageCache(cache);
  }
  return imgUrl || "";
}

/**
 * Transform Python matches to the standard {img, url, name} format
 * Generates per-match merged images with team flags when available.
 */
async function transformPythonMatches(pythonMatches) {
  const results = [];
  for (const m of pythonMatches) {
    const imgUrl = await getOrCreateMatchImage(m);
    const urls = m.urls && m.urls.length > 0 ? m.urls : (m.url ? [m.url] : []);
    if (urls.length === 0) {
      console.log(`  ⏳ ${m.name}: no stream yet (added as placeholder)`);
      results.push({
        img: imgUrl,
        url: "",
        name: m.name || "Unnamed Match",
      });
    } else {
      let serverIdx = 0;
      for (const rawUrl of urls) {
        const rewritten = rewriteFacebookUrl(rawUrl);
        if (!rewritten) continue;
        const suffix = serverIdx === 0 ? "" : `S${serverIdx + 1}`;
        console.log(`  ✅ ${m.name}${suffix}: ${rewritten.slice(0, 60)}...`);
        results.push({
          img: imgUrl,
          url: rewritten,
          name: m.name + suffix || "Unnamed Match",
        });
        serverIdx++;
      }
    }
  }
  return results;
}

/**
 * Check if a channel URL is actually working via HTTP HEAD
 * Facebook CDN URLs always return 403 to HEAD requests, skip them
 */
async function isUrlWorking(url) {
  if (!url) return true;  // placeholder items (no stream yet)
  if (url.includes("fbcdn.net")) return true;
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10000);
    const response = await fetch(url, { method: "GET", signal: controller.signal });
    clearTimeout(timeout);
    return response.ok || response.status === 206;
  } catch {
    return false;
  }
}

/**
 * Filter channels by testing each URL, with concurrency control
 */
async function filterWorkingChannels(channels, concurrency = 5) {
  const results = new Array(channels.length).fill(false);
  let idx = 0;

  async function worker() {
    while (idx < channels.length) {
      const i = idx++;
      const ch = channels[i];
      const ok = await isUrlWorking(ch.url);
      results[i] = ok;
      if (ok) {
        console.log(`  ✅ ${ch.name}`);
      } else {
        console.log(`  ❌ ${ch.name}`);
      }
    }
  }

  await Promise.all(Array.from({ length: concurrency }, worker));
  return channels.filter((_, i) => results[i]);
}

/**
 * Rewrite Facebook URLs to use cached CDN domains
 */
function rewriteFacebookUrl(url) {
  try {
    const u = new URL(url);
    let newDomain;

    // Check if the URL is a video (mpd/m3u8 or contains /hvideo/)
    const isVideo =
      u.pathname.includes("/hvideo") || u.pathname.endsWith(".mpd");

    if (isVideo) {
      // Video URL
      newDomain = "https://video.xx.fbcdn.net";
    } else {
      // Image URL
      newDomain = "https://scontent.xx.fbcdn.net";
    }

    // Rebuild the URL with the new domain
    return `${newDomain}${u.pathname}${u.search}`;
  } catch (error) {
    console.error("❌ URL rewrite error:", error);
    return url;
  }
}

// ================= ENCRYPTION FUNCTIONS =================

/**
 * Generate SHA-256 key from password
 */
function generateKey(password) {
  try {
    const hash = crypto.createHash("sha256");
    hash.update(Buffer.from(password, "utf-8"));
    return hash.digest();
  } catch (err) {
    throw new Error(`Key generation error: ${err.message}`);
  }
}

/**
 * Encrypt data using AES-256-ECB
 */
function encryptData(data, password) {
  try {
    const key = generateKey(password);
    const cipher = crypto.createCipheriv("aes-256-ecb", key, null);

    let encrypted = cipher.update(data, "utf8", "base64");
    encrypted += cipher.final("base64");

    console.log(`✅ Data encrypted successfully (${encrypted.length} chars)`);
    return encrypted;
  } catch (err) {
    console.error(`❌ Encryption error: ${err.message}`);
    throw err;
  }
}

// ================= FACEBOOK API FUNCTIONS =================

/**
 * Post encrypted data to Facebook
 */
async function postToFacebook(transformedData) {
  try {
    // Step 1: Convert to JSON string
    const jsonString = JSON.stringify(transformedData);
    console.log(`\n📝 JSON String created (${jsonString.length} chars)`);

    // Step 2: Encrypt the data
    const encryptedData = encryptData(jsonString, ENCRYPT_PASSWORD);

    // Step 3: Create payload with markers
    const payload = "ANAMATRIC" + encryptedData + "ENDMATRIC";
    console.log(`📦 Payload created with markers (${payload.length} chars)`);

    // Step 4: Post to Facebook (using POST credentials)
    console.log(`\n📤 Posting to Facebook...`);
    console.log(`   Target Post ID: ${POST_ID}`);

    const response = await fetch(
      `https://graph.facebook.com/v19.0/${POST_ID}`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          message: payload,
          access_token: POST_ACCESS_TOKEN,
        }).toString(),
      },
    );

    const responseData = await response.json();

    if (!response.ok) {
      throw new Error(`Facebook API error: ${JSON.stringify(responseData)}`);
    }

    console.log(`✅ Successfully posted to Facebook!`);
    console.log(`📌 Post ID: ${responseData.id}`);
    return responseData;
  } catch (error) {
    console.error(`❌ Error posting to Facebook:`, error.message);
    throw error;
  }
}

// ================= MAIN WORKFLOW =================

/**
 * Main workflow function: Fetch -> Decrypt -> Transform -> Encrypt -> Post
 */
async function runWorkflow() {
  try {
    const timestamp = new Date().toLocaleString();
    console.log(`\n🔄 [${timestamp}] Starting workflow...\n`);

    // Step 1: Fetch from Facebook (using EXTRACT credentials)
    console.log("1️⃣  Fetching data from Facebook...");
    console.log(`   Source Post ID: ${EXTRACT_POST_ID}`);

    const fetchResponse = await fetch(
      `https://graph.facebook.com/v16.0/${EXTRACT_POST_ID}?access_token=${EXTRACT_ACCESS_TOKEN}`,
    );
    const fetchedData = await fetchResponse.json();
    const message = fetchedData?.message;

    if (!message || typeof message !== "string") {
      throw new Error("No message found in Facebook post");
    }
    console.log(`✅ Message fetched (${message.length} chars)\n`);

    // Step 2: Decrypt the message
    console.log("2️⃣  Decrypting data...");
    const decryptedData = decryptData(message, DECRYPT_PASSWORD);
    console.log(`✅ Data decrypted (${decryptedData.length} chars)\n`);

    // Step 3: Parse as JSON
    console.log("3️⃣  Parsing JSON...");
    const parsedData = JSON.parse(decryptedData);
    console.log(`✅ Parsed data successfully\n`);

    // Step 4: Transform to new structure
    console.log("4️⃣  Transforming to new JSON structure...");
    const transformedData = transformChannelData(parsedData);
    console.log(
      `✅ Transformation complete (${transformedData.length} channels)\n`,
    );

    // Display transformed structure
    console.log("📊 Transformed Channels Array:");
    console.log(JSON.stringify(transformedData, null, 2));
    console.log("\n");

    // Validate ALL existing data URLs (remove dead channels + finished matches)
    console.log(`   Validating ${transformedData.length} existing items...`);
    const validExisting = await filterWorkingChannels(transformedData, 5);
    const removedCount = transformedData.length - validExisting.length;
    if (removedCount > 0) {
      console.log(`   🗑 Removed ${removedCount} dead/finished items from existing data`);
    }
    transformedData.length = 0;
    transformedData.push(...validExisting);

    // Step 4.5: Fetch channels from Python scraper, validate, then append
    console.log("4.5️⃣  Fetching additional channels from Python scraper...");
    const pythonChannels = await getPythonChannels();
    if (pythonChannels.length > 0) {
      let transformedPython = transformPythonChannels(pythonChannels);
      console.log(
        `   Validating ${transformedPython.length} Python channel URLs...`,
      );
      transformedPython = await filterWorkingChannels(transformedPython, 5);
      console.log(
        `   Adding ${transformedPython.length} working Python channels to the list`,
      );
      transformedData.push(...transformedPython);
      console.log(
        `   Total channels now: ${transformedData.length}\n`,
      );
    } else {
      console.log("   No Python channels to add\n");
    }

    // Step 4.6: Fetch matches from Python scraper, validate, then append
    console.log("4.6️⃣  Fetching matches from Python scraper...");
    const pythonMatches = await getPythonMatches();
    const postedCache = loadPostedMatchCache();
    const now = Date.now();
    const twentyFourHours = 24 * 3600 * 1000;
    const newMatchKeys = {};
    if (pythonMatches.length > 0) {
      const filteredMatches = filterMatchesByTime(pythonMatches);
      // Remove matches posted >24h ago
      const activeMatches = filteredMatches.filter((m) => {
        const key = (m.st_name || "") + "|" + (m.ft_name || "");
        const postedTime = postedCache[key];
        if (postedTime && (now - postedTime) > twentyFourHours) {
          console.log(`  🗑 Removed (first seen >24h ago): ${m.name}`);
          return false;
        }
        return true;
      });
      if (activeMatches.length > 0) {
        let transformedMatches = await transformPythonMatches(activeMatches);
        // Track new match keys with timestamp
        for (const m of activeMatches) {
          const key = (m.st_name || "") + "|" + (m.ft_name || "");
          if (!postedCache[key]) {
            newMatchKeys[key] = now;
            const matchTime = m.time || "??:??";
            const matchDate = m.date || "??-??-????";
            console.log(`  🆕 New match added: ${m.name || key} at ${matchTime} ${matchDate} (first seen: ${new Date(now).toLocaleString()})`);
          }
        }
        console.log(
          `   Adding ${transformedMatches.length} matches to the list`,
        );
        transformedData.unshift(...transformedMatches);
        console.log(
          `   Total items now: ${transformedData.length}\n`,
        );
      } else {
        console.log("   No active matches to add\n");
      }
    } else {
      console.log("   No matches to add\n");
    }

    // Step 5: Encrypt and Post to Facebook (using POST credentials)
    console.log("5️⃣  Encoding and posting to Facebook...");
    await postToFacebook(transformedData);

    // Update posted match cache with newly tracked matches
    const postedCacheNow = loadPostedMatchCache();
    const newKeys = Object.keys(newMatchKeys).length;
    if (newKeys > 0) {
      Object.assign(postedCacheNow, newMatchKeys);
      savePostedMatchCache(postedCacheNow);
      console.log(`   📝 Tracked ${newKeys} new match(es) for 24h expiry`);
    }

    console.log(`\n✅ [${timestamp}] Workflow completed successfully!`);
    console.log("🎉 Data extracted, transformed, and posted!");
    console.log("⏰ Next run in 15 minutes...\n");
  } catch (error) {
    const timestamp = new Date().toLocaleString();
    console.error(`\n❌ [${timestamp}] Workflow failed:`, error.message);
    console.log("⏰ Continuing loop - next run in 2 minutes...\n");
  }
}

/**
 * Start the automated workflow loop
 */
function startAutomatedWorkflow() {
  console.log("🚀 Starting automated workflow...");
  console.log("📅 Will run every 15 minutes\n");

  // Run immediately on start
  runWorkflow();

  // Then run every 2 minutes (120,000 milliseconds)
  setInterval(runWorkflow, 15 * 60 * 1000); // 15 minutes
}

// Handle graceful shutdown
process.on("SIGINT", () => {
  console.log("\n🛑 Received SIGINT. Gracefully shutting down...");
  process.exit(0);
});

process.on("SIGTERM", () => {
  console.log("\n🛑 Received SIGTERM. Gracefully shutting down...");
  process.exit(0);
});

// Start the automated workflow
startAutomatedWorkflow();
