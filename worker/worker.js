export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const corsHeaders = {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type",
    };

    if (request.method === "OPTIONS") {
      return new Response(null, { headers: corsHeaders });
    }

    // GET /g/:id — retrieve a shared guide by short ID
    const shareMatch = url.pathname.match(/^\/g\/([a-zA-Z0-9_-]+)$/);
    if (request.method === "GET" && shareMatch) {
      const id = shareMatch[1];
      const data = await env.GUIDE_CACHE.get(`share:${id}`);
      if (!data) {
        return new Response(JSON.stringify({ error: "Guide not found" }), {
          status: 404,
          headers: { "Content-Type": "application/json", ...corsHeaders },
        });
      }
      return new Response(data, {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let body;
    try {
      body = await request.json();
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!body.text || typeof body.text !== "string" || !body.text.trim()) {
      return new Response(JSON.stringify({ error: "Missing or empty text field" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Hash input text for cache key
    const encoder = new TextEncoder();
    const hashBuf = await crypto.subtle.digest("SHA-256", encoder.encode(body.text.trim()));
    const cacheKey = Array.from(new Uint8Array(hashBuf)).map(b => b.toString(16).padStart(2, "0")).join("");

    // Check KV cache
    const cached = await env.GUIDE_CACHE.get(cacheKey);
    if (cached) {
      const parsed = JSON.parse(cached);
      parsed._cached = true;
      parsed._shareId = cacheKey.slice(0, 10);
      // Ensure share key exists for cached guides
      await env.GUIDE_CACHE.put(`share:${cacheKey.slice(0, 10)}`, cached);
      return new Response(JSON.stringify(parsed), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const systemPrompt = `Convert guide text to JSON. Output ONLY raw JSON. No markdown fences, no explanation, nothing before or after the JSON object.

Return this exact structure:
{"title":"string","sections":[{"title":"string","items":[{"type":"task","text":"string"},{"type":"note","text":"string"}]}]}

Rules:
- type is either "task" (actionable step) or "note" (tip/warning/info)
- Strip all list markers, numbers, dashes from text
- Group items into logical sections; infer section names from context if not present
- Keep text concise but preserve important detail
- Always return valid JSON`;

    const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash-lite:generateContent?key=${env.GEMINI_KEY}`;

    let geminiRes;
    try {
      geminiRes = await fetch(geminiUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          system_instruction: { parts: [{ text: systemPrompt }] },
          contents: [{ role: "user", parts: [{ text: body.text }] }],
          generationConfig: { maxOutputTokens: 65536, temperature: 0.1, responseMimeType: "application/json" },
        }),
      });
    } catch (err) {
      return new Response(JSON.stringify({ error: "Failed to reach Gemini API" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      return new Response(JSON.stringify({ error: `Gemini API error: ${errText}` }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    let geminiData;
    try {
      geminiData = await geminiRes.json();
    } catch {
      return new Response(JSON.stringify({ error: "Could not parse Gemini response" }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const parts = geminiData?.candidates?.[0]?.content?.parts || [];
    let rawText = parts.filter(p => p.text).map(p => p.text).join("\n");
    rawText = rawText.replace(/```json\s*/g, "").replace(/```\s*/g, "");
    const jsonMatch = rawText.match(/\{[\s\S]*\}/);

    if (!jsonMatch) {
      return new Response(JSON.stringify({ error: "Could not parse response (no match)", debug: rawText.slice(0, 500) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    const finishReason = geminiData?.candidates?.[0]?.finishReason || "unknown";

    let parsed;
    try {
      parsed = JSON.parse(jsonMatch[0]);
    } catch (e) {
      return new Response(JSON.stringify({ error: "Could not parse response (invalid json)", finishReason, debugLen: rawText.length, debugEnd: rawText.slice(-200) }), {
        status: 502,
        headers: { "Content-Type": "application/json", ...corsHeaders },
      });
    }

    // Cache in KV (no expiration)
    const guideJson = JSON.stringify(parsed);
    const shareId = cacheKey.slice(0, 10);
    await Promise.all([
      env.GUIDE_CACHE.put(cacheKey, guideJson),
      env.GUIDE_CACHE.put(`share:${shareId}`, guideJson),
    ]);

    parsed._shareId = shareId;
    return new Response(JSON.stringify(parsed), {
      status: 200,
      headers: { "Content-Type": "application/json", ...corsHeaders },
    });
  },
};
