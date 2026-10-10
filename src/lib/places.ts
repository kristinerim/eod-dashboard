// Turns a Google Places (New) result into the separate address fields the
// guided workflow stores. Pure, so it can be reasoned about without a browser.

export type PlaceComponent = { longText?: string; shortText?: string; types?: string[] };

export type ParsedAddress = {
  street: string;
  unit: string;
  city: string;
  state: string;
  zip: string;
  country: string;
};

export function parsePlaceAddress(components: PlaceComponent[] | undefined): ParsedAddress {
  const find = (type: string) => components?.find((c) => c.types?.includes(type));
  const long = (type: string) => find(type)?.longText ?? "";
  const short = (type: string) => find(type)?.shortText ?? "";

  const streetNumber = long("street_number");
  const route = long("route");
  // Places without a street number (a highway, an intersection) are still useful.
  const street = [streetNumber, route].filter(Boolean).join(" ") || long("premise");

  const city =
    long("locality") || long("postal_town") || long("sublocality_level_1") || long("administrative_area_level_3");

  return {
    street,
    unit: long("subpremise"),
    city,
    state: short("administrative_area_level_1"),
    // The 5-digit ZIP only; the "+4" suffix is noise for dispatch.
    zip: long("postal_code"),
    country: short("country"),
  };
}
