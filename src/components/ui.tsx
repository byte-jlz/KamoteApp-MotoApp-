import DateTimePicker, { DateTimePickerAndroid } from '@react-native-community/datetimepicker';
import { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleProp,
  StyleSheet,
  Text,
  TextInput,
  TextInputProps,
  View,
  ViewStyle,
} from 'react-native';
import { fmtDate } from '../lib/format';
import { Status } from '../lib/status';
import { colors } from '../lib/theme';

export function Screen({ children }: { children: ReactNode }) {
  return (
    <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === 'android' ? 'padding' : undefined}>
      <ScrollView
        style={styles.screen}
        contentContainerStyle={styles.screenContent}
        keyboardShouldPersistTaps="handled"
        automaticallyAdjustKeyboardInsets
      >
        {children}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

export function Card({ children, style }: { children: ReactNode; style?: StyleProp<ViewStyle> }) {
  return <View style={[styles.card, style]}>{children}</View>;
}

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost';

export function Button({
  title,
  onPress,
  variant = 'primary',
  disabled,
  style,
}: {
  title: string;
  onPress: () => void;
  variant?: ButtonVariant;
  disabled?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.button,
        styles[`btn_${variant}`],
        pressed && { opacity: 0.75 },
        disabled && { opacity: 0.4 },
        style,
      ]}
    >
      <Text style={[styles.buttonText, styles[`btnText_${variant}`]]}>{title}</Text>
    </Pressable>
  );
}

export function Field({ label, hint, ...props }: TextInputProps & { label: string; hint?: string }) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput placeholderTextColor={colors.placeholder} {...props} style={[styles.input, props.style]} />
      {hint ? <Text style={styles.hint}>{hint}</Text> : null}
    </View>
  );
}

export function DateField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: Date;
  onChange: (d: Date) => void;
}) {
  const max = new Date();

  if (Platform.OS === 'web') {
    return (
      <Field
        label={label}
        value={value.toISOString().slice(0, 10)}
        onChangeText={(t) => {
          const d = new Date(`${t}T12:00:00`);
          if (!isNaN(d.getTime())) onChange(d);
        }}
        placeholder="YYYY-MM-DD"
      />
    );
  }

  if (Platform.OS === 'ios') {
    return (
      <View style={[styles.field, styles.row]}>
        <Text style={[styles.label, { flex: 1, marginBottom: 0 }]}>{label}</Text>
        <DateTimePicker
          value={value}
          mode="date"
          display="compact"
          maximumDate={max}
          onChange={(_, d) => d && onChange(d)}
        />
      </View>
    );
  }

  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <Pressable
        style={styles.input}
        onPress={() =>
          DateTimePickerAndroid.open({
            value,
            mode: 'date',
            maximumDate: max,
            onChange: (e, d) => e.type === 'set' && d && onChange(d),
          })
        }
      >
        <Text style={styles.inputText}>📅 {fmtDate(value)}</Text>
      </Pressable>
    </View>
  );
}

const STATUS_META: Record<Status, { label: string; fg: string; bg: string }> = {
  overdue: { label: 'Overdue', fg: colors.danger, bg: colors.dangerBg },
  soon: { label: 'Due soon', fg: colors.warn, bg: colors.warnBg },
  ok: { label: 'OK', fg: colors.ok, bg: colors.okBg },
  off: { label: 'Off', fg: colors.muted, bg: colors.offBg },
};

export function statusColor(s: Status) {
  return STATUS_META[s].fg;
}

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const m = STATUS_META[status];
  return (
    <View style={[styles.pill, { backgroundColor: m.bg }]}>
      <Text style={[styles.pillText, { color: m.fg }]}>{label ?? m.label}</Text>
    </View>
  );
}

export function ProgressBar({ progress, status }: { progress: number; status: Status }) {
  const pct = Math.min(1, Math.max(0, progress)) * 100;
  return (
    <View style={styles.track}>
      <View style={[styles.fill, { width: `${pct}%`, backgroundColor: statusColor(status) }]} />
    </View>
  );
}

export function SectionTitle({ children, right }: { children: ReactNode; right?: ReactNode }) {
  return (
    <View style={[styles.row, styles.sectionTitleRow]}>
      <Text style={styles.sectionTitle}>{children}</Text>
      {right}
    </View>
  );
}

export function Chip({ label, selected, onPress }: { label: string; selected: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={[styles.chip, selected && styles.chipSelected]}>
      <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
    </Pressable>
  );
}

export function Checkbox({ label, sub, checked, onPress }: { label: string; sub?: string; checked: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={styles.checkRow} accessibilityRole="checkbox" accessibilityState={{ checked }}>
      <View style={[styles.checkbox, checked && styles.checkboxOn]}>{checked && <Text style={styles.checkMark}>✓</Text>}</View>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkLabel}>{label}</Text>
        {sub ? <Text style={styles.hint}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export const styles = StyleSheet.create({
  flex: { flex: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  screenContent: { padding: 16, paddingBottom: 48, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center' },
  card: {
    backgroundColor: colors.card,
    borderRadius: 14,
    padding: 16,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  button: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btn_primary: { backgroundColor: colors.primary },
  btn_secondary: { backgroundColor: colors.card, borderWidth: 1, borderColor: colors.border },
  btn_danger: { backgroundColor: colors.dangerBg },
  btn_ghost: { backgroundColor: 'transparent', paddingVertical: 8 },
  buttonText: { fontSize: 16, fontWeight: '700' },
  btnText_primary: { color: '#fff' },
  btnText_secondary: { color: colors.text },
  btnText_danger: { color: colors.danger },
  btnText_ghost: { color: colors.primary },
  field: { marginBottom: 14 },
  label: { fontSize: 13, fontWeight: '600', color: colors.muted, marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.4 },
  input: {
    backgroundColor: colors.inputBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.border,
    paddingHorizontal: 12,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.text,
  },
  inputText: { fontSize: 16, color: colors.text },
  hint: { fontSize: 13, color: colors.muted, marginTop: 4 },
  pill: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 3, alignSelf: 'flex-start' },
  pillText: { fontSize: 12, fontWeight: '700' },
  track: { height: 6, borderRadius: 3, backgroundColor: colors.border, overflow: 'hidden' },
  fill: { height: 6, borderRadius: 3 },
  sectionTitleRow: { justifyContent: 'space-between', marginTop: 8 },
  sectionTitle: { fontSize: 13, fontWeight: '700', color: colors.muted, textTransform: 'uppercase', letterSpacing: 0.6 },
  chip: { borderRadius: 999, borderWidth: 1, borderColor: colors.border, backgroundColor: colors.card, paddingHorizontal: 14, paddingVertical: 8 },
  chipSelected: { backgroundColor: colors.primary, borderColor: colors.primary },
  chipText: { fontSize: 14, color: colors.text, fontWeight: '600' },
  chipTextSelected: { color: '#fff' },
  checkRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 10 },
  checkbox: { width: 24, height: 24, borderRadius: 6, borderWidth: 2, borderColor: colors.border, alignItems: 'center', justifyContent: 'center' },
  checkboxOn: { backgroundColor: colors.primary, borderColor: colors.primary },
  checkMark: { color: '#fff', fontWeight: '900', fontSize: 14 },
  checkLabel: { fontSize: 16, color: colors.text },
  title: { fontSize: 18, fontWeight: '700', color: colors.text },
  body: { fontSize: 15, color: colors.text },
  muted: { fontSize: 14, color: colors.muted },
});
