import type PDFDocumentType from "pdfkit";

// @ts-expect-error pdfkit standard font data has no type declarations.
import Helvetica from "pdfkit/standard-fonts/Helvetica";
// @ts-expect-error pdfkit standard font data has no type declarations.
import HelveticaBold from "pdfkit/standard-fonts/HelveticaBold";

type BrowserPdf = {
  default: typeof PDFDocumentType;
  registerStdFonts: (...fonts: Array<{ name: string }>) => void;
};

// Relative path bypasses pdfkit's node export, which loads fonts through createRequire.
// @ts-expect-error pdfkit browser build ships without type declarations.
const browser = (await import("../../node_modules/pdfkit/js/pdfkit.browser.mjs")) as BrowserPdf;

browser.registerStdFonts(Helvetica, HelveticaBold);

const PDFDocument = browser.default;
export default PDFDocument;
