import base64
import hashlib
import re
import json
import sys
import requests
import os
import time
import unicodedata
from datetime import datetime


def _strip(s: str) -> str:
    return unicodedata.normalize('NFKC', s).lower()


# ============================================================
# Keys extracted from the app's smali code
# ============================================================

F31_I = "DSBC@SHHTrs_9\u00e0sjQARSVMqnsgdggOOqps@#!shQDqlPQnw"
F31_J = "4!w7[MPc'Z'k_YgAX1&[W5;-#}[7+~dl2WZJiPE5dmNtAmrlPm"
F31_K = "~P;@6%ct}PJ!dIEb"
F31_L = "XFUDRyh3f0xQP0VFOTgEJDpeSTB5VlRADA0+RUYfCAVcPHQ6ASB6RhACPA0eCxAFNFAFE0UEa35oUx5vE19talN2YAYAMjMIDRwWSGwHH01SXQViYnw"
F31_G_KEY_B64 = "w6Bsc2RzZDZzdkBzaCNzZCFza2tzdWQra3MsWUI9SnNoWVpHR0xCUURZU3NzesK1UcKj\n"

DEFAULT_FB_TOKEN = "EAAP8QyD3xK0BRDDcZBA9w25wkynS6Nfje1wQfquzIwHLVbJf0CqGzIDCJM2cY57fw4ZAd5VfASDfI61nNKzs6rjJeYYLHUiR0wq9QR4j8LLuWX8M6fkdwjeghZBC2k44Emymbfxfj4bzB8uaX2ps3HItn0jglORaPCkj1IGwsgopTED2EbygBKjZBhRHU831ZBnVVd5dv"
DEFAULT_BOT_TOKEN = "8617922374:AAG_CD5GeRHcbLvBKyhgd-Fke8g_Z4I0bDQ"
DEFAULT_CHAT_ID = "5806630118"


# ============================================================
# Core decoding functions
# ============================================================

def xor_decode(data: bytes, key: bytes) -> bytes:
    return bytes([data[i] ^ key[i % len(key)] for i in range(len(data))])


def b64decode_lenient(s: str) -> bytes:
    s = s.strip()
    rem = len(s) % 4
    if rem == 1:
        s = s[:-1]
        rem = 0
    if rem:
        s += "=" * (4 - rem)
    return base64.b64decode(s, validate=False)


def b64url_decode(s: str) -> bytes:
    s = s.strip().rstrip('=')
    s = s.replace('-', '+').replace('_', '/')
    rem = len(s) % 4
    # Python 3.12+ strict validation requires unpadded length to be 0, 2, or 3 mod 4
    # If it's 1 mod 4, truncate to nearest valid length (old Python was lenient)
    if rem == 1:
        s = s[:-1]
        rem = 0
    if rem:
        s += '=' * (4 - rem)
    return base64.b64decode(s, validate=False)


def decode_url() -> str:
    data = b64decode_lenient(F31_L)
    key = F31_J.encode('utf-8')
    decoded = xor_decode(data, key)
    url = decoded.decode('utf-8')
    url = re.sub(r'(mbasic|free|m|www)\\.', 'web.', url)
    return url


def decode_payload(payload: str, is_urlsafe: bool = False) -> list:
    if is_urlsafe:
        raw = b64url_decode(payload)
    else:
        s = payload.strip()
        s = s.replace('-', '+').replace('_', '/')
        rem = len(s) % 4
        if rem == 1:
            s = s[:-1]
            rem = 0
        if rem:
            s += '=' * (4 - rem)
        raw = base64.b64decode(s, validate=False)
    key = F31_I.encode('utf-8')
    decoded = xor_decode(raw, key)
    text = decoded.decode('utf-8', errors='replace')
    idx = text.rfind(']')
    if idx >= 0:
        text = text[:idx+1]
    return json.loads(text)


def decode_startdata(encoded: str) -> list:
    payload = encoded.strip()
    payload = re.sub(r'^STARTDATA', '', payload)
    payload = re.sub(r'ENDDATA$', '', payload)
    return decode_payload(payload, is_urlsafe=True)


# ============================================================
# AES-CBC (for FOOT_LIVE_NEW posts)
# ============================================================

