const namespace = "mfp:anaf:dgti:a4203:declaratie:v1";
const maxBytes = 8 * 1024 * 1024;
const maxBani = 100_000_000;
const pkcs7OidPrefix = [0x2a, 0x86, 0x48, 0x86, 0xf7, 0x0d, 1, 7];

type ImportErrorCode = "zImportInvalid" | "zImportSize" | "zImportPayments" | "zImportTotals";

export class TremolZImportError extends Error {
  constructor(readonly code: ImportErrorCode) {
    super(code);
  }
}

function invalid(): never {
  throw new TremolZImportError("zImportInvalid");
}

// Read the DER ContentInfo and EncapsulatedContentInfo from CMS SignedData.
// This extracts the payload for review. It does not verify the CMS signature.
function extractCmsXml(bytes: Uint8Array): Uint8Array {
  function reader(start: number, end: number) {
    let cursor = start;
    return {
      read(tag: number) {
        if (cursor + 2 > end || bytes[cursor++] !== tag) invalid();
        let length = bytes[cursor++];
        if (length >= 0x80) {
          const lengthBytes = length - 0x80;
          if (lengthBytes < 1 || lengthBytes > 4 || cursor + lengthBytes > end) invalid();
          length = 0;
          for (let i = 0; i < lengthBytes; i++) length = length * 256 + bytes[cursor++];
        }
        const offset = cursor;
        cursor += length;
        if (cursor > end) invalid();
        return { offset, end: cursor };
      },
      readOid(lastByte: number) {
        const oid = this.read(0x06);
        const expected = [...pkcs7OidPrefix, lastByte];
        if (oid.end - oid.offset !== expected.length || expected.some((byte, i) => bytes[oid.offset + i] !== byte)) invalid();
      },
      child(tag: number) {
        const value = this.read(tag);
        return reader(value.offset, value.end);
      },
    };
  }

  const contentInfo = reader(0, bytes.length).child(0x30);
  contentInfo.readOid(2); // signedData
  const signedData = contentInfo.child(0xa0).child(0x30);
  signedData.read(0x02); // version
  signedData.read(0x31); // digestAlgorithms
  const encapsulated = signedData.child(0x30);
  encapsulated.readOid(1); // data
  const xml = encapsulated.child(0xa0).read(0x04);
  return bytes.subarray(xml.offset, xml.end);
}

function readBani(value: string | null): number {
  const match = /^(\d{1,20})(?:\.(\d{1,2}))?$/.exec(value?.trim() ?? "");
  if (!match) invalid();
  const amount = Number(match[1]) * 100 + Number((match[2] ?? "").padEnd(2, "0"));
  if (amount > maxBani) invalid();
  return amount;
}

function children(element: Element, name: string): Element[] {
  return Array.from(element.children).filter((child) => child.namespaceURI === namespace && child.localName === name);
}

export async function readTremolZ(file: File) {
  if (file.size > maxBytes) throw new TremolZImportError("zImportSize");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const xmlBytes = bytes[0] === 0x30 ? extractCmsXml(bytes) : bytes;
  let xml: string;
  try {
    xml = new TextDecoder("utf-8", { fatal: true }).decode(xmlBytes);
  } catch {
    invalid();
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) invalid();

  const document = new DOMParser().parseFromString(xml, "application/xml");
  if (document.getElementsByTagNameNS("http://www.mozilla.org/newlayout/xml/parsererror.xml", "parsererror").length) invalid();
  const root = document.documentElement;
  if (root.localName !== "msj" || root.namespaceURI !== namespace) invalid();
  const reports = children(root, "rB");
  if (reports.length !== 1) invalid();
  const report = reports[0];
  // idR = device identifier (10) + local timestamp (14) + Z number (4).
  const id = /^(\d{10})(\d{4})(\d{2})(\d{2})\d{6}(\d{4})$/.exec(report.getAttribute("idR") ?? "");
  if (!id || !root.getAttribute("idM")?.startsWith(id[1])) invalid();
  const date = `${id[2]}-${id[3]}-${id[4]}`;
  const day = new Date(`${date}T00:00:00Z`);
  if (!Number.isFinite(day.getTime()) || !day.toISOString().startsWith(date)) invalid();

  if (report.getAttribute("monRef") !== "RON") throw new TremolZImportError("zImportPayments");
  const total = readBani(report.getAttribute("totB"));
  const amounts = new Map<string, number>();
  for (const payment of children(report, "pl")) {
    const type = payment.getAttribute("tipP")?.trim().replace(/^0+(?=\d)/, "");
    if ((type !== "1" && type !== "3") || payment.getAttribute("monPl") !== "RON") {
      throw new TremolZImportError("zImportPayments");
    }
    if (amounts.has(type)) invalid();
    amounts.set(type, readBani(payment.getAttribute("valPl")));
  }
  const cash = amounts.get("3") ?? 0;
  const card = amounts.get("1") ?? 0;
  if (cash + card !== total) throw new TremolZImportError("zImportTotals");

  return { date, zNumber: id[5], total, cash, card };
}
