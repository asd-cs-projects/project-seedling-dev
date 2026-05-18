import type { VercelRequest, VercelResponse } from '@vercel/node';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // Handle CORS preflight
  if (req.method === 'OPTIONS') {
    return res.status(200).setHeader('Access-Control-Allow-Origin', '*')
      .setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
      .setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
      .end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      return res.status(500).json({ error: 'OPENROUTER_API_KEY not configured on server' });
    }
    const model = process.env.OPENROUTER_MODEL || 'google/gemini-2.5-flash';

    const { messages, systemPrompt } = req.body;

    if (!messages || !Array.isArray(messages)) {
      return res.status(400).json({ error: 'Messages array is required' });
    }

    const orMessages: Array<{ role: string; content: string }> = [];
    if (systemPrompt) orMessages.push({ role: 'system', content: systemPrompt });
    for (const msg of messages as Array<{ role: string; content: string }>) {
      orMessages.push({ role: msg.role === 'assistant' ? 'assistant' : 'user', content: msg.content });
    }

    const orRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature: 0.7,
        max_tokens: 8192,
        messages: orMessages,
      }),
    });

    if (!orRes.ok) {
      const errText = await orRes.text();
      Object.entries(corsHeaders).forEach(([k, v]) => res.setHeader(k, v));
      return res.status(orRes.status).json({ error: `OpenRouter error: ${errText}` });
    }

    const data = await orRes.json();
    const text: string = data?.choices?.[0]?.message?.content ?? '';

    // Set CORS headers
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    return res.status(200).json({
      choices: [
        {
          message: {
            role: 'assistant',
            content: text,
          },
        },
      ],
    });
  } catch (error) {
    console.error('OpenRouter API error:', error);
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    
    Object.entries(corsHeaders).forEach(([key, value]) => {
      res.setHeader(key, value);
    });

    return res.status(500).json({ error: errorMessage });
  }
}