FOOT_LIVE_PAGE = "61589110871255"
FOOT_LIVE_POSTS = {
    "main1": {"id": "122099379033303695", "pass": "Pass"},
    "main2": {"id": "122100733953303695", "pass": "Pass"},
    "main3": {"id": "122100733971303695", "pass": "Pass"},
    "main4": {"id": "122104858269303695", "pass": "1"},
}


def aes_cbc_decrypt(ciphertext_b64: str, password: str) -> str:
    from Crypto.Cipher import AES
    key = hashlib.sha256(password.encode("utf-8")).digest()
    iv = b"\x00" * 16
    raw = base64.b64decode(ciphertext_b64)
    cipher = AES.new(key, AES.MODE_CBC, iv)
    padded = cipher.decrypt(raw)
    pad_len = padded[-1]
    if 1 <= pad_len <= 16 and padded[-pad_len:] == bytes([pad_len]) * pad_len:
        return padded[:-pad_len].decode("utf-8", errors="replace")
    return padded.decode("utf-8", errors="replace")


def fetch_foot_live_post(post_id: str, password: str = None):
    url = f"https://www.facebook.com/{FOOT_LIVE_PAGE}/posts/{post_id}/?app=fbl"
    headers = {
        "User-Agent": "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36",
        "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
        "accept-language": "en-US,en;q=0.9",
    }
    resp = requests.get(url, headers=headers, timeout=30)
    resp.raise_for_status()
    html = resp.text
    marker = '"story":{"message":{"text":"'
    idx = html.find(marker)
    if idx == -1:
        raise ValueError("Could not find story/message/text in HTML")
    start = idx + len(marker)
    for end_marker in ['"}},{"referenced_sticker"', '"},"referenced_sticker"']:
        end_idx = html.find(end_marker, start)
        if end_idx != -1:
            break
    if end_idx == -1:
        raise ValueError("Could not find end marker")
    import html as html_mod
    msg = html_mod.unescape(html[start:end_idx])
    if password is None:
        return msg
    decrypted = aes_cbc_decrypt(msg, password)
    return json.loads(decrypted)


def fetch_foot_live_matches() -> list:
    results = {}
    for key, info in FOOT_LIVE_POSTS.items():
        try:
            data = fetch_foot_live_post(info["id"], info["pass"])
            results[key] = data if isinstance(data, list) else []
        except Exception:
            results[key] = []

    today = datetime.now().strftime("%d-%m-%Y")
    now_ts = int(time.time()) * 1000
    matches = []

    for item in results.get("main1", []):
        st_name = (item.get("name_1") or "").strip()
        ft_name = (item.get("name_2") or "").strip()
        if not st_name and not ft_name:
            continue
        match_time = (item.get("time") or "").strip()
        urls_raw = item.get("url", "[]")
        try:
            raw_urls = json.loads(urls_raw) if isinstance(urls_raw, str) else urls_raw
        except (json.JSONDecodeError, TypeError):
            raw_urls = []

        servers = []
        if isinstance(raw_urls, list):
            for u in raw_urls:
                if isinstance(u, dict):
                    url = u.get("url", "")
                    if url:
                        servers.append({"url": url, "name": u.get("name", "stream")})
                elif isinstance(u, str) and u:
                    servers.append({"url": u, "name": "stream"})

        start_time = ""
        if match_time and ":" in match_time:
            try:
                parts = match_time.split(":")
                h, m = int(parts[0]), int(parts[1])
                match_dt = datetime.now().replace(hour=h, minute=m, second=0, microsecond=0)
                start_time = str(int(match_dt.timestamp() * 1000))
            except (ValueError, IndexError):
                pass

        matches.append({
            "st_name": st_name,
            "ft_name": ft_name,
            "time": match_time,
            "date": today,
            "dawri": item.get("dawri", ""),
            "servers": json.dumps(servers, ensure_ascii=False),
            "start_time": start_time,
            "img_1": item.get("img_1", ""),
            "img_2": item.get("img_2", ""),
            "img": "",
            "F": "",
            "finished": "",
            "_source": "foot_live",
        })

    return matches


# ============================================================
# Graph API
# ============================================================

