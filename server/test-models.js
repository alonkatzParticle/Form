import 'dotenv/config';
import Anthropic from '@anthropic-ai/sdk';
const client = new Anthropic();
async function run() {
  const models = ['claude-3-5-haiku-20241022', 'claude-3-5-sonnet-20241022', 'claude-sonnet-4-6', 'claude-3-5-sonnet-latest', 'claude-haiku-4-5'];
  for (const model of models) {
    try {
      await client.messages.create({ model, max_tokens: 10, messages: [{role: 'user', content: 'hello'}] });
      console.log(`✅ ${model} WORKS`);
    } catch (err) {
      console.log(`❌ ${model} FAILED: ${err.message}`);
    }
  }
}
run();
