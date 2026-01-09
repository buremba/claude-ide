import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useState, useEffect } from 'react';
import { readFileSync } from 'fs';

declare const onComplete: (result: unknown) => void;
declare const args: { file?: string };

// Simple markdown-ish rendering
function renderLine(line: string, idx: number) {
  // Headers
  if (line.startsWith('### ')) {
    return <Text key={idx} color="yellow">{line.slice(4)}</Text>;
  }
  if (line.startsWith('## ')) {
    return <Text key={idx} bold color="cyan">{line.slice(3)}</Text>;
  }
  if (line.startsWith('# ')) {
    return <Text key={idx} bold color="green">{line.slice(2)}</Text>;
  }
  // List items
  if (line.startsWith('- [ ] ')) {
    return <Text key={idx}><Text color="gray">[ ]</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- [x] ')) {
    return <Text key={idx}><Text color="green">[x]</Text> {line.slice(6)}</Text>;
  }
  if (line.startsWith('- ')) {
    return <Text key={idx}><Text color="blue">•</Text> {line.slice(2)}</Text>;
  }
  // Code blocks (simple)
  if (line.startsWith('```')) {
    return <Text key={idx} dimColor>{line}</Text>;
  }
  // Bold
  if (line.includes('**')) {
    return <Text key={idx}>{line}</Text>;
  }
  // Empty line
  if (!line.trim()) {
    return <Text key={idx}> </Text>;
  }
  return <Text key={idx}>{line}</Text>;
}

export default function PlanViewer() {
  const { exit } = useApp();
  const { stdout } = useStdout();
  const [scroll, setScroll] = useState(0);

  const filePath = args?.file;
  let content = 'No plan file specified';
  let lines: string[] = [];

  if (filePath) {
    try {
      content = readFileSync(filePath, 'utf-8');
      lines = content.split('\n');
    } catch (e) {
      content = `Error reading file: ${filePath}`;
      lines = [content];
    }
  }

  const visibleLines = stdout?.rows ? stdout.rows - 6 : 20;
  const maxScroll = Math.max(0, lines.length - visibleLines);

  useInput((input, key) => {
    if (input === 'y' || input === 'Y') {
      onComplete({ approved: true, file: filePath });
      exit();
    }
    if (input === 'n' || input === 'N' || key.escape) {
      onComplete({ approved: false, file: filePath });
      exit();
    }
    if (key.upArrow || input === 'k') {
      setScroll(s => Math.max(0, s - 1));
    }
    if (key.downArrow || input === 'j') {
      setScroll(s => Math.min(maxScroll, s + 1));
    }
    if (key.pageUp) {
      setScroll(s => Math.max(0, s - visibleLines));
    }
    if (key.pageDown) {
      setScroll(s => Math.min(maxScroll, s + visibleLines));
    }
  });

  const displayLines = lines.slice(scroll, scroll + visibleLines);

  return (
    <Box flexDirection="column" padding={1}>
      <Box borderStyle="round" borderColor="cyan" paddingX={1}>
        <Text bold color="cyan">Plan Review</Text>
        {lines.length > visibleLines && (
          <Text dimColor> ({scroll + 1}-{Math.min(scroll + visibleLines, lines.length)}/{lines.length})</Text>
        )}
      </Box>

      <Box flexDirection="column" marginY={1}>
        {displayLines.map((line, idx) => renderLine(line, idx))}
      </Box>

      <Box borderStyle="single" borderColor="gray" paddingX={1}>
        <Text>
          <Text color="green" bold>Y</Text><Text dimColor>=approve</Text>
          <Text> </Text>
          <Text color="red" bold>N</Text><Text dimColor>=reject</Text>
          <Text> </Text>
          <Text dimColor>↑↓/jk=scroll</Text>
        </Text>
      </Box>
    </Box>
  );
}
