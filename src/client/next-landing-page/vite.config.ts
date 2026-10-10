import { defineConfig, type Plugin } from "vite";
import vinext from "vinext";
import { cloudflare } from "@cloudflare/vite-plugin";
import path from "node:path";

// pdfkit.browser resolves the ICC profile with `new URL(..., import.meta.url)`
// at module init. The Workers bundle does not supply a valid import.meta.url,
// so that throws and every /api/v1 route that loads actions returns HTML 1101.
function pdfkitIccProfile(): Plugin {
  const needle =
    "const ICC_PROFILE_PATH = new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url).href;";
  const replacement =
    "const ICC_PROFILE_PATH = (() => { try { return new URL('./data/sRGB_IEC61966_2_1.icc', import.meta.url).href; } catch { return 'pdfkit-data:sRGB_IEC61966_2_1.icc'; } })();";
  return {
    name: "pdfkit-icc-profile",
    enforce: "pre",
    transform(code, id) {
      if (!id.includes("pdfkit.browser") || !code.includes(needle)) return null;
      return code.replaceAll(needle, replacement);
    },
  };
}

export default defineConfig({
  plugins: [
    pdfkitIccProfile(),
    vinext(),
    cloudflare({
      viteEnvironment: {
        name: "rsc",
        childEnvironments: ["ssr"],
      },
    }),
  ],
  resolve: {
    alias: {
      "@napi-rs/canvas": path.resolve(import.meta.dirname, "empty-stub.js"),
    },
  },
});
