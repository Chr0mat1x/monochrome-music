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
 * The result is a *media descriptor*, not a playable URL: most uploads now
 * carry only HLS transcodings, which an {@code <audio>} element cannot decode.
 * The page stitches the fragments into one MP4 itself (the CDN allows the
 * cross-origin fetch), so the bridge reports the manifest URL and lets the web
 * layer do the joining. The only progressive streams left in the catalogue are
 * 30-second previews, which is why they must never be preferred.
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
    private volatile String clientId;

    public SoundCloudBridge(WebView web) {
        this.web = web;
    }

    /** Resolve a track id to a media descriptor JSON, or null when unplayable. */
    @JavascriptInterface
    public void resolveSoundCloud(final String trackId, final String callback) {
        new Thread(() -> {
            String json = null;
            if (trackId != null && trackId.matches("\\d{1,14}")) {
                try {
                    json = resolve(trackId, clientId());
                } catch (Exception first) {
                    // The scraped id can be rotated out from under us; refresh once.
                    try {
                        clientId = null;
                        json = resolve(trackId, clientId());
                    } catch (Exception second) {
                        json = null;
                    }
                }
            }
            reply(callback, json);
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

    /**
     * Pick the stream to hand back. HLS wins: SoundCloud's remaining progressive
     * transcodings are 30-second previews, so preferring them truncated every
     * song to half a minute. Returns JSON {@code {"protocol":…,"url":…}}.
     */
    private String resolve(String trackId, String id) throws Exception {
        if (id == null) return null;
        JSONObject track = new JSONObject(get(
                "https://api-v2.soundcloud.com/tracks/" + trackId + "?client_id=" + id));
        JSONObject media = track.optJSONObject("media");
        JSONArray transcodings = media != null ? media.optJSONArray("transcodings") : null;
        if (transcodings == null) return null;

        JSONObject hls = null;
        JSONObject progressive = null;
        for (int i = 0; i < transcodings.length(); i++) {
            JSONObject t = transcodings.optJSONObject(i);
            JSONObject format = t != null ? t.optJSONObject("format") : null;
            if (format == null) continue;
            String protocol = format.optString("protocol", "");
            // DRM cannot be stitched, so an encrypted rendition is no use.
            if (protocol.contains("encrypted")) continue;
            if ("hls".equals(protocol) && hls == null) hls = t;
            else if ("progressive".equals(protocol) && progressive == null) progressive = t;
        }

        JSONObject pick = hls != null ? hls : progressive;
        if (pick == null) return null;
        String endpoint = pick.optString("url", null);
        if (endpoint == null) return null;

        JSONObject resolved = new JSONObject(get(endpoint + "?client_id=" + id));
        String url = resolved.optString("url", null);
        if (url == null) return null;

        JSONObject out = new JSONObject();
        out.put("protocol", hls != null ? "hls" : "progressive");
        out.put("url", url);
        return out.toString();
    }

    private String search(String query, String id) throws Exception {
        if (id == null) return "[]";
        // Over-fetch: licensed (MONETIZE) uploads dominate the head of most
        // result sets, so a short page can filter down to nothing. SoundCloud's
        // first fifty hits for "lofi" are all licensed, so a bare query also
        // gets broadened once before we accept an empty answer.
        JSONArray out = playablePage(query, id);
        if (out.length() == 0) {
            out = playablePage(query + " mix", id);
            if (out.length() == 0) out = playablePage(query + " beats", id);
        }
        if (out.length() > 25) {
            JSONArray cut = new JSONArray();
            for (int i = 0; i < 25; i++) cut.put(out.getJSONObject(i));
            return cut.toString();
        }
        return out.toString();
    }

    /**
     * List a query and keep only uploads that will actually play.
     *
     * Passing the policy filter is not enough: many uploads carry only HLS
     * transcodings, which a {@code <audio>} element cannot decode on its own,
     * and the search response never shows the transcodings at all — so the only
     * way to tell them apart is to ask for the track and look. Without this the
     * app lists tracks that fail the moment they are tapped.
     */
    private JSONArray playablePage(String query, String id) throws Exception {
        JSONArray listed = page(query, id, 50);
        if (listed.length() == 0) return listed;
        JSONArray kept = probe(listed, id);
        // If the probe confirmed nothing the API layer is probably having a bad
        // day rather than the whole catalogue being unplayable; trust the list
        // instead of returning a blank page.
        return kept.length() > 0 ? kept : listed;
    }

    /** Keep the listed tracks whose own record exposes a stream we can play. */
    private JSONArray probe(JSONArray listed, final String id) throws Exception {
        final int n = Math.min(listed.length(), 15);
        final boolean[] ok = new boolean[n];
        final java.util.concurrent.atomic.AtomicInteger cursor =
                new java.util.concurrent.atomic.AtomicInteger(0);
        Thread[] pool = new Thread[Math.min(6, n)];
        for (int t = 0; t < pool.length; t++) {
            pool[t] = new Thread(() -> {
                int i;
                while ((i = cursor.getAndIncrement()) < n) {
                    try {
                        ok[i] = hasPlayable(listed.getJSONObject(i).optString("id", ""), id);
                    } catch (Exception ignored) {
                        ok[i] = false;
                    }
                }
            });
            pool[t].start();
        }
        for (Thread th : pool) th.join();
        JSONArray out = new JSONArray();
        for (int i = 0; i < n; i++) if (ok[i]) out.put(listed.getJSONObject(i));
        return out;
    }

    /** True when the track has an HLS or progressive (non-DRM) transcoding. */
    private boolean hasPlayable(String trackId, String id) throws Exception {
        if (trackId.isEmpty() || id == null) return false;
        JSONObject track = new JSONObject(get(
                "https://api-v2.soundcloud.com/tracks/" + trackId + "?client_id=" + id));
        JSONObject media = track.optJSONObject("media");
        JSONArray transcodings = media != null ? media.optJSONArray("transcodings") : null;
        if (transcodings == null) return false;
        for (int i = 0; i < transcodings.length(); i++) {
            JSONObject t = transcodings.optJSONObject(i);
            JSONObject format = t != null ? t.optJSONObject("format") : null;
            if (format == null) continue;
            String protocol = format.optString("protocol", "");
            if (protocol.contains("encrypted")) continue;
            if ("hls".equals(protocol) || "progressive".equals(protocol)) return true;
        }
        return false;
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
            // MONETIZE uploads used to be dropped, but that removed almost the
            // whole catalogue: the licensed tracks are exactly the ones whose
            // full songs are HLS-only, and those play fine once stitched. Only
            // genuinely unstreamable uploads are skipped now.
            if (!t.optBoolean("streamable", true)) continue;
            JSONObject user = t.optJSONObject("user");
            JSONObject item = new JSONObject();
            item.put("id", t.optString("id", ""));
            item.put("title", t.optString("title", ""));
            item.put("artist", user != null ? user.optString("username", "") : "");
            item.put("duration", t.optLong("duration", 0) / 1000);
            item.put("artwork", t.optString("artwork_url", ""));
            // 'SNIP' uploads are the 30-second clips the rights holder allows;
            // the UI labels them as previews and tries to upgrade to a full one.
            item.put("policy", t.optString("policy", ""));
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
