// Camera / gallery capture + compression pipeline (SPEC.md section 6 "Foto": dari kamera,
// metadata, dikompresi sebelum simpan/sync). Compression always runs BEFORE the file is written
// to permanent storage or referenced by a field record, per BRD 01 section 15.

import * as ImagePicker from 'expo-image-picker';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { Directory, File, Paths } from 'expo-file-system';
import { PHOTO_COMPRESS_QUALITY, PHOTO_MAX_DIMENSION } from '../config';
import { uuid } from '../utils/uuid';

const PHOTOS_DIR_NAME = 'ews_photos';

function photosDir(): Directory {
  const dir = new Directory(Paths.document, PHOTOS_DIR_NAME);
  if (!dir.exists) dir.create();
  return dir;
}

export interface CapturedPhoto {
  uri: string;
  fileName: string;
  mimeType: string;
  size: number;
}

async function compressAndStore(sourceUri: string): Promise<CapturedPhoto> {
  const context = ImageManipulator.manipulate(sourceUri);
  context.resize({ width: PHOTO_MAX_DIMENSION });
  const rendered = await context.renderAsync();
  const result = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: PHOTO_COMPRESS_QUALITY });

  const fileName = `${uuid()}.jpg`;
  const dest = new File(photosDir(), fileName);
  const source = new File(result.uri);
  await source.copy(dest);
  // The manipulator's temp render lives in cache; once copied to our permanent photos dir it's
  // safe to leave the cache copy for the OS to reclaim (we never reference result.uri again).

  return { uri: dest.uri, fileName, mimeType: 'image/jpeg', size: dest.size ?? 0 };
}

/** Opens the camera, compresses the shot, and copies it into permanent app storage. Returns null
 * if the user cancels or permission is denied. */
export async function takePhoto(): Promise<CapturedPhoto | null> {
  const perm = await ImagePicker.requestCameraPermissionsAsync();
  if (perm.status !== 'granted') return null;
  const result = await ImagePicker.launchCameraAsync({ mediaTypes: ['images'], quality: 1, allowsEditing: false });
  if (result.canceled || !result.assets?.length) return null;
  return compressAndStore(result.assets[0].uri);
}

/** Opens the photo library as a fallback capture path (useful for demos without a working camera). */
export async function pickPhotoFromLibrary(): Promise<CapturedPhoto | null> {
  const perm = await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (perm.status !== 'granted') return null;
  const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
  if (result.canceled || !result.assets?.length) return null;
  return compressAndStore(result.assets[0].uri);
}

export function deletePhotoFile(uri: string): void {
  try {
    const f = new File(uri);
    if (f.exists) f.delete();
  } catch {
    // best-effort cleanup only
  }
}
