const GEMINI_API = 'https://generativelanguage.googleapis.com/v1beta/models';

export type ThinkingLevel = 'low' | 'high';

export interface GenerateJsonParams {
  apiKey: string;
  model: string;
  prompt: string;
  schema: Record<string, unknown>;
  thinkingLevel: ThinkingLevel;
}

export type GenerateJsonResult =
  | { kind: 'ok'; data: unknown }
  | { kind: 'blocked' }
  | { kind: 'quota_exceeded' }
  | { kind: 'error'; status: number };

export async function generateJson(params: GenerateJsonParams): Promise<GenerateJsonResult> {
  const url = `${GEMINI_API}/${params.model}:generateContent?key=${params.apiKey}`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: params.prompt }] }],
      generationConfig: {
        responseMimeType: 'application/json',
        responseSchema: params.schema,
        thinkingConfig: { thinkingLevel: params.thinkingLevel },
      },
      safetySettings: [
        { category: 'HARM_CATEGORY_DANGEROUS_CONTENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HARASSMENT', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_HATE_SPEECH', threshold: 'BLOCK_ONLY_HIGH' },
        { category: 'HARM_CATEGORY_SEXUALLY_EXPLICIT', threshold: 'BLOCK_ONLY_HIGH' },
      ],
    }),
  });

  if (res.status === 429) return { kind: 'quota_exceeded' };
  if (!res.ok) return { kind: 'error', status: res.status };

  const body = (await res.json()) as {
    candidates?: { content?: { parts?: { text?: string }[] }; finishReason?: string }[];
    promptFeedback?: { blockReason?: string };
  };

  if (body.promptFeedback?.blockReason) return { kind: 'blocked' };

  const candidate = body.candidates?.[0];
  if (!candidate) return { kind: 'blocked' };
  if (candidate.finishReason === 'SAFETY' || candidate.finishReason === 'PROHIBITED_CONTENT') {
    return { kind: 'blocked' };
  }

  const text = candidate.content?.parts?.[0]?.text;
  if (!text) return { kind: 'error', status: res.status };

  try {
    return { kind: 'ok', data: JSON.parse(text) };
  } catch {
    return { kind: 'error', status: res.status };
  }
}
