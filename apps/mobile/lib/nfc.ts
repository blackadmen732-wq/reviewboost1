import NfcManager, { NfcTech, Ndef } from "react-native-nfc-manager";

export interface NfcWriteResult {
  success: boolean;
  verified: boolean;
  tagUid: string | null;
  error: string | null;
}

export async function isNfcSupported(): Promise<boolean> {
  try {
    return await NfcManager.isSupported();
  } catch {
    return false;
  }
}

export async function isNfcEnabled(): Promise<boolean> {
  try {
    return await NfcManager.isEnabled();
  } catch {
    return false;
  }
}

export async function initNfc(): Promise<boolean> {
  try {
    await NfcManager.start();
    return true;
  } catch {
    return false;
  }
}

export async function writeNfcTag(url: string): Promise<NfcWriteResult> {
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef);

    const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
    if (!bytes) {
      return { success: false, verified: false, tagUid: null, error: "Failed to encode NDEF message." };
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    // Read back for verification
    const tag = await NfcManager.getTag();
    const tagUid = tag?.id ?? null;

    let verified = false;
    if (tag?.ndefMessage && tag.ndefMessage.length > 0) {
      const readBack = tag.ndefMessage[0];
      if (readBack?.payload) {
        const decoded = Ndef.uri.decodePayload(
          new Uint8Array(readBack.payload),
        );
        verified = decoded === url;
      }
    }

    return { success: true, verified, tagUid, error: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "NFC write failed.";
    return { success: false, verified: false, tagUid: null, error: message };
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // Cleanup may fail if session was already closed
    }
  }
}

export async function cancelNfcRequest(): Promise<void> {
  try {
    await NfcManager.cancelTechnologyRequest();
  } catch {
    // Ignore
  }
}
