// SimpleVectorStore.ts
import OpenAI from "openai";
import path from "path";
import fs from "fs";

const STORE_PATH = path.resolve("./public/vector_store.json");

interface Document {
  id: string;
  content: string;
  metadata: {
    source: string;
    timestamp: string;
  };
}

interface VectorDocument extends Document {
  embedding?: number[];
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export class SimpleVectorStore {
  private documents: VectorDocument[] = [];

  constructor() {
    this.loadFromDisk();
  }

  async addDocuments(
    docs: { content: string; metadata: { source: string; timestamp: string } }[]
  ) {
    const vectorDocs: VectorDocument[] = [];

    try {
      const contents = docs.map((doc) => doc.content);

      // 检查已有缓存
      const existingMap = new Map(
        this.documents.map((d) => [d.content, d.embedding])
      );

      // 需要计算 embedding 的内容
      const toEmbed = contents.filter((c) => !existingMap.has(c));
      let newEmbeddings: number[][] = [];

      if (toEmbed.length > 0) {
        newEmbeddings = await this.getBatchEmbeddings(toEmbed);
      }

      let embedIndex = 0;
      docs.forEach((doc) => {
        const id = `doc_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;

        let embedding = existingMap.get(doc.content);
        if (!embedding && toEmbed.includes(doc.content)) {
          embedding = newEmbeddings[embedIndex++];
        }

        vectorDocs.push({
          id,
          content: doc.content,
          metadata: doc.metadata,
          embedding,
        });
      });
    } catch (error) {
      console.log("批量向量生成失败，回退到文本搜索模式:", error);

      // 回退到无向量模式
      docs.forEach((doc) => {
        const id = `doc_${Date.now()}_${Math.random()
          .toString(36)
          .substr(2, 9)}`;
        vectorDocs.push({
          id,
          content: doc.content,
          metadata: doc.metadata,
        });
      });
    }

    this.documents.push(...vectorDocs);
    this.saveToDisk();
  }

  async similaritySearch(query: string, k: number = 3): Promise<Document[]> {
    if (this.documents.length === 0) return [];

    // 如果有 embedding，用向量搜索
    if (this.documents[0].embedding) {
      try {
        const queryEmbedding = await this.getEmbedding(query);
        const similarities = this.documents.map((doc) => ({
          doc,
          similarity: this.cosineSimilarity(queryEmbedding, doc.embedding!),
        }));

        return similarities
          .sort((a, b) => b.similarity - a.similarity)
          .slice(0, k)
          .map((item) => ({
            id: item.doc.id,
            content: item.doc.content,
            metadata: item.doc.metadata,
          }));
      } catch (err) {
        console.log("向量搜索失败，回退到文本搜索:", err);
      }
    }

    console.log("no embedding use text similarity");

    // fallback: 简单文本搜索
    const queryLower = query.toLowerCase();
    const matches = this.documents
      .map((doc) => ({
        doc,
        score: this.textSimilarity(queryLower, doc.content.toLowerCase()),
      }))
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, k);

    return matches.map((item) => ({
      id: item.doc.id,
      content: item.doc.content,
      metadata: item.doc.metadata,
    }));
  }

  private async getBatchEmbeddings(texts: string[]): Promise<number[][]> {
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: texts,
      });

      return response.data.map((item) => item.embedding);
    } catch (error) {
      console.error("OpenAI embedding error:", error);
      throw error;
    }
  }

  private async getEmbedding(text: string): Promise<number[]> {
    try {
      const response = await openai.embeddings.create({
        model: "text-embedding-3-small",
        input: text,
      });

      return response.data[0].embedding;
    } catch (error) {
      console.error("OpenAI embedding error:", error);
      throw error;
    }
  }

  private cosineSimilarity(a: number[], b: number[]): number {
    const dotProduct = a.reduce((sum, ai, i) => sum + ai * b[i], 0);
    const magnitudeA = Math.sqrt(a.reduce((sum, ai) => sum + ai * ai, 0));
    const magnitudeB = Math.sqrt(b.reduce((sum, bi) => sum + bi * bi, 0));
    return dotProduct / (magnitudeA * magnitudeB);
  }

  private textSimilarity(query: string, content: string): number {
    const queryWords = query.split(/\s+/).filter((w) => w.length > 2);
    const contentWords = content.split(/\s+/);

    let matches = 0;
    for (const queryWord of queryWords) {
      if (
        contentWords.some(
          (contentWord) =>
            contentWord.includes(queryWord) || queryWord.includes(contentWord)
        )
      ) {
        matches++;
      }
    }
    return queryWords.length > 0 ? matches / queryWords.length : 0;
  }

  getDocumentCount(): number {
    return this.documents.length;
  }

  clear(): void {
    this.documents = [];
    this.saveToDisk();
  }

  private saveToDisk(): void {
    try {
      fs.writeFileSync(STORE_PATH, JSON.stringify(this.documents, null, 2));
    } catch (err) {
      console.error("保存向量数据失败:", err);
    }
  }

  private loadFromDisk(): void {
    try {
      if (fs.existsSync(STORE_PATH)) {
        const raw = fs.readFileSync(STORE_PATH, "utf-8");
        this.documents = JSON.parse(raw);
      }
    } catch (err) {
      console.error("加载向量数据失败:", err);
    }
  }
}

// 单例
let globalVectorStore: SimpleVectorStore | null = null;

export function getVectorStore(): SimpleVectorStore {
  if (!globalVectorStore) {
    globalVectorStore = new SimpleVectorStore();
  }
  return globalVectorStore;
}
