import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { Alert, Text, View } from 'react-native';
import { Button, Card, Chip, Field, Screen, styles } from '../components/ui';
import { BIKE_TYPES } from '../lib/defaults';
import { parseNum } from '../lib/format';
import { useBike, useStore } from '../lib/store';
import { BikeType } from '../lib/types';

export default function BikeForm() {
  const { id } = useLocalSearchParams<{ id?: string }>();
  const existing = useBike(id);
  const { addBike, editBike, deleteBike } = useStore();

  const [name, setName] = useState(existing?.name ?? '');
  const [make, setMake] = useState(existing?.make ?? '');
  const [model, setModel] = useState(existing?.model ?? '');
  const [year, setYear] = useState(existing?.year ?? '');
  const [plate, setPlate] = useState(existing?.plate ?? '');
  const [type, setType] = useState<BikeType>(existing?.type ?? 'scooter');
  const [odo, setOdo] = useState('');

  const save = () => {
    const finalName = name.trim() || [make.trim(), model.trim()].filter(Boolean).join(' ');
    if (!finalName) return Alert.alert('Missing name', 'Give your motorcycle a name, or enter its make and model.');
    const fields = { name: finalName, make: make.trim(), model: model.trim(), year: year.trim(), plate: plate.trim().toUpperCase(), type };

    if (existing) {
      editBike(existing.id, fields);
      router.back();
      return;
    }
    const km = parseNum(odo);
    if (km === null) return Alert.alert('Odometer needed', 'Enter the current odometer reading in km.');
    const newId = addBike({ ...fields, odometer: km });
    router.replace(`/bike/${newId}`);
  };

  const remove = () => {
    if (!existing) return;
    Alert.alert('Delete motorcycle?', `This removes ${existing.name} and all its service history.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          deleteBike(existing.id);
          router.dismissTo('/');
        },
      },
    ]);
  };

  return (
    <>
      <Stack.Screen options={{ title: existing ? 'Edit Motorcycle' : 'Add Motorcycle' }} />
      <Screen>
        <Card>
          <Field label="Nickname" value={name} onChangeText={setName} placeholder="e.g. Daily Ride" />
          <View style={[styles.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Field label="Make" value={make} onChangeText={setMake} placeholder="Honda" />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Model" value={model} onChangeText={setModel} placeholder="Click 125i" />
            </View>
          </View>
          <View style={[styles.row, { gap: 10 }]}>
            <View style={{ flex: 1 }}>
              <Field label="Year" value={year} onChangeText={setYear} placeholder="2024" keyboardType="number-pad" maxLength={4} />
            </View>
            <View style={{ flex: 1 }}>
              <Field label="Plate No." value={plate} onChangeText={setPlate} placeholder="ABC 1234" autoCapitalize="characters" />
            </View>
          </View>
          {!existing && (
            <Field
              label="Current odometer (km)"
              value={odo}
              onChangeText={setOdo}
              placeholder="e.g. 8500"
              keyboardType="number-pad"
            />
          )}
        </Card>

        <Card>
          <Text style={[styles.label, { marginBottom: 10 }]}>Motorcycle type</Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {BIKE_TYPES.map((t) => (
              <Chip key={t.value} label={t.label} selected={type === t.value} onPress={() => setType(t.value)} />
            ))}
          </View>
          <Text style={styles.hint}>{BIKE_TYPES.find((t) => t.value === type)?.hint}</Text>
          <Text style={[styles.hint, { marginTop: 8 }]}>
            {existing
              ? 'Changing the type does not change your existing maintenance items.'
              : 'We set up a recommended PMS schedule for this type. You can edit any interval later.'}
          </Text>
        </Card>

        <Button title={existing ? 'Save changes' : 'Add motorcycle'} onPress={save} />
        {existing && <Button title="Delete motorcycle" variant="danger" onPress={remove} />}
      </Screen>
    </>
  );
}
