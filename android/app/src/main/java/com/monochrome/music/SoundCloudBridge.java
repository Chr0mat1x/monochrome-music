package com.monochrome.music;

import android.os.Handler;
import android.os.Looper;
import android.webkit.JavascriptInterface;
import android.webkit.WebView;

import org.json.JSONArray;
import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Full-length SoundCloud playback for the offline APK.
 *
 * SoundCloud streams whole songs from any IP and its CDN sends
 * {@code Access-Control-Allow-Origin: *}, but the API calls that search and
 * turn a track id into a signed media URL send no CORS headers — so the page
 * itself cannot make them. Java has no such restriction, so this bridge does
 * those two steps and hands the page ready-to-use results.
 *
 * Calls are asynchronous: the network work runs off the WebView's JS thread and
 * the answer comes back through {@code window.__monoNativeResult(cb, value)},
 * so a slow request never freezes the UI.
 */
public class SoundCloudBridge {

    // SoundCloud serves a script-free page to mobile user-agents, which hides
    // the client id; a desktop UA gets the full bundle, and the API itself does
    // not care what device is asking.
    private static final String UA =
            "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) "
                    + "Chrome/120.0.0.0 Safari/537.36";
    private static final Pattern CLIENT_ID =
            Pattern.compile("client_id\\s*[:=]\\s*\"([a-zA-Z0-9]{32})\"");
    private static final Pattern SCRIPT_SRC =
            Pattern.compile("src=\"(https://[^\"]*sndcdn\\.com/assets/[^\"]+\\.js)\"");

    private final WebView web;
    private final Handler main = new Handler(Looper.getMainLooper());
    private String clientId;

    public SoundCloudBridge(WebView web) {
        this.web = web;
    }

    /** Resolve a SoundCloud track id to a direct, seekable audio URL, or null. */
    @JavascriptInterface
    public void resolveSoundCloud(final String trackId, final String callback) {
        new Thread(() -> {
            String url = null;
            if (trackId != null && trackId.matches("\\d{1,14}")) {
                try {
                    url = resolve(trackId, clientId());
                } catch (Exception first) {
                    // The scraped id can be rotated out from under us; refresh once.
                    try {
                        clientId = null;
                        url = resolve(trackId, clientId());
                    } catch (Exception second) {
                        url = null;
                    }
                }
            }
            reply(callback, url);
        }).start();
    }

    /** Search SoundCloud; answers with a JSON array of {id,title,artist,duration}. */
    @JavascriptInterface
    public void searchSoundCloud(final String query, final String callback) {
        new Thread(() -> {
            String json = "[]";
            if (query != null && !query.isEmpty()) {
                try {
                    json = search(query, clientId());
                } catch (Exception first) {
                    try {
                        clientId = null;
                        json = search(query, clientId());
                    } catch (Exception second) {
                        json = "[]";
                    }
                }
            }
            reply(callback, json);
        }).start();
    }

    private String resolve(String trackId, String id) throws Exception {
        if (id == null) return null;
        JSONObject track = new JSONObject(get(
                "https://api-v2.soundcloud.com/tracks/" + trackId + "?client_id=" + id));
        JSONObject media = track.optJSONObject("media");
        JSONArray transcodings = media != null ? media.optJSONArray("transcodings") : null;
        if (transcodings == null) return null;
        String endpoint = null;
        for (int i = 0; i < transcodings.length(); i++) {
            JSONObject t = transcodings.optJSONObject(i);
            JSONObject format = t != null ? t.optJSONObject("format") : null;
            // A <audio> element cannot play SoundCloud's HLS; only the
            // progressive MP3 streams (and it is seekable via range requests).
            if (format != null && "progressive".equals(format.optString("protocol"))) {
                endpoint = t.optString("url", null);
                break;
            }
        }
        if (endpoint == null) return null;
        JSONObject resolved = new JSONObject(get(endpoint + "?client_id=" + id));
        return resolved.optString("url", null);
    }

    private String search(String query, String id) throws Exception {
        if (id == null) return "[]";
        // Over-fetch: licensed (MONETIZE) uploads dominate the head of most
        // result sets, so a short page can filter down to nothing. SoundCloud's
        // first fifty hits for "lofi" are all licensed, so a bare query also
        // gets broadened once before we accept an empty answer.
        JSONArray out = page(query, id, 50);
        if (out.length() == 0) {
            out = page(query + " mix", id, 50);
            if (out.length() == 0) out = page(query + " beats", id, 50);
        }
        return out.toString();
    }

    private JSONArray page(String query, String id, int limit) throws Exception {
        String body = get("https://api-v2.soundcloud.com/search/tracks?q="
                + URLEncoder.encode(query, "UTF-8") + "&client_id=" + id + "&limit=" + limit);
        JSONArray collection = new JSONObject(body).optJSONArray("collection");
        JSONArray out = new JSONArray();
        if (collection == null) return out;
        for (int i = 0; i < collection.length(); i++) {
            JSONObject t = collection.optJSONObject(i);
            if (t == null) continue;
            // Licensed (MONETIZE) uploads have no anonymous progressive stream
            // and answer 404 on resolve, so listing them only produces tracks
            // that fail the moment they are tapped. Drop them and let the
            // playable uploads fill the list instead.
            String policy = t.optString("policy", "");
            if ("MONETIZE".equals(policy) || !t.optBoolean("streamable", true)) continue;
            JSONObject user = t.optJSONObject("user");
            JSONObject item = new JSONObject();
            item.put("id", t.optString("id", ""));
            item.put("title", t.optString("title", ""));
            item.put("artist", user != null ? user.optString("username", "") : "");
            item.put("duration", t.optLong("duration", 0) / 1000);
            item.put("artwork", t.optString("artwork_url", ""));
            // 'SNIP' uploads are the 30-second clips the rights holder allows;
            // the UI labels them as previews and tries to upgrade to a full one.
            item.put("policy", policy);
            out.put(item);
        }
        return out;
    }

    private String clientId() throws Exception {
        if (clientId != null) return clientId;
        String html = get("https://soundcloud.com/");
        List<String> scripts = new ArrayList<>();
        Matcher m = SCRIPT_SRC.matcher(html);
        while (m.find()) scripts.add(m.group(1));
        // The client id lives in one of the later player bundles; scan from the end.
        for (int i = scripts.size() - 1; i >= 0; i--) {
            Matcher id = CLIENT_ID.matcher(get(scripts.get(i)));
            if (id.find()) {
                clientId = id.group(1);
                return clientId;
            }
        }
        return null;
    }

    private void reply(String callback, String value) {
        final String js = "window.__monoNativeResult("
                + JSONObject.quote(callback) + "," + JSONObject.quote(value) + ")";
        main.post(() -> web.evaluateJavascript(js, null));
    }

    private static String get(String url) throws Exception {
        HttpURLConnection conn = (HttpURLConnection) new URL(url).openConnection();
        conn.setRequestProperty("User-Agent", UA);
        conn.setConnectTimeout(8000);
        conn.setReadTimeout(12000);
        try {
            int code = conn.getResponseCode();
            InputStream stream = code >= 400 ? conn.getErrorStream() : conn.getInputStream();
            if (stream == null) throw new IllegalStateException("HTTP " + code);
            StringBuilder sb = new StringBuilder();
            try (BufferedReader r = new BufferedReader(
                    new InputStreamReader(stream, StandardCharsets.UTF_8))) {
                String line;
                while ((line = r.readLine()) != null) sb.append(line).append('\n');
            }
            if (code >= 400) throw new IllegalStateException("HTTP " + code);
            return sb.toString();
        } finally {
            conn.disconnect();
        }
    }
}
