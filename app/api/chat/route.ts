import { streamText } from "ai";
import { createOpenAI } from "@ai-sdk/openai"; // OpenAI provider
import { getVectorStore } from "@/lib/vector-store";

async function searchKnowledgeBase(query: string): Promise<string> {
  try {
    const store = getVectorStore();
    const results = await store.similaritySearch(query, 3);
    return results.map((doc) => doc.content).join("\n\n");
  } catch (error) {
    console.error("Knowledge base search failed:", error);
    return "";
  }
}

export async function POST(req: Request) {
  try {
    const { messages } = await req.json();

    const lastMessage = messages[messages.length - 1];
    const userQuery = lastMessage?.content || "";

    const context = await searchKnowledgeBase(userQuery);

    let systemPrompt = `You are an intelligent LEED (Leadership in Energy and Environmental Design) consultant assistant. You help users with LEED certification questions, sustainable building practices, and environmental design strategies.

Key characteristics:
- Provide accurate, professional, and helpful responses
- Focus on LEED certification requirements, sustainable building practices, and environmental design
- If uncertain about an answer, be honest and suggest consulting official LEED documentation
- Use clear, concise language appropriate for building professionals
- When discussing LEED credits, mention specific credit categories (Location & Transportation, Sustainable Sites, Water Efficiency, Energy Efficiency, Sustainable Materials, Indoor Environmental Quality, Project Priorities)
- Provide actionable recommendations for improving LEED scores

Always respond in English unless specifically asked to use another language.`;

    if (context.trim()) {
      systemPrompt += `

Based on the following knowledge base content, answer the user's question:

${context}

Please prioritize information from the knowledge base when answering. If the knowledge base doesn't contain relevant information, you may use your general knowledge about LEED and sustainable building practices.`;
    }

    const deepseek = createOpenAI({
      apiKey: process.env.NEXT_PUBLIC_CHAT_API_KEY,
      baseURL: process.env.NEXT_PUBLIC_CHAT_BASE_URL,
      compatibility: "compatible",
    });

    const response = await streamText({
      model: deepseek.chat(process.env.NEXT_PUBLIC_CHAT_MODEL!),
      messages: [{ role: "system", content: systemPrompt }, ...messages],
      maxTokens: 1000,
      temperature: 0.7,
    });

    return response.toDataStreamResponse();
  } catch (parseError: unknown) {
    console.error("Request parsing error:", parseError);
    return new Response(
      JSON.stringify({
        error: "Invalid request format",
        details:
          parseError instanceof Error ? parseError.message : "Unknown error",
      }),
      {
        status: 400,
        headers: { "Content-Type": "application/json" },
      }
    );
  }
}
