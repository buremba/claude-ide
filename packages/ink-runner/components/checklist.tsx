import { Box, Text, useInput, useApp, useStdout } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: {
  title?: string;
  items?: string;  // comma-separated
  options?: string;  // alias for items
  checked?: string; // comma-separated indices, e.g. "0,2"
};

interface Item {
  label: string;
  checked: boolean;
}

export default function Checklist() {
  const { exit } = useApp();
  const { stdout } = useStdout();

  const title = args?.title || 'Checklist';
  const itemLabels = (args?.items || args?.options)?.split(',').map(s => s.trim()).filter(Boolean) || ['Item 1', 'Item 2', 'Item 3'];
  const preChecked = new Set(
    args?.checked?.split(',').map(s => parseInt(s.trim(), 10)).filter(n => !isNaN(n)) || []
  );

  const [items, setItems] = useState<Item[]>(
    itemLabels.map((label, i) => ({ label, checked: preChecked.has(i) }))
  );
  const [cursor, setCursor] = useState(0);
  const [scroll, setScroll] = useState(0);

  const visibleLines = stdout?.rows ? Math.max(5, stdout.rows - 6) : 10;
  const maxScroll = Math.max(0, items.length - visibleLines);

  useInput((input, key) => {
    if (input === 'q' || key.escape) {
      onComplete({ action: 'cancel' });
      exit();
      return;
    }

    // Submit
    if (key.return && cursor === items.length) {
      const checked = items.map((item, i) => item.checked ? i : -1).filter(i => i >= 0);
      onComplete({
        action: 'accept',
        checked,
        items: itemLabels,
        checkedLabels: items.filter(item => item.checked).map(item => item.label),
      });
      exit();
      return;
    }

    // Navigate
    if (key.upArrow || input === 'k') {
      setCursor(c => {
        const newC = Math.max(0, c - 1);
        if (newC < scroll) setScroll(newC);
        return newC;
      });
      return;
    }
    if (key.downArrow || input === 'j') {
      setCursor(c => {
        const newC = Math.min(items.length, c + 1); // +1 for Done button
        if (newC >= scroll + visibleLines) setScroll(Math.min(maxScroll, newC - visibleLines + 1));
        return newC;
      });
      return;
    }

    // Toggle item
    if ((input === ' ' || key.return) && cursor < items.length) {
      setItems(prev => prev.map((item, i) =>
        i === cursor ? { ...item, checked: !item.checked } : item
      ));
      return;
    }

    // Check all
    if (input === 'a') {
      setItems(prev => prev.map(item => ({ ...item, checked: true })));
      return;
    }

    // Uncheck all
    if (input === 'n') {
      setItems(prev => prev.map(item => ({ ...item, checked: false })));
      return;
    }
  });

  const displayItems = items.slice(scroll, scroll + visibleLines);
  const checkedCount = items.filter(i => i.checked).length;

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{title}</Text>
        <Text dimColor> ({checkedCount}/{items.length} checked)</Text>
      </Box>

      <Box flexDirection="column">
        {displayItems.map((item, displayIdx) => {
          const actualIdx = scroll + displayIdx;
          const isSelected = actualIdx === cursor;
          const checkbox = item.checked ? '☑' : '☐';
          const checkColor = item.checked ? 'green' : 'gray';

          return (
            <Box key={actualIdx}>
              <Text inverse={isSelected}>
                <Text color={checkColor}>{checkbox}</Text>
                <Text> {item.label}</Text>
              </Text>
            </Box>
          );
        })}

        {/* Done button */}
        <Box marginTop={1}>
          <Text
            inverse={cursor === items.length}
            color={cursor === items.length ? 'green' : undefined}
            bold={cursor === items.length}
          >
            {'  '}[Done]{'  '}
          </Text>
        </Box>
      </Box>

      {items.length > visibleLines && (
        <Box marginTop={1}>
          <Text dimColor>({scroll + 1}-{Math.min(scroll + visibleLines, items.length)}/{items.length})</Text>
        </Box>
      )}

      <Box marginTop={1}>
        <Text dimColor>Space=toggle  a=all  n=none  ↑↓=nav  Enter=done  q=cancel</Text>
      </Box>
    </Box>
  );
}
