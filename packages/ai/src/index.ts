export type AIMessageRole = 'system' | 'user' | 'assistant';

export interface AIMessage {
  readonly role: AIMessageRole;
  readonly content: string;
}

export interface AIRequest {
  readonly model: string;
  readonly messages: readonly AIMessage[];
}

export interface AIResponse {
  readonly content: string;
}

/** Optional provider contract. No AI service or network provider is initialized in v0.1.0. */
export interface AIProvider {
  readonly id: string;
  complete(request: AIRequest): Promise<AIResponse>;
}
