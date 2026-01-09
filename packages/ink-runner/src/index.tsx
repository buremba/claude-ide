#!/usr/bin/env node

import React from "react";
import { render } from "ink";
import { SchemaForm } from "./components/SchemaForm.js";
import { emitResult, emitResultWithFile, setInteractionId } from "./types.js";
import { runFromFile } from "./file-runner.js";
import type { FormSchema } from "./types.js";

interface CliArgs {
  schema?: string;
  file?: string;
  title?: string;
  help?: boolean;
  noSandbox?: boolean;
  interactionId?: string;
  args?: string;  // JSON string of args to pass to component
}

function parseArgs(): CliArgs {
  const cliArgs = process.argv.slice(2);
  const result: CliArgs = {};

  for (let i = 0; i < cliArgs.length; i++) {
    const arg = cliArgs[i];

    if (arg === "--help" || arg === "-h") {
      result.help = true;
    } else if (arg === "--schema" || arg === "-s") {
      result.schema = cliArgs[++i];
    } else if (arg === "--file" || arg === "-f" || arg === "--ink-file") {
      result.file = cliArgs[++i];
    } else if (arg === "--title" || arg === "-t") {
      result.title = cliArgs[++i];
    } else if (arg === "--no-sandbox") {
      result.noSandbox = true;
    } else if (arg === "--interaction-id" || arg === "-i") {
      result.interactionId = cliArgs[++i];
    } else if (arg === "--args" || arg === "-a") {
      result.args = cliArgs[++i];
    }
  }

  return result;
}

function showHelp(): void {
  console.log(`
ink-runner - Interactive form runner for mcp-ide

Usage:
  ink-runner --schema '<json>' [--title 'Form Title']
  ink-runner --file /path/to/component.tsx [--title 'Title']
  ink-runner -s '<json>' [-t 'Form Title']

Options:
  -s, --schema <json>   JSON schema defining the form
  -f, --file <path>     Path to custom Ink component (.tsx/.jsx/.ts/.js)
  -t, --title <text>    Optional form/component title
  -h, --help            Show this help message

Either --schema or --file is required.

Schema Format (for --schema mode):
  {
    "questions": [
      {
        "question": "What is your name?",
        "header": "Name",
        "inputType": "text",          // optional: text, textarea, password
        "placeholder": "Enter name",  // optional
        "validation": "^[a-zA-Z]+$"   // optional: regex pattern
      },
      {
        "question": "Select your role",
        "header": "Role",
        "options": [
          { "label": "Developer", "description": "Write code" },
          { "label": "Designer", "description": "Create designs" }
        ],
        "multiSelect": false  // optional: true for checkbox-style
      }
    ]
  }

Custom Component Format (for --file mode):
  - Must have a default export (React component)
  - Use global 'onComplete(result)' to return data
  - Example:
    import { Box, Text, useInput, useApp } from 'ink';
    function MyComponent() {
      const { exit } = useApp();
      useInput((input, key) => {
        if (key.return) {
          onComplete({ selected: 'value' });
          exit();
        }
      });
      return <Text>Press Enter</Text>;
    }
    export default MyComponent;

Output:
  On completion, prints: __MCP_RESULT__:{"action":"accept","answers/result":{...}}
  Actions: accept, decline, cancel

Controls:
  - Text input: Type and press Enter
  - Single select: Arrow keys + Enter
  - Multi select: Arrow keys + Space to toggle + Enter
  - Cancel: Escape key
`);
}

async function main(): Promise<void> {
  const args = parseArgs();

  // Set interaction ID for file-based result communication
  if (args.interactionId) {
    setInteractionId(args.interactionId);
  }

  if (args.help) {
    showHelp();
    process.exit(0);
  }

  // Handle SIGINT/SIGTERM
  process.on("SIGINT", () => {
    emitResultWithFile({ action: "cancel" });
    process.exit(0);
  });

  process.on("SIGTERM", () => {
    emitResultWithFile({ action: "cancel" });
    process.exit(0);
  });

  // Mode 2: Custom component from file
  if (args.file) {
    let componentArgs: Record<string, unknown> = {};
    if (args.args) {
      try {
        componentArgs = JSON.parse(args.args);
      } catch {
        console.error("Invalid --args JSON");
        process.exit(1);
      }
    }
    await runFromFile({
      filePath: args.file,
      title: args.title,
      sandbox: { enabled: !args.noSandbox },
      args: componentArgs,
    });
    return;
  }

  // Mode 1: Schema-based form
  if (!args.schema) {
    console.error("Error: Either --schema or --file is required");
    console.error("Run 'ink-runner --help' for usage");
    emitResult({ action: "cancel" });
    process.exit(1);
  }

  let schema: FormSchema;
  try {
    schema = JSON.parse(args.schema);
  } catch (err) {
    console.error("Error: Invalid JSON schema");
    console.error(err instanceof Error ? err.message : String(err));
    emitResult({ action: "cancel" });
    process.exit(1);
  }

  if (!schema.questions || !Array.isArray(schema.questions) || schema.questions.length === 0) {
    console.error("Error: Schema must have at least one question");
    emitResult({ action: "cancel" });
    process.exit(1);
  }

  const { waitUntilExit } = render(
    <SchemaForm schema={schema} title={args.title} />
  );

  await waitUntilExit();
}

main().catch((err) => {
  console.error("Fatal error:", err);
  emitResult({ action: "cancel" });
  process.exit(1);
});
