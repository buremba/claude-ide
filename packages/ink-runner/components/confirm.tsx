import { Box, Text, useInput, useApp } from 'ink';
import { useState } from 'react';

declare const onComplete: (result: unknown) => void;
declare const args: {
  prompt?: string;
  question?: string;  // alias for prompt
  message?: string;   // alias for prompt
  yes?: string;
  no?: string;
};

export default function Confirm() {
  const { exit } = useApp();
  const [selected, setSelected] = useState<'yes' | 'no'>('yes');

  const prompt = args?.prompt || args?.question || args?.message || 'Are you sure?';
  const yesLabel = args?.yes || 'Yes';
  const noLabel = args?.no || 'No';

  useInput((input, key) => {
    // Cancel on escape or 'n' when not selecting
    if (key.escape) {
      onComplete({ action: 'cancel' });
      exit();
      return;
    }

    // Quick keys
    if (input === 'y' || input === 'Y') {
      onComplete({ action: 'accept', confirmed: true });
      exit();
      return;
    }
    if (input === 'n' || input === 'N') {
      onComplete({ action: 'accept', confirmed: false });
      exit();
      return;
    }

    // Arrow keys to switch selection
    if (key.leftArrow || key.rightArrow || input === 'h' || input === 'l') {
      setSelected(s => s === 'yes' ? 'no' : 'yes');
      return;
    }

    // Confirm selection
    if (key.return) {
      onComplete({ action: 'accept', confirmed: selected === 'yes' });
      exit();
      return;
    }
  });

  return (
    <Box flexDirection="column" paddingX={1}>
      <Box marginBottom={1}>
        <Text bold color="cyan">{prompt}</Text>
      </Box>

      <Box gap={2}>
        <Box>
          <Text
            color={selected === 'yes' ? 'green' : undefined}
            bold={selected === 'yes'}
            inverse={selected === 'yes'}
          >
            {' '}{yesLabel}{' '}
          </Text>
        </Box>
        <Box>
          <Text
            color={selected === 'no' ? 'red' : undefined}
            bold={selected === 'no'}
            inverse={selected === 'no'}
          >
            {' '}{noLabel}{' '}
          </Text>
        </Box>
      </Box>

      <Box marginTop={1}>
        <Text dimColor>y/n=quick select  ←→=switch  Enter=confirm  Esc=cancel</Text>
      </Box>
    </Box>
  );
}
