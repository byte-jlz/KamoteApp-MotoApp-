import { memo, useMemo } from 'react';
import { View } from 'react-native';
import { qrMatrix } from '../lib/qr';

/**
 * A QR code drawn with plain Views (no SVG or native module). Each row is split into runs of the same color,
 * so a typical code needs a few hundred Views. Always black on white, with the blank border scanners need.
 */
export const QrCode = memo(function QrCode({ value, size }: { value: string; size: number }) {
  const rows = useMemo(() => {
    const m = qrMatrix(value);
    return m.map((row) => {
      const runs: { dark: boolean; len: number }[] = [];
      for (const dark of row) {
        const last = runs[runs.length - 1];
        if (last && last.dark === dark) last.len++;
        else runs.push({ dark, len: 1 });
      }
      return runs;
    });
  }, [value]);

  const quiet = 4;
  // Whole pixels per module, so no hairline seams appear between runs.
  const cell = Math.max(1, Math.floor(size / (rows.length + quiet * 2)));
  const full = cell * (rows.length + quiet * 2);
  return (
    <View
      accessibilityRole="image"
      accessibilityLabel="QR code"
      style={{ width: full, height: full, backgroundColor: '#fff', padding: cell * quiet }}
    >
      {rows.map((runs, r) => (
        <View key={r} style={{ flexDirection: 'row', height: cell }}>
          {runs.map((run, i) => (
            <View key={i} style={{ width: cell * run.len, height: cell, backgroundColor: run.dark ? '#000' : '#fff' }} />
          ))}
        </View>
      ))}
    </View>
  );
});
