/**
 * Comfy Asset Manager - Copyright (c) 2026 Greg Tee. All Rights Reserved.
 * Local AI Service - Connects to local LLM runners (like Ollama) for text analysis.
 */

const http = require('http');
const { getSetting } = require('../database');

class AIService {
    /**
     * Send a prompt to the configured local LLM
     * @param {string} systemPrompt - The system instructions
     * @param {string} userPrompt - The user input
     * @returns {Promise<string>} The raw text response from the model
     */
    static async generate(systemPrompt, userPrompt) {
        // Fallbacks: If user hasn't set anything, assume default Ollama
        const aiUrl = getSetting('llm_url') || 'http://localhost:11434/api/generate';
        const aiModel = getSetting('llm_model') || 'deepseek-r1:32b'; // Safe default based on inventory

        return new Promise((resolve, reject) => {
            try {
                const urlObj = new URL(aiUrl);
                
                // Ollama native API format
                const payload = JSON.stringify({
                    model: aiModel,
                    system: systemPrompt,
                    prompt: userPrompt,
                    stream: false,
                    options: {
                        temperature: 0.1 // Keep it analytical and strict
                    }
                });

                const options = {
                    hostname: urlObj.hostname,
                    port: urlObj.port,
                    path: urlObj.pathname + urlObj.search,
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Content-Length': Buffer.byteLength(payload)
                    },
                    timeout: 60000 // DeepSeek 70b can take a minute to chew
                };

                const req = http.request(options, (res) => {
                    let data = '';
                    res.on('data', chunk => { data += chunk; });
                    res.on('end', () => {
                        if (res.statusCode >= 400) {
                            return reject(new Error(`LLM API Error ${res.statusCode}: ${data}`));
                        }
                        
                        try {
                            const parsed = JSON.parse(data);
                            // Ollama returns { response: "..." }
                            let responseText = parsed.response || '';
                            
                            // DeepSeek R1 outputs <think> tags. Let's strip them out so we only get the JSON block
                            responseText = responseText.replace(/<think>[\s\S]*?<\/think>/g, '').trim();
                            
                            resolve(responseText);
                        } catch (err) {
                            reject(new Error(`Failed to parse LLM response: ${err.message}`));
                        }
                    });
                });

                req.on('error', (e) => reject(new Error(`Could not reach LLM at ${aiUrl}. Is Ollama running?`)));
                req.on('timeout', () => {
                    req.destroy();
                    reject(new Error('LLM request timed out. Model might be too heavy or still loading into VRAM.'));
                });

                req.write(payload);
                req.end();
            } catch (err) {
                reject(new Error(`Invalid LLM URL: ${aiUrl}`));
            }
        });
    }

    /**
     * Build Shot Builder format from client spec
     * @param {string} specExample - e.g. "BATMAN_ep101_sq020_sh010_comp_v001"
     */
    static async parseNamingConvention(specExample) {
        const systemPrompt = `You are a strict JSON API for a VFX pipeline tool. 
Look at the example file name provided by the user. 
Break it down into a sequence of building blocks representing standard VFX naming convention tokens.
The available token types are: "project", "episode", "sequence", "shot", "role", "version", or "custom". 
If there is a static block of text that is not one of those, mark its type as "custom" and put the static text in a "label" key.

For each block, determine the separator that comes BEFORE it. The very first block MUST have an empty string "" for its separator.
Version tokens usually contain a 'v' block, e.g. separator "_v".

Respond ONLY with a valid, raw JSON array of objects representing these blocks in order. 
Do NOT wrap the output in markdown code blocks (\`\`\`json). Do NOT add any conversational text.

Example format:
[
  { "type": "project", "separator": "" },
  { "type": "episode", "separator": "_" },
  { "type": "sequence", "separator": "_" },
  { "type": "shot", "separator": "_" },
  { "type": "role", "separator": "_" },
  { "type": "version", "separator": "_v" }
]`;

        const responseText = await this.generate(systemPrompt, specExample);
        
        try {
            // In case the LLM ignored instructions and wrapped it in markdown anyway, try to clean it
            const cleanText = responseText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
            const parsed = JSON.parse(cleanText);
            
            if (!Array.isArray(parsed)) {
                throw new Error("Response was not a JSON array");
            }
            return parsed;
        } catch (err) {
            throw new Error(`Failed to parse AI output into JSON. AI said: ${responseText}`);
        }
    }
}

module.exports = AIService;