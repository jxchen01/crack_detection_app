export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.setHeader("Allow", "POST");
    return res.status(405).json({ error: "Method not allowed" });
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: "Missing OPENROUTER_API_KEY environment variable." });
  }

  const { model, imageDataUrl, systemPrompt, userPrompt } = req.body || {};

  if (!model || !imageDataUrl) {
    return res.status(400).json({ error: "Request must include model and imageDataUrl." });
  }

  try {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model,
        temperature: 0.1,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: String(systemPrompt || "You are a strict visual quality inspector.")
          },
          {
            role: "user",
            content: [
              {
                type: "text",
                text: String(userPrompt || "Return strict JSON only.")
              },
              {
                type: "image_url",
                image_url: {
                  url: imageDataUrl
                }
              }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      const details = await response.text();
      return res.status(response.status).json({ error: `OpenRouter error: ${details}` });
    }

    const data = await response.json();
    const content = data?.choices?.[0]?.message?.content;

    if (!content) {
      return res.status(502).json({ error: "OpenRouter returned no content." });
    }

    return res.status(200).json({ content });
  } catch (error) {
    return res.status(500).json({ error: error.message || "Unexpected server error." });
  }
}
