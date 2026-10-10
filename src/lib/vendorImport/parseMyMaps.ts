import { XMLParser } from "fast-xml-parser";
import { strFromU8, unzipSync } from "fflate";

export interface RawPin {
  layer: string;
  indexInLayer: number;
  name: string;
  address: string;
  point: { lat: number; lng: number } | null;
  data: Record<string, string>;
}

const MAX_KML_BYTES = 200 * 1024 * 1024;

// A My Maps export is a .kmz (a zip holding doc.kml + icons) or a bare .kml.
export function kmlTextFromBytes(bytes: Uint8Array): string {
  const isZip = bytes[0] === 0x50 && bytes[1] === 0x4b;
  if (!isZip) return new TextDecoder().decode(bytes);

  const files = unzipSync(bytes, {
    filter: (f) => f.name.toLowerCase().endsWith(".kml") && f.originalSize < MAX_KML_BYTES,
  });
  const name = Object.keys(files).find((n) => n.toLowerCase() === "doc.kml") ?? Object.keys(files)[0];
  if (!name) throw new Error("No .kml file found inside the KMZ.");
  return strFromU8(files[name]);
}

type XmlNode = Record<string, unknown>;

function asArray<T>(v: T | T[] | undefined): T[] {
  return v === undefined ? [] : Array.isArray(v) ? v : [v];
}

function str(v: unknown): string {
  return typeof v === "string" ? v.trim() : "";
}

// Reads every Placemark under every layer (Folder). Values stay strings on
// purpose — phone numbers and ZIPs must never be turned into numbers.
export function parseMyMapsKml(kmlText: string): RawPin[] {
  const parser = new XMLParser({
    ignoreAttributes: false,
    attributeNamePrefix: "@_",
    parseTagValue: false,
    parseAttributeValue: false,
    trimValues: true,
    isArray: (name) => name === "Folder" || name === "Placemark" || name === "Data",
  });
  const root = parser.parse(kmlText) as XmlNode;
  const document = ((root.kml as XmlNode | undefined)?.Document ?? {}) as XmlNode;

  const pins: RawPin[] = [];

  function readPlacemarks(container: XmlNode, layer: string) {
    asArray(container.Placemark as XmlNode[] | undefined).forEach((pm, i) => {
      const data: Record<string, string> = {};
      const ext = pm.ExtendedData as XmlNode | undefined;
      for (const d of asArray(ext?.Data as XmlNode[] | undefined)) {
        const key = str(d["@_name"]);
        if (key) data[key] = str(d.value);
      }

      let point: RawPin["point"] = null;
      const coords = str(((pm.Point as XmlNode | undefined)?.coordinates as unknown) ?? "");
      if (coords) {
        const [lng, lat] = coords.split(",").map(Number);
        if (Number.isFinite(lat) && Number.isFinite(lng)) point = { lat, lng };
      }

      pins.push({
        layer,
        indexInLayer: i,
        name: str(pm.name),
        address: str(pm.address),
        point,
        data,
      });
    });
  }

  function walk(container: XmlNode, layerName: string) {
    readPlacemarks(container, layerName);
    for (const folder of asArray(container.Folder as XmlNode[] | undefined)) {
      walk(folder, str(folder.name) || layerName);
    }
  }

  walk(document, "(no layer)");
  return pins;
}
