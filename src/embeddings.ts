import * as dotenv from 'dotenv'
dotenv.config()

export async function getEmbedding(text: string): Promise<number[]> {
  const response = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${process.env.COHERE_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      texts: [text],
      model: 'embed-english-light-v3.0',
      input_type: 'search_document'
    }),
  })

  if (!response.ok) {
    const err = await response.text()
    throw new Error(`Cohere API error: ${err}`)
  }

  const data = await response.json()
  return (data as any).embeddings[0]
}