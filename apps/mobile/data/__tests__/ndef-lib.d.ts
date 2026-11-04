// The NDEF encoder the NFC library ships, imported directly by tests so the
// fake Tag holds the same bytes a phone would read.
declare module "react-native-nfc-manager/ndef-lib" {
  import type { Ndef } from "react-native-nfc-manager";
  const ndef: typeof Ndef & { decodeMessage(bytes: number[] | Uint8Array): unknown[] };
  export default ndef;
}
