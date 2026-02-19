import OpenAI from "openai";

/**
 * Embedding provider abstraction.
 * Currently supports OpenAI only, but designed for future extensibility.
 */
export interface EmbeddingProvider {
  embed(text: string): Promise<number[]>;
}

/**
 * OpenAI embedding provider.
 */
export class OpenAIEmbeddings implements EmbeddingProvider {
  private client: OpenAI;

  constructor(
    apiKey: string,
    private model: string,
  ) {
    this.client = new OpenAI({ apiKey });
  }

  async embed(text: string): Promise<number[]> {
    const response = await this.client.embeddings.create({
      model: this.model,
      input: text,
    });
    return response.data[0].embedding;
  }
}

/**
 * Create an embedding provider based on config.
 */
export function createEmbeddingProvider(config: {
  provider: "openai";
  apiKey: string;
  model: string;
}): EmbeddingProvider {
  if (config.provider === "openai") {
    return new OpenAIEmbeddings(config.apiKey, config.model);
  }
  throw new Error(`Unsupported embedding provider: ${config.provider}`);
}
