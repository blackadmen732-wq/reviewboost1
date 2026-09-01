import NfcManager, { NfcTech, Ndef } from "react-native-nfc-manager";

export interface NfcWriteResult {
  success: boolean;
  verified: boolean;
  error: string | null;
  existingContent: "blank" | "same-url" | "different" | null;
  existingDescription: string | null;
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

export async function readExistingNfcContent(url: string): Promise<NfcWriteResult["existingContent"] & { description: string | null }> {
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef);
    const tag = await NfcManager.getTag();

    if (!tag?.ndefMessage || tag.ndefMessage.length === 0) {
      return { existingContent: "blank" as const, description: null };
    }

    const firstRecord = tag.ndefMessage[0];
    if (firstRecord?.payload) {
      const decoded = Ndef.uri.decodePayload(new Uint8Array(firstRecord.payload));
      if (decoded === url) {
        return { existingContent: "same-url" as const, description: null };
      }
      return { existingContent: "different" as const, description: decoded.slice(0, 60) };
    }

    return { existingContent: "different" as const, description: "Unknown content" };
  } finally {
    try {
      await NfcManager.cancelTechnologyRequest();
    } catch {
      // Cleanup
    }
  }
}

export async function writeNfcTag(url: string): Promise<NfcWriteResult> {
  try {
    await NfcManager.requestTechnology(NfcTech.Ndef);

    const bytes = Ndef.encodeMessage([Ndef.uriRecord(url)]);
    if (!bytes) {
      return { success: false, verified: false, error: "Failed to encode NDEF message.", existingContent: null, existingDescription: null };
    }

    await NfcManager.ndefHandler.writeNdefMessage(bytes);

    // Fresh read-back using ndefHandler.getNdefMessage() instead of getTag()
    // which may return stale pre-write data
    let verified = false;
    try {
      const readBack = await NfcManager.ndefHandler.getNdefMessage();
      if (readBack && Array.isArray(readBack) && readBack.length > 0) {
        const firstRecord = readBack[0];
        if (firstRecord?.payload) {
          const decoded = Ndef.uri.decodePayload(new Uint8Array(firstRecord.payload));
          verified = decoded === url;
        }
      }
    } catch {
      // getNdefMessage() failed — fall back to unverified success
    }

    return { success: true, verified, error: null, existingContent: null, existingDescription: null };
  } catch (e) {
    const message = e instanceof Error ? e.message : "NFC write failed.";
    return { success: false, verified: false, error: message, existingContent: null, existingDescription: null };
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