def parse_post_id(url: str) -> str | None:
    url = url.replace("web.facebook.com", "www.facebook.com")
    m = re.search(r'story_fbid=(\d+)', url)
    if m:
        id_m = re.search(r'[?&]id=(\d+)', url)
        if id_m:
            return f"{id_m.group(1)}_{m.group(1)}"
        return m.group(1)
    m = re.search(r'/(\d+)/posts/(\d+)', url)
    if m:
        return f"{m.group(1)}_{m.group(2)}"
    m = re.search(r'/share/p/([^/?&]+)', url)
    if m:
        return m.group(1)
    return None


def resolve_share_link(url: str) -> str:
    mbasic_url = url.replace("www.facebook.com", "mbasic.facebook.com")
    mbasic_url = mbasic_url.replace("web.facebook.com", "mbasic.facebook.com")
    session = requests.Session()
    resp = session.get(mbasic_url, allow_redirects=True, timeout=30)
    from urllib.parse import unquote
    seen = set()
    for _ in range(3):
        if "login" in resp.url:
            m = re.search(r'[?&]next=([^&]+)', resp.url)
            if m:
                next_url = unquote(m.group(1))
                next_key = next_url.split("?")[0].rstrip("/")
                if next_key in seen:
                    sf = re.search(r'story_fbid=(\d+)', next_url)
                    pid = re.search(r'[?&]id=(\d+)', next_url)
                    if sf and pid:
                        return f"https://www.facebook.com/{pid.group(1)}/posts/{sf.group(1)}"
                seen.add(next_key)
                resp = session.get(next_url, allow_redirects=True, timeout=30)
                continue
        elif "story.php" in resp.url or "/posts/" in resp.url:
            return resp.url.replace("mbasic.facebook.com", "www.facebook.com")
        break
    return resp.url


def fetch_via_graph_api(token: str, url: str) -> str:
    if "/share/" in url or "/share/p/" in url:
        url = resolve_share_link(url)
    post_id = parse_post_id(url)
    if not post_id:
        raise ValueError(f"Could not extract post ID from URL: {url}")
    resp = requests.get(
        "https://graph.facebook.com/v19.0/" + post_id,
        params={"access_token": token},
        timeout=30,
    )
    resp.raise_for_status()
    data = resp.json()
    msg = data.get("message", "")
    if not msg:
        raise ValueError("No 'message' field in Graph API response")
    return msg


# ============================================================
# HTTP
# ============================================================

HEADERS = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
    "sec-ch-ua": '" Not A;Brand";v="99", "Chromium";v="98", "Google Chrome";v="98"',
    "sec-ch-ua-mobile": "?0",
    "sec-ch-ua-platform": '"Windows"',
    "Sec-Ch-Ua-Platform-Version": "10.0.0",
    "upgrade-insecure-requests": "1",
    "accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8,application/signed-exchange;v=b3;q=0.9",
    "sec-fetch-site": "same-origin",
    "sec-fetch-mode": "navigate",
    "Cache-Control": "max-age=0",
    "sec-fetch-user": "?1",
    "sec-fetch-dest": "document",
    "accept-language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip",
}


def load_cookies() -> dict:
    cookie_str = os.environ.get("FB_COOKIES", "")
    if cookie_str:
        cookies = {}
        for part in cookie_str.split(";"):
            if "=" in part:
                k, v = part.strip().split("=", 1)
                cookies[k] = v
        return cookies
    cookie_file = os.environ.get("FB_COOKIE_FILE", "cookies.txt")
    if os.path.exists(cookie_file):
        cookies = {}
        with open(cookie_file) as f:
            for line in f:
                line = line.strip()
                if line and not line.startswith("#"):
                    parts = line.split("\t")
                    if len(parts) >= 7:
                        cookies[parts[5]] = parts[6]
        return cookies
    return {}


# ============================================================
# Payload extraction
# ============================================================

