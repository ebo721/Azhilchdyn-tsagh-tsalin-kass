import type {
  AttendanceDeviceRegistration,
  AttendanceDeviceRegistrationInput,
  AttendanceDeviceSignedRequest,
  AttendanceDeviceStatus,
} from '@workspace/api-client-react';
import {
  getGetAttendanceDeviceStatusUrl,
  getPunchAttendanceDeviceUrl,
  getRegisterAttendanceDeviceUrl,
} from '@workspace/api-client-react';

type StoredDevice = { deviceId: number; privateKey: CryptoKey };

const databaseName = 'staff-ops-office-attendance';
const storeName = 'credentials';
const keyName = 'this-browser';

function apiOrigin(): string {
  const configured = import.meta.env.VITE_OFFICE_ATTENDANCE_API_ORIGIN as string | undefined;
  if (!configured || !import.meta.env.PROD) {
    throw new Error('Ирцийн төхөөрөмжийн бүртгэл зөвхөн production API-ийн шууд HTTPS холболтоор ажиллана.');
  }
  const parsed = new URL(configured);
  if (parsed.protocol !== 'https:' || parsed.origin === window.location.origin) {
    throw new Error('Ирцийн API-ийн шууд HTTPS хаяг буруу тохируулагдсан байна.');
  }
  return parsed.origin;
}

export function directApiAvailable(): boolean {
  try {
    apiOrigin();
    return true;
  } catch {
    return false;
  }
}

function openDatabase(): Promise<IDBDatabase> {
  if (!('indexedDB' in window) || !('crypto' in window) || !crypto.subtle) {
    throw new Error('Энэ браузер төхөөрөмжийн хамгаалалттай бүртгэлийг дэмжихгүй байна.');
  }
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(databaseName, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(storeName);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error('Төхөөрөмжийн бүртгэлийг нээж чадсангүй.'));
  });
}

async function readDevice(): Promise<StoredDevice | null> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readonly');
    const request = transaction.objectStore(storeName).get(keyName);
    request.onsuccess = () => resolve((request.result as StoredDevice | undefined) ?? null);
    request.onerror = () => reject(new Error('Төхөөрөмжийн бүртгэлийг уншиж чадсангүй.'));
    transaction.oncomplete = () => db.close();
    transaction.onabort = () => db.close();
  });
}

async function saveDevice(device: StoredDevice): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).put(device, keyName);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(new Error('Төхөөрөмжийн түлхүүрийг хадгалж чадсангүй. HR-д хандаж төхөөрөмжийг хүчингүй болгоно уу.')); };
  });
}

export async function clearDevice(): Promise<void> {
  const db = await openDatabase();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(storeName, 'readwrite');
    transaction.objectStore(storeName).delete(keyName);
    transaction.oncomplete = () => { db.close(); resolve(); };
    transaction.onerror = () => { db.close(); reject(new Error('Төхөөрөмжийн бүртгэлийг арилгаж чадсангүй.')); };
  });
}

export async function getRegisteredDevice(): Promise<{ deviceId: number } | null> {
  const device = await readDevice();
  return device ? { deviceId: device.deviceId } : null;
}

function base64url(bytes: ArrayBuffer): string {
  const binary = String.fromCharCode(...new Uint8Array(bytes));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

async function signature(privateKey: CryptoKey, message: string): Promise<string> {
  return base64url(await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    privateKey,
    new TextEncoder().encode(message),
  ));
}

async function postDevice<T>(path: string, data: object): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${apiOrigin()}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
      credentials: 'omit',
      cache: 'no-store',
      referrerPolicy: 'no-referrer',
    });
  } catch {
    throw new Error('Ирцийн API-тай холбогдож чадсангүй. Сүлжээгээ шалгана уу.');
  }
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error || `Ирцийн хүсэлт амжилтгүй (${response.status}).`);
  }
  return await response.json() as T;
}

export async function enrollDevice(token: string, name: string): Promise<AttendanceDeviceRegistration> {
  if (await readDevice()) {
    throw new Error('Энэ браузер аль хэдийн бүртгэлтэй байна. Дахин бүртгэхийн өмнө HR-д хандаж хуучин төхөөрөмжийг хүчингүй болгоно уу.');
  }
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    false,
    ['sign', 'verify'],
  );
  const exported = await crypto.subtle.exportKey('jwk', pair.publicKey);
  if (!exported.x || !exported.y) throw new Error('Төхөөрөмжийн нийтийн түлхүүрийг гаргаж чадсангүй.');
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  const body: AttendanceDeviceRegistrationInput = {
    token,
    name: name.trim(),
    publicKey: { kty: 'EC', crv: 'P-256', x: exported.x, y: exported.y },
    timestamp,
    nonce,
    signature: await signature(pair.privateKey, `office-attendance-v1\nregister\n${timestamp}\n${nonce}\n${token}`),
  };
  const result = await postDevice<AttendanceDeviceRegistration>(getRegisterAttendanceDeviceUrl(), body);
  if (!Number.isSafeInteger(result.deviceId) || result.deviceId <= 0) {
    throw new Error('Сервер төхөөрөмжийн бүртгэлийн дугаар буцаасангүй.');
  }
  await saveDevice({ deviceId: result.deviceId, privateKey: pair.privateKey });
  return result;
}

async function signedRequest(action: 'status' | 'check-in' | 'check-out'): Promise<AttendanceDeviceSignedRequest> {
  const device = await readDevice();
  if (!device) throw new Error('Энэ браузер бүртгэлгүй байна. HR-ээс бүртгэлийн холбоос авна уу.');
  const timestamp = Date.now();
  const nonce = crypto.randomUUID();
  return {
    deviceId: device.deviceId,
    timestamp,
    nonce,
    signature: await signature(device.privateKey, `office-attendance-v1\n${action}\n${device.deviceId}\n${timestamp}\n${nonce}`),
  };
}

export async function getDeviceStatus(): Promise<AttendanceDeviceStatus> {
  return postDevice<AttendanceDeviceStatus>(
    getGetAttendanceDeviceStatusUrl(),
    await signedRequest('status'),
  );
}

export async function punchDevice(action: 'check-in' | 'check-out'): Promise<AttendanceDeviceStatus> {
  return postDevice<AttendanceDeviceStatus>(
    getPunchAttendanceDeviceUrl(),
    { ...(await signedRequest(action)), action },
  );
}