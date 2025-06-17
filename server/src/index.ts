import { lines, sendResponse, sendError } from "./stdio";
import teaData from "./teas.json";

const PROTOCOL_VERSION = "2024-11-05"; // inspector compatibility
// const PROTOCOL_VERSION = "2025-06-18"; // latest

const serverInfo = {
  name: "茶",
  version: "0.1.0",
};

interface Tea {
  name: string;
  simplified: string;
  traditional: string;
  description: string;
  type: string;
  origin: string;
  brewingTemp: string;
  steepTime: string;
}

const teas: Tea[] = teaData;

const resources = [
  {
    uri: "tea://teas",
    name: "All Teas",
    description: "List of all available teas",
    mimeType: "application/json",
    get: async () => ({
      contents: [
        {
          uri: "tea://teas",
          mimeType: "application/json",
          text: JSON.stringify({
            totalTeas: teas.length,
            teas: teas.map((tea) => ({
              name: tea.name,
              simplified: tea.simplified,
              traditional: tea.traditional,
              type: tea.type,
              origin: tea.origin,
            })),
          }),
        },
      ],
    }),
  },

  ...teas.map((tea) => {
    const slug = tea.name.toLowerCase().replace(/\s+/g, "-");
    return {
      uri: `tea://teas/${slug}`,
      name: `${tea.name} (${tea.traditional})`,
      description: `Details of ${tea.name}`,
      mimeType: "application/json",
      get: async () => ({
        contents: [
          {
            uri: `tea://teas/${slug}`,
            mimeType: "application/json",
            text: JSON.stringify(tea),
          },
        ],
      }),
    };
  }),
];

const tools = [
  {
    name: "getTeasByType",
    description: "Get all teas of a specific type",
    inputSchema: {
      type: "object",
      properties: {
        type: {
          type: "string",
          description: "Tea type to search for",
        },
      },
      required: ["type"],
    },
    execute: async (args: { type: string }) => {
      if (!args.type || !args.type.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Type parameter cannot be empty",
              }),
            },
          ],
        };
      }

      const type = args.type.trim();

      const matchingTeas = teas.filter((tea) =>
        tea.type.toLowerCase().includes(type.toLowerCase())
      );

      if (matchingTeas.length === 0) {
        const availableTypes = [...new Set(teas.map((t) => t.type))].sort();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                matches: 0,
                message: `Teas of type ${type} not found`,
                availableTypes,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              matches: matchingTeas.length,
              type: matchingTeas[0].type,
              teas: matchingTeas.map((tea) => ({
                name: tea.name,
                simplified: tea.simplified,
                traditional: tea.traditional,
                origin: tea.origin,
              })),
            }),
          },
        ],
      };
    },
  },
  {
    name: "getTeasByRegion",
    description: "Get all teas from a specific province or region",
    inputSchema: {
      type: "object",
      properties: {
        region: {
          type: "string",
          description: "Province or region name to search for",
        },
      },
      required: ["region"],
    },
    execute: async (args: { region: string }) => {
      if (!args.region || !args.region.trim()) {
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                error: "Region parameter cannot be empty",
              }),
            },
          ],
        };
      }

      const region = args.region.trim();

      const matchingTeas = teas.filter((tea) =>
        tea.origin.toLowerCase().includes(region.toLowerCase())
      );

      if (matchingTeas.length === 0) {
        const availableRegions = [...new Set(teas.map((t) => t.origin))].sort();
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                matches: 0,
                message: `Teas from ${region} not found`,
                availableRegions,
              }),
            },
          ],
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              matches: matchingTeas.length,
              region: matchingTeas[0].origin,
              teas: matchingTeas.map((tea) => ({
                name: tea.name,
                simplified: tea.simplified,
                traditional: tea.traditional,
                type: tea.type,
              })),
            }),
          },
        ],
      };
    },
  },
];

(async function main() {
  for await (const line of lines) {
    try {
      const json = JSON.parse(line);

      if (json.jsonrpc !== "2.0") {
        continue;
      }

      if (json.method === "initialize") {
        sendResponse(json.id, {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            resources: {
              listChanged: true,
            },
            tools: {
              listChanged: true,
            },
          },
          serverInfo,
        });
      }

      if (json.method === "ping") {
        sendResponse(json.id, {});
      }

      if (json.method === "resources/list") {
        sendResponse(json.id, {
          resources: resources.map((resource) => ({
            uri: resource.uri,
            name: resource.name,
            description: resource.description,
            mimeType: resource.mimeType,
          })),
        });
      }

      if (json.method === "resources/read") {
        const uri = json.params?.uri;
        if (!uri) {
          sendError(json.id, -32602, "Missing required parameter: uri");
          continue;
        }

        const resource = resources.find((resource) => resource.uri === uri);
        if (resource) {
          const resourceResponse = await resource.get();
          sendResponse(json.id, resourceResponse);
        } else {
          sendError(json.id, -32600, `Resource not found: ${uri}`);
        }
      }

      if (json.method === "tools/list") {
        sendResponse(json.id, {
          tools: tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        });
      }

      if (json.method === "tools/call") {
        const toolName = json.params?.name;
        if (!toolName) {
          sendError(json.id, -32602, "Missing required parameter: name");
          continue;
        }

        const tool = tools.find((tool) => tool.name === toolName);
        if (tool) {
          const toolResponse = await tool.execute(json.params.arguments || {});
          sendResponse(json.id, toolResponse);
        } else {
          sendError(json.id, -32600, `Tool not found: ${toolName}`);
        }
      }
    } catch (err) {
      console.error(err);
    }
  }
})();
