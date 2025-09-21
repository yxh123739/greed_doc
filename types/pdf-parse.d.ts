declare module "pdf-parse-debugging-disabled" {
  interface PDFData {
    numpages: number;
    numrender: number;
    info: any;
    metadata: any;
    text: string;
    version: string;
  }

  function pdf(buffer: Uint8Array | Buffer): Promise<PDFData>;
  export = pdf;
}
