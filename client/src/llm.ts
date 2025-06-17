export type ClaudeMessage = {
  role: string;
  content: any;
};

type ClaudeTool = {
  name: string;
  description: string;
  input_schema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
};

const ANTHROPIC_MODEL = "claude-sonnet-4-20250514";
const ANTHROPIC_VERSION = "2023-06-01";
const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;

export async function claude(
  messages: ClaudeMessage[],
  tools: ClaudeTool[],
  system?: string
) {
  if (!ANTHROPIC_API_KEY) {
    throw new Error("ANTHROPIC_API_KEY environment variable is required");
  }

  const body = {
    model: ANTHROPIC_MODEL,
    max_tokens: 1024,
    messages,
    tools,
    ...(system && { system }),
  };

  const response = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`Anthropic API request failed: ${response.statusText}`);
  }

  const data = await response.json();
  return data.content;
}
