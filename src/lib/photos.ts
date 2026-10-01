import { Directory, File, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import * as ImagePicker from 'expo-image-picker';
import { createVideoPlayer, VideoPlayer } from 'expo-video';
import { Platform } from 'react-native';
import { uid } from './format';
import { Album, CustomAlbum } from './types';

export const BUILTIN_ALBUMS: CustomAlbum[] = [
  { id: 'ride', label: 'Rides', icon: '🛣️' },
  { id: 'service', label: 'Service', icon: '🔧' },
  { id: 'parts', label: 'Parts', icon: '⚙️' },
  { id: 'bike', label: 'My Bike', icon: '🏍️' },
  { id: 'other', label: 'Other', icon: '📁' },
];

/** Icons offered when creating a category. */
export const ALBUM_ICONS = ['🌙', '🌅', '⛰️', '🏖️', '🏕️', '🏁', '👥', '🎉', '⛽', '🧳', '🌧️', '🍜', '📸', '🛠️', '🛡️', '⭐'];

export function allAlbums(custom: CustomAlbum[]) {
  return [...BUILTIN_ALBUMS, ...custom];
}

export function albumMeta(id: Album, custom: CustomAlbum[]) {
  return allAlbums(custom).find((a) => a.id === id) ?? BUILTIN_ALBUMS[BUILTIN_ALBUMS.length - 1];
}

export function isBuiltinAlbum(id: Album) {
  return BUILTIN_ALBUMS.some((a) => a.id === id);
}

// Media lives in the app's private storage on the phone; nothing is uploaded.
function mediaDir() {
  const dir = new Directory(Paths.document, 'photos');
  dir.create({ idempotent: true, intermediates: true });
  return dir;
}

/** Copy a picked/captured file into app storage. Returns the stored file name. */
export function saveMediaFile(sourceUri: string, fallbackExt = '.jpg') {
  const ext = sourceUri.match(/\.(jpe?g|png|heic|webp|mp4|mov|m4v|3gp|webm)$/i)?.[0] ?? fallbackExt;
  const name = `${uid()}${ext.toLowerCase()}`;
  new File(sourceUri).copy(new File(mediaDir(), name));
  return name;
}

/** Only the file name is stored, because the app's folder path can change after updates (iOS). */
export function mediaUri(fileName: string) {
  return new File(Paths.document, 'photos', fileName).uri;
}

export function deleteMediaFile(fileName: string | undefined) {
  if (!fileName) return;
  try {
    const f = new File(Paths.document, 'photos', fileName);
    if (f.exists) f.delete();
  } catch (e) {
    console.warn('Failed to delete media', e);
  }
}

function waitUntilReady(player: VideoPlayer, timeoutMs = 8000) {
  return new Promise<void>((resolve, reject) => {
    if (player.status === 'readyToPlay') return resolve();
    const timer = setTimeout(() => {
      sub.remove();
      reject(new Error('Video took too long to load'));
    }, timeoutMs);
    const sub = player.addListener('statusChange', ({ status }) => {
      if (status === 'readyToPlay' || status === 'error') {
        clearTimeout(timer);
        sub.remove();
        if (status === 'readyToPlay') resolve();
        else reject(new Error('Video failed to load'));
      }
    });
  });
}

/** Grab a frame from a stored video and save it as a JPEG next to it, for the gallery grid. */
export async function makeVideoThumb(videoFileName: string): Promise<string | undefined> {
  const uri = mediaUri(videoFileName);
  // expo-video on Android reads thumbnails from the raw URI string without URL-decoding it, which breaks
  // when the app folder contains '%' (e.g. Expo Go's "%40user%2Fslug"). Its reader opens the file directly,
  // so it doesn't need the player loaded — only the decoded path.
  const android = Platform.OS === 'android';
  const player = createVideoPlayer(android ? decodeURI(uri) : uri);
  try {
    if (!android) await waitUntilReady(player);
    const [frame] = await player.generateThumbnailsAsync(0.5, { maxWidth: 480, maxHeight: 480 });
    const image = await ImageManipulator.manipulate(frame).renderAsync();
    const out = await image.saveAsync({ compress: 0.7, format: SaveFormat.JPEG });
    return saveMediaFile(out.uri);
  } catch (e) {
    console.warn('Failed to make video thumbnail', e);
    return undefined;
  } finally {
    player.release();
  }
}

export function fmtDuration(ms: number) {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** Let the user pick and crop a square image (logo / profile photo). Resolves to a temporary URI, or null if cancelled. */
export async function pickSquareImage() {
  const res = await ImagePicker.launchImageLibraryAsync({
    mediaTypes: ['images'],
    allowsEditing: true,
    aspect: [1, 1],
    quality: 0.7,
  });
  return res.canceled || !res.assets.length ? null : res.assets[0].uri;
}
