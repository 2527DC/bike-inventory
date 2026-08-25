import bwipjs from "bwip-js";

export type BarcodeType = "code128" | "qrcode" | "ean13";

interface BarcodeOptions {
  text: string;
  type?: BarcodeType;
  scale?: number;
  height?: number;
  includetext?: boolean;
}

export async function generateBarcodePng(
  options: BarcodeOptions
): Promise<string> {
  const {
    text,
    type = "code128",
    scale = 3,
    height = 12,
    includetext = false,
  } = options;

  try {
    const png = await bwipjs.toBuffer({
      bcid: type,
      text,
      scale,
      height,
      includetext,
      paddingwidth: 5,
      paddingheight: 5,
    });

    return `data:image/png;base64,${png.toString("base64")}`;
  } catch {
    throw new Error(`Failed to generate barcode for: ${text}`);
  }
}

export function generateSerialCode(sku: string, sequence: number): string {
  if (sequence > 99999) throw new Error(`Serial sequence overflow for SKU ${sku}: ${sequence}`);
  const padded = String(sequence).padStart(4, "0");
  return `${sku}-${padded}`;
}

export function getNextSerialSequence(
  existingSerials: string[],
  sku: string
): number {
  const prefix = `${sku}-`;
  let maxSeq = 0;

  for (const serial of existingSerials) {
    if (serial.startsWith(prefix)) {
      const seqStr = serial.slice(prefix.length);
      const seq = parseInt(seqStr, 10);
      if (!isNaN(seq) && seq > maxSeq) {
        maxSeq = seq;
      }
    }
  }

  return maxSeq + 1;
}

export function generateBatchSerialCodes(
  sku: string,
  quantity: number,
  startSequence: number
): string[] {
  const codes: string[] = [];
  for (let i = 0; i < quantity; i++) {
    codes.push(generateSerialCode(sku, startSequence + i));
  }
  return codes;
}