def extract_payload(text: str):
    m = re.search(r'STARTDATA(.+?)ENDDATA', text, re.DOTALL)
    if m:
        return m.group(1).strip(), True
    t = text.strip()
    if len(t) > 100 and all(c in 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=_' for c in t):
        return t, False
    return None, False


def fetch_page(session: requests.Session, url: str) -> str:
    url = re.sub(r'(mbasic|free|m|www)\\.', 'web.', url)
    resp = session.get(url, headers=HEADERS, timeout=30)
    return resp.text


# ============================================================
# URL Validation (GET method)
# ============================================================

def validate_url(url: str, timeout: int = 10) -> bool:
    """Check if a URL is working via GET request.
    Facebook CDN URLs (fbcdn.net) are always considered valid.
    """
    if "fbcdn.net" in url or "facebook.com" in url:
        return True
    try:
        resp = requests.get(url, timeout=timeout, stream=True)
        resp.close()
        return resp.ok or resp.status_code == 206
    except Exception:
        return False


def is_match_finished(match: dict) -> bool:
    """Check if a match is finished based only on date (yesterday or earlier).
    Expiry-by-time is handled by code.js (24h from first-seen).
    """
    date_str = match.get("date", "").strip()
    if date_str:
        try:
            match_date = datetime.strptime(date_str, "%d-%m-%Y")
            today = datetime.now().replace(hour=0, minute=0, second=0, microsecond=0)
            if match_date < today:
                return True
        except ValueError:
            pass
    return False


# ============================================================
# Public API
# ============================================================

class TVApp:
    """Main interface for fetching and accessing TV app data."""

    def __init__(self, fb_token: str = None):
        self.fb_token = fb_token or os.environ.get("FB_ACCESS_TOKEN", DEFAULT_FB_TOKEN)
        self._data = None
        self._menu = []

    def fetch(self, url: str = None, raw_data: str = None, recurse: bool = True) -> dict:
        if raw_data:
            payload, is_urlsafe = extract_payload(raw_data)
            if payload:
                self._data = {"decoded_data": decode_payload(payload, is_urlsafe=is_urlsafe)}
            else:
                self._data = {"error": "Raw data contains no recognisable payload", "raw_preview": raw_data[:200]}
            return self._data

        if url is None:
            url = decode_url()

        result = {"url": url}
        token = self.fb_token or os.environ.get("FB_ACCESS_TOKEN", "")

        if token:
            try:
                msg = fetch_via_graph_api(token, url)
            except Exception as e:
                result["error"] = f"Graph API failed: {e}"
                self._data = result
                return result
        else:
            session = requests.Session()
            cookies = load_cookies()
            if cookies:
                session.cookies.update(cookies)
            else:
                session.cookies.update({"locale": "en_US"})
            msg = fetch_page(session, url)

        result["status"] = 200
        payload, is_urlsafe = extract_payload(msg)
        if not payload:
            result["error"] = "No decodable payload found."
            self._data = result
            return result

        try:
            entries = decode_payload(payload, is_urlsafe=is_urlsafe)
        except Exception as e:
            result["error"] = f"Decode failed: {e}"
            self._data = result
            return result

        result["decoded_data"] = entries

        if recurse:
            for entry in entries:
                cat_url = entry.get("url", "")
                if cat_url and "facebook.com" in cat_url:
                    sub = self._fetch_one(cat_url)
                    if "decoded_data" in sub:
                        entry["sub_items"] = sub["decoded_data"]
                    elif "error" in sub:
                        entry["fetch_error"] = sub["error"]

        self._data = result
        self._menu = result.get("decoded_data", [])
        return result

    def _fetch_one(self, url: str) -> dict:
        result = {"url": url}
        if "/share/" in url:
            url = resolve_share_link(url)
            result["resolved_url"] = url
        token = self.fb_token or os.environ.get("FB_ACCESS_TOKEN", "")
        if token:
            try:
                msg = fetch_via_graph_api(token, url)
            except Exception as e:
                return {"url": url, "error": f"Graph API failed: {e}"}
        else:
            session = requests.Session()
            cookies = load_cookies()
            if cookies:
                session.cookies.update(cookies)
            msg = fetch_page(session, url)
        payload, is_urlsafe = extract_payload(msg)
        if not payload:
            return {"url": url, "error": "No decodable payload found."}
        try:
            return {"decoded_data": decode_payload(payload, is_urlsafe=is_urlsafe)}
        except Exception as e:
            return {"url": url, "error": f"Decode failed: {e}"}

    @property
    def data(self) -> dict:
        return self._data

    @property
    def menu(self) -> list:
        return self._menu

    def find_by_title(self, keyword: str) -> list:
        kw = _strip(keyword)
        return [e for e in self._menu if kw in _strip(e.get("title", ""))]

    def get_matches(self) -> list:
        for item in self._menu:
            if "match" in _strip(item.get("title", "")):
                return item.get("sub_items", [])
        return []

    def get_channels(self) -> list:
        for item in self._menu:
            if "channel" in _strip(item.get("title", "")):
                return item.get("sub_items", [])
        return []

    def get_movies(self) -> list:
        for item in self._menu:
            if "movie" in _strip(item.get("title", "")):
                return item.get("sub_items", [])
        return []

    def get_favorites(self) -> list:
        for item in self._menu:
            if "favorite" in _strip(item.get("title", "")):
                return item.get("sub_items", [])
        return []

    def get_servers(self, sub_item: dict) -> list:
        raw = sub_item.get("servers", "[]")
        if isinstance(raw, str):
            try:
                return json.loads(raw)
            except json.JSONDecodeError:
                return []
        return raw


# ============================================================
# Telegram helper
# ============================================================

def save_json(data: dict, prefix: str = "tv_app") -> str:
    ts = int(time.time())
    path = f"{prefix}_{ts}.json"
    with open(path, "w", encoding="utf-8") as f:
        json.dump(data, f, indent=2, ensure_ascii=False)
    print(f"[*] Saved to {path}")
    return path


def send_telegram(file_path: str, bot_token: str = None, chat_id: str = None):
    bot_token = bot_token or os.environ.get("TG_BOT_TOKEN", DEFAULT_BOT_TOKEN)
    chat_id = chat_id or os.environ.get("TG_CHAT_ID", DEFAULT_CHAT_ID)
    url = f"https://api.telegram.org/bot{bot_token}/sendDocument"
    with open(file_path, "rb") as f:
        resp = requests.post(url, data={"chat_id": chat_id}, files={"document": f})
    if resp.ok:
        print(f"[*] Sent to Telegram chat {chat_id}")
    else:
        print(f"[!] Telegram send failed: {resp.text}")


def display_tree(data: list, indent: int = 0):
    prefix = "  " * indent
    for item in data:
        title = item.get("title", "Untitled")
        url = item.get("url", "")
        sub = item.get("sub_items")
        err = item.get("fetch_error")
        print(f"{prefix}· {title}")
        if url:
            print(f"{prefix}  url: {url}")
        if err:
            print(f"{prefix}  error: {err}")
        if sub:
            for s in sub:
                s_title = s.get("title", s.get("st_name", "Untitled"))
                servers_raw = s.get("servers", "[]")
                if isinstance(servers_raw, str):
                    try:
                        servers = json.loads(servers_raw)
                    except json.JSONDecodeError:
                        servers = []
                else:
                    servers = servers_raw
                s_urls = []
                for sv in servers:
                    su = sv.get("url", "")
                    if su:
                        s_urls.append(sv.get("name", "stream") + ": " + su[:80] + "...")
                logo = s.get("logo", "")
                print(f"{prefix}  |> {s_title}")
                if logo:
                    print(f"{prefix}      logo: {logo}")
                if s.get("channel"):
                    print(f"{prefix}      channel: {s['channel']}")
                if s.get("st_name"):
                    print(f"{prefix}      match: {s.get('st_name', '')} vs {s.get('ft_name', '')}")
                    print(f"{prefix}      time: {s.get('time', '')}")
                for su in s_urls[:3]:
                    print(f"{prefix}      server: {su}")
                if len(s_urls) > 3:
                    print(f"{prefix}      ... and {len(s_urls) - 3} more servers")


# ============================================================
# CLI
# ============================================================

def get_channels_flat() -> list:
    app = TVApp()
    result = app.fetch(recurse=True)
    if "error" in result:
        print(f"Error: {result['error']}", file=sys.stderr)
        sys.exit(1)
    groups = app.get_channels()
    flat = []
    for group in groups:
        logo = group.get("logo", "")
        servers_raw = group.get("servers", "[]")
        if isinstance(servers_raw, str):
            try:
                servers = json.loads(servers_raw)
            except json.JSONDecodeError:
                servers = []
        else:
            servers = servers_raw
        for sv in servers:
            name = sv.get("name", "")
            name = re.sub(r'^مشاهدة قناة\s*[>›]\s*', '', name)
            name = re.sub(r'[📺🎬📡]+', '', name).strip()
            if not name:
                continue
            url = sv.get("url", "")
            if not url:
                continue
            if not validate_url(url):
                print(f"    ❌ {name}: URL dead, skipping", file=sys.stderr)
                continue
            print(f"    ✅ {name}", file=sys.stderr)
            flat.append({"name": name, "img": logo, "url": url})
    return flat


def get_matches_flat(include_foot_live: bool = True) -> list:
    flat = []

    # --- Fetch from TV App ---
    app = TVApp()
    result = app.fetch(recurse=True)
    if "error" not in result:
        groups = app.get_matches()
        for group in groups:
            if is_match_finished(group):
                st_name = group.get("st_name", "").strip()
                ft_name = group.get("ft_name", "").strip()
                match_name = f"{st_name} vs {ft_name}" if st_name and ft_name else (st_name or ft_name)
                print(f"    ❌ Finished match skipped: {match_name}", file=sys.stderr)
                continue
            servers_raw = group.get("servers", "[]")
            if isinstance(servers_raw, str):
                try:
                    servers = json.loads(servers_raw)
                except json.JSONDecodeError:
                    servers = []
            else:
                servers = servers_raw
            st_name = group.get("st_name", "").strip()
            ft_name = group.get("ft_name", "").strip()
            if not st_name and not ft_name:
                continue
            name = f"{st_name} vs {ft_name}" if st_name and ft_name else (st_name or ft_name)
            urls = []
            for sv in servers:
                url = sv.get("url", "")
                if url:
                    if validate_url(url):
                        urls.append(url)
                        print(f"    ✅ {name}: URL working", file=sys.stderr)
                    else:
                        print(f"    ❌ {name}: URL dead, skipping", file=sys.stderr)
            if not urls:
                print(f"    ⏳ {name}: no stream yet (will be available closer to match time)", file=sys.stderr)
            flat.append({
                "name": name,
                "st_name": st_name,
                "ft_name": ft_name,
                "time": group.get("time", ""),
                "date": group.get("date", ""),
                "start_time": group.get("start_time", ""),
                "img_1": group.get("img_1", ""),
                "img_2": group.get("img_2", ""),
                "img": "",
                "urls": urls,
                "url": urls[0] if urls else "",
                "_source": "tv_app",
            })
    else:
        print(f"Warning: TVApp fetch: {result['error']}", file=sys.stderr)

    # --- Fetch from FOOT_LIVE_NEW ---
    if include_foot_live:
        try:
            foot_matches = fetch_foot_live_matches()
            print(f"    [foot_live] Got {len(foot_matches)} raw matches", file=sys.stderr)
            for m in foot_matches:
                if is_match_finished(m):
                    match_name = f"{m['st_name']} vs {m['ft_name']}"
                    print(f"    ❌ [foot_live] Finished match skipped: {match_name}", file=sys.stderr)
                    continue
                servers_raw = m.get("servers", "[]")
                if isinstance(servers_raw, str):
                    try:
                        servers = json.loads(servers_raw)
                    except json.JSONDecodeError:
                        servers = []
                else:
                    servers = servers_raw
                st_name = m["st_name"]
                ft_name = m["ft_name"]
                name = f"{st_name} vs {ft_name}" if st_name and ft_name else (st_name or ft_name)
                urls = []
                for sv in servers:
                    url = sv.get("url", "")
                    if url:
                        if validate_url(url):
                            urls.append(url)
                            print(f"    ✅ [foot_live] {name}: URL working", file=sys.stderr)
                        else:
                            print(f"    ❌ [foot_live] {name}: URL dead, skipping", file=sys.stderr)
                if not urls:
                    print(f"    ⏳ [foot_live] {name}: no stream yet (will be available closer to match time)", file=sys.stderr)
                flat.append({
                    "name": name,
                    "st_name": st_name,
                    "ft_name": ft_name,
                    "time": m.get("time", ""),
                    "date": m.get("date", ""),
                    "start_time": m.get("start_time", ""),
                    "img_1": m.get("img_1", ""),
                    "img_2": m.get("img_2", ""),
                    "img": "",
                    "urls": urls,
                    "url": urls[0] if urls else "",
                    "_source": "foot_live",
                })
        except Exception as e:
            print(f"Warning: foot_live fetch failed: {e}", file=sys.stderr)

    # Group by match name, keep duplicates only when they have stream URLs
    groups = {}
    for m in flat:
        key = _strip(f"{m.get('st_name','')}|{m.get('ft_name','')}")
        groups.setdefault(key, []).append(m)

    deduped = []
    for key, items in groups.items():
        has_urls = [i for i in items if i.get("urls") or i.get("url")]
        if has_urls:
            # Show all items with URLs (as backup servers)
            for i in has_urls:
                # Merge flags from other items if missing
                for other in items:
                    if not i.get("img_1") and other.get("img_1"):
                        i["img_1"] = other["img_1"]
                    if not i.get("img_2") and other.get("img_2"):
                        i["img_2"] = other["img_2"]
                deduped.append(i)
        else:
            # No URLs anywhere — keep only the first item (no duplicate placeholders)
            first = items[0]
            for other in items:
                if not first.get("img_1") and other.get("img_1"):
                    first["img_1"] = other["img_1"]
                if not first.get("img_2") and other.get("img_2"):
                    first["img_2"] = other["img_2"]
            deduped.append(first)

    removed = len(flat) - len(deduped)
    if removed:
        print(f"    Deduplicated: {removed} placeholder duplicate(s) removed", file=sys.stderr)

    return deduped


def download_match_image() -> str:
    urls = [
        "https://picsum.photos/seed/sports/400/200",
        "https://source.unsplash.com/400x200/?stadium,sports",
    ]
    for url in urls:
        try:
            resp = requests.get(url, timeout=10)
            if resp.status_code == 200 and len(resp.content) > 1000:
                path = "/tmp/match_img.jpg"
                with open(path, "wb") as f:
                    f.write(resp.content)
                return path
        except Exception:
            continue
    return ""


def generate_match_image_via_ai(st_name: str = "", ft_name: str = "",
                                 img_1_url: str = "", img_2_url: str = "") -> str:
    """Generate a merged two-panel match image.
    If img_1_url/img_2_url provided, download actual flag images and merge them.
    Falls back to team names as text.
    """
    try:
        from PIL import Image, ImageDraw, ImageFont
        w, h = 512, 512
        mid = w // 2

        img = Image.new("RGB", (w, h), (20, 30, 50))
        draw = ImageDraw.Draw(img)

        # Left panel
        draw.rectangle([0, 0, mid - 2, h], fill=(25, 38, 60))
        # Right panel (slightly warmer tint)
        draw.rectangle([mid + 2, 0, w, h], fill=(40, 30, 50))

        # Thin white vertical line divider (full height)
        draw.rectangle([mid - 1, 0, mid + 1, h], fill=(255, 255, 255))

        font_size = 34
        try:
            font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
        except Exception:
            font = ImageFont.load_default()

        if not st_name and not ft_name:
            # Generic placeholder: just show VS
            font_size = 28
            try:
                font = ImageFont.truetype("/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf", font_size)
            except Exception:
                font = ImageFont.load_default()
            lw = draw.textlength("VS", font=font)
            draw.text(((mid - lw) / 2, h // 2 - font_size // 2), "VS", font=font, fill=(255, 255, 255))
            rw = draw.textlength("VS", font=font)
            draw.text((mid + (mid - rw) / 2, h // 2 - font_size // 2), "VS", font=font, fill=(255, 255, 255))
        else:
            flag_size = (mid - 20, h - 80)
            left_flag = None
            right_flag = None

            # Download and place left flag
            if img_1_url:
                try:
                    fr = requests.get(img_1_url, timeout=10)
                    if fr.status_code == 200 and len(fr.content) > 200:
                        from io import BytesIO
                        flag_raw = Image.open(BytesIO(fr.content)).convert("RGBA")
                        left_flag = flag_raw.resize(flag_size, Image.LANCZOS)
                except Exception:
                    pass

            # Download and place right flag
            if img_2_url:
                try:
                    fr = requests.get(img_2_url, timeout=10)
                    if fr.status_code == 200 and len(fr.content) > 200:
                        from io import BytesIO
                        flag_raw = Image.open(BytesIO(fr.content)).convert("RGBA")
                        right_flag = flag_raw.resize(flag_size, Image.LANCZOS)
                except Exception:
                    pass

            if left_flag:
                img.paste(left_flag, (10, 40), left_flag)
            else:
                lw = draw.textlength(st_name, font=font)
                draw.text(((mid - lw) / 2, h // 2 - font_size // 2), st_name, font=font, fill=(255, 255, 255))

            if right_flag:
                img.paste(right_flag, (mid + 10, 40), right_flag)
            else:
                rw = draw.textlength(ft_name, font=font)
                draw.text((mid + (mid - rw) / 2, h // 2 - font_size // 2), ft_name, font=font, fill=(255, 255, 255))

        path = "/tmp/match_img.jpg"
        img.save(path, "JPEG", quality=95)
        return path
    except Exception as e:
        print(f"  Match image generation failed: {e}", file=sys.stderr)
        return download_match_image()


def upload_vs_to_fb(st_name: str, ft_name: str, token: str,
                    img_1_url: str = "", img_2_url: str = "") -> str:
    path = generate_match_image_via_ai(st_name, ft_name, img_1_url, img_2_url)
    if not path:
        return ""
    privacy = json.dumps({"value": "SELF"})
    with open(path, "rb") as f:
        resp = requests.post(
            "https://graph.facebook.com/v19.0/me/photos",
            params={"access_token": token, "privacy": privacy},
            files={"source": ("match.jpg", f, "image/jpeg")},
            timeout=30,
        )
    data = resp.json()
    if "error" in data:
        raise RuntimeError(f"Facebook upload error: {data['error']}")
    photo_id = data.get("id")
    if not photo_id:
        raise RuntimeError("No photo id in response")
    r2 = requests.get(
        f"https://graph.facebook.com/v19.0/{photo_id}",
        params={"fields": "images", "access_token": token},
        timeout=15,
    )
    img_data = r2.json()
    images = img_data.get("images", [])
    if images:
        return images[0]["source"]
    return f"https://www.facebook.com/photo/?fbid={photo_id}"


if __name__ == "__main__":
    url = None
    raw = None
    recurse = True
    fmt_json = False
    no_telegram = False
    channels_only = False
    matches_only = False
    no_foot_live = False
    foot_live_only = False

    args = sys.argv[1:]
    while args:
        a = args.pop(0)
        if a == "--no-recurse":
            recurse = False
        elif a == "--json":
            fmt_json = True
        elif a == "--no-telegram":
            no_telegram = True
        elif a == "--channels-only":
            channels_only = True
        elif a == "--matches-only":
            matches_only = True
        elif a == "--no-foot-live":
            no_foot_live = True
        elif a == "--foot-live-only":
            foot_live_only = True
        elif a == "--upload-vs":
            st_name = args.pop(0) if args else ""
            ft_name = args.pop(0) if args else ""
            token = args.pop(0) if args else ""
            img_1_url = args.pop(0) if args else ""
            img_2_url = args.pop(0) if args else ""
            url = upload_vs_to_fb(st_name, ft_name, token, img_1_url, img_2_url)
            print(url)
            sys.exit(0)
        elif a.startswith("STARTDATA") or "STARTDATA" in a:
            raw = a
        else:
            url = a

    if channels_only:
        flat = get_channels_flat()
        print(json.dumps(flat, ensure_ascii=False))
        sys.exit(0)

    if matches_only:
        flat = get_matches_flat(include_foot_live=not no_foot_live)
        print(json.dumps(flat, ensure_ascii=False))
        sys.exit(0)

    if foot_live_only:
        flat = get_matches_flat(include_foot_live=True)
        foot_only = [m for m in flat if m.get("_source") == "foot_live"]
        print(json.dumps(foot_only, ensure_ascii=False))
        sys.exit(0)

    app = TVApp()
    result = app.fetch(url=url, raw_data=raw, recurse=recurse)

    if "error" in result:
        print(f"Error: {result['error']}")
        sys.exit(1)

    path = save_json(result)
    if not no_telegram:
        send_telegram(path)

    if fmt_json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    elif "decoded_data" in result:
        print("Main menu \u2192")
        display_tree(result["decoded_data"])
    else:
        print(json.dumps(result, indent=2, ensure_ascii=False))
