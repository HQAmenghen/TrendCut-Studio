#!/usr/bin/env node

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema
} from '@modelcontextprotocol/sdk/types.js';

import { tools } from './tools.js';

const toolMap = new Map(tools.map((tool) => [tool.name, tool]));

const server = new Server(
  {
    name: 'video-assistant-agent-mcp',
    version: '0.1.0'
  },
  {
    capabilities: {
      tools: {}
    }
  }
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    inputSchema: tool.inputSchema
  }))
}));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const tool = toolMap.get(request.params.name);
  if (!tool) {
    return {
      isError: true,
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            success: false,
            error: `Unknown tool: ${request.params.name}`,
            code: 'MCP_TOOL_NOT_FOUND',
            stage: 'mcp.tools'
          }, null, 2)
        }
      ]
    };
  }
  return tool.handler(request.params.arguments || {});
});

const transport = new StdioServerTransport();
await server.connect(transport);
