import { spawn } from "node:child_process";
import readline from "node:readline/promises";
import { intro, isCancel, select, text } from "@clack/prompts";
import chalk from "chalk";

import { claude, ClaudeMessage } from "./llm";

type Resource = {
  uri: string;
  name: string;
};

type Tool = {
  name: string;
  description: string;
  inputSchema: {
    type: string;
    properties: Record<string, any>;
    required: string[];
  };
};

type Content = {
  text: string;
};

function displayContent(content: Content[]) {
  for (const line of content) {
    console.log("");
    try {
      console.log(JSON.parse(line.text));
    } catch (err) {
      console.log(line.text);
    }
    console.log("");
  }
}

function displayResult(result: { type: string; text: string }[]) {
  for (const message of result) {
    console.log("");
    if (message.type === "text") {
      console.log(message.text);
    }
    console.log("");
  }
}

(async function main() {
  const server = spawn("node", ["../server/dist/index.js"], {
    stdio: ["pipe", "pipe", "inherit"],
  });

  const rl = readline.createInterface({
    input: server.stdout,
    output: undefined,
  });

  let prevId = 0;
  async function send(
    method: string,
    params: object = {},
    isNotification?: boolean
  ) {
    server.stdin.write(
      JSON.stringify({
        jsonrpc: "2.0",
        method,
        params,
        id: isNotification ? undefined : prevId++,
      }) + "\n"
    );

    if (isNotification) {
      return;
    }

    const json = await rl.question("");
    return JSON.parse(json).result;
  }

  const {
    serverInfo,
    capabilities,
  }: {
    serverInfo: {
      name: string;
      version: string;
    };
    capabilities: {
      tools?: any;
      resources?: any;
    };
  } = await send("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: {
      name: "mcp/client",
      version: "0.1.0",
    },
  });

  await send("notifications/initialized", {}, true);

  let tools: Tool[] = [];
  if (capabilities.tools) {
    const toolsResponse = await send("tools/list", {
      _meta: { progressToken: 1 },
    });
    tools = toolsResponse.tools || [];
  }

  let resources: Resource[] = [];
  if (capabilities.resources) {
    const resourcesResponse = await send("resources/list", {
      _meta: { progressToken: 1 },
    });
    resources = resourcesResponse.resources || [];
  }

  intro(
    `Connected to ${chalk.green(serverInfo.name)} ${chalk.gray(
      `v${serverInfo.version}`
    )}`
  );

  async function llm(messages: ClaudeMessage[], systemPrompt?: string) {
    const result = await claude(
      messages,
      tools.map(({ inputSchema, ...rest }) => ({
        ...rest,
        input_schema: inputSchema,
      })),
      systemPrompt || undefined
    );
    return result;
  }

  while (true) {
    const options = [{ label: "Ask LLM", value: "llm" }];
    if (resources.length > 0) {
      options.push({
        label: "Get a resource",
        value: "resource",
      });
    }
    if (tools.length > 0) {
      options.push({
        label: "Use a tool",
        value: "tool",
      });
    }

    const action = await select({
      message: "What would you like to do?",
      options,
    });

    if (isCancel(action)) {
      process.exit(0);
    }

    switch (action) {
      case "tool": {
        const tool = await select({
          message: "Select a tool",
          options: tools.map((tool) => ({
            label: tool.name,
            value: tool,
          })),
        });

        if (isCancel(tool)) {
          process.exit(0);
        }

        const args: Record<string, any> = {};
        const props = tool?.inputSchema?.properties ?? {};
        const stringArgs = Object.keys(props).filter(
          (key) => props[key]?.type === "string"
        );

        for (const key of stringArgs) {
          const answer = await text({
            message: `Enter the value for ${key}:`,
            initialValue: "",
          });

          if (isCancel(answer)) {
            process.exit(0);
          }

          args[key] = answer;
        }

        const { content }: { content: Content[] } = await send("tools/call", {
          name: tool.name,
          arguments: args,
        });

        displayContent(content);
        break;
      }
      case "resource": {
        const resource = await select({
          message: "Select a resource",
          options: resources.map((resource) => ({
            label: resource.name,
            value: resource,
          })),
        });

        if (isCancel(resource)) {
          process.exit(0);
        }

        const { contents }: { contents: Content[] } = await send(
          "resources/read",
          { uri: resource.uri }
        );

        displayContent(contents);
        break;
      }
      case "llm": {
        // combine all resources into system prompt
        let systemPrompt = "";
        for (const resource of resources) {
          const { contents }: { contents: Content[] } = await send(
            "resources/read",
            { uri: resource.uri }
          );
          systemPrompt += contents.map((c) => c.text).join("\n");
        }

        const prompt = await text({
          message: "Enter your prompt:",
          initialValue: "",
        });

        if (isCancel(prompt)) {
          process.exit(0);
        }

        const messages: ClaudeMessage[] = [{ role: "user", content: prompt }];

        const result = await llm(messages, systemPrompt);
        displayResult(result);
        messages.push({
          role: "assistant",
          content: result,
        });

        // handle tool calls if LLM asks
        const lastMessage = result[result.length - 1];
        if (lastMessage.type === "tool_use") {
          const toolName = lastMessage.name;
          const toolArgs = lastMessage.input;
          console.log(
            chalk.yellow(`\n🔧 ${toolName}(${JSON.stringify(toolArgs)})`)
          );

          const { content }: { content: Content[] } = await send("tools/call", {
            name: toolName,
            arguments: toolArgs,
          });

          displayContent(content);

          messages.push({
            role: "user",
            content: [
              {
                type: "tool_result",
                tool_use_id: lastMessage.id,
                content: content[0].text,
              },
            ],
          });

          // follow up after tool call
          const followup = await llm(messages);
          displayResult(followup);
        }
        break;
      }
    }
  }
})();
