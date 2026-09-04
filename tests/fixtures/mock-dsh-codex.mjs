export class OpenAICodexCredentialStore {}

export class OpenAICodexImageClient {
  constructor() {}

  async generate(prompt, images) {
    if (!Array.isArray(images) || images.length !== 2) throw new Error('mask reference was not forwarded');
    if (!String(prompt).includes('alpha=0')) throw new Error('mask alpha convention was not described');
    return Buffer.from('mock-generated-image');
  }
}

