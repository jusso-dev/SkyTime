// Lazy loader for the Google Maps Places library. Returns null when no API
// key is configured so callers can fall back to a plain input. The script is
// fetched once per page lifetime, even when multiple components mount.

type MapsNamespace = {
  maps: {
    places: {
      Autocomplete: new (
        input: HTMLInputElement,
        options?: Record<string, unknown>,
      ) => {
        addListener: (event: string, handler: () => void) => { remove?: () => void };
        getPlace: () => { formatted_address?: string };
      };
    };
  };
};

declare global {
  interface Window {
    google?: MapsNamespace;
  }
}

let loadPromise: Promise<MapsNamespace> | null = null;

export function getGoogleMapsApiKey(): string {
  return process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY ?? "";
}

export function loadGooglePlaces(): Promise<MapsNamespace> | null {
  if (typeof window === "undefined") return null;
  const apiKey = getGoogleMapsApiKey();
  if (!apiKey) return null;
  if (window.google?.maps?.places) return Promise.resolve(window.google);
  if (loadPromise) return loadPromise;

  loadPromise = new Promise((resolve, reject) => {
    const callbackName = "__skytimeGoogleMapsLoaded";
    const win = window as unknown as Record<string, unknown>;
    win[callbackName] = () => {
      if (window.google?.maps?.places) {
        resolve(window.google);
      } else {
        reject(new Error("Google Maps Places library missing"));
      }
    };
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(
      apiKey,
    )}&libraries=places&callback=${callbackName}&v=weekly`;
    script.async = true;
    script.defer = true;
    script.onerror = () => {
      loadPromise = null;
      reject(new Error("Google Maps failed to load"));
    };
    document.head.appendChild(script);
  });

  return loadPromise;
}
