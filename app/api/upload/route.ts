import { NextRequest, NextResponse } from "next/server";
import { RecursiveCharacterTextSplitter } from "langchain/text_splitter";
import pdf from "pdf-parse-debugging-disabled";
import mammoth from "mammoth";
import { getVectorStore } from "@/lib/vector-store";

async function parseFile(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const uint8Array = new Uint8Array(buffer);

  if (file.type === "application/pdf") {
    try {
      const data = await pdf(uint8Array);
      return data.text;
    } catch (error) {
      throw new Error(`PDF parsing failed: ${error}`);
    }
  } else if (
    file.type ===
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document"
  ) {
    try {
      const result = await mammoth.extractRawText({
        buffer: Buffer.from(uint8Array),
      });
      return result.value;
    } catch (error) {
      throw new Error(`Word document parsing failed: ${error}`);
    }
  } else if (file.type === "text/plain" || file.type === "text/markdown") {
    return new TextDecoder().decode(uint8Array);
  } else {
    throw new Error(`Unsupported file type: ${file.type}`);
  }
}

export async function POST(req: NextRequest) {
  try {
    const formData = await req.formData();
    const file = formData.get("file") as File;
    const content = formData.get("content") as string;

    if (!file && !content) {
      return NextResponse.json(
        { error: "Please provide a file or text content" },
        { status: 400 }
      );
    }

    let text = content || "";

    if (file) {
      text = await parseFile(file);
    }

    if (!text.trim()) {
      return NextResponse.json(
        { error: "Document content is empty" },
        { status: 400 }
      );
    }

    // Split text into chunks
    const splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1000,
      chunkOverlap: 200,
    });

    const docs = await splitter.createDocuments(
      [text],
      [
        {
          source: file?.name || "text_input",
          timestamp: new Date().toISOString(),
        },
      ]
    );

    // Convert to simplified format and store in vector database
    const docsForStore = docs.map((doc) => ({
      content: doc.pageContent,
      metadata: {
        source: doc.metadata.source as string,
        timestamp: doc.metadata.timestamp as string,
      },
    }));

    try {
      const store = getVectorStore();
      await store.addDocuments(docsForStore);

      return NextResponse.json({
        success: true,
        message: `Document processed successfully, split into ${docs.length} chunks`,
        chunks: docs.length,
        totalDocs: store.getDocumentCount(),
      });
    } catch (vectorError) {
      console.error("Vector storage error:", vectorError);
      return NextResponse.json({
        success: true,
        message: `Document parsed successfully (${docs.length} chunks), but vector storage encountered issues`,
        chunks: docs.length,
        warning: "Vector storage issues may limit search functionality",
      });
    }
  } catch (error) {
    console.error("Document processing error:", error);
    return NextResponse.json(
      {
        error: `Processing failed: ${
          error instanceof Error ? error.message : "Unknown error"
        }`,
      },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    return NextResponse.json({
      message: "Knowledge base API is running normally",
      status: "ready",
    });
  } catch {
    return NextResponse.json(
      { error: "Failed to get information" },
      { status: 500 }
    );
  }
}
